// ============================================================
// Googleログイン（クライアント側）
//
// Google Identity Services で IDトークン(JWT) を受け取り、入場時にサーバーへ渡す。
// サーバーはそれを検証してメールアドレスを得て、管理者/VIP/一般を判定する。
//
// 権限の判定は「入場時に1回」なので、トークンの有効期限（約1時間）が
// ライブ中に切れても、その回の権限は維持される。
//
// GOOGLE_CLIENT_ID がサーバーに設定されていないときは、ログイン機能ごと出さない
// （その間は全員が今まで通り使える。docs/SETUP_AUTH.md 参照）
// ============================================================

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let config = null; // { login, clientId, persistent, events }
let idToken = '';
let profile = null; // { email, name, picture }
let gisReady = null;

/** サーバーの設定（ログインが使えるか・イベント一覧）を取得する */
export async function fetchConfig() {
  if (config) return config;
  try {
    const res = await fetch('api/config');
    config = await res.json();
  } catch {
    config = { ok: false, login: false, clientId: '', persistent: false, events: [] };
  }
  return config;
}

export function getConfig() {
  return config;
}

export function getIdToken() {
  return idToken;
}

export function getProfile() {
  return profile;
}

export function isSignedIn() {
  return Boolean(idToken);
}

/** JWTのペイロードを読む（表示用。検証はサーバーがやるのでここでは信用しない） */
function decodePayload(jwt) {
  try {
    const base = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** GISのスクリプトを1回だけ読み込む */
function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Googleのログイン用スクリプトを読み込めませんでした'));
    document.head.appendChild(s);
  });
  return gisReady;
}

/**
 * ログインボタンを指定要素に描画する。
 * @param {HTMLElement} container ボタンを入れる場所
 * @param {(p:{email:string,name:string}|null)=>void} onChange ログイン状態が変わったとき
 */
export async function renderLoginButton(container, onChange) {
  const cfg = await fetchConfig();
  if (!cfg.login || !cfg.clientId) return false; // ログイン未設定なら何も出さない

  try {
    await loadGis();
  } catch {
    container.textContent = 'ログイン機能を読み込めませんでした（オフラインの可能性があります）';
    return false;
  }

  window.google.accounts.id.initialize({
    client_id: cfg.clientId,
    callback: (resp) => {
      idToken = resp.credential || '';
      const p = decodePayload(idToken);
      profile = p ? { email: p.email, name: p.name, picture: p.picture } : null;
      if (onChange) onChange(profile);
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  container.innerHTML = '';
  const holder = document.createElement('div');
  container.appendChild(holder);
  window.google.accounts.id.renderButton(holder, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    locale: 'ja',
  });
  return true;
}

/** ログアウト（このタブの状態を捨てるだけ。Googleアカウント自体はログアウトしない） */
export function signOut() {
  idToken = '';
  profile = null;
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* noop */
  }
}
