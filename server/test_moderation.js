// ============================================================
// ブロック／キック／BAN の自己テスト
// 使い方: サーバーを起動した状態で `node test_moderation.js`
//   例) PORT=5200 node server.js  →  WS_URL=ws://localhost:5200/ws node test_moderation.js
//
// 権限は本来Googleログインで決まるが、ローカルかつログイン未設定のときだけ
// join の devRole/devEmail で指定できるので、それを使って検証している。
//
// 注意: このテストは実際にBANを書き込む。永続化(Turso)が有効な環境で走らせると
// 本物のBAN一覧が汚れるので、ローカル（メモリ運用）で使うこと。
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 接続してjoinする。welcomeを待つかどうかは呼び出し側の判断 */
function connect(name, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    let closed = false;
    ws.on('message', (d) => {
      try {
        inbox.push(JSON.parse(d.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => {
      closed = true;
    });
    ws.on('error', reject);
    ws.on('open', () => {
      const authed = opts.devRole && opts.devRole !== 'guest';
      ws.send(
        JSON.stringify({
          t: 'join',
          av: { h: 'bob', o: 'middle', ac: 'none', hc: 1, sc: 2, bc: 0, ec: 1 },
          ...(authed ? { devEmail: `${name}@example.com`, devName: name } : {}),
          ...opts,
        }),
      );
      resolve({
        ws,
        inbox,
        send: (o) => ws.send(JSON.stringify(o)),
        isClosed: () => closed,
      });
    });
  });
}

async function waitFor(c, pred, timeout = 1200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = c.inbox.find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  return null;
}

async function main() {
  console.log(`=== ブロック／キック／BAN 自己テスト (${WS_URL}) ===`);

  // ---------- 1. ブロックは相互不可視 ----------
  const alice = await connect('alice', { devRole: 'user', ev: 'main', rm: 5 });
  const bob = await connect('bob', { devRole: 'user', ev: 'main', rm: 5 });
  const wA = await waitFor(alice, (m) => m.t === 'welcome');
  await waitFor(bob, (m) => m.t === 'welcome');
  const bobId = (await waitFor(alice, (m) => m.t === 'peer-join'))?.p?.id;
  check('前提: 同じルームでお互いが見えている', Boolean(bobId), `bobId=${bobId}`);
  check('welcomeにブロック一覧が入る', Array.isArray(wA?.blocked), `blocked=${JSON.stringify(wA?.blocked)}`);

  alice.inbox.length = 0;
  bob.inbox.length = 0;
  alice.send({ t: 'block', id: bobId });

  const leaveAtAlice = await waitFor(alice, (m) => m.t === 'peer-leave' && m.id === bobId);
  check('ブロックした側の画面から相手が消える', Boolean(leaveAtAlice));
  const leaveAtBob = await waitFor(bob, (m) => m.t === 'peer-leave');
  check('ブロックされた側の画面からも相手が消える（相互不可視）', Boolean(leaveAtBob));

  const blockedAck = await waitFor(alice, (m) => m.t === 'blocked');
  check('ブロックの控えが本人に返る', Boolean(blockedAck) && Boolean(blockedAck.k), `n=${blockedAck?.n}`);
  const notified = await waitFor(bob, (m) => m.t === 'blocked' || m.t === 'moderated', 400);
  check('ブロックしたことは相手に知らされない', !notified);

  // ---------- 2. ブロック中はチャットも届かない ----------
  alice.inbox.length = 0;
  bob.inbox.length = 0;
  bob.send({ t: 'chat', txt: 'きこえますか' });
  const chatLeak = await waitFor(alice, (m) => m.t === 'chat', 500);
  check('ブロック相手のチャットは届かない', !chatLeak);

  bob.send({ t: 'pos', x: 4, z: 4, r: 0, m: true });
  const posLeak = await waitFor(alice, (m) => m.t === 'pos', 500);
  check('ブロック相手の位置も届かない', !posLeak);

  // ---------- 3. 解除で戻る ----------
  alice.inbox.length = 0;
  bob.inbox.length = 0;
  alice.send({ t: 'unblock', k: blockedAck?.k });
  const backAtAlice = await waitFor(alice, (m) => m.t === 'peer-join');
  check('解除すると相手の姿が戻る', Boolean(backAtAlice));
  const backAtBob = await waitFor(bob, (m) => m.t === 'peer-join');
  check('解除は相手側にも反映される', Boolean(backAtBob));
  const listAfter = await waitFor(alice, (m) => m.t === 'blocked-list');
  check('解除後のブロック一覧は空になる', Array.isArray(listAfter?.list) && listAfter.list.length === 0);

  // ---------- 4. キック ----------
  const admin = await connect('admin', { devRole: 'admin', ev: 'main', rm: 5 });
  const wAdmin = await waitFor(admin, (m) => m.t === 'welcome');
  // bobは admin より先に入っているので peer-join は飛んでこない。welcome.peers から拾う
  const targetId = (wAdmin?.peers || []).find((p) => p.n === 'bob')?.id;
  check('先に入っていた人もwelcome.peersから特定できる', Boolean(targetId), `id=${targetId}`);

  bob.inbox.length = 0;
  admin.send({ t: 'kick', id: targetId });
  const kicked = await waitFor(bob, (m) => m.t === 'kicked');
  check('キックされた本人に通知が届く', Boolean(kicked), `by=${kicked?.by}`);
  await sleep(300);
  check('キックされると切断される', bob.isClosed());

  // 一般ユーザーはキックできない
  alice.inbox.length = 0;
  alice.send({ t: 'kick', id: targetId });
  const deniedKick = await waitFor(alice, (m) => m.t === 'denied');
  check('一般ユーザーはキックできない', deniedKick?.reason === 'staff-only', `reason=${deniedKick?.reason}`);

  // 管理者・VIPはキックできない
  const vip = await connect('vip', { devRole: 'vip', ev: 'main', rm: 5 });
  await waitFor(vip, (m) => m.t === 'welcome');
  const vipSeen = await waitFor(admin, (m) => m.t === 'peer-join' && m.p.n === 'vip', 1500);
  admin.inbox.length = 0;
  admin.send({ t: 'kick', id: vipSeen?.p?.id });
  const deniedStaff = await waitFor(admin, (m) => m.t === 'denied');
  check('管理者・VIPはキックできない', deniedStaff?.reason === 'cannot-kick-staff', `reason=${deniedStaff?.reason}`);

  // ---------- 5. BAN ----------
  const badguy = await connect('badguy', { devRole: 'user', ev: 'main', rm: 5 });
  await waitFor(badguy, (m) => m.t === 'welcome');
  const badSeen = await waitFor(admin, (m) => m.t === 'peer-join' && m.p.n === 'badguy', 1500);

  badguy.inbox.length = 0;
  admin.inbox.length = 0;
  admin.send({ t: 'ban', id: badSeen?.p?.id, why: 'テスト' });
  const banned = await waitFor(badguy, (m) => m.t === 'banned');
  check('BANされた本人に理由つきで通知が届く', banned?.why === 'テスト', `by=${banned?.by} why=${banned?.why}`);
  await sleep(300);
  check('BANされると切断される', badguy.isClosed());

  // 再入場できない
  const retry = await connect('badguy', { devRole: 'user', ev: 'main', rm: 5 });
  const deniedJoin = await waitFor(retry, (m) => m.t === 'denied');
  check('BAN後は再入場できない', deniedJoin?.reason === 'banned', `reason=${deniedJoin?.reason}`);
  const welcomeLeak = await waitFor(retry, (m) => m.t === 'welcome', 400);
  check('BAN中はwelcomeが返らない', !welcomeLeak);

  // 一覧に出る
  admin.inbox.length = 0;
  admin.send({ t: 'bans' });
  const banList = await waitFor(admin, (m) => m.t === 'bans');
  const hit = (banList?.list || []).find((b) => b.name === 'badguy');
  check('BAN一覧に出る', Boolean(hit), `reason=${hit?.reason} by=${hit?.byName}`);

  // ゲストはBANできない
  const guest = await connect('guest1', { devRole: 'guest', ev: 'main', rm: 5 });
  await waitFor(guest, (m) => m.t === 'welcome');
  const guestSeen = await waitFor(admin, (m) => m.t === 'peer-join' && /ゲスト/.test(m.p.n), 1500);
  admin.inbox.length = 0;
  admin.send({ t: 'ban', id: guestSeen?.p?.id });
  const deniedGuest = await waitFor(admin, (m) => m.t === 'denied');
  check('ゲストはBANできない（アカウント単位のため）', deniedGuest?.reason === 'cannot-ban-guest', `reason=${deniedGuest?.reason}`);

  // 一般ユーザーはBANできない
  alice.inbox.length = 0;
  alice.send({ t: 'ban', id: guestSeen?.p?.id });
  const deniedBan = await waitFor(alice, (m) => m.t === 'denied');
  check('一般ユーザーはBANできない', deniedBan?.reason === 'admin-only', `reason=${deniedBan?.reason}`);

  // 一般ユーザーはBAN一覧を見られない
  alice.inbox.length = 0;
  alice.send({ t: 'bans' });
  const deniedList = await waitFor(alice, (m) => m.t === 'denied');
  check('一般ユーザーはBAN一覧を見られない', deniedList?.reason === 'admin-only', `reason=${deniedList?.reason}`);

  // ---------- 6. 解除 ----------
  admin.inbox.length = 0;
  admin.send({ t: 'unban', email: 'badguy@example.com' });
  const afterUnban = await waitFor(admin, (m) => m.t === 'bans');
  const stillThere = (afterUnban?.list || []).find((b) => b.name === 'badguy');
  check('BAN解除で一覧から消える', !stillThere);

  const rejoin = await connect('badguy', { devRole: 'user', ev: 'main', rm: 5 });
  const rejoined = await waitFor(rejoin, (m) => m.t === 'welcome');
  check('BAN解除で再入場できる', Boolean(rejoined), `n=${rejoined?.n}`);

  [alice, admin, vip, guest, retry, rejoin].forEach((c) => {
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  });

  console.log('=== 結果サマリ ===');
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? 'ALL PASS' : `${failed}件 FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('テスト実行エラー:', e);
  process.exit(1);
});
