// ============================================================
// VERSE CITY Web — リアルタイム同期サーバー
// 仕様: docs/PROTOCOL.md（通信）/ docs/PRESENCE_SPEC.md §2.2（presence.json）
// 依存: ws / @libsql/client / google-auth-library
//
// 2026-07-29 構造変更: 「イベント ＞ ルーム」の二層になった。
//   イベント … 動画と再生位置の持ち主。管理者が作る。常設の main は消えない
//   ルーム   … イベント内の分割（定員30人）。同じイベントなら全ルームが同じ動画・同じ再生位置
// ============================================================

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

import {
  initStore,
  isPersistent,
  getStoreStatus,
  loadEvents,
  saveEvent,
  updateEventVideo,
  deleteEvent,
  loadProfile,
  saveProfile,
  loadBlocks,
  saveBlock,
  deleteBlock,
  loadBans,
  saveBan,
  deleteBan,
  logRunOpen,
  logRunRename,
  logRunClose,
  logVisitStart,
  logVisitEnd,
  closeOpenVisits,
  touchHeartbeat,
  listRuns,
  getRun,
  listVisits,
  listVisitsForRuns,
  loadKickTimeouts,
  saveKickTimeout,
  deleteKickTimeout,
  addKickLog,
  listKickLog,
  addChatLog,
  listChatLog,
} from './store.js';
import { summarize, gridSeries, autoStepMs, visitsCsv, seriesCsv, chatCsv } from './stats.js';
// YouTubeのライブチャットを読んで、本人のアバターに吹き出しを出す（2026-08-03追加）
import { LiveChatReader, isYouTubeReadEnabled, getYouTubeReadStatus } from './ytread.js';
import { initYtLinks, issueCode, matchMessage, unlink, isLinked, ytLinkCount } from './ytlink.js';
// ゲストの見た目はクライアントと同じ計算で決める（src/guestlook.js を両側で読む）。
// 別々に持つと片方だけ直したときに姿がズレるので、1本のファイルを共有する
import { guestLookFor } from '../src/guestlook.js';
import {
  verifyIdToken,
  roleForEmail,
  defaultRole,
  isGlobalRole,
  canControlVideo,
  canInteract,
  isLoginEnabled,
  getClientId,
} from './auth.js';

// 静的ファイル配信のルート（= クライアント一式があるプロジェクト直下）
const CLIENT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

// ------------------------------------------------------------
// 定数（仕様値）
// ------------------------------------------------------------
const PORT = process.env.PORT || 5179;
const WS_PATH = '/ws';

// 1ルームの定員はイベントごとに持つ（DEFAULT_CAPACITY / MIN_CAPACITY / MAX_CAPACITY を参照）
const RATE_LIMIT_PER_SEC = 20;    // 1クライアントが1秒に送れる最大メッセージ数
const MAX_NAME_LEN = 12;          // n の最大文字数
const MAX_TXT_LEN = 200;          // chat.txt の最大文字数
const MAX_COORD_ABS = 100;        // 座標の絶対値上限（これを超える/非数は破棄）

// エモートの既定リスト（docs/PROTOCOL.md と一致させること。ここにないidは破棄）
const EMOTE_IDS = new Set(['wave', 'clap', 'jump', 'dance', 'heart', 'penlight']);
const EMOTE_MIN_INTERVAL_MS = 500; // 1クライアントあたりのエモート最小間隔（連打防止）

// スクリーン
const DEFAULT_VIDEO_ID = 'unrobrGhlv0';       // 常設イベントの初期動画
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;    // YouTube動画IDの形式

// イベント
//
// 2026-07-30 変更: 「常設イベント(main)を必ず作る」のをやめた。
// 常設だと管理人の意思と関係なく常に入れてしまい、調整中でも人が入ってくる。
// いまは「管理人がイベントを立てている間だけ会場が開く」。
// パブリックで立てて閉じなければ、結果としてそれが常設になる（loyさん設計 2026-07-30）。
const MAX_EVENTS = 20;
const MAX_EVENT_NAME_LEN = 24;
const EVENT_ID_RE = /^[a-z0-9_-]{1,24}$/;
const MAX_EVENT_CODE_LEN = 24;                // 合言葉の最大文字数
const DEFAULT_CAPACITY = 30;                  // 1ルームの既定キャパ
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 60;                      // presence.json の web[] 上限に合わせる

// ゲスト（未ログイン）の見た目は src/guestlook.js が匿名IDから決める（2026-08-02）。
// 以前は全員同じ固定アバターだったが、
//   ・全ゲストが同じ姿になり、荒らしがいても「どのゲストか」を指させない
//   ・本人の画面だけ入場画面で決めた姿が残り、他人と食い違う
// という2つの問題があった。いまは髪なし＋肌と服の色がIDから決まる

// 開発用の権限指定を許すか。Render上では常に無効（RENDER環境変数が必ず立つため）。
// ローカルでのみ有効で、管理者/VIP/ゲストの挙動を実際に動かして確かめるために使う。
const DEV_ROLES = new Set(['admin', 'vip', 'user', 'guest']);
const ALLOW_DEV_ROLE = !process.env.RENDER;

// 迷惑行為への対処（2026-07-30追加）
const MAX_BLOCKS = 200;           // 1人が持てるブロックの上限
const MAX_BAN_REASON_LEN = 60;    // BAN理由の最大文字数

// PRESENCE_SPEC §2.2 向けの出力上限
const PRESENCE_MAX_WEB = 60;      // web[] の最大人数
const PRESENCE_CHAT_WINDOW_MS = 30 * 1000; // c を付与する直近発言の有効期間
const PRESENCE_CHAT_TXT_MAX = 40; // c[0] の最大文字数（30KB制約対応）

// 「直近チャット」フィールド(c)は実装済みだが、運用判断が済むまで既定は無効。
const ENABLE_CHAT_FIELD = false;

// 運営メッセージの固定枠（2026-08-02追加）。チャットに流すと見逃されるので別枠にする
const NOTICE_LEVELS = new Set(['info', 'important', 'emergency']);
const MAX_NOTICE_LEN = 120;

// キックのタイムアウト（2026-08-02追加）。0＝すぐ戻れる（従来どおり）
const KICK_MINUTES = new Set([0, 5, 15, 60, 180]);
const MAX_KICK_REASON_LEN = 60;

// NPCの上限（管理者が決める全体の上限。各自はこの範囲で自分の画面を増減する）
const MAX_NPC = 100;

// イベントログ（2026-07-31追加）
const HEARTBEAT_LOG_MS = 60 * 1000; // 「生きている印」を打つ間隔＝再起動時のズレの上限
const MAX_LOG_RUNS = 200;           // 記録画面と外部APIが返す開催の最大件数
// PORTAL（Supabase側）が集計を取りに来るための合言葉。
// 未設定なら外部APIは開かない（無効が既定。うっかり全世界に公開しないため）
const STATS_TOKEN = process.env.STATS_TOKEN || '';

// 会場を開く鍵（2026-07-31追加）。
//
// 開発中のものに直リンクで来られたくない、という要望への対処。
// 転送サービス（short.gy）経由でしか入れないようにする案が出たが、
// 302転送は「どこから来たか」をこちらに伝えないうえ、転送後は本物のURLが
// アドレスバーに出るため、経由の判定は原理的にできない（実測で確認）。
// そこで「案内するURLに鍵を付ける」形にした:
//   https://allverse.onrender.com/?k=<ENTRY_KEY>
// 鍵を変えれば、配ったURLもブックマークも一斉に無効になる＝いつでも閉じられる。
//
// ⚠ これは「うっかり来た人を止める」ためのもので、秘密を守る仕組みではない。
//   鍵つきURLをそのまま転送されれば入れる。守りたいのは公開の可否であって中身ではない。
// 未設定なら鍵は無効＝今までどおり誰でも入れる（ローカル開発と移行の安全策。
// GOOGLE_CLIENT_ID や STATS_TOKEN と同じ考え方）。
const ENTRY_KEY = process.env.ENTRY_KEY || '';

// ------------------------------------------------------------
// サーバー状態
// ------------------------------------------------------------
// events: Map<eventId, Event>
//   Event = { id, name, videoId, playback:{playing,pos,at},
//             requireLogin, entryCode, capacity, vrcBridge, createdAt }
//     requireLogin … ゲスト（未ログイン）を弾く
//     entryCode    … '' ならパブリック。文字列なら入場に合言葉が要る
//                    ⚠ この値はクライアントへ送らない（見られたら意味がない）。管理人にだけ返す
//     capacity     … 1ルームの定員。あとから変更できるが、いま入っている人数より下げられない
//     vrcBridge    … presence.json（VRChat連携）に出すイベントか。ONにできるのは1つだけ
const events = new Map();

// rooms: Map<roomKey, Map<clientId, ClientState>>   roomKey = `${eventId}#${roomNumber}`
const rooms = new Map();

let nextClientSeq = 1; // "c1", "c2", ... を払い出す連番
let nextGuestSeq = 1; // 「ゲスト001」の連番
const startedAt = Date.now();

// BANされたメールアドレス。入場のたびにDBを叩かないようメモリに載せておく。
// bans: Map<email, {email,name,byName,reason,createdAt}>
const bans = new Map();

// キックのタイムアウト（2026-08-02追加）。
// kickTimeouts: Map<eventId, Map<subject, {untilAt,name,byName,reason,createdAt}>>
//
// 「蹴るだけで即戻れる」ではBANとの間が空きすぎていたので、時間つきにした。
// subject は入場ログと同じ匿名ID（`u:ハッシュ`/`g:番号`）なので、
// Googleアカウントを持たないゲストにも効く（BANはゲストに効かない）。
const kickTimeouts = new Map();

/** タイムアウトを1件セットする（メモリ側） */
function setKickTimeout(t) {
  let m = kickTimeouts.get(t.eventId);
  if (!m) {
    m = new Map();
    kickTimeouts.set(t.eventId, m);
  }
  m.set(t.subject, t);
}

/**
 * その人がそのイベントから締め出し中か。切れていれば掃除して null を返す。
 * @returns {{untilAt:number, byName:string, reason:string}|null}
 */
function findKickTimeout(eventId, subject) {
  const m = kickTimeouts.get(eventId);
  if (!m) return null;
  const t = m.get(subject);
  if (!t) return null;
  if (t.untilAt <= Date.now()) {
    m.delete(subject);
    deleteKickTimeout(eventId, subject).catch(() => {});
    return null;
  }
  return t;
}

/** そのイベントにいる管理者だけに送る（運営向けの通知に使う） */
function notifyAdmins(eventId, obj) {
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    for (const c of members.values()) {
      if (c.role === 'admin') send(c.ws, obj);
    }
  }
}

/**
 * ブロックの相手を指す文字列。
 * ログイン済みは `e:メール`（次回入場しても同じ人）、
 * ゲストは `g:接続id`（ゲストは次に来たら別人なので、その場限りで十分）。
 */
function blockKeyOf(client) {
  return client.email ? `e:${client.email}` : `g:${client.id}`;
}

/**
 * 2人の間にブロックがあるか。
 * どちらか一方がブロックしていれば、両方から見えなくする（相互不可視）。
 * 片方向にすると、ブロックした相手にこちらの発言が届き続けるので、
 * 嫌がらせへの対処にならない。
 */
function isBlockedBetween(a, b) {
  if (!a || !b) return false;
  return a.blocks.has(blockKeyOf(b)) || b.blocks.has(blockKeyOf(a));
}

