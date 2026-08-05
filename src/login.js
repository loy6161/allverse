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

// ------------------------------------------------------------
// ログイン状態の持ち越し（2026-08-04追加）
//
// loyさんの指摘:
//   > ログインしたのにアバターのキャラメがリセットされてる。
//   > ページ遷移のたびにログインし直しは面倒なのでセッションもってほしい。
//
// 原因: IDトークンを**この変数にしか持っていなかった**ので、
//   ページを読み込み直すと消える → ログアウト扱い → 見た目もゲストに戻る。
//   退室ボタン（読み込み直しで入場画面へ戻る）を入れてから目立つようになった。
//
// 対策は2段構え:
//   ① IDトークンを sessionStorage に置き、読み込み直後に**期限内なら復元**する
//   ② Google側の自動サインイン（auto_select）も有効にして、期限切れ後は勝手に取り直す
//
// ⚠ localStorage ではなく sessionStorage にしている。
//   タブを閉じたら消える＝共用のパソコンでログインしっぱなしにならない。
// ⚠ 期限(exp)を必ず見る。切れたトークンを持ち回るとサーバーに弾かれ、
//   「ログインしているのに権限が無い」という分かりにくい状態になる。
// ------------------------------------------------------------
const TOKEN_KEY = 'vc-idtoken';

let config = null; // { login, clientId, persistent, events }
let idToken = '';
let profile = null; // { email, name, picture }
let gisReady = null;

/** サーバーの設定（ログインが使えるか・イベント一覧）を取得する */
export async function fetchConfig(force = false) {
  // 通常はキャッシュを返す（ログイン設定は変わらないので）。
  // イベント一覧も入っているため、イベントを立てた直後などは force=true で取り直す
  if (config && !force) return config;
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

/** そのトークンがまだ使えるか（期限に30秒の余裕を見る） */
function tokenAlive(jwt) {
  const p = decodePayload(jwt);
  if (!p || !p.exp) return false;
  return p.exp * 1000 > Date.now() + 30_000;
}

/** 受け取ったトークンを覚える（保存も含む） */
function acceptToken(jwt) {
  idToken = jwt || '';
  const p = idToken ? decodePayload(idToken) : null;
  profile = p ? { email: p.email, name: p.name, picture: p.picture } : null;
  try {
    if (idToken) sessionStorage.setItem(TOKEN_KEY, idToken);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 保存できなくても、そのタブの中では効く */
  }
  return profile;
}

/**
 * 保存してあるトークンを復元する（読み込み直後に1回）。
 * ⚠ 期限切れは捨てる。持ち回ってもサーバーに弾かれるだけで、状態が分かりにくくなる。
 */
function restoreToken() {
  if (idToken) return Boolean(profile);
  let saved = '';
  try {
    saved = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return false;
  }
  if (!saved) return false;
  if (!tokenAlive(saved)) {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
    return false;
  }
  acceptToken(saved);
  return Boolean(profile);
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
      acceptToken(resp.credential || '');
      if (onChange) onChange(profile);
    },
    // 前回と同じアカウントなら、ボタンを押さなくても勝手にサインインし直す。
    // 保存したトークンが期限切れになったあとの取り直しがこれで効く
    auto_select: true,
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

  // ① 保存してあるトークンで即座に戻す。
  //    ここで onChange を自分で呼ぶ（Google側のコールバックは走らないため）。
  //    これを呼ばないと、ログイン状態なのに見た目がゲストのままになる
  if (restoreToken()) {
    if (onChange) onChange(profile);
  } else {
    // ② 保存が無い／期限切れなら、Googleの自動サインインを試す。
    //    同意済みなら画面を出さずに callback が来る。出せない環境では何も起きない
    try {
      window.google.accounts.id.prompt();
    } catch {
      /* One Tap が出せない環境（ブラウザ設定等）。ボタンから押せば入れる */
    }
  }
  return true;
}

/** ログアウト（このタブの状態を捨てるだけ。Googleアカウント自体はログアウトしない） */
export function signOut() {
  idToken = '';
  profile = null;
  // ⚠ 保存も消す。残すと読み込み直しで勝手にログインし直してしまう
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    /* noop */
  }
}
