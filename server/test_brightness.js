// ============================================================
// 会場の明るさ（イベント設定）の自己テスト（2026-08-04追加）
//
// loyさんの指示:
//   > 明るさは、3段階を管理者+VIPは設定から調整できるといいかもね
//   > 明るさは運営やVIPが変えて全体へ反映でいいよ
//
// ★ ここで見張りたいのは「**その場にいる全員に**届くこと」。
//   個人設定にすると権限を絞る意味が無くなるので、
//   「運営が変える → 会場にいる他の人にも同じ値が届く」を機械で確かめる。
//   見た目そのもの（どのくらい明るいか）はloyさんの目でしか判断できない。
//
// 実行（サーバーを起動した状態で）:
//   cd server && WS_URL=... HTTP_URL=... node test_brightness.js
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_URL = process.env.HTTP_URL || 'http://localhost:5179';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`${HTTP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function waitFor(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} が来ない`)), timeoutMs);
    ws.on('message', function onMsg(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === type) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(m);
      }
    });
  });
}
/** そのイベントの最新情報を /api/status から拾う */
async function eventInfo(evId) {
  const st = await (await fetch(`${HTTP_URL}/api/status`)).json();
  return (st.events || []).find((e) => e.id === evId);
}

const created = await post('/api/admin/event', { name: '明るさテスト' });
const evId = created.ev.id;
ok('イベントを立てられた', Boolean(evId), evId);

console.log('\n[1] 既定はこれまでの見た目（既存イベントの絵を変えない）');
ok('立てた直後は normal', created.ev.brightness === 'normal', created.ev.brightness);

console.log('\n[2] 運営が変えると、その場にいる全員へ届く');
// 運営（1人目）と、ただの参加者（2人目）を入れる
const staff = await connect();
staff.send(JSON.stringify({ t: 'join', n: '運営', ev: evId, vid: '1111222233334444' }));
await waitFor(staff, 'welcome');
const guest = await connect();
guest.send(JSON.stringify({ t: 'join', n: 'お客さん', ev: evId, vid: '5555666677778888' }));
const guestWelcome = await waitFor(guest, 'welcome');
ok('2人目にも入場時点の明るさが届く', guestWelcome.event && guestWelcome.event.brightness === 'normal',
  guestWelcome.event && guestWelcome.event.brightness);

// 2人目が受け取る「イベント情報の更新」を待ち受けてから変更する
const pushed = waitFor(guest, 'events').catch(() => null);
staff.send(JSON.stringify({ t: 'event-update', id: evId, brightness: 'brightest' }));
await sleep(600);

const info = await eventInfo(evId);
ok('サーバーが新しい値を覚えている', info && info.brightness === 'brightest',
  info && info.brightness);
const ev2 = await pushed;
// 配られるのは { t:'events', events:[...] }（broadcastAllEvents）
const pushedEv = ev2 && (ev2.events || []).find((e) => e.id === evId);
ok('★変更が2人目にも届く（個人設定ではない）', pushedEv && pushedEv.brightness === 'brightest',
  pushedEv ? pushedEv.brightness : '届いていない');

console.log('\n[3] 知らない値は既定に落とす（変な値で会場が真っ暗にならない）');
staff.send(JSON.stringify({ t: 'event-update', id: evId, brightness: 'ものすごく明るい' }));
await sleep(500);
const info2 = await eventInfo(evId);
ok('知らない値は無視され、直前の値が保たれる', info2 && info2.brightness === 'brightest',
  info2 && info2.brightness);

console.log('\n[4] 段階を受け付ける');
// ⚠ `+` 付きは画面全体（アバター・映像も）を持ち上げる段階。
//   見比べて決めるために両方式を並べてある（2026-08-04）
for (const level of ['normal', 'dim', 'bright', 'brightest', 'brightest+']) {
  staff.send(JSON.stringify({ t: 'event-update', id: evId, brightness: level }));
  await sleep(350);
  const i = await eventInfo(evId);
  ok(`${level} を受け付ける`, i && i.brightness === level, i && i.brightness);
}

staff.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(300);
staff.close();
guest.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
