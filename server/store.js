// ============================================================
// イベント定義の永続化（Turso / libSQL）
//
// 環境変数が未設定なら「メモリだけで動く」モードに自動で落ちる。
// ローカル開発や、Tursoの設定前でもサーバーは普通に起動できる。
//   TURSO_DATABASE_URL … libsql://xxxx.turso.io
//   TURSO_AUTH_TOKEN   … 読み書き用トークン
//
// Render無料プランはスリープでメモリが消えるため、ここが唯一の「消えない場所」になる。
// ============================================================

import { createClient } from '@libsql/client';
// ゲスト専用の髪型id。アカウントの記録に混ぜないための判定に使う（saveProfile 参照）
import { GUEST_HAIR } from '../src/guestlook.js';

const URL_ENV = process.env.TURSO_DATABASE_URL || '';
const TOKEN_ENV = process.env.TURSO_AUTH_TOKEN || '';

let db = null;
let ready = false;
let lastError = ''; // 繋がらなかった理由（設定を直すときの手がかり）

/** 永続化が有効かどうか（UIに「保存されます/されません」を出すのに使う） */
export function isPersistent() {
  return ready;
}

/**
 * 設定状況の要約。/api/status に出して、設定ミスを画面から特定できるようにする。
 * トークンそのものは絶対に出さない。URLはホスト名だけを出す。
 */
export function getStoreStatus() {
  let urlHint = '';
  if (URL_ENV) {
    try {
      urlHint = new URL(URL_ENV).host || '(解析できない形式)';
    } catch {
      urlHint = '(URLの形式が不正)';
    }
  }
  return {
    urlSet: Boolean(URL_ENV),
    tokenSet: Boolean(TOKEN_ENV),
    urlHost: urlHint,
    ready,
    error: lastError,
  };
}

/**
 * 接続とテーブル作成。失敗してもサーバーは止めない（メモリ運用に落ちるだけ）。
 * @returns {Promise<boolean>} 永続化が使えるか
 */
