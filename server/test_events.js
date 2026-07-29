// ============================================================
// イベント／ルーム・権限・ローカルチャットの自己テスト
// 使い方: サーバーを起動した状態で `node test_events.js`
//   例) PORT=5200 node server.js  →  WS_URL=ws://localhost:5200/ws node test_events.js
//
// 権限（管理者/VIP/ゲスト）は本来Googleログインで決まるが、ローカルかつログイン未設定の
// ときだけ join の devRole で指定できるので、それを使って検証している。
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_BASE = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 接続してjoinし、welcomeを受け取るまで待つ */
function connect(name, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    ws.on('message', (d) => {
      try {
        inbox.push(JSON.parse(d.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      // 表示名はサーバーが決める。テストでは名前で相手を特定するので、
      // devEmail/devName を渡してログイン済みユーザーとして名前を確定させる
      // （devRole:'guest' を指定したケースは、ゲスト連番になるのが正しい挙動）
      const authed = opts.devRole && opts.devRole !== 'guest';
      ws.send(
        JSON.stringify({
          t: 'join',
          n: name,
          av: { h: 'bob', o: 'middle', ac: 'none', hc: 1, sc: 2, bc: 0, ec: 1 },
          ...(authed ? { devEmail: `${encodeURIComponent(name)}@example.com`, devName: name } : {}),
          ...opts,
        }),
      );
      resolve({ ws, inbox, send: (o) => ws.send(JSON.stringify(o)) });
    });
  });
}

/** inbox から条件に合う最初のメッセージを取り出す（最大 timeout ms 待つ） */
async function waitFor(c, pred, timeout = 1200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = c.inbox.find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  return null;
}

async function getJson(pathname) {
  const res = await fetch(HTTP_BASE + pathname);
  return res.json();
}

async function main() {
  console.log(`=== イベント／権限テスト (${WS_URL}) ===`);

  // ---------- 1. 常設イベントが必ずある ----------
  const cfg = await getJson('/api/config');
  const main0 = cfg.events.find((e) => e.id === 'main');
  check('常設イベント main が存在する', Boolean(main0) && main0.permanent === true, main0 && main0.name);

  // ---------- 2. 管理者がイベントを作れる ----------
  const admin = await connect('管理者', { devRole: 'admin' });
  const adminWelcome = await waitFor(admin, (m) => m.t === 'welcome');
  check('welcomeにrole/イベント情報が入る', adminWelcome?.role === 'admin' && adminWelcome?.ev === 'main',
    `role=${adminWelcome?.role} ev=${adminWelcome?.ev}`);
  // クライアントは「定員 − 実在人数」ぶんをNPCで埋めるので、定員を知る必要がある
  check('welcomeにルームの定員が入る', adminWelcome?.cap === 30, `cap=${adminWelcome?.cap}`);

  admin.send({ t: 'event-create', name: 'テストライブ', v: 'aaaaaaaaaaa' });
  const created = await waitFor(admin, (m) => m.t === 'event-created');
  check('管理者はイベントを作成できる', Boolean(created), created && created.ev.name);
  const newEventId = created?.ev?.id;

  // ---------- 3. 同じイベントの別ルームで動画が同期する ----------
  // main の #1 と #2 に1人ずつ入れる
  const a1 = await connect('A1', { ev: 'main', rm: 1, devRole: 'user' });
  const b2 = await connect('B2', { ev: 'main', rm: 2, devRole: 'user' });
  const w1 = await waitFor(a1, (m) => m.t === 'welcome');
  const w2 = await waitFor(b2, (m) => m.t === 'welcome');
  check('ルーム番号を指定して入場できる', w1?.room === 1 && w2?.room === 2, `#${w1?.room} / #${w2?.room}`);

  a1.inbox.length = 0;
  b2.inbox.length = 0;
  admin.send({ t: 'screen', v: 'bbbbbbbbbbb' });
  const s1 = await waitFor(a1, (m) => m.t === 'screen');
  const s2 = await waitFor(b2, (m) => m.t === 'screen');
  check('動画変更が同じイベントの別ルームにも届く', s1?.v === 'bbbbbbbbbbb' && s2?.v === 'bbbbbbbbbbb',
    `#1=${s1?.v} #2=${s2?.v}`);

  a1.inbox.length = 0;
  b2.inbox.length = 0;
  admin.send({ t: 'playback', st: 'pause', pos: 33 });
  const p1 = await waitFor(a1, (m) => m.t === 'playback');
  const p2 = await waitFor(b2, (m) => m.t === 'playback');
  check('再生操作も別ルームに届く', p1?.st === 'pause' && p2?.st === 'pause' && p1?.pos === 33);

  // ---------- 4. 別イベントは別の動画を持つ ----------
  const other = await connect('別イベントの人', { ev: newEventId, devRole: 'user' });
  const wo = await waitFor(other, (m) => m.t === 'welcome');
  check('別イベントは自分の動画を持つ', wo?.screen === 'aaaaaaaaaaa' && wo?.ev === newEventId,
    `screen=${wo?.screen}`);

  // ---------- 5. 一般ユーザーは別ルームから見えない ----------
  const peersOfB2 = w2?.peers || [];
  check('一般ユーザーは別ルームのpeersに入らない',
    !peersOfB2.some((p) => p.n === 'A1'), `peers=${peersOfB2.map((p) => p.n).join(',')}`);

  // ---------- 6. VIPは全ルームに現れる ----------
  a1.inbox.length = 0;
  b2.inbox.length = 0;
  const vip = await connect('VIP', { ev: 'main', rm: 1, devRole: 'vip' });
  await waitFor(vip, (m) => m.t === 'welcome');
  const seenIn1 = await waitFor(a1, (m) => m.t === 'peer-join' && m.p.n === 'VIP');
  const seenIn2 = await waitFor(b2, (m) => m.t === 'peer-join' && m.p.n === 'VIP');
  check('VIPの入場が自室に届く', Boolean(seenIn1));
  check('VIPの入場が別ルームにも届く', Boolean(seenIn2), seenIn2 && `role=${seenIn2.p.role}`);

  // ---------- 7. VIPのチャットが別ルームに届く ----------
  a1.inbox.length = 0;
  b2.inbox.length = 0;
  vip.send({ t: 'chat', txt: '全ルームに聞こえるはず' });
  const c2msg = await waitFor(b2, (m) => m.t === 'chat');
  check('VIPのチャットが別ルームに届く', c2msg?.txt === '全ルームに聞こえるはず' && c2msg?.sc === 'local',
    `sc=${c2msg?.sc}`);

  // ---------- 8. 一般のチャットは自室だけ ----------
  a1.inbox.length = 0;
  b2.inbox.length = 0;
  a1.send({ t: 'chat', txt: '自室だけのはず' });
  const heardSelf = await waitFor(a1, (m) => m.t === 'chat' && m.txt === '自室だけのはず');
  const leaked = await waitFor(b2, (m) => m.t === 'chat' && m.txt === '自室だけのはず', 400);
  check('一般のチャットは自室に届く', Boolean(heardSelf));
  check('一般のチャットは別ルームに漏れない', !leaked);

  // ---------- 9. チャットの既定スコープは local ----------
  check('チャットの既定スコープはlocal', heardSelf?.sc === 'local', `sc=${heardSelf?.sc}`);

  // ---------- 10. ゲストの制限 ----------
  const guest = await connect('ゲスト', { ev: 'main', rm: 1, devRole: 'guest' });
  const gw = await waitFor(guest, (m) => m.t === 'welcome');
  check('ゲストのアバターは固定される', gw?.role === 'guest');

  guest.send({ t: 'chat', txt: 'しゃべれないはず' });
  const gDeniedChat = await waitFor(guest, (m) => m.t === 'denied' && m.reason === 'guest-no-chat');
  check('ゲストはチャットできない', Boolean(gDeniedChat));

  guest.send({ t: 'emote', e: 'wave' });
  const gDeniedEmote = await waitFor(guest, (m) => m.t === 'denied' && m.reason === 'guest-no-emote');
  check('ゲストはエモートできない', Boolean(gDeniedEmote));

  guest.send({ t: 'update', n: 'かえたい', av: { h: 'twin' } });
  const gDeniedAv = await waitFor(guest, (m) => m.t === 'denied' && m.reason === 'guest-no-avatar');
  check('ゲストはアバターを変更できない', Boolean(gDeniedAv));

  // ゲストの見た目と名前がサーバー側で決まっているか（別の人から見える情報で確認）
  const guestPeer = (await waitFor(a1, (m) => m.t === 'peer-join' && /^ゲスト\d{3}$/.test(m.p.n)))?.p;
  check('ゲストの見た目はサーバーが固定する', guestPeer?.av?.h === 'short' && guestPeer?.av?.ac === 'none',
    JSON.stringify(guestPeer?.av));
  check('ゲストの名前はサーバーが連番で割り当てる（申告した名前は使われない）',
    Boolean(guestPeer) && guestPeer.n !== 'ゲスト' && /^ゲスト\d{3}$/.test(guestPeer.n),
    guestPeer && guestPeer.n);
  check('ゲスト自身にも確定した名前が返る', /^ゲスト\d{3}$/.test(gw?.n || ''), gw?.n);

  // ---------- 11. ルーム移動 ----------
  a1.inbox.length = 0;
  b2.inbox.length = 0;
  a1.send({ t: 'move', ev: 'main', rm: 2 });
  const moved = await waitFor(a1, (m) => m.t === 'moved');
  check('ルーム移動できる', moved?.room === 2, `room=${moved?.room}`);
  const arrived = await waitFor(b2, (m) => m.t === 'peer-join' && m.p.n === 'A1');
  check('移動先の人に入場が届く', Boolean(arrived));

  // ---------- 12. ログイン必須イベントにゲストは入れない ----------
  admin.send({ t: 'event-create', name: '限定ライブ', v: 'ccccccccccc', requireLogin: true });
  const locked = await waitFor(admin, (m) => m.t === 'event-created' && m.ev.name === '限定ライブ');
  const lockedId = locked?.ev?.id;
  const guest2 = await connect('入れないゲスト', { ev: lockedId, devRole: 'guest' });
  const denied = await waitFor(guest2, (m) => m.t === 'denied' && m.reason === 'login-required');
  check('ログイン必須イベントにゲストは入れない', Boolean(denied));

  // ---------- 13. presence.json は常設イベントのみ ----------
  const presence = await getJson('/api/presence.json');
  const names = presence.web.map((w) => w.n);
  check('presence.jsonはv=1のまま', presence.v === 1);
  check('presence.jsonに別イベントの人が混ざらない', !names.includes('別イベントの人'), names.join(','));

  // ---------- 後片付け ----------
  for (const c of [admin, a1, b2, other, vip, guest, guest2]) {
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  }
  await sleep(200);

  console.log('=== 結果サマリ ===');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`);
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('テスト実行エラー:', e);
  process.exit(1);
});
