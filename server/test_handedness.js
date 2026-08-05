// ============================================================
// 利き手の自己テスト（2026-08-04追加）
//
// loyさんの指摘:
//   > いや、今左手だよ？見方間違えてるよ。
//   > ちなみにVR側は右手になってるから今がすでに逆手になってるから合わせたいね
//
// ★ 何が起きていたか:
//   GLB内のオブジェクト名 `armR` は、実際には**アバターの左腕**だった。
//   （rotation.y=0 のとき armR の中心が x=+0.18／armL が x=-0.18。
//     アバターの前方は +z なので、右手は -x 側＝armL）
//   片手のエモートは全部 `armR` を使っていたので**左手で振っていた**。
//   VRChat側のプロキシは右手なので、両会場で手が食い違っていた。
//
// ★ ここで見張るのは **「既定が右のままか」** の一点。
//   ここが左に倒れると、**未指定の古いデータの人が全員左利きになり、
//   VRChat側とまた食い違う**。動きそのものはブラウザ側で実測している
//   （右利き→実際の右腕が上がる／左利き→左腕、を確認済み）。
//
// ⚠ src/ は three を import しているので node から読み込めない。
//   そのため**ソースを読んで確かめる**（test_emote_sync.js と同じやり方）。
//
// 実行:
//   cd server && node test_handedness.js
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', 'src', f), 'utf8');
const netSrc = src('net.js');
const avatarSrc = src('avatar.js');
const glbSrc = src('avatar_glb.js');
const joinSrc = src('join.js');

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`[PASS] ${label}${extra ? ` - ${extra}` : ''}`);
  } else {
    fail++;
    console.error(`[FAIL] ${label}${extra ? ` - ${extra}` : ''}`);
  }
}

console.log('[1] 選べるのは右と左の2つ');
ok('AVATAR_PARTS に handedness がある', /handedness:\s*\['right',\s*'left'\]/.test(avatarSrc));

console.log('\n[2] ★既定は右（ここが左に倒れると古いデータの人が全員左利きになる）');
// configToAv: 'left' のときだけ 'l'、それ以外は 'r'
ok('送るときは left のときだけ l', /cfg\.handedness === 'left' \? 'l' : 'r'/.test(netSrc));
// avToConfig: 'l' のときだけ left、それ以外は right
ok('受けるときは l のときだけ left', /a\.hd === 'l' \? 'left' : 'right'/.test(netSrc));
ok('ランダムでは決めない（既定の right から始める）',
  /handedness: 'right'/.test(avatarSrc));
ok('入場画面でも未設定は right に倒す',
  /handedness\.includes\(config\.handedness\)\)\s*config\.handedness = 'right'/.test(joinSrc));

console.log('\n[3] ★片手のエモートが利き手を通っている');
// ⚠ 両手のエモート（踊る・ハート・星・花火）は armL と armR を**対で**使うので、
//   ファイル全体で `aimArm(armR` を数えると正しい使用まで拾ってしまう。
//   片手で使う4つの case ブロックだけを切り出して見る。
function caseBlock(id) {
  const start = glbSrc.indexOf(`case '${id}': {`);
  if (start < 0) return '';
  const end = glbSrc.indexOf("      case '", start + 10);
  return glbSrc.slice(start, end > 0 ? end : start + 2000);
}
for (const id of ['wave', 'penlight', 'fist', 'cheers']) {
  const b = caseBlock(id);
  ok(`${id} は利き手を通す`, b.includes('aimMainHand('), b ? '' : 'ブロックが見つからない');
  ok(`${id} に armR の直指定が残っていない`, !/aimArm\(armR/.test(b));
}
// 両手のものは対で使ったままであること（片方だけ利き手に変えると左右がちぐはぐになる）
// ⚠ 触り方は2通りある。aimArm で向きを指定するもの（heart/star/firework）と、
//   rotation.x を直接いじるもの（dance）。どちらでも「両腕が出てくる」ことで見る
for (const id of ['dance', 'heart', 'star', 'firework']) {
  const b = caseBlock(id);
  const both = /armL/.test(b) && /armR/.test(b);
  const untouched = !b.includes('aimMainHand(');
  ok(`${id} は両手のまま`, both && untouched, both ? '' : '片腕しか出てこない');
}

console.log('\n[4] 持ち物も利き手に付く');
ok('ペンライトを利き手に付ける', /h\.arm\.add\(stick\)/.test(glbSrc));
ok('ジョッキを利き手に付ける', /h\.arm\.add\(g\)/.test(glbSrc));

console.log('\n[5] 名前と実体が逆であることが書き残されている');
// ここを知らずに armR を「右腕」と読むと、また同じ間違いをする
ok('armR が実際は左腕だと注意書きがある',
  /armR`? は実際には\*\*アバターの左腕\*\*|armR` は実際には/.test(glbSrc));

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
