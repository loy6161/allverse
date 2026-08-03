// ============================================================
// YouTubeライブチャットの読み取り（2026-08-03追加）
//
// なぜ必要か:
//   これまでの「YouTubeチャット連動」は、YouTubeのチャット画面を
//   ブラウザ会場にiframeで**はめ込んでいるだけ**で、こちらは中身を
//   1文字も受け取っていなかった。だから「誰が喋ったか」が分からず、
//   本人のアバターに吹き出しを出すことができなかった。
//   ここでチャットの中身をサーバーが直接読む。
//
// 元にしたもの:
//   L:\企画用\App_Dev\apps\loyall\VRC_User_Loger\event-analytics\
//     server\services\youtube.ts
//   あちらは「配信が終わった後に全部まとめて取る（分析・記事用）」ので、
//   nextPageToken を最後までめくり切って終了する作りだった。
//   こちらは「配信中に、新しい発言だけを取り続ける」ので回し方が逆になる。
//   APIの叩き方と authorDetails.channelId の取り出し方はあちらを踏襲した。
//
// 依存を足していない理由:
//   App_Dev は googleapis パッケージを使っているが、ここで要るのは
//   エンドポイント2本だけなので fetch で直接叩く。
//   本番（Render）の依存を1つでも増やさない方が壊れにくい。
//
// ⚠ APIの利用枠（quota）に注意:
//   liveChatMessages.list は1回あたり5ユニット。1日の既定枠は10,000。
//   5秒おきに回すと1時間で3,600ユニット＝3時間の配信で枠を使い切る。
//   そのため既定の間隔を10秒にしてある（3時間で約5,400ユニット）。
//   YouTube側が「これ以上短くするな」と指定してくる pollingIntervalMillis は
//   下限として必ず守る（守らないと弾かれる）。
//
// ★ 2026-08-04 追加 — 「配信していない時間」で枠を焼き切っていた:
//   2026-08-03、本番の配信中に quotaExceeded で連動が止まった。
//   原因は配信中の消費ではなく、**イベントを立てっぱなしにしていた待機時間**。
//   配信していない間も30秒おきに「まだ始まらない？」と聞き続けており、
//   それだけで1日 2,880回 × 5 = 14,400ユニット＝**配信しなくても枠が切れる**。
//   さらに連動ONのイベントが2つあり、消費は2倍になっていた。
//
//   対策は3つ:
//     ・待機中（配信していない）の間隔を大きく伸ばす（IDLE_INTERVAL_MS）
//     ・見ている人が誰もいないときは、そもそも読まない（shouldPoll）
//     ・枠切れを検知したら、その日はもう叩かない（枠が戻る時刻まで休む）
// ============================================================

const API = 'https://www.googleapis.com/youtube/v3';

/** 既定の取得間隔。quota を使い切らないための値（上のコメント参照） */
const DEFAULT_INTERVAL_MS = 10_000;

/** 連続で失敗したときに間隔を伸ばす上限。配信終了後に叩き続けないため */
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * 待機中（その動画がまだ配信中でない）の見に行く間隔。
 *
 * 以前は30秒だった。それだと待機だけで1日14,400ユニット＝枠(10,000)を超える。
 * 5分にすると1日 288回 × 5 = **1,440ユニット**で収まり、
 * 3時間の配信（5,400）と足しても枠の7割程度に留まる。
 *
 * 副作用は「配信開始に気づくのが最大5分遅れる」こと。
 * 開演前に会場を開けておく運用なので、5分の遅れは実害が小さいと判断した。
 */
const IDLE_INTERVAL_MS = 5 * 60_000;

/**
 * 枠が戻る時刻。YouTubeの枠は**太平洋時間の0時**にリセットされる。
 * 日本時間だと 16:00（冬・PST）か 17:00（夏・PDT）。
 * ここでは安全側に倒して「次の 17:00 JST」を待つ（早く再開して即また切らすより、
 * 少し待って確実に復活する方がよい）。
 */
const QUOTA_RESET_HOUR_JST = 17;

/** 枠切れを表すYouTube側の理由。これが返ったら叩くのをやめる */
const QUOTA_REASON = 'quotaExceeded';