/**
 * 表示名はサーバーが決める（クライアントの申告は使わない）。
 *
 * 2026-07-29 確定: ログイン済みはGoogleアカウントの表示名で固定する。
 * この名前はYouTubeのコメントに出る名前と同じなので、コミュニティ内では既に公開名であり、
 * かつ本人以外は名乗れなくなる（なりすまし防止）。
 * 未ログインは「ゲスト+連番」をこちらで割り当てる。連番なので他人と被らず、詐称もできない。
 */
function resolveDisplayName(email, googleName) {
  if (!email) {
    const n = String(nextGuestSeq++).padStart(3, '0');
    return `ゲスト${n}`;
  }
  // Googleの表示名が取れないときはメールのローカル部で代替する
  const base = (googleName || '').trim() || String(email).split('@')[0];
  return clampString(base, MAX_NAME_LEN, 'メンバー');
}

// ------------------------------------------------------------
// イベントログ（2026-07-31 追加）
//
// 記録するのは「誰が・いつ入って・いつ出たか」の1行だけ。
// 同接の経過も累計も滞在時間も、あとからこの1本で計算できる（server/stats.js）。
//
// ★累計の数え方は「案A」（2026-07-31 loyさん決定）
//   ログイン済み … Googleアカウント単位。別の端末でも同じ人として数える
//   ゲスト       … ブラウザに保存した匿名の番号。同じブラウザなら同じ人
// どちらもメールアドレスや個人情報そのものは残さない。ログイン済みは
// メールのハッシュにして、記録から本人を逆算できないようにしている。
//
// NPC（賑やかし）はクライアント側だけの存在でサーバーに繋いでいないため、
// ここには最初から入らない＝人数の水増しは起きない。
// ------------------------------------------------------------

const VISITOR_ID_RE = /^[a-f0-9]{8,32}$/; // クライアントが持つ匿名IDの形式

/** 匿名の訪問者id。ログイン済みはメールのハッシュ、ゲストはブラウザ保存の番号 */
function visitorIdOf(client, rawVid) {
  if (client.email) {
    return `u:${createHash('sha256').update(client.email).digest('hex').slice(0, 16)}`;
  }
  const vid = typeof rawVid === 'string' ? rawVid.toLowerCase() : '';
  if (VISITOR_ID_RE.test(vid)) return `g:${vid.slice(0, 32)}`;
  // 匿名IDを送ってこない（保存できない）ブラウザ。その接続かぎりの扱いになる
  return `g:conn-${client.id}`;
}

/**
 * 入場を記録する。書き込みは待たず、行のidだけ client に持たせておく。
 * 記録の失敗で入場が遅れたり失敗したりしてはいけないので、すべて非同期・握り潰し。
 */
function startVisitLog(client, ev) {
  const joinedAt = Date.now();
  client.visitRunId = ev.runId;
  client.visitEnded = false;
  client.visitRow = logVisitStart({
    runId: ev.runId,
    eventId: ev.id,
    visitor: client.visitor,
    kind: client.role,
    name: client.n,
    room: client.room,
    joinedAt,
  }).catch(() => null);
}

/**
 * 退場を記録する。
 * 閉店と切断がほぼ同時に走るので、client側とDB側の両方で二重書き込みを防いでいる。
 */
function endVisitLog(client, closedBy = '') {
  if (!client.visitRow || client.visitEnded) return;
  client.visitEnded = true;
  const leftAt = Date.now();
  const p = client.visitRow;
  client.visitRow = null;
  p.then((id) => (id == null ? null : logVisitEnd(id, leftAt, closedBy))).catch(() => {});
}

/**
 * クライアント1人分の状態
 * @typedef {Object} ClientState
 * @property {string} id
 * @property {import('ws').WebSocket} ws
 * @property {string|null} eventId
 * @property {number|null} room
 * @property {boolean} joined
 * @property {string} role   'admin' | 'vip' | 'user' | 'guest'
 * @property {string} email
 * @property {string} n
 * @property {Object} av
 * @property {number} x
 * @property {number} z
 * @property {number} r
 * @property {boolean} m
 * @property {{txt:string, ts:number}|null} lastChat
 * @property {number[]} msgTimes
 */

// ------------------------------------------------------------
// イベント
// ------------------------------------------------------------

function makeEvent({
  id,
  name,
  videoId,
  requireLogin = false,
  entryCode = '',
  capacity = DEFAULT_CAPACITY,
  vrcBridge = false,
  createdAt = Date.now(),
  ownerEmail = '',
  npcMax = -1,
  chatMode = 'local',
  noticeLevel = '',
  noticeText = '',
}) {
  return {
    id,
    name,
    videoId,
    requireLogin,
    entryCode,
    capacity: clampCapacity(capacity),
    vrcBridge,
    createdAt,
    // 立てた人のメール。VIPは自分が立てたイベントだけ操作できる（2026-08-02）
    ownerEmail: String(ownerEmail || ''),
    // NPCの全体上限。-1 は自動（キャパ − 実在人数）＝これまでの挙動
    npcMax: Number.isFinite(npcMax) ? npcMax : -1,
    // 'local' … 独自チャット ／ 'youtube' … YouTubeチャットへ一本化
    chatMode: chatMode === 'youtube' ? 'youtube' : 'local',
    // 運営メッセージの固定枠（'' なら出さない）
    noticeLevel: NOTICE_LEVELS.has(noticeLevel) ? noticeLevel : '',
    noticeText: String(noticeText || ''),
    // 記録用の開催id。イベントidが将来使い回されても過去の記録と混ざらないように
    // 「id＋立てた時刻」で一意にする
    runId: `${id}-${createdAt}`,
    playback: { playing: true, pos: 0, at: Date.now(), live: false },
  };
}

/** キャパを許容範囲へ収める */
function clampCapacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CAPACITY;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.trunc(n)));
}

/** そのイベントで一番人が多いルームの人数（キャパを下げられる下限になる） */
function maxRoomOccupancy(eventId) {
  let n = 0;
  for (const [key, members] of rooms) {
    if (keyEventId(key) === eventId) n = Math.max(n, members.size);
  }
  return n;
}

/** VRChatへ出すイベント（vrcBridge が立っているもの）。無ければ null */
function bridgedEvent() {
  for (const ev of events.values()) if (ev.vrcBridge) return ev;
  return null;
}

/** vrcBridge は1つだけ。指定のイベント以外を落とす */
function makeBridgeExclusive(keepId) {
  for (const ev of events.values()) {
    if (ev.id !== keepId && ev.vrcBridge) ev.vrcBridge = false;
  }
}

/**
 * 現在の再生位置を求める（pos は at 時点の位置なので、再生中なら経過分を足す）
 *
 * ライブ配信のときは **pos を返さない**。
 * ライブの「再生位置」は配信の時刻そのもので、こちらが持っている経過秒とは無関係。
 * それを渡すと受け取った側が視聴可能範囲の外へシークして配信が止まる
 * （2026-07-30 の「生配信が途中で止まる」不具合の原因）。
 * クライアント側にもガードはあるが、古い版が繋いでも壊れないよう元から渡さない。
 */
function currentPlayback(eventId) {
  const ev = events.get(eventId);
  if (!ev) return { st: 'play' };
  const pb = ev.playback;
  if (pb.live) return { st: pb.playing ? 'play' : 'pause' };
  const elapsed = pb.playing ? (Date.now() - pb.at) / 1000 : 0;
  return { st: pb.playing ? 'play' : 'pause', pos: Math.max(0, pb.pos + elapsed) };
}

/** クライアントに渡すイベント情報（内部の at などは出さない） */
function toEventInfo(ev) {
  return {
    id: ev.id,
    name: ev.name,
    v: ev.videoId,
    requireLogin: ev.requireLogin,
    // 合言葉そのものは出さない。「要るかどうか」だけ伝える
    hasCode: Boolean(ev.entryCode),
    cap: ev.capacity,
    vrc: ev.vrcBridge,
    count: countInEvent(ev.id),
    // NPCの全体上限。-1 は自動（キャパ − 実在人数）。
    // 各自はこの範囲内で自分の画面のNPCを増減できる（超えられない）
    npcMax: ev.npcMax,
    // 'local'（独自チャット）/ 'youtube'（YouTubeチャットへ一本化）
    chatMode: ev.chatMode,
    // 運営メッセージの固定枠。level が空なら出さない
    notice: ev.noticeLevel ? { level: ev.noticeLevel, text: ev.noticeText } : null,
  };
}

/** そのイベントを操作できる人向け。合言葉の中身も返す（人に伝えるために必要） */
function toEventInfoAdmin(ev) {
  return { ...toEventInfo(ev), code: ev.entryCode };
}

/**
 * そのイベントを操作できるか（2026-08-02 追加）
 *
 * 管理者不在でもメンバーだけで会場を回せるようにするため、VIPに運営権限を渡した。
 * ただし**自分が立てたイベントだけ**に限る。そうしないと他人のイベントを
 * 勝手に閉じられてしまう（loyさんの配信中に別のVIPが閉じる、が起きうる）。
 *
 * ⚠ ログイン未設定（ローカル開発）では canControlVideo が全員 true を返すので、
 *   ここも全員 true になる。本番はログイン設定済みなので意図通りに効く。
 */
function canManageEvent(role, email, ev) {
  if (!ev) return false;
  if (canControlVideo(role)) return true; // 管理者（ログイン未設定なら全員）
  return role === 'vip' && Boolean(email) && ev.ownerEmail === email;
}

/** イベントを新しく立てられるか。VIPも立てられる（立てた本人が所有者になる） */
function canCreateEvent(role) {
  return canControlVideo(role) || role === 'vip';
}

function countInEvent(eventId) {
  let n = 0;
  for (const [key, members] of rooms) {
    if (keyEventId(key) === eventId) n += members.size;
  }
  return n;
}

/**
 * イベント一覧＋各ルームの人数（入場画面とルーム移動で使う）
 *
 * 合言葉の中身を含めるのは「そのイベントを操作できる人」にだけ。
 * 管理人の設定画面に現在の合言葉を出すために要る（見えないまま保存すると
 * 空欄で上書きされて合言葉が消えてしまう）。それ以外へは絶対に渡さない。
 *
 * 2026-08-02: 判定を**イベントごと**に変えた。VIPは自分が立てたイベントの
 * 合言葉だけ見えて、他人のイベントの合言葉は見えない。
 * viewer が null（公開JSON）のときは、どのイベントの合言葉も出さない。
 */
function buildEventList(viewer = null) {
  return Array.from(events.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((ev) => {
      const manage = viewer ? canManageEvent(viewer.role, viewer.email, ev) : false;
      return {
        ...(manage ? toEventInfoAdmin(ev) : toEventInfo(ev)),
        // クライアントが「設定」「閉じる」を出すかの判断に使う
        mine: manage,
        rooms: buildRoomList(ev.id),
      };
    });
}

/** そのイベントのルーム一覧。空きのある最小番号を必ず1つは含める */
function buildRoomList(eventId) {
  const list = [];
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    list.push({ room: keyRoomNumber(key), count: members.size, full: members.size >= capacityOf(eventId) });
  }
  list.sort((a, b) => a.room - b.room);
  const next = assignRoom(eventId);
  if (!list.some((r) => r.room === next)) list.push({ room: next, count: 0, full: false });
  return list;
}

// ------------------------------------------------------------
// ルームキーのユーティリティ
// ------------------------------------------------------------
function roomKey(eventId, roomNumber) {
  return `${eventId}#${roomNumber}`;
}
function keyEventId(key) {
  return key.slice(0, key.lastIndexOf('#'));
}
function keyRoomNumber(key) {
  return Number(key.slice(key.lastIndexOf('#') + 1));
}