export async function initStore() {
  if (!URL_ENV) {
    lastError = 'TURSO_DATABASE_URL が設定されていません';
    console.log('[store] TURSO_DATABASE_URL 未設定 → イベントはメモリのみ（再起動で消えます）');
    return false;
  }
  if (!TOKEN_ENV) {
    // URLだけ設定してトークンを入れ忘れるミスが起きやすいので、先に明示する
    console.warn('[store] TURSO_AUTH_TOKEN が未設定です。認証エラーになる可能性があります');
  }
  try {
    db = createClient({ url: URL_ENV, authToken: TOKEN_ENV || undefined });
    await db.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        video_id      TEXT NOT NULL,
        require_login INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      )
    `);
    // 2026-07-30 追加の列。CREATE TABLE IF NOT EXISTS は既存テーブルを作り替えないので、
    // 稼働中のDBには ALTER で足す。既に列があればエラーになるだけなので握りつぶす。
    //   entry_code … 合言葉（空文字＝パブリック）
    //   capacity   … 1ルームの定員
    //   vrc_bridge … VRChat連携に出すイベントか
    //   owner_email … 立てた人。VIPは「自分が立てたイベント」だけ操作できる（2026-08-02）
    //   npc_max     … NPCの全体上限。-1 は自動（キャパ − 実在人数）
    //   chat_mode   … 'local'（独自チャット）/ 'youtube'（YouTubeチャットへ一本化）
    //   notice_*    … 運営メッセージの固定枠（レベルと本文）
    for (const ddl of [
      `ALTER TABLE events ADD COLUMN entry_code TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE events ADD COLUMN capacity INTEGER NOT NULL DEFAULT 30`,
      `ALTER TABLE events ADD COLUMN vrc_bridge INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE events ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE events ADD COLUMN npc_max INTEGER NOT NULL DEFAULT -1`,
      `ALTER TABLE events ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'local'`,
      `ALTER TABLE events ADD COLUMN notice_level TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE events ADD COLUMN notice_text TEXT NOT NULL DEFAULT ''`,
    ]) {
      try {
        await db.execute(ddl);
      } catch (e) {
        // 既にその列がある＝正常。それ以外の失敗も起動は止めない
      }
    }
    // ログイン済みユーザーの入場設定。別の端末でも同じ姿で入れるようにするため
    await db.execute(`
      CREATE TABLE IF NOT EXISTS profiles (
        email      TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        av         TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    // ブロック（相互不可視）。ログイン済みユーザー同士だけ永続化する。
    // ゲストは次に来たとき別人になるので、記録しても意味がない
    await db.execute(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_email TEXT NOT NULL,
        blocked_email TEXT NOT NULL,
        blocked_name  TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (blocker_email, blocked_email)
      )
    `);
    // BAN（管理者が再入場を止める）
    await db.execute(`
      CREATE TABLE IF NOT EXISTS bans (
        email      TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        by_name    TEXT NOT NULL,
        reason     TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    // ---- イベントログ（2026-07-31 追加）----
    // イベントを立ててから閉じるまでを1回の「開催」として残す。
    // run_id を id と分けているのは、イベントidが将来使い回された場合に
    // 過去の開催と記録が混ざらないようにするため（run_id = `${eventId}-${createdAt}`）。
    await db.execute(`
      CREATE TABLE IF NOT EXISTS event_runs (
        run_id    TEXT PRIMARY KEY,
        event_id  TEXT NOT NULL,
        name      TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER
      )
    `);
    // 入退場ログ。1行 = 1回の入場（退場時に left_at を埋める）。
    // 同接の経過・累計ユニーク・滞在時間は、この1本から全部あとで計算する
    await db.execute(`
      CREATE TABLE IF NOT EXISTS visits (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id    TEXT NOT NULL,
        event_id  TEXT NOT NULL,
        visitor   TEXT NOT NULL,
        kind      TEXT NOT NULL,
        name      TEXT NOT NULL,
        room      INTEGER NOT NULL,
        joined_at INTEGER NOT NULL,
        left_at   INTEGER,
        closed_by TEXT NOT NULL DEFAULT ''
      )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_visits_run ON visits(run_id, joined_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_visits_open ON visits(left_at)');
    // ---- キックのタイムアウト（2026-08-02 追加）----
    // キックは「蹴るだけで即戻れる」仕様だったので、荒らしへの対処にならなかった。
    // 時間を決めて再入場を止められるようにする（実質的な一時BAN）。
    // subject は入場ログと同じ匿名IDを使う（ログイン済み=u:ハッシュ / ゲスト=g:番号）。
    // これで**ゲストにも効く**（BANはGoogleアカウント単位なので効かなかった）。
    await db.execute(`
      CREATE TABLE IF NOT EXISTS kick_timeouts (
        event_id   TEXT NOT NULL,
        subject    TEXT NOT NULL,
        until_at   INTEGER NOT NULL,
        name       TEXT NOT NULL,
        by_name    TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, subject)
      )
    `);
    // キックの履歴。管理者があとで「BANするか」を判断するための材料。
    // タイムアウトが切れても残す（timeouts は消えるが、こちらは記録として残る）
    await db.execute(`
      CREATE TABLE IF NOT EXISTS kick_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id   TEXT NOT NULL,
        event_name TEXT NOT NULL,
        subject    TEXT NOT NULL,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL DEFAULT '',
        by_name    TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT '',
        minutes    INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_kicklog_at ON kick_log(created_at)');
    // ---- 会場チャットの記録（2026-08-02 追加）----
    // 「何かあった時に証拠になるので」（loyさん）。開催（run_id）に紐づけて残す。
    // イベントを閉じても消さない＝あとから見返せることが目的なので。
    // ⚠ ゲストは発言できない仕様なので、ここに残るのはログイン済みの人の発言だけ。
    //   YouTubeチャット連動のイベントでは会場チャット自体を使わないため記録も無い。
    await db.execute(`
      CREATE TABLE IF NOT EXISTS chat_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id     TEXT NOT NULL,
        event_id   TEXT NOT NULL,
        room       INTEGER NOT NULL,
        visitor    TEXT NOT NULL,
        name       TEXT NOT NULL,
        txt        TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'local',
        created_at INTEGER NOT NULL
      )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_chatlog_run ON chat_log(run_id, created_at)');
    // YouTubeのチャンネルと、ブラウザ会場にいる本人の結びつき（2026-08-03追加）。
    // 合言葉をYouTubeのチャットへ送ってもらい、その発言の channelId を本人と繋ぐ。
    //
    // ⚠ 一度繋いだら次回以降も有効にする（毎回合言葉を打たせると使われない）。
    //   link_key は ログイン済み＝`m:<メールのハッシュ>` ／ ゲスト＝`v:<匿名ID>`。
    //   **メールアドレスそのものは保存しない**（イベント記録と同じ方針）。
    await db.execute(`
      CREATE TABLE IF NOT EXISTS yt_links (
        channel_id  TEXT PRIMARY KEY,
        link_key    TEXT NOT NULL,
        yt_name     TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL
      )
    `);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_ytlinks_key ON yt_links(link_key)');
    // サーバーが最後に生きていた時刻。再起動で「退場が書かれないまま」残った行を
    // どの時刻で閉じるかの根拠になる（詳細は closeOpenVisits）
    await db.execute(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      )
    `);
    ready = true;
    lastError = '';
    console.log('[store] Turso に接続しました（イベントは永続化されます）');
    return true;
  } catch (e) {
    db = null;
    ready = false;
    // トークンが混ざらないよう、メッセージだけを短く保持する
    lastError = String(e && e.message ? e.message : e).slice(0, 200);
    console.warn('[store] Turso 接続に失敗 → メモリのみで続行します:', lastError);
    return false;
  }
}

/** 保存済みイベントを全件読む。失敗時は空配列（起動を止めない） */
export async function loadEvents() {
  if (!ready) return [];
  try {
    const rs = await db.execute(
      `SELECT id, name, video_id, require_login, entry_code, capacity, vrc_bridge, created_at,
              owner_email, npc_max, chat_mode, notice_level, notice_text
         FROM events`,
    );
    return rs.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      videoId: String(r.video_id),
      requireLogin: Number(r.require_login) === 1,
      entryCode: r.entry_code == null ? '' : String(r.entry_code),
      capacity: r.capacity == null ? 30 : Number(r.capacity),
      vrcBridge: Number(r.vrc_bridge) === 1,
      createdAt: Number(r.created_at),
      ownerEmail: r.owner_email == null ? '' : String(r.owner_email),
      npcMax: r.npc_max == null ? -1 : Number(r.npc_max),
      chatMode: r.chat_mode == null ? 'local' : String(r.chat_mode),
      noticeLevel: r.notice_level == null ? '' : String(r.notice_level),
      noticeText: r.notice_text == null ? '' : String(r.notice_text),
    }));
  } catch (e) {
    console.warn('[store] イベント読み込みに失敗:', e.message);
    return [];
  }
}

