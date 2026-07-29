// ============================================================
// 入場設定（アバターの見た目）の保存と復元
//
// ※ 表示名は保存しない。名前はサーバーが決める仕様になったため
//   （ログイン済み＝Googleアカウントの表示名／未ログイン＝ゲスト連番）。
//   ここで復元すると、実際に表示される名前と食い違って紛らわしくなる。
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
 * 保存されている見た目を読む。
 * @returns {{config?:object}|null}
 */
export function loadLocalPrefs() {
  const p = safeRead();
  if (!p || typeof p !== 'object') return null;
  if (!p.config || typeof p.config !== 'object') return null;
  return { config: p.config };
}

/** アバターの見た目を保存する（名前は保存しない） */
export function saveLocalPrefs({ config }) {
  if (!config || typeof config !== 'object') return;
  safeWrite({ config, savedAt: Date.now() });
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