/** そのイベントの定員（イベントが消えていれば既定値） */
function capacityOf(eventId) {
  const ev = events.get(eventId);
  return ev ? ev.capacity : DEFAULT_CAPACITY;
}

/** 指定ルームが定員未満か */
function roomHasSpace(eventId, roomNumber) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return true;
  return room.size < capacityOf(eventId);
}

/** そのイベントで「空きのある最小番号ルーム」 */
function assignRoom(eventId) {
  let n = 1;
  for (;;) {
    if (roomHasSpace(eventId, n)) return n;
    n += 1;
  }
}

/**
 * 入れるルームがあるか。
 * ルーム番号は無限に増やせる作りなので実際には必ず空きがあるが、
 * 「キャパ0のイベント」など将来の設定ミスで無限ループしないよう上限で打ち切る
 */
function assignableRoom(eventId) {
  if (capacityOf(eventId) < 1) return 0;
  const n = assignRoom(eventId);
  return n <= 999 ? n : 0;
}

// ------------------------------------------------------------
// ユーティリティ
// ------------------------------------------------------------

/** 文字列を強制トリム */
function clampString(value, maxLen, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLen);
}

/** 数値検証: 非数・±100超は無効(null)を返す */
function validCoord(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_COORD_ABS) return null;
  return value;
}

/** av はそのまま中継する想定だが、最低限オブジェクトであることだけ担保する */
function sanitizeAv(av) {
  if (av && typeof av === 'object' && !Array.isArray(av)) return av;
  return {};
}

/** JSON文字列として安全にwsへ送信する（送信失敗は無視） */
function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    // 送信エラーは無視（切断処理はcloseイベント側で行う）
  }
}

/**
 * 同室の全員（フィルタ可）にブロードキャスト。
 * from を渡すと、その人とブロック関係にある相手には届かない。
 */
function broadcastToRoom(eventId, roomNumber, obj, excludeId = null, from = null) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return;
  for (const client of room.values()) {
    if (excludeId && client.id === excludeId) continue;
    if (from && isBlockedBetween(from, client)) continue;
    send(client.ws, obj);
  }
}

/** 同じイベントの全ルームへブロードキャスト（管理者・VIPの姿と発言はこちらを使う） */
function broadcastToEvent(eventId, obj, excludeId = null, from = null) {
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    for (const client of members.values()) {
      if (excludeId && client.id === excludeId) continue;
      if (from && isBlockedBetween(from, client)) continue;
      send(client.ws, obj);
    }
  }
}

/**
 * そのクライアントの発信をどこまで届けるか。
 * 管理者・VIPはイベント全体、それ以外は自室のみ。
 * どちらの場合も、ブロック関係にある相手には届かない。
 */
function broadcastFrom(client, obj, excludeSelf = true) {
  const exclude = excludeSelf ? client.id : null;
  if (isGlobalRole(client.role)) {
    broadcastToEvent(client.eventId, obj, exclude, client);
  } else {
    broadcastToRoom(client.eventId, client.room, obj, exclude, client);
  }
}

/** 同室に人数変化を通知 */
function broadcastCount(eventId, roomNumber) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return;
  broadcastToRoom(eventId, roomNumber, { t: 'count', c: room.size });
}

/** peer-join/welcome用に「相手から見えるべき情報」だけを抜き出す */
function toPeerInfo(client) {
  return {
    id: client.id,
    n: client.n,
    av: client.av,
    x: client.x,
    z: client.z,
    r: client.r,
    role: client.role,
  };
}

/**
 * 自分から見えるべき相手の一覧。
 * 自室の全員＋（同じイベントの他ルームにいる）管理者・VIP。
 */
function visiblePeersFor(client) {
  const out = [];
  const myKey = roomKey(client.eventId, client.room);
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    const sameRoom = key === myKey;
    for (const other of members.values()) {
      if (other.id === client.id) continue;
      if (isBlockedBetween(client, other)) continue; // ブロック相手は最初から居ないものとして扱う
      if (sameRoom || isGlobalRole(other.role)) out.push(toPeerInfo(other));
    }
  }
  return out;
}

// ------------------------------------------------------------
// メッセージハンドラ（種別ごと）
// ------------------------------------------------------------

/** join: 入場処理。idt があればGoogleのIDトークンとして検証して権限を決める */
async function handleJoin(client, msg) {
  if (client.joined) return; // 二重join無視

  // ---- 認証（任意）----
  let role = defaultRole();
  let email = '';
  let googleName = '';
  if (msg.idt) {
    const info = await verifyIdToken(msg.idt);
    if (info) {
      email = info.email;
      googleName = info.name || '';
      role = roleForEmail(email);
    }
  }
  // 開発用の権限指定。Render上では絶対に効かない（RENDER環境変数で封じる）。
  // VIP・ゲストの挙動や、設定の保存/復元をローカルで試すためのもの。
  if (ALLOW_DEV_ROLE && typeof msg.devRole === 'string' && DEV_ROLES.has(msg.devRole)) {
    role = msg.devRole;
    if (typeof msg.devEmail === 'string' && msg.devEmail) {
      email = clampString(msg.devEmail, 120).toLowerCase();
      googleName = clampString(msg.devName, MAX_NAME_LEN);
    }
  }
  client.role = role;
  client.email = email;
  // 記録用の匿名id。入場を断られた場合は記録しないので、ここでは決めるだけ
  client.visitor = visitorIdOf(client, msg.vid);

  // BANされた人は入れない。名前を割り当てる前に弾く
  if (email && bans.has(email)) {
    const ban = bans.get(email);
    send(client.ws, { t: 'denied', reason: 'banned', by: ban.byName, why: ban.reason });
    return;
  }

  // ブロックしている相手をメモリに載せ直す（別の端末から入っても効くように）
  client.blocks = new Set();
  client.blockNames = new Map();
  if (email) {
    for (const b of await loadBlocks(email)) {
      client.blocks.add(`e:${b.email}`);
      client.blockNames.set(`e:${b.email}`, b.name);
    }
  }

  // ---- イベントの決定 ----
  // 常設イベントは廃止したので、フォールバック先が無い。
  // 管理人が何も立てていなければ会場は閉まっている（2026-07-30）
  if (events.size === 0) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }
  const ev = typeof msg.ev === 'string' ? events.get(msg.ev) : null;
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }

  // ログイン必須イベントにゲストは入れない
  if (ev.requireLogin && role === 'guest') {
    send(client.ws, { t: 'denied', reason: 'login-required', ev: ev.id });
    return;
  }

  // 合言葉。照合はサーバーだけで行う（クライアントには正解を渡していない）
  if (ev.entryCode && clampString(msg.code, MAX_EVENT_CODE_LEN) !== ev.entryCode) {
    send(client.ws, { t: 'denied', reason: 'bad-code', ev: ev.id });
    return;
  }

  // キックの締め出し中なら入れない（2026-08-02）。
  // 相手の識別は匿名IDなので、ログインしていないゲストにも効く
  const timeout = findKickTimeout(ev.id, client.visitor);
  if (timeout) {
    send(client.ws, {
      t: 'denied',
      reason: 'kicked-out',
      ev: ev.id,
      until: timeout.untilAt,
      by: timeout.byName,
      why: timeout.reason,
    });
    return;
  }

  // 満室なら入れない（キャパはイベントごと）
  if (!assignableRoom(ev.id)) {
    send(client.ws, { t: 'denied', reason: 'event-full', ev: ev.id });
    return;
  }

  // ---- ルームの決定（指定があり空いていればそこ、無ければ自動割当）----
  const wantRoom = Number.isInteger(msg.rm) && msg.rm >= 1 && msg.rm <= 999 ? msg.rm : null;
  const roomNumber = wantRoom && roomHasSpace(ev.id, wantRoom) ? wantRoom : assignRoom(ev.id);

  // 名前はサーバーが決める。msg.n は受け取らない（他人の名前を名乗れないようにするため）
  client.n = resolveDisplayName(email, googleName);
  // ゲストの見た目はサーバーが決める（クライアントの申告は使わない）。
  // 同じブラウザなら毎回同じ姿になるので「あの黄色いゲスト、また来てる」が成立する
  client.av = role === 'guest' ? guestLookFor(client.visitor) : sanitizeAv(msg.av);
  client.x = 0;
  client.z = 0;
  client.r = 0;
  client.m = false;
  client.eventId = ev.id;
  client.room = roomNumber;

  const key = roomKey(ev.id, roomNumber);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }

  client.joined = true;
  const peers = visiblePeersFor(client); // 自分を入れる前に集める
  room.set(client.id, client);

  send(client.ws, {
    t: 'welcome',
    id: client.id,
    // 名前はサーバーが決めるので、確定した表示名を本人にも返す
    n: client.n,
    // 見た目も返す。ゲストはサーバーが決めるので、これを返さないと
    // **本人の画面だけ入場画面で決めた姿のまま**になり、他人と食い違う（2026-08-02 修正）
    av: client.av,
    role: client.role,
    // 「いまいるイベントを操作できるか」。VIPは自分が立てたイベントだけ true になる
    canControl: canManageEvent(client.role, client.email, ev),
    // 「管理者そのものか」。イベントに依らない権限（BAN・記録の閲覧）の出し分けに使う。
    // canControl と分けているのは、VIPが自分のイベントを操作できる＝管理者ではないため。
    // これを一緒にすると、VIPに管理者専用パネルが見えてしまう（押しても弾かれる）
    isAdmin: canControlVideo(client.role),
    canInteract: canInteract(client.role),
    // YouTubeの発言を自分のアバターに出せる状態か（2026-08-03追加）。
    // yt.on … サーバーが読み取りできる設定になっているか（キーの有無）
    // yt.linked … この人が既にチャンネルを繋いでいるか（繋いでいれば合言葉は不要）
    yt: { on: isYouTubeReadEnabled(), linked: isLinked(client.visitor) },
    ev: ev.id,
    event: toEventInfo(ev),
    room: roomNumber,
    peers,
    count: room.size,
    cap: ev.capacity, // クライアントは「定員 − 実在人数」ぶんをNPCで埋める
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
    events: buildEventList(client),
    persistent: isPersistent(),
    blocked: blockedListFor(client), // 「ブロック中の人」を画面から解除できるようにする
  });

  // 管理者・VIPはイベント全体に、一般は自室にだけ現れる
  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, roomNumber);

  // 入場ログ（断られた人は通らないので、実際に入れた人だけが記録される）
  startVisitLog(client, ev);

  // 次回そのまま入れるように、ログイン済みなら名前と姿を覚えておく
  if (client.email) await saveProfile(client.email, client.n, client.av);
}

/** pos: 位置更新の中継 */
function handlePos(client, msg) {
  if (!client.joined) return;

  const x = validCoord(msg.x);
  const z = validCoord(msg.z);
  if (x === null || z === null) return; // 非数・範囲外は破棄

  const r = typeof msg.r === 'number' && Number.isFinite(msg.r) ? Math.trunc(msg.r) : 0;
  const m = Boolean(msg.m);

  client.x = x;
  client.z = z;
  client.r = r;
  client.m = m;

  broadcastFrom(client, { t: 'pos', id: client.id, x, z, r, m });
}

/**
 * chat: チャット中継
 * sc（scope）: 'local' … ワールド内だけ（既定）／'stream' … 配信にも流す想定の発言
 * ※ YouTubeへの送信そのものは未実装。ここではscopeを保持して中継するだけ。
 */
