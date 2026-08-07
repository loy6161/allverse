// ============================================================
// 財布と持ち物 — **モック**（2026-08-07・loyさん「まずはこの構想のモックを作って。
// ポイント管理はあとでもいい」）
//
// ⚠⚠ ここは本物ではありません。**残高も持ち物もこの端末の中だけ**にあります。
//   ブラウザの保存を消せば消えるし、他の端末とも、VRChat側とも繋がっていません。
//
// 本番の設計（docs/SPEC_POINTS.md）では、台帳は **ALLVERSE Worker が唯一の正**で、
// 増減はすべてサーバーが決めます。クライアントが決めた残高は信用できないためです
// （通信を差し替えれば無限に増やせる）。
//
// ★ 差し替えやすいように、**この4つの関数の形を本番と同じにしてあります**。
//   中身をWorkerへのfetchに置き換えれば、呼び出し側は直さなくて済みます。
//     getWallet() / spend(cost, reason) / grant(amount, reason) / addItem(itemId, n)
//   本番では spend/grant は「お願いする」だけになり、**結果はサーバーが返す**形になります。
// ============================================================

const KEY = 'vc.wallet.mock';
// モックの初期残高（2026-08-08・loyさん「テスト用なので初期VCもっと多く頂戴。
// お金な足りなくてテストできん」）。3000 → 50000 に引き上げ。
// ⚠ これは**初回だけ**効く値（read() が保存を持っていないときに使う既定値）。
//   もう遊んでいる人の残高を勝手に増やすものではない
const START_BALANCE = 50000;

const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { balance: START_BALANCE, items: {}, log: [] };
    const w = JSON.parse(raw);
    return {
      balance: Number.isFinite(w.balance) ? w.balance : START_BALANCE,
      items: w.items && typeof w.items === 'object' ? w.items : {},
      log: Array.isArray(w.log) ? w.log : [],
    };
  } catch {
    return { balance: START_BALANCE, items: {}, log: [] };
  }
}

function write(w) {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // 保存できなくても遊べる（モックなので落とさない）
  }
  for (const fn of listeners) fn(w);
}

/** 残高と持ち物を読む */
export function getWallet() {
  return read();
}

/** 残高が変わったら呼ばれる。戻り値を呼ぶと解除 */
export function onWalletChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 使う。足りなければ false を返して**何もしない**。
 * ⚠ 本番ではここでサーバーに問い合わせ、**サーバーが可否を決める**
 */
export function spend(cost, reason = '') {
  const w = read();
  if (!(cost > 0) || w.balance < cost) return false;
  w.balance -= cost;
  w.log.unshift({ t: Date.now(), amount: -cost, reason });
  w.log = w.log.slice(0, 50);
  write(w);
  return true;
}

/** もらう（ログインボーナス・当選など） */
export function grant(amount, reason = '') {
  if (!(amount > 0)) return;
  const w = read();
  w.balance += amount;
  w.log.unshift({ t: Date.now(), amount, reason });
  w.log = w.log.slice(0, 50);
  write(w);
}

/** 持ち物に足す（itemId は catalog.js の通し番号） */
export function addItem(itemId, n = 1) {
  const w = read();
  w.items[itemId] = (w.items[itemId] || 0) + n;
  write(w);
}

/** 持っているか */
export function hasItem(itemId) {
  return (read().items[itemId] || 0) > 0;
}

// ------------------------------------------------------------------
// 貯まる手段（2026-08-08・loyさんの選択「ログインボーナス（1日1回）」「イベント参加」）
//
// ⚠ **これもモック**。この端末の中で日付を見て配っているだけなので、
//   保存を消せば何度でも受け取れる。本番はサーバーが判定する。
// ------------------------------------------------------------------

/** 1日1回のログインボーナス */
export const DAILY_BONUS = 300;
/** イベントに参加したときのボーナス（同じイベントでは1日1回だけ） */
export const EVENT_BONUS = 200;

/** その端末の「今日」。日付が変わったかを見るだけなので地域時刻でよい */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readClaims() {
  try {
    return JSON.parse(localStorage.getItem(CLAIM_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const CLAIM_KEY = 'vc.wallet.claims';

/**
 * 1日1回のログインボーナス。受け取ったら金額を返し、今日すでに受け取っていれば 0。
 * @returns {number}
 */
export function claimDailyBonus() {
  const claims = readClaims();
  if (claims.daily === today()) return 0;
  claims.daily = today();
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(claims));
  } catch { /* 保存できなくても配る */ }
  grant(DAILY_BONUS, 'ログインボーナス');
  return DAILY_BONUS;
}

/**
 * イベント参加のボーナス。**同じイベントでは1日1回**。
 * @param {string} eventId
 * @returns {number} 受け取った金額（既に受け取っていれば 0）
 */
export function claimEventBonus(eventId) {
  if (!eventId) return 0;
  const claims = readClaims();
  const key = `ev:${eventId}`;
  if (claims[key] === today()) return 0;
  claims[key] = today();
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(claims));
  } catch { /* 保存できなくても配る */ }
  grant(EVENT_BONUS, 'イベント参加');
  return EVENT_BONUS;
}

