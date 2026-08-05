// ============================================================
// 「ゲストの見た目がアカウントに引き継がれない」ことのテスト（2026-08-03追加）
//
// loyさんの指摘:
//   > アバターが一度ゲストで入っちゃうと次ログインしたときに
//   > ゲストの時のキャラメが引き継がれてしまう
//
// 経路が3つあったので、3つとも塞いだことを確かめる:
//   ① サーバー: ゲスト専用の髪型を含む姿は profiles に保存しない
//   ② サーバー: 既に保存されてしまっている記録は、読むときに落とす
//   ③ クライアント: localStorage に混ざっていたら読み書きの両方で落とす
//      （ここはブラウザ側なので、このテストでは①②だけを見る）
//
// 実行: cd server && node test_profile.js
// ============================================================

import { rm } from 'node:fs/promises';
import { GUEST_HAIR } from '../src/guestlook.js';

const DB = './_test_profile.db';
process.env.TURSO_DATABASE_URL = `file:${DB}`;

const { initStore, saveProfile, loadProfile } = await import('./store.js');

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

await initStore();

const EMAIL = 'tester@example.com';
const NORMAL_AV = { h: 'bob', o: 'middle', ac: 'none', hc: 3, sc: 4, bc: 1, ec: 2, pl: 5 };
const GUEST_AV = { h: GUEST_HAIR, o: 'middle', ac: 'none', hc: 9, sc: 2, bc: 6, ec: 0, pl: 0 };

console.log('\n[1] ふつうの見た目は保存される');
ok('保存できた', (await saveProfile(EMAIL, 'ろい', NORMAL_AV)) === true);
let got = await loadProfile(EMAIL);
ok('読み戻せた', Boolean(got));
ok('髪型が残っている', got.av.h === 'bob', got.av.h);
ok('色も残っている', got.av.hc === 3 && got.av.sc === 4);

console.log('\n[2] ゲスト専用の姿は保存しない');
ok('保存が拒否される', (await saveProfile(EMAIL, 'ろい', GUEST_AV)) === false);
got = await loadProfile(EMAIL);
ok('前の見た目が壊されていない', got.av.h === 'bob', got.av.h);
ok('ゲストの色で上書きされていない', got.av.hc === 3, String(got.av.hc));

console.log('\n[3] 既に混ざってしまった記録は、読むときに落とす');
// 保存側を通さず、DBへ直接ゲストの姿を書き込んで再現する
const { createClient } = await import('@libsql/client');
const db = createClient({ url: `file:${DB}` });
await db.execute({
  sql: `INSERT INTO profiles (email, name, av, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET av = excluded.av`,
  args: ['dirty@example.com', 'よごれ', JSON.stringify(GUEST_AV), Date.now()],
});
const dirty = await loadProfile('dirty@example.com');
ok('ゲスト専用の髪型が落ちている', dirty.av.h === undefined, String(dirty.av.h));
ok('他の項目は残っている', dirty.av.sc === 2 && dirty.av.bc === 6);

console.log('\n[4] 保存が無い人は null（新規のログイン）');
ok('null が返る', (await loadProfile('nobody@example.com')) === null);

console.log('\n[5] ★いつ保存したかが分かる（端末側の保存と新旧を比べるため）');
// これが無いと、別の端末で前に保存した古い姿が、いま設定した姿を上書きしてしまう
// （2026-08-04 loyさん「ログインでアバター違うのになる」）
const before = Date.now();
await saveProfile(EMAIL, 'ろい', { ...NORMAL_AV, hc: 7 });
const stamped = await loadProfile(EMAIL);
ok('updatedAt が返る', typeof stamped.updatedAt === 'number', String(stamped.updatedAt));
ok('保存した時刻になっている', stamped.updatedAt >= before, `${stamped.updatedAt} >= ${before}`);
ok('上書きも効いている', stamped.av.hc === 7, String(stamped.av.hc));

await rm(DB, { force: true }).catch(() => {});
await rm(`${DB}-shm`, { force: true }).catch(() => {});
await rm(`${DB}-wal`, { force: true }).catch(() => {});

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