/** 次に枠が戻る時刻（ミリ秒）。JSTの17時。既に過ぎていれば翌日の17時 */
function nextQuotaResetAt(now = Date.now()) {
  // サーバーのタイムゾーンに依存させない。UTCで組み立てる（JST = UTC+9）
  const jstNow = new Date(now + 9 * 3600_000);
  const reset = Date.UTC(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate(),
    QUOTA_RESET_HOUR_JST - 9, // JSTの17時 = UTCの8時
    0,
    0,
    0,
  );
  return reset > now ? reset : reset + 24 * 3600_000;
}

/** 1回の取得で受け取る最大件数 */
const MAX_RESULTS = 200;

/** 環境変数。未設定ならこの機能はまるごと動かない（他の機能には影響しない） */
const API_KEY = process.env.YOUTUBE_API_KEY || '';

/** 取得間隔は環境変数で調整できるようにしておく（枠が増えたら短くできる） */
const INTERVAL_MS = Math.max(
  2_000,
  Number(process.env.YT_POLL_MS) || DEFAULT_INTERVAL_MS,
);

export function isYouTubeReadEnabled() {
  return Boolean(API_KEY);
}

/**
 * テストからだけ触る出口（2026-08-04追加）。
 * 枠の計算は「数字を間違えると本番の配信が止まる」ので、外から検算できるようにする。
 * 本体のコードからは使わない。
 */
export const __quotaTestHooks = {
  nextQuotaResetAt,
  get IDLE_INTERVAL_MS() {
    return IDLE_INTERVAL_MS;
  },
  QUOTA_RESET_HOUR_JST,
};

// ------------------------------------------------------------
// 読み取りの健康状態（2026-08-03追加）
//
// なぜ要るのか:
//   「YouTubeにコメントしたのに会場に出ない」が起きたとき、外から分かるのは
//   「キーが設定されている」「読み取りが動いている」だけで、
//   **取れているのか・失敗しているのか・枠切れなのかが何も見えなかった**。
//   Renderのログを見に行かないと切り分けられず、配信中には間に合わない。
//   ここに最後の結果を残して /api/status から見えるようにする。
// ------------------------------------------------------------

const health = {
  lastOkAt: 0,        // 最後に取得できた時刻（ミリ秒）
  lastCount: 0,       // そのとき受け取った件数
  totalMsgs: 0,       // 起動してからの累計件数
  lastErrorAt: 0,     // 最後に失敗した時刻
  lastError: '',      // その理由（quotaExceeded など）
  fails: 0,           // 連続失敗回数（0に戻ったら復活した合図）
  nextInMs: 0,        // 次に見に行くまでの間隔（枠切れで伸びる）
  calls: 0,           // 起動してから叩いた回数（枠の消費 = calls × 5 ユニット）
  quotaOutUntil: 0,   // 枠切れで休んでいる終了時刻（0＝休んでいない）
  skipped: 0,         // 誰もいないので読まなかった回数
};

/** 枠切れに入る。全リーダー共通で止める（1つが切れていれば全部切れている） */
function enterQuotaOut() {
  health.quotaOutUntil = nextQuotaResetAt();
}

/** いま枠切れで休んでいるか */
function isQuotaOut() {
  if (!health.quotaOutUntil) return false;
  if (Date.now() >= health.quotaOutUntil) {
    // 枠が戻った。次のtickから普通に叩く
    health.quotaOutUntil = 0;
    health.fails = 0;
    return false;
  }
  return true;
}

function noteReadOk(count, nextInMs) {
  health.lastOkAt = Date.now();
  health.lastCount = count;
  health.totalMsgs += count;
  health.lastError = '';
  health.fails = 0;
  health.nextInMs = nextInMs;
}

function noteReadError(message, nextInMs) {
  health.lastErrorAt = Date.now();
  health.lastError = message;
  health.fails += 1;
  health.nextInMs = nextInMs;
}

/** 設定状況と直近の結果（/api/status 用）。キーそのものは絶対に出さない */
export function getYouTubeReadStatus() {
  const now = Date.now();
  const ago = (t) => (t ? Math.round((now - t) / 1000) : null);
  return {
    keySet: Boolean(API_KEY),
    intervalMs: INTERVAL_MS,
    // ↓ ここから2026-08-03追加。「取れているのか」を外から見るためのもの
    lastOkAgoSec: ago(health.lastOkAt),   // null＝起動してから一度も取れていない
    lastCount: health.lastCount,
    totalMsgs: health.totalMsgs,
    lastErrorAgoSec: ago(health.lastErrorAt),
    lastError: health.lastError,
    fails: health.fails,
    nextInMs: health.nextInMs,
    // ↓ 2026-08-04追加。枠の消費を開演前に確かめられるようにする
    calls: health.calls,
    quotaUsed: health.calls * 5, // liveChat/messages も videos も 1回5ユニット相当で数える
    quotaOutUntil: health.quotaOutUntil || null,
    quotaOutMinLeft: health.quotaOutUntil
      ? Math.max(0, Math.round((health.quotaOutUntil - now) / 60000))
      : null,
    skipped: health.skipped,
    idleIntervalMs: IDLE_INTERVAL_MS,
  };
}