/** モックを初期状態に戻す（試すとき用） */
export function resetWallet() {
  write({ balance: START_BALANCE, items: {}, log: [] });
  try {
    localStorage.removeItem(CLAIM_KEY);
  } catch { /* 消せなくてもよい */ }
}

// ------------------------------------------------------------------
// テスト用の即席チャージ（2026-08-08・loyさん「お金な足りなくてテストできん」）
//
// ⚠⚠ **モック期間だけのボタン**。本番のALLVERSE Workerには絶対に持ち込まない
//   （現実のお金は一切絡まないが、無制限に増やせる仕組み自体を本番機能として
//   残すと台帳の意味が無くなるため）。押した場所（ウォレット画面）にも
//   「モック限定」であることを必ず表示すること
// ------------------------------------------------------------------

export const TEST_TOPUP_AMOUNT = 10000;

/** テスト用に一気に足す。何度でも押せる（モック限定） */
export function claimTestTopup() {
  grant(TEST_TOPUP_AMOUNT, 'テスト用チャージ（モック限定）');
  return TEST_TOPUP_AMOUNT;
}

// ------------------------------------------------------------------
// ログイン日数（2026-08-08・ランキング表示用）
//
// > ランキングはVC、ログイン日数、とかがいいかもね。（loyさん）
//
// ⚠ これもモック。この端末の「今日」を見て、前回と連続しているかだけを判定する。
//   保存を消せば0に戻るし、他の端末とは合算されない
// ------------------------------------------------------------------

const LOGIN_KEY = 'vc.wallet.login';

function readLogin() {
  try {
    const v = JSON.parse(localStorage.getItem(LOGIN_KEY) || 'null');
    if (!v || typeof v !== 'object') return { lastDay: '', streak: 0, total: 0 };
    return {
      lastDay: typeof v.lastDay === 'string' ? v.lastDay : '',
      streak: Number.isFinite(v.streak) ? v.streak : 0,
      total: Number.isFinite(v.total) ? v.total : 0,
    };
  } catch {
    return { lastDay: '', streak: 0, total: 0 };
  }
}

/** today() の "Y-M-D" 同士の差（日数）。前回の記録が無ければ null */
function dayDiff(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const a = new Date(fy, fm - 1, fd);
  const b = new Date(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

/**
 * 入場のたびに呼ぶ。同じ日に何度呼んでも1日として数える。
 * 前回の記録の**翌日**に呼ばれれば連続日数(streak)が伸び、間が空けば1に戻る。
 * @returns {{ streak:number, total:number }}
 */
export function recordLoginDay() {
  const t = today();
  const s = readLogin();
  if (s.lastDay === t) return { streak: s.streak, total: s.total }; // 今日はもう数えた
  const diff = s.lastDay ? dayDiff(s.lastDay, t) : null;
  const streak = diff === 1 ? s.streak + 1 : 1;
  const total = s.total + 1;
  try {
    localStorage.setItem(LOGIN_KEY, JSON.stringify({ lastDay: t, streak, total }));
  } catch { /* 保存できなくても遊べる */ }
  return { streak, total };
}

/** いまのログイン日数（画面表示用。記録し直しはしない） */
export function getLoginStat() {
  const s = readLogin();
  return { streak: s.streak, total: s.total };
}

// ------------------------------------------------------------------
// 貯まる手段の追加分（2026-08-08・loyさん「VCを稼ぐ方法がないと詰むね」）
//
// 上の claimDailyBonus / claimEventBonus に足して、
// 「街を歩く理由」「人と関わると得」になるものを用意する。
// ⚠ どれもモック（この端末だけの判定）。本番はサーバーが可否を決める
// ------------------------------------------------------------------

/** 実績を達成したときの報酬（phoneextra.js の ACHIEVEMENTS.reward から呼ばれる） */
export function grantAchievementReward(amount, label) {
  if (!(amount > 0)) return;
  grant(amount, `実績: ${label}`);
}

/** 街に落ちているコインを拾ったとき */
export function grantCityCoin(amount) {
  if (!(amount > 0)) return;
  grant(amount, '街のコイン');
}

/** 街に出ている間の滞在ボーナス（一定時間ごと） */
export function grantStayBonus(amount) {
  if (!(amount > 0)) return;
  grant(amount, '街での滞在ボーナス');
}

const FRIEND_BONUS_KEY = 'vc.wallet.friendbonus';
/** フレンドになったときのボーナス（他の人と関わると得なもの） */
export const FRIEND_BONUS = 250;

/**
 * フレンドになったボーナスを配る。**同じ相手には1回だけ**（名前で判定）。
 * 申請した側・受けた側の両方から呼んでよい（それぞれの端末で1回ずつ配られる）
 */
export function claimFriendBonus(name) {
  if (!name) return 0;
  let given = [];
  try {
    given = JSON.parse(localStorage.getItem(FRIEND_BONUS_KEY) || '[]');
    if (!Array.isArray(given)) given = [];
  } catch {
    given = [];
  }
  if (given.includes(name)) return 0;
  given.push(name);
  try {
    localStorage.setItem(FRIEND_BONUS_KEY, JSON.stringify(given.slice(-200)));
  } catch { /* 保存できなくても配る */ }
  grant(FRIEND_BONUS, `フレンド: ${name}`);
  return FRIEND_BONUS;
}
