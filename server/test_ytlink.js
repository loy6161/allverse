// ============================================================
// YouTubeチャット読み取り・合言葉での結びつけ の自動テスト（2026-08-03追加）
//
// ここで確かめるのは「合言葉のさばき方」だけ。YouTubeのAPIそのものは叩かない
// （叩くと利用枠を消費するうえ、配信中でないと再現できないため）。
// APIから返ってきた形のデータを手で作って matchMessage に流し込む。
//
// 実行:
//   cd server && node test_ytlink.js
// ============================================================

import { issueCode, matchMessage, unlink, isLinked, cancelCodesFor, ytLinkCount } from './ytlink.js';

let pass = 0;
let fail = 0;

function ok(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.error(`  ✘ ${label}`);
  }
}

function ytMsg(channelId, text, name = 'だれか') {
  return { channelId, name, text };
}

console.log('\n[1] 合言葉の発行');
const A = 'u:aaaaaaaaaaaaaaaa'; // ログイン済みの人
const B = 'g:bbbbbbbb';         // ゲスト

const c1 = issueCode(A);
ok('合言葉が返る', typeof c1.code === 'string' && c1.code.length > 0);
ok('AV- で始まる', c1.code.startsWith('AV-'));
ok('有効期限が未来', c1.expiresAt > Date.now());
ok('紛らわしい文字(0/O/1/I/l)を含まない', !/[01OIl]/.test(c1.code.slice(3)));

const c2 = issueCode(B);
ok('別の人には別の合言葉', c1.code !== c2.code);

console.log('\n[2] 合言葉を打つと結びつく');
const before = ytLinkCount();
const r1 = matchMessage(ytMsg('UC_aaa', `よろしく ${c1.code}`, 'Aさん'));
ok('結びついた', Boolean(r1) && r1.linkKey === A);
ok('「いま繋がった」として返る', r1.justLinked === true);
ok('件数が増えた', ytLinkCount() === before + 1);
ok('繋がっていると分かる', isLinked(A) === true);

console.log('\n[3] 以後はその人の発言として扱われる');
const r2 = matchMessage(ytMsg('UC_aaa', 'こんばんは'));
ok('合言葉なしでも本人と分かる', Boolean(r2) && r2.linkKey === A);
ok('2回目は justLinked ではない', r2.justLinked === false);

console.log('\n[4] 関係ない人の発言は流さない');
ok('未連携のチャンネルは null', matchMessage(ytMsg('UC_zzz', 'はじめまして')) === null);
ok('空の発言は null', matchMessage(ytMsg('UC_zzz', '')) === null);
ok('channelIdが無ければ null', matchMessage(ytMsg('', 'やあ')) === null);
ok('msgがnullでも落ちない', matchMessage(null) === null);

console.log('\n[5] 合言葉は使い捨て');
const c3 = issueCode(B);
const r3 = matchMessage(ytMsg('UC_bbb', c3.code));
ok('Bが繋がった', Boolean(r3) && r3.linkKey === B);
// 同じ合言葉を別のチャンネルが打っても、もう効かない
ok('同じ合言葉を他人が打っても効かない', matchMessage(ytMsg('UC_ccc', c3.code)) === null);

console.log('\n[6] 大文字小文字と、文中に混ざっている場合');
const c4 = issueCode('u:cccccccccccccccc');
const lower = c4.code.toLowerCase();
const r4 = matchMessage(ytMsg('UC_ddd', `ねえねえ ${lower} だよ`));
ok('小文字で打っても拾う', Boolean(r4) && r4.linkKey === 'u:cccccccccccccccc');

console.log('\n[7] 同じ人が押し直すと前の合言葉は無効になる');
const D = 'u:dddddddddddddddd';
const old = issueCode(D);
const neu = issueCode(D);
ok('新しい合言葉が出る', old.code !== neu.code);
ok('古い合言葉はもう効かない', matchMessage(ytMsg('UC_eee', old.code)) === null);
ok('新しい合言葉は効く', (matchMessage(ytMsg('UC_eee', neu.code)) || {}).linkKey === D);

console.log('\n[8] 取り消し');
const E = 'u:eeeeeeeeeeeeeeee';
const c5 = issueCode(E);
cancelCodesFor(E);
ok('取り消した合言葉は効かない', matchMessage(ytMsg('UC_fff', c5.code)) === null);

console.log('\n[9] 連携の解除');
const removed = await unlink(A);
ok('1件消えた', removed === 1);
ok('もう繋がっていない', isLinked(A) === false);
ok('解除後の発言は流れない', matchMessage(ytMsg('UC_aaa', 'まだいる？')) === null);

console.log('\n[10] 同じチャンネルを別の人が繋ぎ直したら乗り換わる');
const F = 'u:ffffffffffffffff';
const G = 'u:gggggggggggggggg';
const cf = issueCode(F);
matchMessage(ytMsg('UC_ggg', cf.code));
ok('Fに繋がった', (matchMessage(ytMsg('UC_ggg', 'やあ')) || {}).linkKey === F);
const cg = issueCode(G);
// 既に繋がっているチャンネルからの発言なので、まず「Fの発言」として拾われる。
// ここが乗り換わらないと、アカウントを持ち替えた人の発言が
// 前の持ち主のアバターに出続けてしまう
const r5 = matchMessage(ytMsg('UC_ggg', cg.code));
ok('既存の結びつきが優先される（誤爆はしない）', Boolean(r5) && r5.linkKey === F);

console.log(`\n===== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
