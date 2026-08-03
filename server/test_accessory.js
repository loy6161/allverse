// ============================================================
// アクセサリーの複数付けの自己テスト（2026-08-04追加）
//
// テストユーザーの要望: 「アクセサリーを複数付けたい」
//
// ★ ここで守りたいのは **VRChat側へ変なものを流さないこと**。
//   `ac` は presence.json を通ってVRChatのUdonに渡り、向こうは `+` で分割して
//   そのまま処理する（申し送り⑧）。知らないid・重複・長すぎる並びを
//   素通しすると向こうの処理にゴミが渡るので、こちらで必ず落とす。
//
// 実行:
//   cd server && node test_accessory.js
// ============================================================

import {
  parseAccessories,
  formatAccessories,
  toggleAccessory,
  hasAccessory,
  MAX_ACCESSORIES,
} from '../src/accessory.js';

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('[1] これまでの1つだけの形が壊れていない（既存ユーザーの見た目を変えない）');
ok('"halo" はそのまま', formatAccessories('halo') === 'halo');
ok('"none" はそのまま', formatAccessories('none') === 'none');
ok('空文字は none になる', formatAccessories('') === 'none');
ok('undefined でも落ちない', formatAccessories(undefined) === 'none');
ok('1つだけなら + が付かない', !formatAccessories('kemo').includes('+'), formatAccessories('kemo'));

console.log('\n[2] 複数付けられる');
ok('2つ並ぶ', formatAccessories('wing+halo') === 'wing+halo');
ok('配列でも受け取れる', formatAccessories(['wing', 'halo']) === 'wing+halo');
ok('分解できる', eq(parseAccessories('wing+halo'), ['wing', 'halo']));
ok('付いているか判定できる', hasAccessory('wing+halo', 'halo') === true);
ok('付いていないものは false', hasAccessory('wing+halo', 'tail') === false);

console.log('\n[3] ★VRChatへ流す前に汚れを落とす');
ok('知らないidは捨てる', formatAccessories('halo+ドラゴン') === 'halo');
ok('知らないidだけなら none', formatAccessories('ドラゴン+ユニコーン') === 'none');
ok('重複は1つにまとめる', formatAccessories('halo+halo') === 'halo');
ok('none が混ざっていたら無視する', formatAccessories('none+halo') === 'halo');
ok('空の要素があっても平気', formatAccessories('halo++wing') === 'halo+wing');
ok('前後の空白を落とす', formatAccessories(' halo + wing ') === 'halo+wing');

console.log('\n[4] ★上限を超えない（長すぎる並びをVRChatへ渡さない）');
const many = 'kemo+ahoge+tail+wing+halo+ribbon';
ok(`${MAX_ACCESSORIES}つで切る`, parseAccessories(many).length === MAX_ACCESSORIES,
  formatAccessories(many));
ok('切ったあとも先頭から順に残る', formatAccessories(many) === 'kemo+ahoge+tail');

console.log('\n[5] 顔まわりは同時に付かない（メガネとサングラス）');
ok('先に選ばれている方が残る', formatAccessories('glasses+sunglasses') === 'glasses');
ok('逆順でも先頭が残る', formatAccessories('sunglasses+glasses') === 'sunglasses');
ok('片方だけなら普通に付く', formatAccessories('sunglasses') === 'sunglasses');

console.log('\n[6] 押して付ける・押して外す');
ok('何も無い状態から付ける', toggleAccessory('none', 'halo') === 'halo');
ok('もう一度押すと外れる', toggleAccessory('halo', 'halo') === 'none');
ok('2つ目を足せる', toggleAccessory('halo', 'wing') === 'halo+wing');
ok('真ん中だけ外せる', toggleAccessory('halo+wing+tail', 'wing') === 'halo+tail');
ok('メガネを押すとサングラスと入れ替わる',
  toggleAccessory('sunglasses+halo', 'glasses') === 'halo+glasses',
  toggleAccessory('sunglasses+halo', 'glasses'));
// 上限に達しているとき: 押しても無反応より、古いものが外れる方が迷わない
ok('上限のとき、いちばん古いものが外れて新しいものが付く',
  toggleAccessory('kemo+ahoge+tail', 'halo') === 'ahoge+tail+halo',
  toggleAccessory('kemo+ahoge+tail', 'halo'));
ok('「なし」を押すと全部外れる', toggleAccessory('halo+wing', 'none') === 'none');
ok('知らないidを押しても壊れない', toggleAccessory('halo', 'ドラゴン') === 'halo');

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
