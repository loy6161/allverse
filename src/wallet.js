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
const START_BALANCE = 3000; // モックの初期残高（すぐ試せるように多めに配る）

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

/** モックを初期状態に戻す（試すとき用） */
export function resetWallet() {
  write({ balance: START_BALANCE, items: {}, log: [] });
}
