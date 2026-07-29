// ============================================================
// VERSE CITY Web サーバー 自己テストスクリプト
// 使い方: サーバーを別プロセスで起動した状態で `node test.js` を実行する。
// PROTOCOL.md / PRESENCE_SPEC.md §2.2 に定義された挙動を一通り検証する。
// ============================================================

import WebSocket from 'ws';
import http from 'node:http';

const PORT = process.env.PORT || 5179;
const WS_URL = `ws://localhost:${PORT}/ws`;
const HTTP_BASE = `http://localhost:${PORT}`;

const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ' - ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** wsクライアントを1つ作り、受信メッセージをキューへ積む */
function makeClient() {
  const ws = new WebSocket(WS_URL);
  const queue = [];
  ws.on('message', (raw) => {
    try {
      queue.push(JSON.parse(raw.toString()));
    } catch {
      // JSON化失敗は無視（テスト対象外）
    }
  });
  return { ws, queue };
}

function waitOpen(client) {
  return new Promise((resolve, reject) => {
    if (client.ws.readyState === WebSocket.OPEN) return resolve();
    client.ws.once('open', resolve);
    client.ws.once('error', reject);
  });
}

/** キューの中からpredicateに一致する最初のメッセージを待って取り出す */
async function waitFor(client, predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = client.queue.findIndex(predicate);
    if (idx !== -1) return client.queue.splice(idx, 1)[0];
    await sleep(30);
  }
  return null;
}