function handleChat(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-chat' });
    return;
  }

  // YouTubeチャット連動のイベントでは、会場の独自チャットは使わない。
  // クライアントは入力欄を隠しているが、それはUIの都合でしかない。
  // サーバーが止めないと開発者ツールから投げれば書き込めてしまい、
  // 「発言はYouTubeへ一本化する」という設計が成立しない（2026-08-02 追加）
  const myEvent = events.get(client.eventId);
  if (myEvent && myEvent.chatMode === 'youtube') {
    send(client.ws, { t: 'denied', reason: 'chat-on-youtube' });
    return;
  }

  const txt = clampString(msg.txt, MAX_TXT_LEN);
  if (!txt) return;

  // 配信送信は管理者のみ（誤爆すると配信のコメント欄から消せないため既定は local）
  let scope = msg.sc === 'stream' ? 'stream' : 'local';
  if (scope === 'stream' && !canControlVideo(client.role)) scope = 'local';

  client.lastChat = { txt, ts: Date.now() };

  // 会場チャットを記録する（2026-08-02 loyさん要望「何かあった時に証拠になるので」）。
  // ブロードキャストの前に await すると発言が遅れるので、記録は投げっぱなしにする。
  // ブロックで一部の人に見えなかった発言も残す——ブロックは見え方の話であって、
  // 「起きたこと」は起きたことなので、証拠としては残っている必要がある
  if (myEvent) {
    addChatLog({
      runId: myEvent.runId,
      eventId: myEvent.id,
      room: client.room,
      visitor: client.visitor,
      name: client.n,
      txt,
      scope,
      createdAt: Date.now(),
    }).catch(() => {});
  }

  // 発信者自身にも返す（クライアント側で自分のidなら無視する仕様）
  broadcastFrom(client, { t: 'chat', id: client.id, n: client.n, txt, sc: scope }, false);
}

/** update: アバターの再カスタム（名前は変えられない） */
async function handleUpdate(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-avatar' });
    return;
  }

  // 名前は入場時にサーバーが確定させたものを使い続ける。msg.n は無視する
  client.av = sanitizeAv(msg.av);

  broadcastFrom(client, { t: 'peer-update', id: client.id, n: client.n, av: client.av, role: client.role });

  // 変更後の姿を次回に持ち越す
  if (client.email) await saveProfile(client.email, client.n, client.av);
}

/** emote: エモート中継（既定リスト以外は破棄・連打は間引く） */
function handleEmote(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-emote' });
    return;
  }
  if (typeof msg.e !== 'string' || !EMOTE_IDS.has(msg.e)) return;

  const now = Date.now();
  if (client.lastEmoteAt && now - client.lastEmoteAt < EMOTE_MIN_INTERVAL_MS) return;
  client.lastEmoteAt = now;

  broadcastFrom(client, { t: 'emote', id: client.id, e: msg.e });
}

/** screen: イベントの動画を変更。いま自分がいるイベントを操作できる人だけ */
async function handleScreen(client, msg) {
  if (!client.joined) return;
  const ev = events.get(client.eventId);
  if (!ev) return;
  if (!canManageEvent(client.role, client.email, ev)) {
    send(client.ws, { t: 'denied', reason: 'not-your-event' });
    return;
  }
  if (typeof msg.v !== 'string' || !VIDEO_ID_RE.test(msg.v)) return;

  ev.videoId = msg.v;
  ev.playback = { playing: true, pos: 0, at: Date.now() }; // 動画が変われば先頭から

  broadcastToEvent(client.eventId, { t: 'screen', v: msg.v, by: client.n });
  // 権限ごとに中身が違う（管理者には合言葉が入る）ので、配り分けを持つ共通関数を使う。
  // ここで合言葉なしの一覧を管理者へ送ってしまうと、設定画面の合言葉欄が空になり、
  // そのまま保存した拍子に合言葉が消える（2026-07-31 実際に本番で消えた）
  broadcastAllEvents();
  await updateEventVideo(ev.id, msg.v);
}

/** playback: 再生/一時停止/シーク。いま自分がいるイベントを操作できる人だけ */
function handlePlayback(client, msg) {
  if (!client.joined) return;
  const ev = events.get(client.eventId);
  if (!ev) return;
  if (!canManageEvent(client.role, client.email, ev)) {
    send(client.ws, { t: 'denied', reason: 'not-your-event' });
    return;
  }
  if (msg.st !== 'play' && msg.st !== 'pause') return;
  const pos = typeof msg.pos === 'number' && Number.isFinite(msg.pos) ? Math.max(0, msg.pos) : 0;
  if (pos > 24 * 3600) return; // 異常値は破棄
  // ライブ配信なら位置は保存しない（上の currentPlayback のコメント参照）
  const live = msg.live === true;
  ev.playback = { playing: msg.st === 'play', pos: live ? 0 : pos, at: Date.now(), live };

  const out = { t: 'playback', id: client.id, st: msg.st };
  if (!live) out.pos = pos;
  broadcastToEvent(client.eventId, out, client.id);
}

/** event-create: イベント作成（管理者とVIP）。立てた本人が所有者になる */
async function handleEventCreate(client, msg) {
  if (!client.joined) return;
  if (!canCreateEvent(client.role)) {
    send(client.ws, { t: 'denied', reason: 'staff-only' });
    return;
  }
  if (events.size >= MAX_EVENTS) {
    send(client.ws, { t: 'denied', reason: 'too-many-events' });
    return;
  }

  const ev = await createEventFrom(msg, client.email);
  if (!ev) return;
  send(client.ws, { t: 'event-created', ev: toEventInfoAdmin(ev) });
  broadcastAllEvents();
}

/**
 * イベントを1つ作る。WS（入場後の🚪パネル）とHTTP（入場画面）の両方から使う。
 * 入場画面から作れないと、イベント0件のとき「入れないから作れない」で詰むため
 * 入口を2つ用意している（2026-07-30）。
 */
async function createEventFrom(msg, ownerEmail = '') {
  const name = clampString(msg && msg.name, MAX_EVENT_NAME_LEN).trim();
  if (!name) return null;
  const videoId =
    typeof msg.v === 'string' && VIDEO_ID_RE.test(msg.v) ? msg.v : DEFAULT_VIDEO_ID;

  // idは名前から作らず衝突しない連番にする（日本語名でも安全）
  let id = `ev${Date.now().toString(36)}`;
  if (!EVENT_ID_RE.test(id) || events.has(id)) id = `ev${Date.now().toString(36)}${events.size}`;

  const ev = makeEvent({
    id,
    name,
    videoId,
    requireLogin: Boolean(msg.requireLogin),
    entryCode: clampString(msg.code, MAX_EVENT_CODE_LEN).trim(),
    capacity: msg.cap,
    vrcBridge: Boolean(msg.vrc),
    // 立てた人。VIPが自分のイベントだけ操作できるようにするための印
    ownerEmail: String(ownerEmail || ''),
    chatMode: msg.chatMode === 'youtube' ? 'youtube' : 'local',
  });
  if (ev.vrcBridge) makeBridgeExclusive(ev.id);
  events.set(id, ev);
  await saveEvent(ev);
  // 開催の記録を開始（閉じるまでの入退場がこの runId にぶら下がる）
  await logRunOpen({ runId: ev.runId, eventId: ev.id, name: ev.name, openedAt: ev.createdAt });
  return ev;
}

/**
 * event-update: 立てたあとに設定を変える（管理者のみ）
 *
 * 変えると壊れるものだけ拒否する方針（loyさん指示 2026-07-30）。
 * いま拒否しているのは「キャパを現在の在室人数より下げること」だけ。
 * 名前・合言葉・ログイン必須・VRChat連携は、いつ変えても実害がないので通す
 * （合言葉を後から付けても、既に入っている人は追い出さない＝次の入場から効く）。
 */
async function handleEventUpdate(client, msg) {
  if (!client.joined) return;
  const ev = events.get(msg && msg.id);
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }
  // 権限はイベントごとに見る。VIPは自分が立てたイベントだけ変更できる
  if (!canManageEvent(client.role, client.email, ev)) {
    send(client.ws, { t: 'denied', reason: 'not-your-event' });
    return;
  }

  if (typeof msg.name === 'string') {
    const name = clampString(msg.name, MAX_EVENT_NAME_LEN).trim();
    if (name && name !== ev.name) {
      ev.name = name;
      // 記録側の名前も合わせる。あとから改名しても記録が同じ名前で追えるように
      await logRunRename(ev.runId, name);
    }
  }
  if (typeof msg.code === 'string') {
    ev.entryCode = clampString(msg.code, MAX_EVENT_CODE_LEN).trim();
  }
  if (typeof msg.requireLogin === 'boolean') {
    ev.requireLogin = msg.requireLogin;
  }
  if (typeof msg.vrc === 'boolean') {
    ev.vrcBridge = msg.vrc;
    if (ev.vrcBridge) makeBridgeExclusive(ev.id);
  }
  if (msg.cap !== undefined) {
    const want = clampCapacity(msg.cap);
    const floor = maxRoomOccupancy(ev.id);
    if (want < floor) {
      // 減らしすぎ。いま入っている人を弾き出すことになるので拒否する
      send(client.ws, { t: 'denied', reason: 'capacity-too-small', ev: ev.id, min: floor });
      return;
    }
    ev.capacity = want;
  }
  // NPCの全体上限。-1 は自動（キャパ − 実在人数）に戻す
  if (msg.npcMax !== undefined) {
    const n = Number(msg.npcMax);
    ev.npcMax = Number.isFinite(n) && n >= 0 ? Math.min(MAX_NPC, Math.trunc(n)) : -1;
  }
  // チャットの形（独自チャット / YouTubeへ一本化）
  if (msg.chatMode === 'local' || msg.chatMode === 'youtube') {
    ev.chatMode = msg.chatMode;
  }
  // 運営メッセージの固定枠。level を空にすると消える
  if (msg.notice !== undefined) {
    const lv = msg.notice && typeof msg.notice.level === 'string' ? msg.notice.level : '';
    const tx = msg.notice && typeof msg.notice.text === 'string' ? msg.notice.text : '';
    const text = clampString(tx, MAX_NOTICE_LEN).trim();
    // 本文が空なら、レベルが何であれ出さない（空の帯が残るのを防ぐ）
    ev.noticeLevel = NOTICE_LEVELS.has(lv) && text ? lv : '';
    ev.noticeText = ev.noticeLevel ? text : '';
  }

  await saveEvent(ev);
  send(client.ws, { t: 'event-updated', ev: toEventInfoAdmin(ev) });
  broadcastAllEvents();
  // 中にいる人へ、変わった設定をその場で反映させる（定員・チャットの形・運営メッセージ）。
  // 以前はイベント一覧しか配っていなかったので、
  // 「キャパを増やしてもNPCが増えない」など**途中変更が効かなかった**（2026-08-02 loyさん指摘）
  broadcastToEvent(ev.id, { t: 'event-changed', event: toEventInfo(ev) });
}

/**
 * event-delete: イベントを閉じる（管理者のみ）
 *
 * 2026-07-30 変更: 以前は「人がいる間は消せない」だったが、
 * 「閉じたら何もなくなる」方針に合わせ、中の人を退場させてから消す。
 * ライブの終演と同じ扱い。誤操作が怖いので、確認はクライアント側で取る。
 */