/** 1件保存（同じidなら上書き） */
export async function saveEvent(ev) {
  if (!ready) return false;
  try {
    await db.execute({
      sql: `INSERT INTO events (id, name, video_id, require_login, entry_code, capacity, vrc_bridge, created_at,
                                owner_email, npc_max, chat_mode, notice_level, notice_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              video_id = excluded.video_id,
              require_login = excluded.require_login,
              entry_code = excluded.entry_code,
              capacity = excluded.capacity,
              vrc_bridge = excluded.vrc_bridge,
              owner_email = excluded.owner_email,
              npc_max = excluded.npc_max,
              chat_mode = excluded.chat_mode,
              notice_level = excluded.notice_level,
              notice_text = excluded.notice_text`,
      args: [
        ev.id,
        ev.name,
        ev.videoId,
        ev.requireLogin ? 1 : 0,
        ev.entryCode || '',
        ev.capacity,
        ev.vrcBridge ? 1 : 0,
        ev.createdAt,
        ev.ownerEmail || '',
        Number.isFinite(ev.npcMax) ? ev.npcMax : -1,
        ev.chatMode || 'local',
        ev.noticeLevel || '',
        ev.noticeText || '',
      ],
    });
    return true;
  } catch (e) {
    console.warn('[store] イベント保存に失敗:', e.message);
    return false;
  }
}

/** 動画IDだけ更新（管理者が配信URLを差し替えたとき） */
export async function updateEventVideo(id, videoId) {
  if (!ready) return false;
  try {
    await db.execute({ sql: 'UPDATE events SET video_id = ? WHERE id = ?', args: [videoId, id] });
    return true;
  } catch (e) {
    console.warn('[store] 動画IDの更新に失敗:', e.message);
    return false;
  }
}

// ------------------------------------------------------------
// ユーザーの入場設定（名前・アバター）
// ------------------------------------------------------------

/**
 * 保存されている設定を読む。無ければ null。
 * @param {string} email
 * @returns {Promise<{name:string, av:object}|null>}
 */
export async function loadProfile(email) {
  if (!ready || !email) return null;
  try {
    const rs = await db.execute({
      sql: 'SELECT name, av FROM profiles WHERE email = ?',
      args: [email],
    });
    if (!rs.rows.length) return null;
    const row = rs.rows[0];
    let av = {};
    try {
      av = JSON.parse(String(row.av));
    } catch {
      av = {};
    }
    // ⚠ 既に混ざってしまった記録の後始末。
    //   保存側は塞いだが、それ以前に書かれた「髪なし」がDBに残っている人がいる。
    //   読むときに落としておけば、次に入ったとき既定の髪型に戻る（2026-08-03）
    if (av && av.h === GUEST_HAIR) delete av.h;
    return { name: String(row.name), av };
  } catch (e) {
    console.warn('[store] プロフィール読み込みに失敗:', e.message);
    return null;
  }
}

