// ============================================================
// 運営専用の見た目（前髪メッシュ・その形・グラデ・左右で違う目の色）が
// 権限の無い人に渡らないかの自己テスト。2026-08-07追加。使い方: node test_staffonly.js
//
// ⚠ 画面で隠すだけでは足りない。細工した通信で送られたら通ってしまうので、
//   サーバーの受け口（server.js の sanitizeAv）が最後の砦になっている。
// ============================================================

import { sanitizeStaffAv, isStaffRole } from '../src/staffonly.js';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

const FULL = {
  h: 'bob', hl: 'bob', hs: 'none', hb: 'std', o: 'middle',
  ac: 'wing+mesh', hc: 3, sc: 2, bc: 1, ec: 8, pl: 0, mc: 0,
  // 運営専用
  es: 1, ec2: 5, et2: 6, sn: 3, sp: 'c', sw: 'wide', hg: 7,
};
const STAFF_KEYS = ['es', 'ec2', 'et2', 'sn', 'sp', 'sw', 'hg'];

for (const role of ['admin', 'vip']) {
  const out = sanitizeStaffAv(FULL, role);
  check(`${role} は全部そのまま`, STAFF_KEYS.every((k) => out[k] === FULL[k]));
  check(`${role} は前髪メッシュを付けられる`, out.ac === 'wing+mesh', out.ac);
}

for (const role of ['user', 'guest', '', undefined]) {
  const out = sanitizeStaffAv(FULL, role);
  const left = STAFF_KEYS.filter((k) => k in out);
  check(`${String(role) || '(無指定)'} からは運営専用が消える`, left.length === 0, left.join(','));
  check(`${String(role) || '(無指定)'} の前髪メッシュは落ちる`, out.ac === 'wing', out.ac);
  check(`${String(role) || '(無指定)'} でも普通の項目は残る`, out.hc === 3 && out.hl === 'bob' && out.ec === 8);
}

check('元の av を書き換えない', 'es' in FULL && FULL.ac === 'wing+mesh');
check('isStaffRole', isStaffRole('admin') && isStaffRole('vip') && !isStaffRole('user') && !isStaffRole('guest'));
check('av が無くても落ちない', sanitizeStaffAv(null, 'user') === null);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${results.length}項目中 ${pass} PASS / ${results.length - pass} FAIL ===`);
process.exit(pass === results.length ? 0 : 1);
