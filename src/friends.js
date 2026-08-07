// ============================================================
// フレンド（連絡帳） — **モック**（2026-08-08・loyさん依頼）
//
// > ・フレンド機能（連絡帳）でメッセージはフレンドのみがいいね
//
// ★ なぜフレンド限定にするか
//   会場に居合わせただけの人に個別メッセージを送れると、
//   一方的に送りつける道になる。**相手が承諾した相手とだけ**話せる形にする。
//
// ⚠ **この端末だけに保存する**（localStorage）。本番はサーバー（台帳と同じ場所）に置く。
//   モックなので、承諾のやり取りもサーバーを通さず「相手が居るときに申請→承諾」で完結させる。
//   ＝別の端末では引き継がれない。
//
// ⚠ フレンドの識別は **id ではなく名前** で持つ。
//   id（接続ごとの番号）は入り直すと変わるので、次に会ったとき別人になってしまう。
//   名前はサーバーが決めていて本人以外名乗れないので、モックの範囲では名前で足りる。
// ============================================================

const KEY = 'vc.friends';

const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      friends: Array.isArray(raw.friends) ? raw.friends : [],
      // 自分あてに来ている申請（相手の名前）
      requests: Array.isArray(raw.requests) ? raw.requests : [],
    };
  } catch {
    return { friends: [], requests: [] };
  }
}

function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* 保存できなくても遊べる */ }
  for (const fn of listeners) fn(v);
}

export function getFriends() {
  return read();
}

export function onFriendsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isFriend(name) {
  return read().friends.includes(name);
}

/** 申請が来た（相手から） */
export function addRequest(name) {
  const v = read();
  if (!name || v.friends.includes(name) || v.requests.includes(name)) return false;
  v.requests.push(name);
  write(v);
  return true;
}

/** 申請を受ける */
export function acceptRequest(name) {
  const v = read();
  v.requests = v.requests.filter((n) => n !== name);
  if (!v.friends.includes(name)) v.friends.push(name);
  write(v);
}

/** 申請を断る */
export function declineRequest(name) {
  const v = read();
  v.requests = v.requests.filter((n) => n !== name);
  write(v);
}

/** 相手が承諾してくれた（自分から送った申請の返事） */
export function addFriend(name) {
  const v = read();
  if (name && !v.friends.includes(name)) {
    v.friends.push(name);
    write(v);
  }
}

export function removeFriend(name) {
  const v = read();
  v.friends = v.friends.filter((n) => n !== name);
  write(v);
}