/** 設定を保存（同じメールなら上書き） */
export async function saveProfile(email, name, av) {
  if (!ready || !email) return false;
  // ⚠ ゲスト専用の姿（髪なし）はアカウントの記録に混ぜない。
  //   混ざると「一度ゲストで入ったら、次にログインしても髪なしのまま」になる
  //   （2026-08-03 loyさん指摘）。ゲストの姿はサーバーが毎回 visitor から作るので、
  //   保存しなくても何も失われない
  if (av && av.h === GUEST_HAIR) {
    return false;
  }
  try {
    await db.execute({
      sql: `INSERT INTO profiles (email, name, av, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              name = excluded.name,
              av = excluded.av,
              updated_at = excluded.updated_at`,
      args: [email, String(name || ''), JSON.stringify(av || {}), Date.now()],
    });
    return true;
  } catch (e) {
    console.warn('[store] プロフィール保存に失敗:', e.message);
    return false;
  }
}

/** 1件削除 */
export async function deleteEvent(id) {
  if (!ready) return false;
  try {
    await db.execute({ sql: 'DELETE FROM events WHERE id = ?', args: [id] });
    return true;
  } catch (e) {
    console.warn('[store] イベント削除に失敗:', e.message);
    return false;
  }
}

// ------------------------------------------------------------
// ブロック（相互不可視）
// ------------------------------------------------------------

/**
 * その人がブロックしている相手のメール一覧。
 * 入場のたびに読んで、サーバーのメモリに載せ直す。
 * @returns {Promise<Array<{email:string,name:string}>>}
 */
export async function loadBlocks(email) {
  if (!ready || !email) return [];
  try {
    const rs = await db.execute({
      sql: 'SELECT blocked_email, blocked_name FROM blocks WHERE blocker_email = ?',
      args: [email],
    });
    return rs.rows.map((r) => ({ email: String(r.blocked_email), name: String(r.blocked_name) }));
  } catch (e) {
    console.warn('[store] ブロック一覧の読み込みに失敗:', e.message);
    return [];
  }
}

export async function saveBlock(blockerEmail, blockedEmail, blockedName) {
  if (!ready || !blockerEmail || !blockedEmail) return false;
  try {
    await db.execute({
      sql: `INSERT INTO blocks (blocker_email, blocked_email, blocked_name, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(blocker_email, blocked_email) DO UPDATE SET
              blocked_name = excluded.blocked_name`,
      args: [blockerEmail, blockedEmail, String(blockedName || ''), Date.now()],
    });
    return true;
  } catch (e) {
    console.warn('[store] ブロックの保存に失敗:', e.message);
    return false;
  }
}

export async function deleteBlock(blockerEmail, blockedEmail) {
  if (!ready || !blockerEmail || !blockedEmail) return false;
  try {
    await db.execute({
      sql: 'DELETE FROM blocks WHERE blocker_email = ? AND blocked_email = ?',
      args: [blockerEmail, blockedEmail],
    });
    return true;
  } catch (e) {
    console.warn('[store] ブロックの解除に失敗:', e.message);
    return false;
  }
}

// ------------------------------------------------------------
// BAN（管理者が再入場を止める）
// ------------------------------------------------------------

/** 全件読む。起動時にメモリへ載せて、入場のたびのDB問い合わせを避ける */
export async function loadBans() {
  if (!ready) return [];
  try {
    const rs = await db.execute('SELECT email, name, by_name, reason, created_at FROM bans');
    return rs.rows.map((r) => ({
      email: String(r.email),
      name: String(r.name),
      byName: String(r.by_name),
      reason: String(r.reason),
      createdAt: Number(r.created_at),
    }));
  } catch (e) {
    console.warn('[store] BAN一覧の読み込みに失敗:', e.message);
    return [];
  }
}

export async function saveBan(ban) {
  if (!ready || !ban || !ban.email) return false;
  try {
    await db.execute({
      sql: `INSERT INTO bans (email, name, by_name, reason, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              name = excluded.name,
              by_name = excluded.by_name,
              reason = excluded.reason,
              created_at = excluded.created_at`,
      args: [ban.email, String(ban.name || ''), String(ban.byName || ''), String(ban.reason || ''), ban.createdAt],
    });
    return true;
  } catch (e) {
    console.warn('[store] BANの保存に失敗:', e.message);
    return false;
  }
}

export async function deleteBan(email) {
  if (!ready || !email) return false;
  try {
    await db.execute({ sql: 'DELETE FROM bans WHERE email = ?', args: [email] });
    return true;
  } catch (e) {
    console.warn('[store] BANの解除に失敗:', e.message);
    return false;
  }
}

// ------------------------------------------------------------
// キックのタイムアウトと履歴（2026-08-02 追加）
//
// キックは「蹴るだけで即戻れる」ので荒らしに効かなかった。
// 時間つきにして、その間は同じイベントへ再入場できないようにする。
// 相手の識別は入場ログと同じ匿名ID（`u:ハッシュ` / `g:番号`）を使うので、
// **BANでは止められなかったゲストにも効く**。
// ------------------------------------------------------------