async function apiGet(pathAndQuery) {
  const url = `${API}/${pathAndQuery}&key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.errors?.[0]?.reason || body?.error?.message || '';
    } catch {
      /* 本文が読めなくても状態コードだけで十分 */
    }
    const err = new Error(`YouTube API ${res.status} ${detail}`);
    err.status = res.status;
    err.reason = detail;
    throw err;
  }
  return res.json();
}

/**
 * 動画IDから「いま開いているライブチャットのID」を得る。
 * 配信が終わっていると activeLiveChatId は消えるので null が返る。
 */
export async function resolveLiveChatId(videoId) {
  const data = await apiGet(
    `videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`,
  );
  const item = data?.items?.[0];
  if (!item) return null;
  return item.liveStreamingDetails?.activeLiveChatId || null;
}

/**
 * 1件のチャットを、こちらで使う形に直す。
 * 欲しいのは「誰が(channelId)・何を(text)」だけなので、
 * スパチャやメンバーの判別は落としている（要るようになったら足す）。
 */
function parseItem(item) {
  const snippet = item?.snippet;
  const author = item?.authorDetails;
  if (!snippet || !author) return null;
  // テキスト発言以外（スパチャ・メンバー加入など）は本文が無いことがある。
  // 吹き出しに出すものが無いので捨てる
  const text = snippet.displayMessage || snippet.textMessageDetails?.messageText || '';
  const channelId = author.channelId || '';
  if (!text || !channelId) return null;
  return {
    id: item.id || `${snippet.publishedAt}_${channelId}`,
    channelId,
    name: author.displayName || '',
    text,
    ts: Date.parse(snippet.publishedAt || '') || Date.now(),
    isOwner: Boolean(author.isChatOwner),
    isModerator: Boolean(author.isChatModerator),
  };
}

/**
 * ひとつの配信のチャットを読み続ける係。
 *
 * 使い方:
 *   const r = new LiveChatReader(videoId, onMessages);
 *   r.start();  … 読み始める
 *   r.stop();   … 止める（イベントが閉じたら必ず呼ぶ）
 *
 * @param {string} videoId
 * @param {(messages: Array<object>) => void} onMessages 新しい発言が来たときに呼ばれる
 * @param {{shouldPoll?: () => boolean}} [opts]
 *   shouldPoll … false を返す間は**APIを叩かない**（会場に誰もいない等）。
 *   出す相手がいないのに読んでも枠を捨てるだけなので、呼び出し側に判断させる
 */
export class LiveChatReader {
  constructor(videoId, onMessages, opts = {}) {
    this.videoId = videoId;
    this.onMessages = onMessages;
    this.shouldPoll = typeof opts.shouldPoll === 'function' ? opts.shouldPoll : null;
    this.liveChatId = '';
    this.pageToken = '';
    this.timer = null;
    this.stopped = true;
    this.backoffMs = 0;
    /** 直近のエラー。管理者向けの状態表示に使う */
    this.lastError = '';
    /** 最初の1回は「これまでの発言」が大量に返るので、吹き出しに出さず読み飛ばす */
    this.primed = false;
  }

  start() {
    if (!API_KEY) {
      this.lastError = 'YOUTUBE_API_KEY が設定されていません';
      return;
    }
    if (!this.stopped) return;
    this.stopped = false;
    this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  schedule(ms) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick() {
    if (this.stopped) return;

    // ---- 叩く前の門番（2026-08-04追加）。ここで弾いたぶんは枠を使わない ----

    // 枠切れ中は一切叩かない。叩いても403が返るだけで、
    // 「戻ったのに気づかない」ようにしないため戻る時刻まで待つ
    if (isQuotaOut()) {
      const leftMs = health.quotaOutUntil - Date.now();
      this.lastError = `YouTubeの利用枠を使い切りました。${Math.ceil(leftMs / 60000)}分後（JST${QUOTA_RESET_HOUR_JST}時）に再開します`;
      // 1分ごとに「まだ戻らないか」だけ確認する（APIは叩かない）
      this.schedule(Math.min(leftMs + 1000, 60_000));
      return;
    }

    // 出す相手が誰もいないなら読まない。会場を開けっぱなしにしていても枠が減らない
    if (this.shouldPoll && !this.shouldPoll()) {
      health.skipped += 1;
      this.lastError = '';
      this.schedule(IDLE_INTERVAL_MS);
      return;
    }

    try {
      health.calls += 1;
      if (!this.liveChatId) {
        this.liveChatId = await resolveLiveChatId(this.videoId);
        if (!this.liveChatId) {
          // まだ配信が始まっていない／もう終わった。
          // 枠を無駄に使わないよう、少し待ってから見に行く
          // ⚠ ここを短くすると、待機しているだけで枠を焼き切る（冒頭のコメント参照）。
          //   以前は30秒で、それが2026-08-03の枠切れの主因だった
          this.lastError = 'この動画はいまライブ配信中ではありません';
          noteReadError(this.lastError, IDLE_INTERVAL_MS);
          this.schedule(IDLE_INTERVAL_MS);
          return;
        }
      }

      // ⚠ パスは `liveChat/messages`。`liveChatMessages` ではない。
      //   googleapis パッケージのメソッド名が `liveChatMessages.list` なので
      //   そのままURLに書いてしまい、**本文なしの404**が返って原因が分からなかった
      //   （2026-08-03 実配信で踏んだ。エラー本文が空なので気づきにくい）
      const q = [
        'liveChat/messages?part=snippet,authorDetails',
        `liveChatId=${encodeURIComponent(this.liveChatId)}`,
        `maxResults=${MAX_RESULTS}`,
      ];
      if (this.pageToken) q.push(`pageToken=${encodeURIComponent(this.pageToken)}`);
      const data = await apiGet(q.join('&'));

      this.pageToken = data.nextPageToken || '';
      this.lastError = '';
      this.backoffMs = 0;

      const items = Array.isArray(data.items) ? data.items : [];
      const msgs = items.map(parseItem).filter(Boolean);

      if (!this.primed) {
        // 1回目に返ってくるのは「入る前からあった発言」なので出さない。
        // ここを出すと、繋いだ瞬間に過去ログが全部吹き出しになって荒れる
        this.primed = true;
      } else if (msgs.length && this.onMessages) {
        this.onMessages(msgs);
      }

      // YouTubeが指定してくる待ち時間は下限として必ず守る。
      // こちらの既定（枠の節約）とどちらか長い方を採る
      const wantMs = Number(data.pollingIntervalMillis) || 0;
      const nextMs = Math.max(INTERVAL_MS, wantMs);
      noteReadOk(msgs.length, nextMs);
      this.schedule(nextMs);
    } catch (err) {
      this.lastError = err?.message || String(err);

      // ★ 枠切れ。叩き続けても無駄なので、枠が戻る時刻まで休む（2026-08-04追加）。
      //   以前は間隔を伸ばしながら叩き続けていて、枠を使い切ったあとも
      //   403を取り続けていた（意味が無いうえ、他のアプリの巻き添えにもなる）
      if (err?.reason === QUOTA_REASON) {
        enterQuotaOut();
        const leftMin = Math.ceil((health.quotaOutUntil - Date.now()) / 60000);
        this.lastError = `YouTubeの利用枠を使い切りました。${leftMin}分後（JST${QUOTA_RESET_HOUR_JST}時）に再開します`;
        console.warn('[ytread] 枠切れ。次の再開まで', leftMin, '分');
        noteReadError(this.lastError, 60_000);
        this.schedule(60_000);
        return;
      }

      // 配信が終わった／チャットが閉じた場合は liveChatId が無効になる。
      // 取り直せば「配信中ではない」に落ちるので、次で拾える
      if (err?.status === 403 || err?.status === 404) {
        this.liveChatId = '';
        this.pageToken = '';
      }

      // 失敗が続くときは間隔を伸ばす。
      // 枠切れ(quotaExceeded)で叩き続けると他のアプリの分まで巻き添えになる
      this.backoffMs = this.backoffMs
        ? Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
        : INTERVAL_MS * 2;
      console.warn('[ytread]', this.videoId, this.lastError);
      noteReadError(this.lastError, this.backoffMs);
      this.schedule(this.backoffMs);
    }
  }
}
