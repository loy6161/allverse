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

import { GUEST_HAIR } from './guestlook.js';
import { avToConfig } from './net.js';

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
  const config = { ...p.config };
  const savedAt = Number(p.savedAt) || 0;
  // ⚠ ゲスト専用の髪型（髪なし）が保存に混ざっていたら捨てる。
  //   これはサーバーがゲストに割り当てる姿であって、本人が選んだものではない。
  //   残っていると「一度ゲストで入ったら、ログインしても髪なしのまま」になる
  //   （2026-08-03 loyさん指摘）。選択肢に無い値なので、消せば既定の髪型に戻る
  //   髪は3分割になったので（2026-08-06）、長さ側も見る
  if (config.hairStyle === GUEST_HAIR) delete config.hairStyle;
  if (config.hairLength === GUEST_HAIR) delete config.hairLength;
  return { config, savedAt };
}

/** アバターの見た目を保存する（名前は保存しない） */
export function saveLocalPrefs({ config }) {
  if (!config || typeof config !== 'object') return;
  // ゲスト用に割り当てられた姿は「本人の好み」ではないので保存しない。
  // ここを通してしまうと、次にログインしたときまで引き継がれる
  const clean = { ...config };
  if (clean.hairStyle === GUEST_HAIR) delete clean.hairStyle;
  if (clean.hairLength === GUEST_HAIR) delete clean.hairLength;
  safeWrite({ config: clean, savedAt: Date.now() });
}

/**
 * サーバーの記録を使うか、この端末の保存を使うかの判断（2026-08-06追加）。
 *
 * ★ 優先順位は **この端末 ＞ サーバー**。理由:
 *   サーバーは**入場のたび**に保存されるので、端末の保存（決定を押した時刻）より
 *   必ず数秒新しい。「新しい方を採る」で比べると**いつでもサーバーが勝つ**ため、
 *   サーバーの記録が古い/違うと毎回そこへ戻される
 *   （2026-08-04〜06 に「リセットされた」が3回続いた原因）。
 *
 * この端末に保存があれば二度と勝手に変わらない。無い端末（初めての機器・ブラウザ）
 * では引き続きサーバーの記録を使うので、別端末への引き継ぎは効く。
 *
 * @param {{config?:object}|null} local loadLocalPrefs() の結果
 * @returns {boolean} true ならサーバーの記録を使う
 */
export function shouldUseServerPrefs(local) {
  if (!local || !local.config || typeof local.config !== 'object') return true;
  // 中身が空（壊れた保存）なら、無いのと同じ扱いにする
  return Object.keys(local.config).length === 0;
}

/**
 * サーバーに保存してある設定を取る（ログイン済みのときだけ）。
 * @param {string} idToken
 * @returns {Promise<{name?:string, config?:object, googleName?:string, role?:string}|null>}
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
      // ★ サーバーが持っているのは**通信用の圧縮した形**（{h, o, ac, hc, sc...}）で、
      //   入場画面が使う形（{hairStyle, outfit, accessory, hairColor...}）とは別物。
      //   ここで変換せずに返していたため、呼び出し側の Object.assign が
      //   **一致するキーが1つも無いまま素通り**し、ログインしても前回の姿が戻らなかった
      //   （2026-08-04 loyさん「またログインでアバター引き継がれてないよ」）。
      //   同じ端末では localStorage 側が効くので、**別の端末で入ったときだけ**
      //   既定の姿に戻る、という気づきにくい壊れ方をしていた
      config: data.av ? avToConfig(data.av) : null,
      // サーバーがその姿を保存した時刻。ブラウザ側の保存と比べて新しい方を採る
      updatedAt: Number(data.updatedAt) || 0,
      googleName: data.googleName || '',
      // 入場画面で「イベントを作る」を出すかの判断に使う。
      // あくまで表示の出し分けで、実際の可否はサーバーが判定する
      role: data.role || 'user',
    };
  } catch {
    return null; // 取れなくても入場は続けられる
  }
}