/** 期限切れを除いた、生きているタイムアウトを全部読む（起動時にメモリへ載せる） */
export async function loadKickTimeouts(now = Date.now()) {
  if (!ready) return [];
  try {
    const rs = await db.execute({
      sql: `SELECT event_id, subject, until_at, name, by_name, reason, created_at
              FROM kick_timeouts WHERE until_at > ?`,
      args: [now],
    });
    return rs.rows.map((r) => ({
      eventId: String(r.event_id),
      subject: String(r.subject),
      untilAt: Number(r.until_at),
      name: String(r.name),
      byName: String(r.by_name),
      reason: r.reason == null ? '' : String(r.reason),
      createdAt: Number(r.created_at),
    }));
  } catch (e) {
    console.warn('[store] キックのタイムアウト読み込みに失敗:', e.message);
    return [];
  }
}

export async function saveKickTimeout(t) {
  if (!ready || !t) return false;
  try {
    await db.execute({
      sql: `INSERT INTO kick_timeouts (event_id, subject, until_at, name, by_name, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id, subject) DO UPDATE SET
              until_at = excluded.until_at,
              name = excluded.name,
              by_name = excluded.by_name,
              reason = excluded.reason,
              created_at = excluded.created_at`,
      args: [t.eventId, t.subject, t.untilAt, String(t.name || ''), String(t.byName || ''), String(t.reason || ''), t.createdAt],
    });
    return true;
  } catch (e) {
    console.warn('[store] キックのタイムアウト保存に失敗:', e.message);
    return false;
  }
}

/** 解除（管理者が早めに許すとき）。イベントを閉じたときの一括削除にも使う */
export async function deleteKickTimeout(eventId, subject = null) {
  if (!ready || !eventId) return false;
  try {
    if (subject) {
      await db.execute({
        sql: 'DELETE FROM kick_timeouts WHERE event_id = ? AND subject = ?',
        args: [eventId, subject],
      });
    } else {
      await db.execute({ sql: 'DELETE FROM kick_timeouts WHERE event_id = ?', args: [eventId] });
    }
    return true;
  } catch (e) {
    console.warn('[store] キックのタイムアウト削除に失敗:', e.message);
    return false;
  }
}

/**
 * 履歴を1件足す。タイムアウトが切れても消さない。
 * 「この人、前にも蹴られてるな」を管理者が判断できるようにするための記録。
 */