async function handleEventDelete(client, msg) {
  if (!client.joined) return;
  const ev = events.get(msg.id);
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'cannot-delete' });
    return;
  }
  // VIPは自分が立てたイベントしか閉じられない。
  // これが無いと、別のVIPが進行中のライブを閉じられてしまう
  if (!canManageEvent(client.role, client.email, ev)) {
    send(client.ws, { t: 'denied', reason: 'not-your-event' });
    return;
  }

  // 中にいる人へ「閉まった」ことを伝えて切る（自分も含む）
  for (const [key, members] of Array.from(rooms)) {
    if (keyEventId(key) !== ev.id) continue;
    for (const c of Array.from(members.values())) {
      // 記録は切断より先に閉じる。理由が '' ではなく「閉店」として残るようにするため
      endVisitLog(c, 'event-closed');
      send(c.ws, { t: 'closed', ev: ev.id, name: ev.name });
      try {
        c.ws.close();
      } catch (e) {
        // 既に切れていても構わない
      }
    }
    rooms.delete(key);
  }

  events.delete(ev.id);
  await deleteEvent(ev.id);
  // キックのタイムアウトはイベントに紐づくので、閉じたら一緒に片付ける
  kickTimeouts.delete(ev.id);
  await deleteKickTimeout(ev.id);
  // 記録は残す。イベント定義を消しても「いつ開いて、いつ閉じたか」は後から見たいので
  // （消えたら記録の意味がない。2026-07-31 の設計方針）。
  // キックの履歴も同じ理由で残す（あとでBANするかの判断材料になる）
  await logRunClose(ev.runId, Date.now());
  broadcastAllEvents();
}

/** move: 別のイベント/ルームへ移動する */
function handleMove(client, msg) {
  if (!client.joined) return;

  const targetEventId = typeof msg.ev === 'string' && events.has(msg.ev) ? msg.ev : client.eventId;
  const ev = events.get(targetEventId);
  if (!ev) return;
  if (ev.requireLogin && client.role === 'guest') {
    send(client.ws, { t: 'denied', reason: 'login-required', ev: ev.id });
    return;
  }

  // ---- 別のイベントへ移るときは、入場と同じ関門をくぐらせる（2026-08-02 修正）----
  //
  // ⚠ ここが抜けていた。move は join と同じ「イベントへの入場」なのに、
  //   合言葉もキックの締め出しも見ていなかったため、
  //   ・合言葉つきイベントへ**合言葉なしで入れてしまう**（今回以前からあった穴）
  //   ・キックで締め出した相手が **join し直さず move で戻れてしまう**
  //   という2つが起きていた。同じイベント内のルーム移動には掛けない
  //   （既に入場を許された人が部屋を移るだけなので、また合言葉を聞くのはおかしい）。
  if (targetEventId !== client.eventId) {
    if (ev.entryCode && clampString(msg.code, MAX_EVENT_CODE_LEN) !== ev.entryCode) {
      send(client.ws, { t: 'denied', reason: 'bad-code', ev: ev.id });
      return;
    }
    const timeout = findKickTimeout(ev.id, client.visitor);
    if (timeout) {
      send(client.ws, {
        t: 'denied',
        reason: 'kicked-out',
        ev: ev.id,
        until: timeout.untilAt,
        by: timeout.byName,
        why: timeout.reason,
      });
      return;
    }
    if (!assignableRoom(ev.id)) {
      send(client.ws, { t: 'denied', reason: 'event-full', ev: ev.id });
      return;
    }
  }

  const wantRoom = Number.isInteger(msg.rm) && msg.rm >= 1 && msg.rm <= 999 ? msg.rm : null;
  const targetRoom = wantRoom && roomHasSpace(ev.id, wantRoom) ? wantRoom : assignRoom(ev.id);
  if (targetEventId === client.eventId && targetRoom === client.room) return; // 同じ場所なら何もしない

  // イベントをまたぐ移動だけが記録上の「退場→入場」。
  // 同じイベント内でルームを移っただけなら1回の滞在として続ける
  // （ルームはVRChatのインスタンスに相当するもので、来場としては同じ1回）
  const changedEvent = targetEventId !== client.eventId;

  // 元の場所から抜ける
  leaveCurrentRoom(client);

  client.eventId = ev.id;
  client.room = targetRoom;
  client.x = 0;
  client.z = 0;

  const key = roomKey(ev.id, targetRoom);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }
  const peers = visiblePeersFor(client);
  room.set(client.id, client);

  send(client.ws, {
    t: 'moved',
    ev: ev.id,
    event: toEventInfo(ev),
    room: targetRoom,
    peers,
    count: room.size,
    cap: ev.capacity,
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
  });

  if (changedEvent) {
    endVisitLog(client, 'moved');
    startVisitLog(client, ev);
  }

  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, targetRoom);
  broadcastAllEvents();
}

/** events: 一覧の要求 */
function handleEventsRequest(client) {
  send(client.ws, { t: 'events', events: buildEventList(client) });
}

// ------------------------------------------------------------
// 迷惑行為への対処（ブロック／キック／BAN）
//
// 3つの強さが違うので、使える人と効き方を分けている:
//   ブロック … 誰でも使える。自分と相手が互いに見えなくなるだけ。相手は入場し続けられる
//   キック   … 管理者・VIP。その場から退出させる。すぐ入り直せる（一時的な冷却用）
//   BAN      … 管理者だけ。Googleアカウント単位で再入場を止める
// ------------------------------------------------------------

/** ブロック相手を画面に出さないための識別子。メールを本人以外に見せないため短いハッシュにする */
function blockToken(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 自分のブロック一覧（UIの「解除」に使う）。メールそのものは返さない */
function blockedListFor(client) {
  const out = [];
  for (const key of client.blocks) {
    out.push({ k: blockToken(key), n: client.blockNames.get(key) || '（名前不明）' });
  }
  return out;
}

/** 同じイベントにいる相手を接続idで探す（キック・BAN・ブロックの対象指定に使う） */
function findPeerInEvent(client, id) {
  if (typeof id !== 'string' || !id) return null;
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    const target = members.get(id);
    if (target) return target;
  }
  return null;
}

/** その相手を自分の画面から消す／相手の画面からも自分を消す */
function hideEachOther(a, b) {
  send(a.ws, { t: 'peer-leave', id: b.id });
  send(b.ws, { t: 'peer-leave', id: a.id });
}

/** block: 相手と相互に見えなくする。相手には通知しない（トラブルを増やさないため） */
async function handleBlock(client, msg) {
  if (!client.joined) return;
  const target = findPeerInEvent(client, msg.id);
  if (!target) return;
  if (target.id === client.id) return; // 自分はブロックできない
  if (client.blocks.size >= MAX_BLOCKS) {
    send(client.ws, { t: 'denied', reason: 'too-many-blocks' });
    return;
  }

  const key = blockKeyOf(target);
  client.blocks.add(key);
  client.blockNames.set(key, target.n);
  hideEachOther(client, target);
  send(client.ws, { t: 'blocked', k: blockToken(key), n: target.n });

  // 記録できるのはログイン済み同士だけ。ゲストは次に来たら別人なので残しても意味がない
  if (client.email && target.email) await saveBlock(client.email, target.email, target.n);
}

/** unblock: 解除。姿がすぐ戻るように、同じ場所にいれば入場通知を送り直す */
async function handleUnblock(client, msg) {
  if (!client.joined) return;
  let hit = '';
  for (const key of client.blocks) {
    if (blockToken(key) === msg.k) {
      hit = key;
      break;
    }
  }
  if (!hit) return;

  client.blocks.delete(hit);
  client.blockNames.delete(hit);
  if (client.email && hit.startsWith('e:')) await deleteBlock(client.email, hit.slice(2));

  // 解除した相手が今その場にいるなら、互いの姿を戻す
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    for (const other of members.values()) {
      if (other.id === client.id) continue;
      if (blockKeyOf(other) !== hit) continue;
      if (isBlockedBetween(client, other)) continue; // 相手側のブロックが残っていれば戻さない
      send(client.ws, { t: 'peer-join', p: toPeerInfo(other) });
      send(other.ws, { t: 'peer-join', p: toPeerInfo(client) });
    }
  }
  send(client.ws, { t: 'blocked-list', list: blockedListFor(client) });
}

/**
 * kick: その場から退出させる（管理者・VIP）。再入場はできる。
 * 同格以上は蹴れない。VIPが管理者を、管理者が管理者を蹴れると収拾がつかなくなるため。
 */
async function handleKick(client, msg) {
  if (!client.joined) return;
  if (!isGlobalRole(client.role)) {
    send(client.ws, { t: 'denied', reason: 'staff-only' });
    return;
  }
  const ev = events.get(client.eventId);
  // 2026-08-02: キックも「自分が立てたイベントだけ」に絞る。
  // ここを役職だけで判定すると、他人のライブに客として来ているVIPが
  // その会場の参加者を最大3時間締め出せてしまう（設定変更や閉じるは絞ったのに、
  // キックだけ抜けていた）
  if (!canManageEvent(client.role, client.email, ev)) {
    send(client.ws, { t: 'denied', reason: 'not-your-event' });
    return;
  }

  const target = findPeerInEvent(client, msg.id);
  if (!target || target.id === client.id) return;
  if (isGlobalRole(target.role)) {
    send(client.ws, { t: 'denied', reason: 'cannot-kick-staff' });
    return;
  }

  const mins = KICK_MINUTES.has(Number(msg.mins)) ? Number(msg.mins) : 0;
  const reason = clampString(msg.why, MAX_KICK_REASON_LEN);
  const now = Date.now();

  // 時間つきなら、その間そのイベントへ再入場できないようにする。
  // 相手の識別は入場ログと同じ匿名ID（`u:ハッシュ`/`g:番号`）なので**ゲストにも効く**。
  //
  // ⚠ **メモリへの登録を先に済ませ、DBへの保存は後回しにする。**
  //   締め出しの判定はメモリを見るので、これで即座に効く。
  //   逆にDBの書き込みを待ってから通知すると、書き込みが遅れたときに
  //   蹴られた本人へ理由が届く前に接続が切れ、「通信が不安定」に見えてしまう
  //   （実DBでのテストで実際に取りこぼした。2026-08-02）
  let timeout = null;
  if (mins > 0 && ev) {
    timeout = {
      eventId: ev.id,
      subject: target.visitor,
      untilAt: now + mins * 60 * 1000,
      name: target.n,
      byName: client.n,
      reason,
      createdAt: now,
    };
    setKickTimeout(timeout);
  }

  send(target.ws, { t: 'kicked', by: client.n, mins, why: reason });
  send(client.ws, { t: 'moderated', act: 'kick', n: target.n, mins });
  // 管理者には誰が誰を蹴ったかを知らせる（VIPが蹴った場合も気づけるように）
  notifyAdmins(client.eventId, {
    t: 'staff-note',
    kind: 'kick',
    n: target.n,
    by: client.n,
    mins,
    why: reason,
  });
  try {
    target.ws.close();
  } catch {
    // 既に切れている場合は何もしない（closeイベント側で後始末される）
  }

  // ---- ここから先は保存。通知が済んでいるので時間がかかっても体験に響かない ----
  if (timeout) await saveKickTimeout(timeout); // 再起動しても締め出しが解けないように
  // 履歴は時間の有無にかかわらず残す。
  // 「この人、前にも蹴られてるな」を管理者が後から判断してBANを決めるための材料
  // （loyさん設計 2026-08-02: キックの履歴を管理人に通知して、あとで審議する）
  await addKickLog({
    eventId: ev ? ev.id : client.eventId,
    eventName: ev ? ev.name : '',
    subject: target.visitor,
    name: target.n,
    email: target.email,
    byName: client.n,
    reason,
    minutes: mins,
    createdAt: now,
  });
}

