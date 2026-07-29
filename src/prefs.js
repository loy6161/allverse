// ============================================================
// 入場設定（名前・アバター）の保存と復元
//
// 2段構え:
//   1. ブラウザ（localStorage）… ログインしていなくても効く。すぐ読める
//   2. サーバー（Turso）      … ログイン済みのときだけ。別の端末でも引き継げる
//
// 起動時はまずブラウザの保存を使い、ログインしたらサーバー側で上書きする。
// こうすると「オフラインでも前回のまま」「別PCでもログインすれば同じ姿」の両方が成立する。
// ============================================================

const KEY = 'allverse.prefs.v1';

/** localStorage が使えない環境（プライベートモード等）でも落ちないようにする */
function safeRead() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false; // 容量不足・保存禁止でも機能自体は続行させる
  }
}

/**
 * 保存されている設定を読む。
 * @returns {{name?:string, config?:object}|null}
 */
export function loadLocalPrefs() {
  const p = safeRead();
  if (!p || typeof p !== 'object') return null;
  const out = {};
  if (typeof p.name === 'string') out.name = p.name;
  if (p.config && typeof p.config === 'object') out.config = p.config;
  return Object.keys(out).length ? out : null;
}

/** 名前とアバターを保存する */
export function saveLocalPrefs({ name, config }) {
  const cur = safeRead() || {};
  if (typeof name === 'string') cur.name = name;
  if (config && typeof config === 'object') cur.config = config;
  cur.savedAt = Date.now();
  safeWrite(cur);
}

/**
 * サーバーに保存してある設定を取る（ログイン済みのときだけ）。
 * @param {string} idToken
 * @returns {Promise<{name?:string, config?:object, googleName?:string}|null>}
 */
export async function fetchServerPrefs(idToken) {
  if (!idToken) return null;
  try {
    const res = await fetch('api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idt: idToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok) return null;
    return {
      name: data.name || '',
      config: data.av || null,
      googleName: data.googleName || '',
    };
  } catch {
    return null; // 取れなくても入場は続けられる
  }
}
