// ============================================================
// 髪の3分割（長さ・髪型・前髪）の自己テスト。2026-08-06追加
// 使い方: node test_hair.js（サーバーは要らない）
//
// 見ているのは主に**後方互換**:
//   ・古い1つだけのid（'twin' 等）が3つに読み替わるか
//   ・送るときに古いid（av.h）が付いてくるか（VRChat側が今も見ているため）
//   ・ゲストの「髪なし」が消えないか
// ============================================================

// ⚠ net.js / avatar.js は three を読み込むのでここからは import できない。
//   変換の中身は hair.js に寄せてあるので、それを直接見る
import {
  normalizeHair, legacyHairId, LEGACY_HAIR, HAIR_LENGTHS, HAIR_ARRANGES, BANGS,
} from '../src/hair.js';
import { GUEST_HAIR } from '../src/guestlook.js';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

// ---- 古いid → 3つ ----
for (const [old, want] of Object.entries(LEGACY_HAIR)) {
  const got = normalizeHair({ hairStyle: old });
  check(
    `古い「${old}」が3つに読み替わる`,
    got.hairLength === want.hairLength && got.hairStyle === want.hairStyle && got.bangs === want.bangs,
    JSON.stringify(got),
  );
}

// ---- 3つ → 古いid（VRChat互換） ----
const legacyCases = [
  [{ hairLength: 'bob', hairStyle: 'twin', bangs: 'std' }, 'twin'],
  [{ hairLength: 'long', hairStyle: 'bun', bangs: 'patsun' }, 'bun'], // 結い方が最優先
  [{ hairLength: 'short', hairStyle: 'none', bangs: 'patsun' }, 'patsun'],
  [{ hairLength: 'short', hairStyle: 'none', bangs: 'std' }, 'short'],
  [{ hairLength: GUEST_HAIR, hairStyle: 'none', bangs: 'std' }, GUEST_HAIR],
];
for (const [h, want] of legacyCases) {
  check(`古いidに落とす: ${JSON.stringify(h)} → ${want}`, legacyHairId(h) === want, legacyHairId(h));
}

// ---- 往復（新しいクライアント同士。net.js は hl/hs/hb をそのまま載せる）----
let roundTripOk = true;
let combos = 0;
for (const len of HAIR_LENGTHS) {
  for (const st of HAIR_ARRANGES) {
    for (const bg of BANGS) {
      combos++;
      const back = normalizeHair({ hairLength: len, hairStyle: st, bangs: bg });
      if (back.hairLength !== len || back.hairStyle !== st || back.bangs !== bg) {
        roundTripOk = false;
        console.log('  ずれた:', len, st, bg, '→', JSON.stringify(back));
      }
    }
  }
}
check(`往復: ${combos}通りすべて元に戻る`, roundTripOk && combos === 48, `${combos}通り`);

// ---- 古いクライアントから来た av（hl が無い）----
const fromOld = normalizeHair({ hairStyle: 'twin' });
check(
  '古い av（h だけ）を受け取れる',
  fromOld.hairLength === 'bob' && fromOld.hairStyle === 'twin' && fromOld.bangs === 'std',
  JSON.stringify(fromOld),
);

// ---- ゲスト（髪なし）----
const guest = normalizeHair({ hairStyle: GUEST_HAIR });
check('ゲストの「髪なし」が保たれる', guest.hairLength === GUEST_HAIR, guest.hairLength);
check('ゲストを送り返しても髪なしのまま', legacyHairId(guest) === GUEST_HAIR);

// ---- 知らない値は既定に倒す ----
const junk = normalizeHair({ hairLength: 'xxx', hairStyle: 'yyy', bangs: 'zzz' });
check(
  '知らない値は既定に倒れる',
  junk.hairLength === 'long' && junk.hairStyle === 'none' && junk.bangs === 'std',
  JSON.stringify(junk),
);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${results.length}項目中 ${pass} PASS / ${results.length - pass} FAIL ===`);
process.exit(pass === results.length ? 0 : 1);