/** kicks: キックの履歴を返す（管理者のみ）。BANするかの審議に使う */
async function handleKickLogRequest(client) {
  if (!client.joined || client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  send(client.ws, { t: 'kicks', list: await listKickLog(100) });
}

/** ban: 再入場を止める（管理者だけ）。Googleアカウント単位なのでゲストにはかけられない */
async function handleBan(client, msg) {
  if (!client.joined) return;
  if (client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const target = findPeerInEvent(client, msg.id);
  if (!target || target.id === client.id) return;
  if (isGlobalRole(target.role)) {
    send(client.ws, { t: 'denied', reason: 'cannot-ban-staff' });
    return;
  }
  if (!target.email) {
    // ゲストは次に来たら別人になるので、BANしても止められない
    send(client.ws, { t: 'denied', reason: 'cannot-ban-guest' });
    return;
  }

  const ban = {
    email: target.email,
    name: target.n,
    byName: client.n,
    reason: clampString(msg.why, MAX_BAN_REASON_LEN),
    createdAt: Date.now(),
  };
  bans.set(ban.email, ban);
  await saveBan(ban);

  send(target.ws, { t: 'banned', by: client.n, why: ban.reason });
  send(client.ws, { t: 'moderated', act: 'ban', n: target.n });
  try {
    target.ws.close();
  } catch {
    // 同上
  }
}

/** unban: 解除（管理者だけ） */
async function handleUnban(client, msg) {
  if (!client.joined || client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const email = typeof msg.email === 'string' ? msg.email.toLowerCase() : '';
  if (!email || !bans.has(email)) return;
  bans.delete(email);
  await deleteBan(email);
  send(client.ws, { t: 'bans', list: [...bans.values()] });
}

/** bans: BAN一覧の要求（管理者だけ） */
function handleBansRequest(client) {
  if (!client.joined || client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  send(client.ws, { t: 'bans', list: [...bans.values()] });
}

// ------------------------------------------------------------
// YouTubeチャットの読み取り → 本人のアバターに吹き出し（2026-08-03追加）
//
// これまでの「YouTubeチャット連動」は、YouTubeのチャット画面を会場に
// はめ込んでいるだけで、こちらは中身を受け取っていなかった。
// ここでサーバーが直接チャットを読み、合言葉で本人と結びついた発言だけを
// 会場へ流す。結びついていない人の発言は流さない（誰の頭に出せばいいか
// 分からないため。会場のチャット欄はYouTubeの埋め込みが担当している）。
// ------------------------------------------------------------

/** eventId -> LiveChatReader。連動ONで動画があるイベントのぶんだけ動かす */
const ytReaders = new Map();

/** そのイベントで読み取りを動かすべきか */
function shouldReadYt(ev) {
  return Boolean(
    ev && ev.chatMode === 'youtube' && ev.videoId && isYouTubeReadEnabled(),
  );
}

/**
 * イベントの状態に合わせて読み取り係を増減させる。
 * イベントの作成・設定変更・削除・起動時に呼ぶ。
 *
 * 動画が差し替わったら作り直す（liveChatId が別物になるため、
 * 同じ係を使い回すと前の配信のチャットを読み続けてしまう）。
 */
function syncYtReaders() {
  // 要らなくなったものを止める
  for (const [eventId, reader] of ytReaders) {
    const ev = events.get(eventId);
    if (!shouldReadYt(ev) || reader.videoId !== ev.videoId) {
      reader.stop();
      ytReaders.delete(eventId);
    }
  }
  // 足りないものを起こす
  for (const ev of events.values()) {
    if (!shouldReadYt(ev) || ytReaders.has(ev.id)) continue;
    const reader = new LiveChatReader(ev.videoId, (msgs) => {
      onYtMessages(ev.id, msgs);
    });
    ytReaders.set(ev.id, reader);
    reader.start();
    console.log(`[ytread] 読み取り開始: event=${ev.id} video=${ev.videoId}`);
  }
}

/** そのイベントの中から、結びつけの鍵が一致する人を探す */
function findClientByLinkKey(eventId, linkKey) {
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    for (const client of members.values()) {
      if (client.joined && client.visitor === linkKey) return client;
    }
  }
  return null;
}

/**
 * YouTubeから届いた発言をさばく。
 * 結びついている人のものだけを、その人がいるルームへ流す。
 */
function onYtMessages(eventId, msgs) {
  for (const msg of msgs) {
    const hit = matchMessage(msg);
    if (!hit) continue; // 関係ない人の発言＝吹き出しは出さない

    const client = findClientByLinkKey(eventId, hit.linkKey);
    if (!client) continue; // 繋いだ人が会場にいない（帰った後の発言など）

    if (hit.justLinked) {
      // 本人にだけ「繋がった」と知らせる。名前はYouTube側の表示名
      send(client.ws, { t: 'yt-linked', ok: true, ytName: msg.name || '' });
    }

    const txt = clampString(msg.text, MAX_TXT_LEN);
    if (!txt) continue;
    client.lastChat = { txt, ts: Date.now() };

    // 会場の発言と同じ形で流す。sc:'yt' はクライアントで出所を出し分けるため。
    // from に本人を渡すことで、ブロックしている人には見えないまま保たれる
    broadcastToRoom(
      eventId,
      client.room,
      { t: 'chat', id: client.id, n: client.n, txt, sc: 'yt' },
      null,
      client,
    );
  }
}

/**
 * 開発用: YouTubeの発言が届いたことにする（2026-08-03追加）
 *
 * 本物のチャットは「配信中でないと流れてこない」ので、
 * これが無いと吹き出しの確認をライブ本番でしか行えない。
 * それでは直しながら試すことができないため、注入口を用意した。
 *
 * ⚠ ローカル（Render以外）のループバック接続からしか受け付けない。
 *   スクリーンショット用の /api/_shot と同じ守り方。
 */
function handleDevYtInject(body) {
  const eventId = String(body?.eventId || '');
  if (!events.has(eventId)) return { ok: false, why: 'イベントが見つかりません' };
  const msg = {
    channelId: String(body?.channelId || 'UC_dev_test'),
    name: String(body?.name || 'テスト視聴者'),
    text: String(body?.text || ''),
  };
  onYtMessages(eventId, [msg]);
  return { ok: true, sent: msg };
}

/**
 * yt-code: 合言葉をくれ、という要求。
 * これをYouTubeのチャットに打つと、そのチャンネルが本人と結びつく。
 */
function handleYtCode(client, _msg) {
  if (!client.joined) return;
  if (!isYouTubeReadEnabled()) {
    send(client.ws, { t: 'yt-code', ok: false, why: 'disabled' });
    return;
  }
  const { code, expiresAt } = issueCode(client.visitor);
  send(client.ws, { t: 'yt-code', ok: true, code, expiresAt });
}

/** yt-unlink: 結びつきを解除する（本人のぶんだけ） */
async function handleYtUnlink(client, _msg) {
  if (!client.joined) return;
  const n = await unlink(client.visitor);
  send(client.ws, { t: 'yt-linked', ok: false, removed: n });
}

const HANDLERS = {
  join: handleJoin,
  'yt-code': handleYtCode,
  'yt-unlink': handleYtUnlink,
  pos: handlePos,
  chat: handleChat,
  update: handleUpdate,
  emote: handleEmote,
  screen: handleScreen,
  playback: handlePlayback,
  'event-create': handleEventCreate,
  'event-update': handleEventUpdate,
  'event-delete': handleEventDelete,
  move: handleMove,
  events: handleEventsRequest,
  block: handleBlock,
  unblock: handleUnblock,
  kick: handleKick,
  ban: handleBan,
  unban: handleUnban,
  bans: handleBansRequest,
  kicks: handleKickLogRequest,
};

/** 全員にイベント一覧を配る（人数が変わったとき・イベントが増減したとき） */
function broadcastAllEvents() {
  // イベントの作成・設定変更・動画差し替え・削除は、すべてここを通る。
  // 読み取り係の増減もここに乗せておけば、経路ごとに呼び忘れることがない
  syncYtReaders();

  // 2026-08-02: 合言葉を見せる範囲がイベントごとになった（VIPは自分のイベントだけ）ので、
  // 「管理者用／全員用」の2種類では足りない。人ごとに組み立てる。
  // イベント数もクライアント数も上限が小さい（20件×60人）ので負荷は問題にならない
  for (const members of rooms.values()) {
    for (const client of members.values()) {
      send(client.ws, { t: 'events', events: buildEventList(client) });
    }
  }
}

/** 今いるルームから抜ける（切断・移動の共通処理） */
function leaveCurrentRoom(client) {
  if (client.eventId === null || client.room === null) return;
  const key = roomKey(client.eventId, client.room);
  const room = rooms.get(key);
  if (!room) return;

  room.delete(client.id);
  broadcastFrom(client, { t: 'peer-leave', id: client.id });

  if (room.size === 0) {
    rooms.delete(key); // 空ルームは破棄（番号の穴あきは assignRoom が埋める）
  } else {
    broadcastCount(client.eventId, client.room);
  }
}

/** 切断時処理 */
function handleDisconnect(client) {
  if (!client.joined) return;
  endVisitLog(client, '');
  leaveCurrentRoom(client);
  client.joined = false;
  client.eventId = null;
  client.room = null;
}

/** レート制限チェック: 直近1秒間の送信回数が上限を超えていないか */
function isRateLimited(client) {
  const now = Date.now();
  client.msgTimes = client.msgTimes.filter((t) => now - t < 1000);
  client.msgTimes.push(now);
  return client.msgTimes.length > RATE_LIMIT_PER_SEC;
}

// ------------------------------------------------------------
// HTTP: ステータスJSON / presence.json / イベント一覧
// ------------------------------------------------------------

function buildStatusJson() {
  const roomList = Array.from(rooms.entries())
    .map(([key, members]) => ({ event: keyEventId(key), room: keyRoomNumber(key), count: members.size }))
    .sort((a, b) => (a.event === b.event ? a.room - b.room : a.event < b.event ? -1 : 1));

  return {
    ok: true,
    rooms: roomList,
    events: buildEventList(null),
    persistent: isPersistent(),
    login: isLoginEnabled(),
    // PORTAL連携APIが開いているか（合言葉そのものは出さない）
    statsApi: Boolean(STATS_TOKEN),
    // 入口に鍵がかかっているか（鍵そのものは出さない）。
    // 鍵を変えたのに反映されない、を画面から切り分けるための手がかり
    entryGate: Boolean(ENTRY_KEY),
    // 設定ミスを画面から特定できるようにする（トークンは含めない）
    store: getStoreStatus(),
    // YouTubeチャットの読み取り（2026-08-03追加）。APIキーそのものは出さない。
    // reading … いま実際に読み取りが動いているイベントの数
    // links   … 結びつき済みのチャンネル数
    ytRead: { ...getYouTubeReadStatus(), reading: ytReaders.size, links: ytLinkCount() },
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    // いま動いているのがどのコミットかを外から見られるようにする。
    // 2026-07-30、本番が9コミット前のまま止まっているのに気づけず、
    // 「デプロイしたのに反映されない」の切り分けに時間を取られた。
    // Render が渡す環境変数をそのまま出す（ローカルでは unknown）
    commit: (process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 7),
    branch: process.env.RENDER_GIT_BRANCH || 'unknown',
  };
}

// ------------------------------------------------------------
// ブラウザ座標 → VRChatワールド座標
//
// なぜ必要か: ブラウザ側の会場は VRChat の VERSE CITY2025 から書き出した
// 同じメッシュだが、変換時に「会場の中心を原点へ寄せる」処理を入れたため、
// 座標が VRC 本体とズレている。VRC側の定数で吸収してもらう案もあったが、
// 「あっちは直すの大変」（2026-07-30 loyさん判断）なので、送る直前にこちらで戻す。
//
// 寄せ幅は書き出しログ(offset_applied)に残っており、Unityシーンの実測値とも一致した:
//   会場入口         VRC(-213.90, -61.60) ⇔ ブラウザ(4.90, 10.31)  … 誤差 0.00m
//   ステージ背面ガラス VRC(-213.92, -99.15) ⇔ ブラウザ(4.92, -27.24) … 基準点の違いのみ
//
// X だけ符号が反転するのは、Unity(左手系) から書き出して three.js(右手系) へ
// 取り込んだため。向きも同じ理由で左右が入れ替わる:
//   ブラウザの r は three.js の rotation.y（度）で、向き = (sin r, cos r)。
//   X が反転するので VRC 側の向きは (-sin r, cos r) = 角度 -r になる。
// ------------------------------------------------------------
const VRC_ORIGIN_X = -209.0; // 会場中心のVRCワールド座標X
const VRC_ORIGIN_Z = -71.91; // 会場中心のVRCワールド座標Z

/** ブラウザのx → VRCのX（X軸は反転する） */
function toVrcX(x) {
  return Math.round((-x + VRC_ORIGIN_X) * 10) / 10;
}

/** ブラウザのz → VRCのZ */
function toVrcZ(z) {
  return Math.round((z + VRC_ORIGIN_Z) * 10) / 10;
}

/** ブラウザの向き(度) → VRCの向き(度・0〜359) */
function toVrcRot(r) {
  return ((Math.round(-r) % 360) + 360) % 360;
}

/**
 * presence.json（PRESENCE_SPEC v=1 は凍結。フィールドを増やさない）
 *
 * x/z/r は VRChatワールド座標系で出す（2026-07-30 変更。上の変換を参照）。
 *
 * rm はルーム番号なので、イベントをまたぐと番号が衝突して
 * 「別のイベントにいる人が同じ部屋にいる」ように見えてしまう。
 * v=1 のまま正しさを保つため、VRC側へ出すのは常設イベント(main)だけにしている。
 * 特別イベントも流したくなったら、Unity側と v=2 の相談が必要。
 */
function buildPresenceJson() {
  const nowMs = Date.now();
  const web = [];

  // VRChatの会場は clubVERSE 1つなので、送るイベントも1つに絞る。
  // どれを送るかは管理人が「VRChatに出す」設定で選ぶ（2026-07-30。以前は常設main固定だった）
  const bridged = bridgedEvent();
  const keys = bridged
    ? Array.from(rooms.keys())
        .filter((k) => keyEventId(k) === bridged.id)
        .sort((a, b) => keyRoomNumber(a) - keyRoomNumber(b))
    : [];

  outer: for (const key of keys) {
    const room = rooms.get(key);
    for (const client of room.values()) {
      if (web.length >= PRESENCE_MAX_WEB) break outer;

      const entry = {
        rm: keyRoomNumber(key),
        n: client.n,
        // VRC側がそのまま置ける値にして渡す（変換の理由は上のコメント）
        x: toVrcX(client.x),
        z: toVrcZ(client.z),
        r: toVrcRot(client.r),
        av: client.av,
      };

      if (ENABLE_CHAT_FIELD && client.lastChat && nowMs - client.lastChat.ts <= PRESENCE_CHAT_WINDOW_MS) {
        entry.c = [
          clampString(client.lastChat.txt, PRESENCE_CHAT_TXT_MAX),
          Math.floor(client.lastChat.ts / 1000),
        ];
      }

      web.push(entry);
    }
  }

  return {
    v: 1,
    ts: Math.floor(nowMs / 1000),
    web,
    yt: [], // YouTubeチャット連携は現段階では未実装のため常に空配列
  };
}

// ------------------------------------------------------------
// HTTPサーバー本体
// ------------------------------------------------------------

// 開発用: ブラウザで描いた絵をファイルに保存する（見た目を確認しながら直すため）。
// ALLOW_SHOTS=1、またはローカル起動（Render以外）のループバック接続のみ有効。
const ALLOW_SHOTS = process.env.ALLOW_SHOTS === '1' || !process.env.RENDER;
function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

async function handleShot(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 20 * 1024 * 1024) req.destroy();
  });
  await new Promise((resolve) => req.on('end', resolve));
  try {
    const { name, data } = JSON.parse(body);
    const safeName = String(name || 'shot').replace(/[^A-Za-z0-9_-]/g, '');
    const base64 = String(data).replace(/^data:image\/png;base64,/, '');
    const dir = path.join(CLIENT_ROOT, '_shots');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${safeName}.png`), Buffer.from(base64, 'base64'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, file: `_shots/${safeName}.png` }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

/** リクエストのJSON本文を読む（上限つき） */
async function readJsonBody(req, maxBytes = 64 * 1024) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > maxBytes) req.destroy();
  });
  await new Promise((resolve) => req.on('end', resolve));
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * POST /api/profile — 保存済みの名前とアバターを返す。
 * IDトークンを検証して本人のぶんだけ返すので、他人の設定は取れない。
 */
async function handleProfileRequest(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const body = await readJsonBody(req);
  const info = body && body.idt ? await verifyIdToken(body.idt) : null;
  if (!info) {
    send(401, { ok: false, error: 'not-signed-in' });
    return;
  }

  const saved = await loadProfile(info.email);
  send(200, {
    ok: true,
    name: saved ? saved.name : '',
    av: saved ? saved.av : null,
    // 保存が無いときの初期値として使ってもらう（本名の可能性があるので強制はしない）
    googleName: info.name || '',
    role: roleForEmail(info.email),
  });
}

/**
 * 入場画面から管理人がイベントを立てるためのHTTP口。
 *
 * 入場後の🚪パネルからも作れる（WSの event-create）が、常設イベントを廃止したことで
 * 「イベントが0件だと入場できない → 入場できないと作れない」という詰みが起きる。
 * それを避けるため、WSに繋ぐ前でも作れる入口をここに用意している（2026-07-30）。
 */
/**
 * HTTPの本文から管理者かどうかを判定する（イベント作成と記録画面で共通）。
 *
 * 判定の考え方はWS側の join と同じに揃えている:
 *   ログイン設定済み → Googleのトークンで判定
 *   ログイン未設定（ローカル開発）→ defaultRole。加えて devRole の指定を許す
 * devRole は Render 上では絶対に効かない（RENDER環境変数で封じている）。
 * これが無いと、ログイン未設定の環境でイベントを1つも作れず何もできなくなる。
 *
 * @returns {Promise<{ok:true, role:string} | {ok:false, code:number, error:string}>}
 */
async function authAdminBody(body, { allowStaff = false } = {}) {
  // 開発用の権限指定。Render上では ALLOW_DEV_ROLE が false なので絶対に効かない。
  // ⚠ 判定を「ログイン必須で弾く」より**先**に置くこと。
  //   後ろに置くと、ログインを有効にしたローカル環境で devRole が使えず、
  //   権限まわりの検証ができなくなる（WS側の join は元から先に見ている）
  const dev =
    ALLOW_DEV_ROLE && body && typeof body.devRole === 'string' && DEV_ROLES.has(body.devRole);

  let role = defaultRole();
  let email = '';
  if (body && body.idt) {
    const info = await verifyIdToken(body.idt);
    if (!info) return { ok: false, code: 401, error: 'not-signed-in' };
    email = info.email;
    role = roleForEmail(email);
  } else if (isLoginEnabled() && !dev) {
    return { ok: false, code: 401, error: 'not-signed-in' };
  }
  if (dev) {
    role = body.devRole;
    if (typeof body.devEmail === 'string' && body.devEmail) email = body.devEmail.toLowerCase();
  }
  // allowStaff … イベント作成はVIPにも開放する（管理者不在でも会場を開けるように）。
  // 記録の閲覧など管理者専用のものは false のままにする
  const ok = allowStaff ? canCreateEvent(role) : canControlVideo(role);
  if (!ok) return { ok: false, code: 403, error: 'admin-only' };
  return { ok: true, role, email };
}

async function handleAdminEventCreate(req, res) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const body = await readJsonBody(req);
  // イベント作成はVIPにも開放（管理者不在でもメンバーが会場を開けるように・2026-08-02）
  const auth = await authAdminBody(body, { allowStaff: true });
  if (!auth.ok) {
    reply(auth.code, { ok: false, error: auth.error });
    return;
  }
  if (events.size >= MAX_EVENTS) {
    reply(400, { ok: false, error: 'too-many-events' });
    return;
  }

  const ev = await createEventFrom(body, auth.email);
  if (!ev) {
    reply(400, { ok: false, error: 'bad-name' });
    return;
  }
  broadcastAllEvents();
  reply(200, { ok: true, ev: toEventInfoAdmin(ev) });
}

// ------------------------------------------------------------
// イベントの記録（管理者向け）と、PORTALへの受け渡し
//
// 記録画面のAPIをPOSTにしているのは、IDトークンをURLに載せないため
// （履歴・アクセスログ・リファラに残る）。既存の /api/profile と同じ考え方。
// CSVもPOSTで本文を受け取り、ダウンロードはブラウザ側でBlobにして行う。
// ------------------------------------------------------------

/** 開催一覧＋それぞれの要約。往復を増やさないよう訪問ログは1クエリでまとめて取る */
async function buildRunSummaries(limit = MAX_LOG_RUNS) {
  const runs = await listRuns(limit);
  const byRun = await listVisitsForRuns(runs.map((r) => r.runId));
  const now = Date.now();
  return runs.map((run) => summarizeRun(run, byRun.get(run.runId) || [], now));
}

function summarizeRun(run, visits, now) {
  return {
    runId: run.runId,
    eventId: run.eventId,
    name: run.name,
    ...summarize(run, visits, now),
  };
}

async function handleAdminLogs(req, res) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const body = await readJsonBody(req);
  const auth = await authAdminBody(body);
  if (!auth.ok) {
    reply(auth.code, { ok: false, error: auth.error });
    return;
  }
  reply(200, {
    ok: true,
    persistent: isPersistent(),
    runs: await buildRunSummaries(Number(body && body.limit) || MAX_LOG_RUNS),
  });
}

async function handleAdminLogDetail(req, res) {
  const body = await readJsonBody(req);
  const auth = await authAdminBody(body);
  if (!auth.ok) {
    res.writeHead(auth.code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: auth.error }));
    return;
  }

  const runId = body && typeof body.runId === 'string' ? body.runId : '';
  const run = await getRun(runId);
  if (!run) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'no-run' }));
    return;
  }
  const visits = await listVisits(runId);
  const now = Date.now();
  const format = body && typeof body.format === 'string' ? body.format : 'json';

  if (format === 'csv-chat') {
    const text = chatCsv(run, await listChatLog(runId));
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chat-${runId.replace(/[^\w.-]/g, '')}.csv"`,
    });
    res.end(text);
    return;
  }

  if (format === 'csv-visits' || format === 'csv-series') {
    const text = format === 'csv-visits' ? visitsCsv(run, visits, now) : seriesCsv(run, visits, { now });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${format}-${runId.replace(/[^\w.-]/g, '')}.csv"`,
    });
    res.end(text);
    return;
  }

  const to = run.closedAt == null ? now : run.closedAt;
  // 画面のグラフ用に間引いた同接の経過。刻みは開催時間から決める
  // （1分固定だと短いイベントの山が消える。ピークの数値は要約側が正確に持つ）
  const stepMs = autoStepMs(to - run.openedAt);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      ok: true,
      run: summarizeRun(run, visits, now),
      stepMs,
      series: gridSeries(visits, { from: run.openedAt, to, stepMs }),
      visits,
      // 会場チャット（管理者のみ）。件数が多くなるので画面には直近ぶんだけ出す
      chat: await listChatLog(runId),
    }),
  );
}

