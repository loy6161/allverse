// ============================================================
// Googleログインの検証と権限判定
//
// クライアントは Google Identity Services で受け取った IDトークン(JWT) を
// join に載せてくる。ここで Google の公開鍵を使って検証し、メールアドレスを得る。
// トークンは改ざんできないので、メールアドレスは信用してよい。
//
// 環境変数:
//   GOOGLE_CLIENT_ID … OAuthクライアントID（これが未設定ならログイン機能は無効＝全員ゲスト）
//   ADMIN_EMAILS     … 管理者のメール（カンマ区切り）
//   VIP_EMAILS       … 全ルームに現れるメンバーのメール（カンマ区切り）
//
// 権限は4段階:
//   admin … 動画の入力・再生操作・イベント作成。全ルームに現れる
//   vip   … 全ルームに現れる。動画は操作できない
//   user  … ログイン済みの一般参加者
//   guest … 未ログイン。チャット・エモート・アバター変更ができない
// ============================================================

import { OAuth2Client } from 'google-auth-library';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

function parseEmailList(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const ADMIN_EMAILS = parseEmailList(process.env.ADMIN_EMAILS);
const VIP_EMAILS = parseEmailList(process.env.VIP_EMAILS);

const client = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

/** ログイン機能が使える状態か（クライアントに「ログインボタンを出すか」を伝える） */
export function isLoginEnabled() {
  return Boolean(CLIENT_ID);
}

export function getClientId() {
  return CLIENT_ID;
}

// 同じトークンを何度も検証しないための短期キャッシュ（再接続時の往復を減らす）
const verifyCache = new Map(); // token -> { email, exp }
const CACHE_MAX = 500;

/**
 * IDトークンを検証してメールアドレスを返す。無効なら null。
 * @param {string} idToken
 * @returns {Promise<{email:string, name:string}|null>}
 */
export async function verifyIdToken(idToken) {
  if (!client || typeof idToken !== 'string' || idToken.length < 20) return null;

  const cached = verifyCache.get(idToken);
  if (cached && cached.exp > Date.now()) return { email: cached.email, name: cached.name };

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || payload.email_verified === false) return null;

    const info = { email: String(payload.email).toLowerCase(), name: String(payload.name || '') };
    if (verifyCache.size > CACHE_MAX) verifyCache.clear();
    // トークン自体の有効期限か5分後の早い方までキャッシュ
    const expMs = Math.min((payload.exp || 0) * 1000, Date.now() + 5 * 60 * 1000);
    verifyCache.set(idToken, { ...info, exp: expMs });
    return info;
  } catch {
    return null; // 期限切れ・改ざん・別クライアント宛 など
  }
}

/** メールアドレスから権限を決める */
export function roleForEmail(email) {
  if (!email) return 'guest';
  const e = String(email).toLowerCase();
  if (ADMIN_EMAILS.has(e)) return 'admin';
  if (VIP_EMAILS.has(e)) return 'vip';
  return 'user';
}

/**
 * ログイン未設定のときの既定ロール。
 *
 * GOOGLE_CLIENT_ID が無い＝そもそもログインする手段が無いので、
 * この状態で全員を guest に落とすと誰も喋れず動画も操作できなくなる。
 * OAuthを設定するまでは「今まで通り誰でも使える」状態を保ち、
 * 設定した時点で自動的に権限制御が効き始める、という移行にしている。
 */
export function defaultRole() {
  return isLoginEnabled() ? 'guest' : 'user';
}

/** ログイン未設定の間は管理機能を誰でも触れる（現行の挙動を維持するため） */
function isOpenMode() {
  return !isLoginEnabled();
}

/** 全ルームに現れる権限か */
export function isGlobalRole(role) {
  return role === 'admin' || role === 'vip';
}

/** 動画を操作できる権限か */
export function canControlVideo(role) {
  if (isOpenMode()) return true;
  return role === 'admin';
}

/** チャット・エモート・アバター変更ができる権限か（ゲストは不可） */
export function canInteract(role) {
  return role !== 'guest';
}