export async function addKickLog(entry) {
  if (!ready || !entry) return false;
  try {
    await db.execute({
      sql: `INSERT INTO kick_log (event_id, event_name, subject, name, email, by_name, reason, minutes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.eventId,
        String(entry.eventName || ''),
        entry.subject,
        String(entry.name || ''),
        String(entry.email || ''),
        String(entry.byName || ''),
        String(entry.reason || ''),
        Number(entry.minutes) || 0,
        entry.createdAt,
      ],
    });
    return true;
  } catch (e) {
    console.warn('[store] キック履歴の記録に失敗:', e.message);
    return false;
  }
}

/** 履歴（新しい順）。管理者の👥パネルに出して、BANするかの判断材料にする */
export async function listKickLog(limit = 100) {
  if (!ready) return [];
  const lim = Math.min(500, Math.max(1, Math.trunc(limit) || 100));
  try {
    const rs = await db.execute({
      sql: `SELECT id, event_id, event_name, subject, name, email, by_name, reason, minutes, created_at
              FROM kick_log ORDER BY created_at DESC LIMIT ?`,
      args: [lim],
    });
    return rs.rows.map((r) => ({
      id: Number(r.id),
      eventId: String(r.event_id),
      eventName: String(r.event_name),
      subject: String(r.subject),
      name: String(r.name),
      email: r.email == null ? '' : String(r.email),
      byName: String(r.by_name),
      reason: r.reason == null ? '' : String(r.reason),
      minutes: Number(r.minutes) || 0,
      createdAt: Number(r.created_at),
    }));
  } catch (e) {
    console.warn('[store] キック履歴の読み込みに失敗:', e.message);
    return [];
  }
}

// ------------------------------------------------------------
// イベントログ（開催記録と入退場ログ）
//
// Turso未設定でも機能自体は動くようにメモリ版を持つ。
// 「ローカルで試したら記録画面が空っぽ」を避けるため。
// ただしメモリ版は再起動で消える（イベント定義と同じ扱い）。
// ------------------------------------------------------------

const MAX_MEM_VISITS = 20000; // メモリ運用時の上限（古い順に捨てる）
const memRuns = new Map(); // runId -> run
const memVisits = [];
let memVisitSeq = 1;
let memHeartbeat = 0;

/** 行→オブジェクト（列名はSQL側、キャメルケースはJS側で統一する） */
function toRun(r) {
  return {
    runId: String(r.run_id),
    eventId: String(r.event_id),
    name: String(r.name),
    openedAt: Number(r.opened_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
  };
}

function toVisit(r) {
  return {
    id: Number(r.id),
    runId: String(r.run_id),
    eventId: String(r.event_id),
    visitor: String(r.visitor),
    kind: String(r.kind),
    name: String(r.name),
    room: Number(r.room),
    joinedAt: Number(r.joined_at),
    leftAt: r.left_at == null ? null : Number(r.left_at),
    closedBy: r.closed_by == null ? '' : String(r.closed_by),
  };
}

/**
 * 開催を1件記録する（イベントを立てたとき／起動時の取りこぼし補完）。
 * 既にあれば何もしない＝ログ機能より前から動いていたイベントも拾える。
 */
export async function logRunOpen(run) {
  if (!run || !run.runId) return false;
  if (!ready) {
    if (!memRuns.has(run.runId)) {
      memRuns.set(run.runId, { ...run, closedAt: run.closedAt ?? null });
    }
    return true;
  }
  try {
    await db.execute({
      sql: `INSERT INTO event_runs (run_id, event_id, name, opened_at, closed_at)
            VALUES (?, ?, ?, ?, NULL)
            ON CONFLICT(run_id) DO NOTHING`,
      args: [run.runId, run.eventId, String(run.name || ''), run.openedAt],
    });
    return true;
  } catch (e) {
    console.warn('[store] 開催記録の作成に失敗:', e.message);
    return false;
  }
}

/** イベント名が変わったら記録側も合わせる（後から名前を変えても記録が追える） */
export async function logRunRename(runId, name) {
  if (!runId) return false;
  if (!ready) {
    const r = memRuns.get(runId);
    if (r) r.name = String(name || '');
    return true;
  }
  try {
    await db.execute({
      sql: 'UPDATE event_runs SET name = ? WHERE run_id = ?',
      args: [String(name || ''), runId],
    });
    return true;
  } catch (e) {
    console.warn('[store] 開催名の更新に失敗:', e.message);
    return false;
  }
}

/** 閉店を記録する。既に閉じている記録は上書きしない */
export async function logRunClose(runId, closedAt) {
  if (!runId) return false;
  if (!ready) {
    const r = memRuns.get(runId);
    if (r && r.closedAt == null) r.closedAt = closedAt;
    return true;
  }
  try {
    await db.execute({
      sql: 'UPDATE event_runs SET closed_at = ? WHERE run_id = ? AND closed_at IS NULL',
      args: [closedAt, runId],
    });
    return true;
  } catch (e) {
    console.warn('[store] 閉店の記録に失敗:', e.message);
    return false;
  }
}

/**
 * 入場を記録し、その行のidを返す（退場時にこのidで閉じる）。
 * 失敗しても入場自体は通す（記録はサービスを止める理由にならない）。
 * @returns {Promise<number|null>}
 */
export async function logVisitStart(v) {
  if (!v || !v.runId) return null;
  if (!ready) {
    const row = { ...v, id: memVisitSeq++, leftAt: null, closedBy: '' };
    memVisits.push(row);
    if (memVisits.length > MAX_MEM_VISITS) memVisits.splice(0, memVisits.length - MAX_MEM_VISITS);
    return row.id;
  }
  try {
    const rs = await db.execute({
      sql: `INSERT INTO visits (run_id, event_id, visitor, kind, name, room, joined_at, left_at, closed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '')`,
      args: [v.runId, v.eventId, v.visitor, v.kind, String(v.name || ''), v.room, v.joinedAt],
    });
    // libSQL は BigInt で返す
    return rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid);
  } catch (e) {
    console.warn('[store] 入場ログの記録に失敗:', e.message);
    return null;
  }
}

/**
 * 退場を記録する。
 * `left_at IS NULL` の行だけを更新するので、二重に呼ばれても最初の1回が残る
 * （閉店処理と切断処理がほぼ同時に走るため、この条件が要る）。
 */
export async function logVisitEnd(id, leftAt, closedBy = '') {
  if (id == null) return false;
  if (!ready) {
    const row = memVisits.find((r) => r.id === id);
    if (row && row.leftAt == null) {
      row.leftAt = leftAt;
      row.closedBy = closedBy;
    }
    return true;
  }
  try {
    await db.execute({
      sql: 'UPDATE visits SET left_at = ?, closed_by = ? WHERE id = ? AND left_at IS NULL',
      args: [leftAt, String(closedBy || ''), id],
    });
    return true;
  } catch (e) {
    console.warn('[store] 退場ログの記録に失敗:', e.message);
    return false;
  }
}

/**
 * 起動時の補正。前回のサーバーが落ちたとき、退場が書かれないまま残った行を閉じる。
 *
 * 閉じる時刻には「サーバーが最後に生きていた時刻」(heartbeat) を使う。
 * 今の時刻で閉じると、スリープしていた時間ぶん滞在時間が水増しされてしまう
 * （Render無料プランは15分アクセスが無いと寝るので、実際に何時間もズレる）。
 */
export async function closeOpenVisits(closedBy = 'restart') {
  const at = await readHeartbeat();
  if (!ready) {
    let n = 0;
    for (const row of memVisits) {
      if (row.leftAt == null) {
        row.leftAt = Math.max(row.joinedAt, at || row.joinedAt);
        row.closedBy = closedBy;
        n++;
      }
    }
    return n;
  }
  try {
    // heartbeat が無い（初回起動・古いDB）ときは入場時刻で閉じる＝滞在0秒。
    // 実際より短く出るが、水増しするよりは安全
    const rs = await db.execute({
      sql: `UPDATE visits
               SET left_at = CASE WHEN ? > joined_at THEN ? ELSE joined_at END,
                   closed_by = ?
             WHERE left_at IS NULL`,
      args: [at || 0, at || 0, String(closedBy)],
    });
    return Number(rs.rowsAffected || 0);
  } catch (e) {
    console.warn('[store] 閉じ忘れの補正に失敗:', e.message);
    return 0;
  }
}

/** サーバーが生きている印。人が入っている間だけ定期的に呼ぶ */
export async function touchHeartbeat(ts) {
  if (!ready) {
    memHeartbeat = ts;
    return true;
  }
  try {
    await db.execute({
      sql: `INSERT INTO meta (k, v) VALUES ('heartbeat', ?)
            ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      args: [String(ts)],
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function readHeartbeat() {
  if (!ready) return memHeartbeat;
  try {
    const rs = await db.execute("SELECT v FROM meta WHERE k = 'heartbeat'");
    if (!rs.rows.length) return 0;
    const n = Number(rs.rows[0].v);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

/** 開催の一覧（新しい順） */
export async function listRuns(limit = 100) {
  const lim = Math.min(500, Math.max(1, Math.trunc(limit) || 100));
  if (!ready) {
    return Array.from(memRuns.values())
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, lim)
      .map((r) => ({ ...r }));
  }
  try {
    const rs = await db.execute({
      sql: `SELECT run_id, event_id, name, opened_at, closed_at
              FROM event_runs ORDER BY opened_at DESC LIMIT ?`,
      args: [lim],
    });
    return rs.rows.map(toRun);
  } catch (e) {
    console.warn('[store] 開催一覧の読み込みに失敗:', e.message);
    return [];
  }
}

export async function getRun(runId) {
  if (!runId) return null;
  if (!ready) {
    const r = memRuns.get(runId);
    return r ? { ...r } : null;
  }
  try {
    const rs = await db.execute({
      sql: 'SELECT run_id, event_id, name, opened_at, closed_at FROM event_runs WHERE run_id = ?',
      args: [runId],
    });
    return rs.rows.length ? toRun(rs.rows[0]) : null;
  } catch (e) {
    console.warn('[store] 開催の読み込みに失敗:', e.message);
    return null;
  }
}

/**
 * 会場チャットを1件記録する（2026-08-02追加）。
 * 発言そのものは既にブロードキャスト済みなので、ここが失敗しても会話は止めない。
 */
export async function addChatLog(entry) {
  if (!entry || !entry.runId) return false;
  if (!ready) return true; // メモリ運用では残さない（再起動で消える＝証拠にならないため）
  try {
    await db.execute({
      sql: `INSERT INTO chat_log (run_id, event_id, room, visitor, name, txt, scope, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.runId,
        entry.eventId,
        Number(entry.room) || 0,
        entry.visitor,
        String(entry.name || ''),
        String(entry.txt || ''),
        entry.scope === 'stream' ? 'stream' : 'local',
        entry.createdAt,
      ],
    });
    return true;
  } catch (e) {
    console.warn('[store] チャットの記録に失敗:', e.message);
    return false;
  }
}

/** 1開催ぶんの会場チャット（時刻順）。管理者だけが見る */
export async function listChatLog(runId, limit = 5000) {
  if (!ready || !runId) return [];
  const lim = Math.min(20000, Math.max(1, Math.trunc(limit) || 5000));
  try {
    const rs = await db.execute({
      sql: `SELECT id, room, visitor, name, txt, scope, created_at
              FROM chat_log WHERE run_id = ? ORDER BY created_at ASC LIMIT ?`,
      args: [runId, lim],
    });
    return rs.rows.map((r) => ({
      id: Number(r.id),
      room: Number(r.room),
      visitor: String(r.visitor),
      name: String(r.name),
      txt: String(r.txt),
      scope: String(r.scope),
      createdAt: Number(r.created_at),
    }));
  } catch (e) {
    console.warn('[store] チャットの読み込みに失敗:', e.message);
    return [];
  }
}

// ------------------------------------------------------------
// YouTubeチャンネルとの結びつき（2026-08-03追加）
// ------------------------------------------------------------

/**
 * 結びつきを保存する。同じチャンネルを別の人が繋ぎ直したら上書きする
 * （アカウントを持ち替えた場合に、古い持ち主のアバターへ吹き出しが出ると事故になるため）。
 */
export async function saveYtLink({ channelId, linkKey, ytName = '', createdAt = Date.now() }) {
  if (!ready || !channelId || !linkKey) return false;
  try {
    await db.execute({
      sql: `INSERT INTO yt_links (channel_id, link_key, yt_name, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
              link_key = excluded.link_key,
              yt_name = excluded.yt_name,
              created_at = excluded.created_at`,
      args: [String(channelId), String(linkKey), String(ytName || ''), createdAt],
    });
    return true;
  } catch (e) {
    console.warn('[store] YouTube連携の保存に失敗:', e.message);
    return false;
  }
}

/**
 * 保存済みの結びつきを全件読む。
 * 件数はイベント参加者ぶんしか増えないので、起動時に全部メモリへ載せて
 * チャット1件ごとのDB往復を無くす（Turso は Singapore にあり往復が遅い）。
 * @returns {Promise<Array<{channelId:string, linkKey:string, ytName:string}>>}
 */
export async function loadYtLinks() {
  if (!ready) return [];
  try {
    const rs = await db.execute('SELECT channel_id, link_key, yt_name FROM yt_links');
    return rs.rows.map((r) => ({
      channelId: String(r.channel_id),
      linkKey: String(r.link_key),
      ytName: String(r.yt_name || ''),
    }));
  } catch (e) {
    console.warn('[store] YouTube連携の読み込みに失敗:', e.message);
    return [];
  }
}

/** 結びつきを解除する（本人が「連携をやめる」を押したとき） */
export async function deleteYtLinksFor(linkKey) {
  if (!ready || !linkKey) return false;
  try {
    await db.execute({
      sql: 'DELETE FROM yt_links WHERE link_key = ?',
      args: [String(linkKey)],
    });
    return true;
  } catch (e) {
    console.warn('[store] YouTube連携の解除に失敗:', e.message);
    return false;
  }
}

/**
 * 複数の開催ぶんをまとめて読む。
 * 一覧画面で開催ごとにクエリを投げると、Turso（Singapore）への往復が件数ぶん積み上がって
 * 表示が数秒かかる。1回のクエリで全部取ってJS側で振り分ける。
 * @returns {Promise<Map<string, Array>>} runId -> visits
 */
export async function listVisitsForRuns(runIds) {
  const ids = Array.from(new Set((runIds || []).filter(Boolean)));
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  if (!ready) {
    for (const v of memVisits) {
      const arr = map.get(v.runId);
      if (arr) arr.push({ ...v });
    }
    return map;
  }
  try {
    const holes = ids.map(() => '?').join(',');
    const rs = await db.execute({
      sql: `SELECT id, run_id, event_id, visitor, kind, name, room, joined_at, left_at, closed_by
              FROM visits WHERE run_id IN (${holes}) ORDER BY joined_at ASC`,
      args: ids,
    });
    for (const row of rs.rows) {
      const v = toVisit(row);
      const arr = map.get(v.runId);
      if (arr) arr.push(v);
    }
    return map;
  } catch (e) {
    console.warn('[store] 訪問ログの一括読み込みに失敗:', e.message);
    return map;
  }
}

/** 1開催ぶんの入退場ログ（時刻順） */
export async function listVisits(runId) {
  if (!runId) return [];
  if (!ready) {
    return memVisits.filter((v) => v.runId === runId).map((v) => ({ ...v }));
  }
  try {
    const rs = await db.execute({
      sql: `SELECT id, run_id, event_id, visitor, kind, name, room, joined_at, left_at, closed_by
              FROM visits WHERE run_id = ? ORDER BY joined_at ASC`,
      args: [runId],
    });
    return rs.rows.map(toVisit);
  } catch (e) {
    console.warn('[store] 訪問ログの読み込みに失敗:', e.message);
    return [];
  }
}