/**
 * GET /api/stats.json — PORTAL（Supabase側）が集計を取りに来る口。
 *
 * 方式は「案1: こちらがAPIを出し、PORTAL側が取りに来る」（2026-07-31）。
 * 本番DBの書き込み鍵をこちらに置かずに済むのが理由。VRChat連携と同じ考え方。
 *
 * 返すのは集計値だけで、訪問者ごとの行は出さない。PORTALに必要なのは
 * 「ピーク・累計・滞在」であって、誰が来たかではないため。
 * 合言葉(STATS_TOKEN)が未設定なら、この口は開かない。
 */
async function handleStatsJson(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
    res.end(JSON.stringify(obj));
  };

  if (!STATS_TOKEN) {
    reply(403, { ok: false, error: 'stats-api-disabled' });
    return;
  }
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  // 長さが違うだけで falseになるので、まず長さを合わせてから定数時間で比べる
  const okToken =
    given.length === STATS_TOKEN.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(STATS_TOKEN));
  if (!okToken) {
    reply(401, { ok: false, error: 'bad-token' });
    return;
  }

  const q = new URLSearchParams((req.url || '').split('?')[1] || '');
  const since = Number(q.get('since'));
  const limit = Number(q.get('limit')) || MAX_LOG_RUNS;
  let runs = await buildRunSummaries(limit);
  if (Number.isFinite(since) && since > 0) runs = runs.filter((r) => r.openedAt >= since);

  reply(200, { ok: true, source: 'allverse-web', generatedAt: Date.now(), events: runs });
}

