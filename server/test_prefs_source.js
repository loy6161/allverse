// ============================================================
// 「アバターの姿を、この端末とサーバーのどちらから復元するか」の判断
//
// 2026-08-04〜06 に **同じ症状が3回**（リセットされた／違う姿になった／またリセット）
// 出ている場所なので、判断そのものをテストで固定する。
//
//   ・この端末に保存があれば **必ずそちらを使う**（勝手に変わらない）
//   ・保存が無い端末（初めての機器・ブラウザ）だけサーバーの記録を使う（引き継ぎ）
//
// ⚠ 「保存時刻が新しい方を採る」に戻してはいけない。
//   サーバーは**入場のたび**に保存されるので、端末の保存（決定を押した時刻）より
//   必ず数秒新しくなり、**いつでもサーバーが勝つ**。それで3回目の事故が起きた。
// ============================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`[PASS] ${label}${extra ? ` - ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`[FAIL] ${label}${extra ? ` - ${extra}` : ''}`);
  }
}

// prefs.js はブラウザ向け（localStorage / fetch を使う）なので、
// 判断の関数だけを取り出して読み込む
const here = path.dirname(fileURLToPath(import.meta.url));
const src = await readFile(path.join(here, '..', 'src', 'prefs.js'), 'utf8');
const m = src.match(/export function shouldUseServerPrefs\(local\) \{[\s\S]*?\n\}/);
if (!m) {
  console.log('[FAIL] shouldUseServerPrefs が prefs.js に見つからない');
  process.exit(1);
}
const shouldUseServerPrefs = new Function(`${m[0].replace('export ', '')}; return shouldUseServerPrefs;`)();

console.log('[1] この端末に保存があるとき ＝ サーバーを使わない');
ok(
  '保存があればサーバーを使わない',
  shouldUseServerPrefs({ config: { hairStyle: 'bob', outfit: 'middle' } }) === false,
);
ok(
  '項目が1つでもあれば使わない',
  shouldUseServerPrefs({ config: { hairStyle: 'twin' } }) === false,
);
ok(
  '★保存時刻が古くてもサーバーに負けない（3回目の事故の再発防止）',
  shouldUseServerPrefs({ config: { hairStyle: 'bob' }, savedAt: 1 }) === false,
);

console.log('\n[2] 保存が無い/壊れているとき ＝ サーバーを使う（別端末への引き継ぎ）');
ok('保存そのものが無い', shouldUseServerPrefs(null) === true);
ok('config が無い', shouldUseServerPrefs({}) === true);
ok('config が空っぽ', shouldUseServerPrefs({ config: {} }) === true);
ok('config が object でない', shouldUseServerPrefs({ config: 'こわれている' }) === true);

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
