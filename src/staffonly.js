import { stripStaffOnly } from './accessory.js';

// ------------------------------------------------------------------
// 「運営（管理者・VIP）だけが使える見た目」の判定を1か所に集める。
//
// 2026-08-07・loyさん方針:
//   出演者は20人（今後増える）。**固有アイテムを都度作るのは続かない**ので、
//   アイテムではなく**パラメータ**（前髪メッシュの形・髪のグラデ・左右で違う目の色）を
//   運営専用にして、出演者ごとに違う数値を配る形にした。
//   ＝ 3Dアセットを増やさずに固有性を出す。
//
// ⚠ 画面で隠すだけでは足りない。細工した通信で送られたら通ってしまうので、
//   **サーバーの受け口で必ずこれを通す**（server.js の sanitizeAv）。
// ------------------------------------------------------------------

export function isStaffRole(role) {
  return role === 'admin' || role === 'vip';
}

/**
 * av（通信の形）から、その権限では使えない項目を落とす。
 * @param {object} av 受け取ったアバター情報
 * @param {string} role 'admin' | 'vip' | 'user' | 'guest'
 */
export function sanitizeStaffAv(av, role) {
  if (!av || typeof av !== 'object' || Array.isArray(av)) return av;
  const out = { ...av };
  if (typeof out.ac === 'string') out.ac = stripStaffOnly(out.ac, role);
  if (isStaffRole(role)) return out;
  // 左右で違う目の色（2026-08-07追加）
  delete out.es;
  delete out.ec2;
  delete out.et2;
  // 髪の飾り（前髪メッシュの形・グラデ）。
  // 形（sn/sp/sw）は、メッシュ自体が運営専用なので ac 側で既に落ちているが、
  // 念のためここでも落としておく（片方だけ直したときに漏れないように）
  delete out.sn;
  delete out.sp;
  delete out.sw;
  delete out.hg;
  return out;
}