// ------------------------------------------------------------
// 会場の鍵（ENTRY_KEY）
// ------------------------------------------------------------

/** 入口のHTMLか（ここだけ鍵で守る。中の部品は単体では意味を持たない） */
function isEntryDocument(safePath) {
  return safePath === '' || safePath.toLowerCase().endsWith('.html');
}

/** URLの ?k= が鍵と一致するか。鍵が未設定なら常に true（＝誰でも入れる） */
function hasValidEntryKey(rawUrl) {
  if (!ENTRY_KEY) return true;
  const q = new URLSearchParams((rawUrl || '').split('?')[1] || '');
  const k = q.get('k') || '';
  // 長さが違えば timingSafeEqual が例外を投げるので、先に揃えてから比べる
  return (
    k.length === ENTRY_KEY.length && timingSafeEqual(Buffer.from(k), Buffer.from(ENTRY_KEY))
  );
}

/**
 * 鍵が合わないときの応答。
 *
 * loyさんの要望は「直リンクを叩いても**何も表示されない**」なので、
 * 案内文もサービス名も出さない。404にしているのは、
 * 白紙よりも「そこには何も無い」という自然な見え方になるため。
 * 会場が開いているかどうかも、この応答からは分からない。
 */
function sendClosedDoor(res) {
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', // 鍵を変えたあとも古い応答が残らないように
  });
  res.end('<!doctype html><meta charset="utf-8"><title>Not Found</title>');
}

const httpServer = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (ALLOW_SHOTS && isLoopback(req) && req.method === 'POST' && url === '/api/_shot') {
    await handleShot(req, res);
    return;
  }

  // 開発用: YouTubeの発言が届いたことにする（ローカルのみ・上記 handleDevYtInject 参照）
  if (ALLOW_SHOTS && isLoopback(req) && req.method === 'POST' && url === '/api/_yt-inject') {
    const body = await readJsonBody(req).catch(() => null);
    const out = handleDevYtInject(body || {});
    res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
    return;
  }

  if (req.method === 'GET' && url === '/api/status') {
    const body = JSON.stringify(buildStatusJson());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  // 入場画面が「前回の名前とアバター」を取りに来る。
  // GETではなくPOSTなのは、IDトークンをURLに載せない（履歴やログに残さない）ため。
  if (req.method === 'POST' && url === '/api/profile') {
    await handleProfileRequest(req, res);
    return;
  }

  // 入場画面から管理人がイベントを立てる（イベント0件のときの唯一の入口）
  if (req.method === 'POST' && url === '/api/admin/event') {
    await handleAdminEventCreate(req, res);
    return;
  }

  // イベントの記録（管理者向け）。POSTなのはIDトークンをURLに載せないため
  if (req.method === 'POST' && url === '/api/admin/logs') {
    await handleAdminLogs(req, res);
    return;
  }
  if (req.method === 'POST' && url === '/api/admin/log') {
    await handleAdminLogDetail(req, res);
    return;
  }

  // PORTALが集計を取りに来る口（Authorization: Bearer <STATS_TOKEN>）
  if (url === '/api/stats.json') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      await handleStatsJson(req, res);
      return;
    }
  }

  // 入場画面がログインボタンの出し分けとイベント一覧に使う
  if (req.method === 'GET' && url === '/api/config') {
    const body = JSON.stringify({
      ok: true,
      login: isLoginEnabled(),
      clientId: getClientId(),
      persistent: isPersistent(),
      events: buildEventList(null),
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && url === '/api/presence.json') {
    const body = JSON.stringify(buildPresenceJson());
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return;
  }

  // ---- 静的ファイル配信（クライアント一式。1サービスでデプロイできるようにする） ----
  if (req.method === 'GET') {
    // パストラバーサル防止＋サーバーコードは配信しない
    const safePath = path.normalize(url).replace(/^([/\\])+/, '');
    if (safePath.startsWith('..') || safePath.startsWith('server')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    // 鍵が要るのは入口のHTMLだけ。JSや3Dモデル単体では会場に入れないので、
    // ここを閉じれば「直リンクを叩いても何も出ない」は成立する。
    // ⚠ presence.json は絶対に閉じない（VRChat側のWorkerが取りに来ている）
    if (isEntryDocument(safePath) && !hasValidEntryKey(req.url)) {
      sendClosedDoor(res);
      return;
    }
    const filePath = path.join(CLIENT_ROOT, safePath === '' ? 'index.html' : safePath);
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
      return;
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

// ------------------------------------------------------------
// WebSocketサーバー（/ws のみ受け付け）
// ------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url !== WS_PATH && !url.startsWith(`${WS_PATH}?`)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// ---- 死活監視 ----
const HEARTBEAT_MS = 30000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, HEARTBEAT_MS).unref?.();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const client = {
    id: `c${nextClientSeq++}`,
    ws,
    eventId: null,
    room: null,
    joined: false,
    role: 'guest',
    email: '',
    n: '',
    av: {},
    x: 0,
    z: 0,
    r: 0,
    m: false,
    lastChat: null,
    msgTimes: [],
    // ブロックしている相手（相互不可視の判定に使う）。入場時にDBから読み直す
    blocks: new Set(),
    blockNames: new Map(), // 解除UIに出す名前。キーはblocks側と同じ
  };

  ws.on('message', (raw) => {
    if (isRateLimited(client)) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // 不正JSONは無視
    }

    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    // join前の他メッセージは無視
    if (!client.joined && msg.t !== 'join') return;

    const handler = HANDLERS[msg.t];
    if (!handler) return; // 想定外のtは無視（切断まではしない）

    // handleJoin/handleScreen は非同期（トークン検証・DB書き込み）
    Promise.resolve(handler(client, msg)).catch(() => {});
  });

  ws.on('close', () => {
    handleDisconnect(client);
  });

  ws.on('error', () => {
    // 個別クライアントのソケットエラーはログのみ（サーバー自体は継続）
  });
});

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------

/** いま誰か会場に入っているか（heartbeatを打つ必要があるかの判定） */
function anyoneInside() {
  for (const members of rooms.values()) if (members.size > 0) return true;
  return false;
}

async function boot() {
  await initStore();

  // 前回サーバーが落ちたときに「退場が書かれないまま」残った記録を閉じる。
  // heartbeat を読むので、新しい heartbeat を打ち始める前に済ませる
  const fixed = await closeOpenVisits('restart');

  // 保存済みイベントを復元。何も無ければ会場は閉まったまま（管理人が立てるまで誰も入れない）
  for (const row of await loadEvents()) {
    const ev = makeEvent(row);
    events.set(row.id, ev);
    // 記録の開始行が無ければ足す（ログ機能より前から動いていたイベントを拾うため）
    await logRunOpen({ runId: ev.runId, eventId: ev.id, name: ev.name, openedAt: ev.createdAt });
  }
  // 保存内容が壊れていて2つ以上ONでも、VRChatへ出すのは1つに保つ
  const firstBridged = bridgedEvent();
  if (firstBridged) makeBridgeExclusive(firstBridged.id);

  // BANはメモリに載せておく。入場のたびにDBを叩かずに済ませるため
  for (const b of await loadBans()) bans.set(b.email, b);

  // YouTubeとの結びつきもメモリに載せる。チャット1件ごとにDBを叩くと
  // Turso（Singapore）への往復が積み上がって吹き出しが遅れる
  const ytLinks = await initYtLinks();
  // 復元したイベントに連動ONのものがあれば、ここで読み取りが始まる
  syncYtReaders();

  // キックの締め出しも復元する。ここを消すと、再起動しただけで
  // 1時間の締め出しが解けてしまい、荒らし対策として役に立たない
  const timeouts = await loadKickTimeouts();
  for (const t of timeouts) setKickTimeout(t);

  // サーバーが生きている印。人がいる間だけ打つ（誰もいない時間に書き込みを増やさない）。
  // 次に落ちたとき、この時刻で「閉じ忘れ」を閉じるので、記録のズレは最大1分に収まる
  setInterval(() => {
    if (anyoneInside()) touchHeartbeat(Date.now()).catch(() => {});
  }, HEARTBEAT_LOG_MS).unref?.();

  httpServer.listen(PORT, () => {
    console.log(`[VERSE CITY Web Server] listening on port ${PORT} (ws path: ${WS_PATH})`);
    console.log(`  ログイン: ${isLoginEnabled() ? '有効' : '無効（GOOGLE_CLIENT_ID 未設定）'}`);
    console.log(`  イベント永続化: ${isPersistent() ? '有効（Turso）' : '無効（メモリのみ）'}`);
    console.log(`  イベント数: ${events.size} ／ BAN: ${bans.size}件 ／ キック締め出し: ${timeouts.length}件`);
    console.log(`  イベントログ: 有効${fixed ? `（前回の閉じ忘れ ${fixed}件を補正）` : ''}`);
    console.log(`  PORTAL連携API: ${STATS_TOKEN ? '有効（/api/stats.json）' : '無効（STATS_TOKEN 未設定）'}`);
    console.log(`  入口の鍵: ${ENTRY_KEY ? '有効（?k= が必要）' : '無効（ENTRY_KEY 未設定＝誰でも入れる）'}`);
    console.log(
      `  YouTubeチャット読み取り: ${
        isYouTubeReadEnabled()
          ? `有効（${getYouTubeReadStatus().intervalMs / 1000}秒おき・連携済み${ytLinks}件）`
          : '無効（YOUTUBE_API_KEY 未設定）'
      }`,
    );
  });
}

boot();
