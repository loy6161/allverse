// ============================================================
// 配信後の交流まわりの自己テスト（2026-08-04追加）
//
// loyさんの要望:
//   > YouTubeの生配信視聴中はいいんだけど、配信終わった後とかにそのまま交流したいのに
//   > 今の仕様だとチャットが使えないよね？切り替えられるといいかも。
//   > その場合、エモート連動とかも内部のチャットでもできるの？
//
// ★ 見張りたいのは2つ:
//   ① 運営がワンタッチで会場チャットへ戻せること（その場の全員に反映）
//   ② **会場チャットでもエモート連動が効くこと**
//      （YouTubeでは動くのに会場チャットでは動かない、というちぐはぐを作らない）
//
// 実行（サーバーを起動した状態で）:
//   cd server && WS_URL=... HTTP_URL=... node test_localchat.js
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
async function eventInfo(evId) {
  const st = await (await fetch(`${HTTP_URL}/api/status`)).json();
  return (st.events || []).find((e) => e.id === evId);
}

const created = await post('/api/admin/event', { name: '配信後テスト' });
const evId = created.ev.id;
ok('イベントを立てられた', Boolean(evId), evId);

const staff = await connect();
staff.send(JSON.stringify({ t: 'join', n: '運営', ev: evId, vid: '1122334455667788' }));
await waitFor(staff, 'welcome');
const guest = await connect();
guest.send(JSON.stringify({ t: 'join', n: 'お客さん', ev: evId, vid: '8877665544332211' }));
await waitFor(guest, 'welcome');

console.log('\n[1] 配信中（YouTube連動ON）は会場チャットで発言できない');
staff.send(JSON.stringify({ t: 'event-update', id: evId, chatMode: 'youtube' }));
await sleep(500);
const denied = waitFor(guest, 'denied', 2500).catch(() => null);
guest.send(JSON.stringify({ t: 'chat', txt: 'こんばんは' }));
const d = await denied;
ok('YouTube連動中は発言が断られる', d && d.reason === 'chat-on-youtube',
  d ? d.reason : '断られなかった');

console.log('\n[2] ★運営がワンタッチで会場チャットへ戻せる（全員に反映）');
const pushed = waitFor(guest, 'events').catch(() => null);
// 「会場チャットを開く」ボタンが送るのと同じもの
staff.send(JSON.stringify({ t: 'event-update', id: evId, chatMode: 'local' }));
await sleep(600);
const info = await eventInfo(evId);
ok('サーバーが local に戻る', info && info.chatMode === 'local', info && info.chatMode);
const ev2 = await pushed;
const pushedEv = ev2 && (ev2.events || []).find((e) => e.id === evId);
ok('その場の全員に届く', pushedEv && pushedEv.chatMode === 'local',
  pushedEv ? pushedEv.chatMode : '届いていない');

console.log('\n[3] 戻したあとは会場チャットで発言できる');
const said = waitFor(staff, 'chat', 2500).catch(() => null);
guest.send(JSON.stringify({ t: 'chat', txt: 'おつかれさまでした' }));
const s = await said;
ok('発言が他の人に届く', s && s.txt === 'おつかれさまでした', s && s.txt);

console.log('\n[4] ★会場チャットでもエモート連動が効く（loyさん指示「全部効かせる」）');
const cases = [
  { txt: '888', 期待: 'clap', 説明: '888 で拍手' },
  { txt: 'www', 期待: 'smile', 説明: 'www でニコニコ' },
  { txt: '🎉🎉🎉', 期待: null, 説明: '絵文字（指定外）はペンライト等になる' },
];
for (const c of cases) {
  const em = waitFor(staff, 'emote', 2500).catch(() => null);
  guest.send(JSON.stringify({ t: 'chat', txt: c.txt }));
  const e = await em;
  if (c.期待) {
    ok(`${c.説明}`, e && e.e === c.期待, e ? e.e : 'エモートが来ない');
  } else {
    ok(`${c.説明}`, Boolean(e && e.e), e ? e.e : 'エモートが来ない');
  }
  await sleep(700); // 連打制限(500ms)を避ける
}

console.log('\n[5] ふつうの会話ではエモートが出ない（会場がうるさくならない）');
const none = waitFor(staff, 'emote', 1500).catch(() => null);
guest.send(JSON.stringify({ t: 'chat', txt: '今日はありがとうございました' }));
ok('ただの会話では何も出ない', (await none) === null);

console.log('\n[6] 「自分のアバターを動かさない」を選んだ人には出ない');
guest.send(JSON.stringify({ t: 'yt-emote', on: false }));
await sleep(300);
const off = waitFor(staff, 'emote', 1500).catch(() => null);
guest.send(JSON.stringify({ t: 'chat', txt: '888' }));
ok('OFFにした人はエモートが出ない', (await off) === null);

staff.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(300);
staff.close();
guest.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
