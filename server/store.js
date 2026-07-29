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
    const rs = await db.execute('SELECT id, name, video_id, require_login, created_at FROM events');
    return rs.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      videoId: String(r.video_id),
      requireLogin: Number(r.require_login) === 1,
      createdAt: Number(r.created_at),
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
      sql: `INSERT INTO events (id, name, video_id, require_login, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              video_id = excluded.video_id,
              require_login = excluded.require_login`,
      args: [ev.id, ev.name, ev.videoId, ev.requireLogin ? 1 : 0, ev.createdAt],
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
    return { name: String(row.name), av };
  } catch (e) {
    console.warn('[store] プロフィール読み込みに失敗:', e.message);
    return null;
  }
}

/** 設定を保存（同じメールなら上書き） */
export async function saveProfile(email, name, av) {
  if (!ready || !email) return false;
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
