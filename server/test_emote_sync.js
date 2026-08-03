// ============================================================
// エモートの長さが「2か所で食い違っていない」ことの自己テスト（2026-08-04追加）
//
// なぜ要るのか:
//   エモートの長さは **src/avatar_glb.js（見た目）と server/server.js（VRChatへ送る emd）
//   の2か所**にある。片方だけ直すと、ブラウザ会場では3振りなのにVRC客席では1振りで止まる、
//   という食い違いが起きる。docs にも「ハマりどころ」として書いてあるが、
//   人間の注意力に頼るのをやめて機械で見張る。
//
//   繰り返し上限（EMOTE_MAX_REPEAT）も同じ理由で2か所にある。
//
// 実行:
//   cd server && node test_emote_sync.js
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, 'server.js'), 'utf8');
const avatarSrc = readFileSync(join(here, '..', 'src', 'avatar_glb.js'), 'utf8');

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

/** `名前: 数値` の組をすべて拾う。コメント行は取り除いてから見る */
function pairsIn(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const body = line.replace(/\/\/.*$/, '');
    const m = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
    let hit;
    while ((hit = m.exec(body))) out[hit[1]] = Number(hit[2]);
  }
  return out;
}

/** `const NAME = { ... };` の中身を取り出す（入れ子は想定しない） */
function objectLiteral(src, name) {
  const i = src.indexOf(`const ${name} = {`);
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  const end = src.indexOf('};', start);
  if (end < 0) return null;
  return src.slice(start + 1, end);
}

console.log('[1] エモートの長さ（秒）が両側で一致する');
const serverDur = pairsIn(objectLiteral(serverSrc, 'EMOTE_DURATIONS') || '');
const clientDur = pairsIn(objectLiteral(avatarSrc, 'EMOTE_DURATIONS') || '');
ok('サーバー側の表を読めた', Object.keys(serverDur).length > 0, `${Object.keys(serverDur).length}件`);
ok('クライアント側の表を読めた', Object.keys(clientDur).length > 0, `${Object.keys(clientDur).length}件`);

const allIds = new Set([...Object.keys(serverDur), ...Object.keys(clientDur)]);
for (const id of [...allIds].sort()) {
  ok(`${id} の長さが一致`, serverDur[id] === clientDur[id],
    `サーバー=${serverDur[id]} / クライアント=${clientDur[id]}`);
}

console.log('\n[2] 繰り返し上限が両側で一致する');
const serverMax = pairsIn(objectLiteral(serverSrc, 'EMOTE_MAX_REPEAT') || '');
const clientMax = pairsIn(objectLiteral(avatarSrc, 'EMOTE_MAX_REPEAT') || '');
const maxIds = new Set([...Object.keys(serverMax), ...Object.keys(clientMax)]);
ok('上限の表が両側にある', maxIds.size > 0, [...maxIds].join(','));
for (const id of [...maxIds].sort()) {
  ok(`${id} の繰り返し上限が一致`, serverMax[id] === clientMax[id],
    `サーバー=${serverMax[id]} / クライアント=${clientMax[id]}`);
}

console.log('\n[3] 連投しても長くなりすぎない');
// 弾幕で繋いだときの最長。ここが伸びすぎると1人が会場を占有する
for (const id of [...maxIds].sort()) {
  const total = (serverDur[id] || 0) * (serverMax[id] || 1);
  ok(`${id} は連投しても8秒以内`, total <= 8, `${total.toFixed(1)}秒`);
}

console.log('\n[4] ペンライトは3振り（2026-08-04 loyさん要望）');
// 1振り0.6秒 × 3 = 1.8秒。ここを変えるときは PENLIGHT_SWINGS も一緒に直すこと
ok('長さが1.8秒', serverDur.penlight === 1.8, String(serverDur.penlight));
const swings = /const PENLIGHT_SWINGS = (\d+)/.exec(avatarSrc);
ok('振り数が3', swings && swings[1] === '3', swings ? swings[1] : 'ない');
ok('長さ ÷ 振り数 = 0.6秒（1振りの速さが変わっていない）',
  swings && Math.abs(serverDur.penlight / Number(swings[1]) - 0.6) < 1e-9,
  swings ? String(serverDur.penlight / Number(swings[1])) : '-');

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
