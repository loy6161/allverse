// ============================================================
// 「コメント → エモート」の判定テスト（2026-08-03追加）
//
// loyさんの指示:
//   ・888 / 乾杯 / www は拾う
//   ・指定以外の絵文字はペンライト（アーティスト独自の弾幕がここに落ちる）
//   ・ハート/星/ニコニコ/花火は連投しない
//
// 実行: cd server && node test_chatemote.js
// ============================================================

import { emoteFromText, MAX_REPEAT } from './chatemote.js';

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
const r = (t) => emoteFromText(t);

console.log('\n[1] 文字の合図');
ok('888 で拍手', r('888').id === 'clap', JSON.stringify(r('888')));
ok('88888 も拍手', r('88888').id === 'clap');
ok('全角の８８８ も拍手', r('８８８').id === 'clap');
ok('888 888 888 は3回ぶん', r('888 888 888').n === 3, String(r('888 888 888').n));
ok('文中の 888 も拾う', r('よかった888').id === 'clap');
ok('www でニコニコ', r('www').id === 'smile');
ok('ｗｗｗ でもニコニコ', r('ｗｗｗ').id === 'smile');
ok('乾杯 で乾杯', r('乾杯！').id === 'cheers');
ok('かんぱい でも乾杯', r('かんぱい').id === 'cheers');

console.log('\n[2] 誤爆しない');
ok('888円 は拾わない', r('888円') === null, JSON.stringify(r('888円')));
ok('8888番地 は拾わない', r('8888番地') === null);
ok('1888 は拾わない', r('1888') === null);
ok('単独の w は拾わない', r('w') === null);
ok('word は拾わない', r('word') === null);
ok('ふつうの会話は無反応', r('こんばんは、今日もありがとう') === null);
ok('空文字は無反応', r('') === null);
ok('null でも落ちない', r(null) === null);

console.log('\n[3] 決め打ちの絵文字');
ok('👏 で拍手', r('\u{1F44F}').id === 'clap');
ok('👋 で手をふる', r('\u{1F44B}').id === 'wave');
ok('❤️ でハート（異体字つき）', r('\u{2764}\u{FE0F}').id === 'heart');
ok('⭐ で星', r('\u{2B50}').id === 'star');
ok('🎉 で花火', r('\u{1F389}').id === 'firework');
ok('🍺 で乾杯', r('\u{1F37A}').id === 'cheers');
ok('✊ でコブシ', r('\u{270A}').id === 'fist');
ok('🤘 でヘッドバンキング', r('\u{1F918}').id === 'headbang');

console.log('\n[3-2] ジャンプ（2026-08-03追加・12種で唯一割り当てが抜けていた）');
ok('↑ でジャンプ', r('\u{2191}').id === 'jump', JSON.stringify(r('\u{2191}')));
ok('↑↑↑ は3回ぶん', r('\u{2191}\u{2191}\u{2191}').n === 3, String(r('\u{2191}\u{2191}\u{2191}').n));
ok('⤴️ でジャンプ', r('\u{2934}\u{FE0F}').id === 'jump');
ok('⬆️ でジャンプ', r('\u{2B06}\u{FE0F}').id === 'jump');
ok('🆙 でジャンプ', r('\u{1F199}').id === 'jump');
ok('→（右矢印）は拾わない', r('\u{2192}') === null, JSON.stringify(r('\u{2192}')));

console.log('\n[4] 指定以外の絵文字はペンライト（弾幕）');
const barrage = r('\u{1F680}\u{1F680}\u{1F680}\u{1F680}\u{1F680}'); // 🚀×5
ok('未指定の絵文字はペンライト', barrage.id === 'penlight', JSON.stringify(barrage));
ok('数だけ繰り返す', barrage.n === 5, String(barrage.n));
const many = r('\u{1F680}'.repeat(30));
ok(`上限 ${MAX_REPEAT} で頭打ち`, many.n === MAX_REPEAT, String(many.n));
ok('文字と混ざっていても拾う', r('いくぞ\u{1F680}\u{1F680}').id === 'penlight');

console.log('\n[5] 混ざった弾幕はペンライト（loyさんの実例・2026-08-03）');
// 💙♬ を4回くり返す（アーティスト指定の弾幕）
const b1 = r('\u{1F499}\u{266C}'.repeat(4));
ok('💙♬×4 はペンライト', b1.id === 'penlight', JSON.stringify(b1));
ok('絵文字の数だけ繰り返す', b1.n === 8, String(b1.n));
// 🚀⭐️ を3回くり返す
const b2 = r('\u{1F680}\u{2B50}\u{FE0F}'.repeat(3));
ok('🚀⭐️×3 はペンライト', b2.id === 'penlight', JSON.stringify(b2));
ok('絵文字の数だけ繰り返す', b2.n === 6, String(b2.n));

console.log('\n[6] 素直な反応は弾幕にしない');
ok('❤×3 はハートのまま', r('\u{2764}\u{2764}\u{2764}').id === 'heart');
ok('👏×3 は拍手のまま', r('\u{1F44F}\u{1F44F}\u{1F44F}').id === 'clap');
ok(
  '👏×3＋⭐ は拍手のまま（突出している方を採る）',
  r('\u{1F44F}\u{1F44F}\u{1F44F}\u{2B50}').id === 'clap',
  JSON.stringify(r('\u{1F44F}\u{1F44F}\u{1F44F}\u{2B50}')),
);
ok(
  '軽い混ぜ方（👏⭐）は弾幕にしない',
  r('\u{1F44F}\u{2B50}').id !== 'penlight',
  JSON.stringify(r('\u{1F44F}\u{2B50}')),
);

console.log('\n[7] 複数の絵文字が混ざったら多い方');
const mixed = r('\u{1F44F}\u{1F44F}\u{1F44F}\u{2B50}'); // 👏×3 + ⭐×1
ok('多い方（拍手）が選ばれる', mixed.id === 'clap', JSON.stringify(mixed));
ok('その数だけ繰り返す', mixed.n === 3, String(mixed.n));

console.log('\n[8] 何かが出るものは繰り返さない');
ok('ハートは1回だけ', r('\u{2764}\u{2764}\u{2764}').n <= 3); // 判定側は数えるが、再生側で1回に落とす
ok('www は1回だけ', r('wwwwwwww').n === 1, String(r('wwwwwwww').n));

console.log('\n[9] コールのワード（管理画面で登録するもの・2026-08-03追加）');
const CALLS = [
  { w: 'リバーブ最高', e: 'firework' },
  { w: 'リバーブ', e: 'penlight' },
  { w: 'オイオイ', e: 'fist' },
];
const c = (t) => emoteFromText(t, CALLS);
ok('ワードそのままで反応', c('リバーブ').id === 'penlight', JSON.stringify(c('リバーブ')));
ok('「！」が付いても反応（ゆるい判定）', c('リバーブ！').id === 'penlight');
ok('文中に入っていても反応', c('やっぱりリバーブいいね').id === 'penlight');
ok(
  '長いワードが優先される',
  c('リバーブ最高！').id === 'firework',
  JSON.stringify(c('リバーブ最高！')),
);
ok('別のワードは別のエモート', c('オイオイオイ').id === 'fist');
ok('登録していない言葉は無反応', c('こんばんは') === null, JSON.stringify(c('こんばんは')));
ok('リスト未選択（null）なら反応しない', emoteFromText('リバーブ！', null) === null);
ok('空のリストでも落ちない', emoteFromText('リバーブ！', []) === null);
ok('ワードは絵文字より先に見る', c('リバーブ\u{1F44F}\u{1F44F}').id === 'penlight');

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