/** 一定時間待って、predicateに一致するメッセージが「来ないこと」を確認する */
async function waitForAbsence(client, predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = client.queue.findIndex(predicate);
    if (idx !== -1) return false; // 来てしまった
    await sleep(30);
  }
  return true; // 最後まで来なかった
}

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${HTTP_BASE}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  console.log(`=== VERSE CITY Web サーバー 自己テスト (${WS_URL}) ===`);

  const alice = makeClient();
  const bob = makeClient();

  await waitOpen(alice);
  await waitOpen(bob);

  // --- join: Alice が先に入場 ---
  // 表示名はサーバーが決める（2026-07-29〜）。テストでは devEmail/devName で
  // ログイン済みユーザーを模して、名前を確定させたうえで中継を検証する
  alice.ws.send(JSON.stringify({
    t: 'join', n: '詐称しても無視される', av: { h: 'twin', hc: 5, sc: 0, bc: 1 },
    devRole: 'user', devEmail: 'alice@example.com', devName: 'Alice',
  }));
  const welcomeAlice = await waitFor(alice, (m) => m.t === 'welcome');
  if (!welcomeAlice) {
    record('Alice welcome受信', false, 'タイムアウト');
    return finish();
  }
  const aliceId = welcomeAlice.id;

  // --- join: Bob が後から入場 ---
  bob.ws.send(JSON.stringify({
    t: 'join', n: '詐称しても無視される', av: { h: 'short', hc: 1, sc: 2, bc: 0 },
    devRole: 'user', devEmail: 'bob@example.com', devName: 'Bob',
  }));
  const welcomeBob = await waitFor(bob, (m) => m.t === 'welcome');
  if (!welcomeBob) {
    record('Bob welcome受信', false, 'タイムアウト');
    return finish();
  }
  const bobId = welcomeBob.id;

  // 検証1: 後発(Bob)のwelcomeに先発(Alice)がpeersとして入っている
  const alicePeerInBob = (welcomeBob.peers || []).find((p) => p.id === aliceId);
  record(
    '後発welcomeのpeersに先発が含まれる',
    Boolean(alicePeerInBob) && alicePeerInBob.n === 'Alice',
    alicePeerInBob ? `peer=${JSON.stringify(alicePeerInBob)}` : 'Aliceが見つからない',
  );

  // --- pos: Aliceが位置送信 → Bobに中継される（自分には届かない） ---
  alice.ws.send(JSON.stringify({ t: 'pos', x: 3.2, z: -12.5, r: 90, m: true }));

  const posAtBob = await waitFor(bob, (m) => m.t === 'pos' && m.id === aliceId);
  record(
    'pos中継: 相手に届く',
    Boolean(posAtBob) && posAtBob.x === 3.2 && posAtBob.z === -12.5 && posAtBob.r === 90,
    posAtBob ? JSON.stringify(posAtBob) : 'タイムアウト',
  );

  const posNotAtAlice = await waitForAbsence(alice, (m) => m.t === 'pos' && m.id === aliceId, 500);
  record('pos中継: 自分には届かない', posNotAtAlice, posNotAtAlice ? '' : '自分にposが届いてしまった');

  // --- chat: 両方に届く（発信者にも返る） ---
  alice.ws.send(JSON.stringify({ t: 'chat', txt: 'こんにちは' }));
  const chatAtAlice = await waitFor(alice, (m) => m.t === 'chat' && m.id === aliceId);
  const chatAtBob = await waitFor(bob, (m) => m.t === 'chat' && m.id === aliceId);
  record(
    'chatが両方に届く',
    Boolean(chatAtAlice) && Boolean(chatAtBob) && chatAtAlice.txt === 'こんにちは' && chatAtBob.txt === 'こんにちは',
    `alice=${JSON.stringify(chatAtAlice)} bob=${JSON.stringify(chatAtBob)}`,
  );

  // --- update: Bobがアバターを変更 → Aliceにpeer-updateとして届く ---
  // 名前は変えられない（サーバーが入場時に確定させたものを使い続ける）
  bob.ws.send(JSON.stringify({ t: 'update', n: 'Bobby', av: { h: 'hat', hc: 2, sc: 3, bc: 1 } }));
  const peerUpdateAtAlice = await waitFor(alice, (m) => m.t === 'peer-update' && m.id === bobId);
  record(
    'updateでアバターが変わる',
    Boolean(peerUpdateAtAlice) && peerUpdateAtAlice.av.h === 'hat',
    peerUpdateAtAlice ? JSON.stringify(peerUpdateAtAlice) : 'タイムアウト',
  );
  // 権限も一緒に送る。無いと着替えたあと👑や⭐が消えてしまう
  record(
    'updateで権限も一緒に届く',
    Boolean(peerUpdateAtAlice) && typeof peerUpdateAtAlice.role === 'string',
    peerUpdateAtAlice ? `role=${peerUpdateAtAlice.role}` : 'タイムアウト',
  );
  record(
    'updateで名前は変えられない',
    Boolean(peerUpdateAtAlice) && peerUpdateAtAlice.n === 'Bob',
    peerUpdateAtAlice ? `n=${peerUpdateAtAlice.n}` : 'タイムアウト',
  );

  // --- presence.json: 2人分(rm=1, av付き)が入っている ---
  await sleep(100);
  const presenceRes = await httpGetJson('/api/presence.json');
  const web = presenceRes.body.web || [];
  const bothInRoom1 = web.filter((e) => e.rm === 1 && e.av);
  record(
    'GET /api/presence.json に2人分(rm=1, av付き)',
    presenceRes.status === 200 &&
      presenceRes.headers['access-control-allow-origin'] === '*' &&
      bothInRoom1.length === 2,
    `status=${presenceRes.status} web=${JSON.stringify(web)}`,
  );

  // --- 切断: Bobが切断 → Aliceにpeer-leaveが届く ---
  bob.ws.close();
  const peerLeaveAtAlice = await waitFor(alice, (m) => m.t === 'peer-leave' && m.id === bobId);
  record(
    '切断でpeer-leaveが届く',
    Boolean(peerLeaveAtAlice),
    peerLeaveAtAlice ? JSON.stringify(peerLeaveAtAlice) : 'タイムアウト',
  );

  alice.ws.close();
  return finish();
}

function finish() {
  const failCount = results.filter((r) => !r.pass).length;
  console.log('=== 結果サマリ ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}`);
  }
  console.log(failCount === 0 ? 'ALL PASS' : `${failCount}件 FAIL`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('テスト実行中にエラー:', err);
  process.exit(1);
});
