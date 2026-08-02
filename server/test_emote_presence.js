// ============================================================
// presence.json のエモート項目の自動テスト（2026-08-03追加）
//
// VRChat側からの依頼（docs/HANDOFF_REQUEST_FROM_UNITY_EMOTE.md）で
// 追加した em / emt / emd を、実際にサーバーを動かして確かめる。
//
// 実行（サーバーを起動した状態で）:
//   cd server && node test_emote_presence.js
//   環境変数 WS_URL / HTTP_URL で接続先を変えられる
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

async function getPresence() {
  const res = await fetch(`${HTTP_URL}/api/presence.json`);
  return res.json();
}

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

// ---- 準備: イベントを立てて、VRChatの客席に出す設定にする ----
// ⚠ イベントidはサーバーが決める（こちらの指定は使われない）ので、返ってきた値を使う
const created = await post('/api/admin/event', { name: 'エモートpresenceテスト' });
const evId = created && created.ev && created.ev.id;
ok('テスト用イベントを立てられた', Boolean(evId), evId);

const ws = await connect();
ws.send(JSON.stringify({ t: 'join', av: {}, n: 'エモ太郎', ev: evId, vid: 'aabbccdd11223344' }));
const welcome = await waitFor(ws, 'welcome');
ok('入場できた', Boolean(welcome.id), welcome.n);

// VRChatの客席に出す設定は、立てたあとに切り替える（presence に載る条件）
ws.send(JSON.stringify({ t: 'event-update', id: evId, vrc: true }));
await sleep(300);

console.log('\n[1] エモートしていないときは項目が出ない');
let p = await getPresence();
let me = (p.web || []).find((w) => w.n === welcome.n);
ok('presence に自分が載っている', Boolean(me));
ok('em が無い', me && me.em === undefined);
ok('emt が無い', me && me.emt === undefined);
ok('emd が無い', me && me.emd === undefined);

console.log('\n[2] エモートすると載る');
ws.send(JSON.stringify({ t: 'emote', e: 'wave' }));
await sleep(200);
p = await getPresence();
me = (p.web || []).find((w) => w.n === welcome.n);
ok('em が載る', me && me.em === 'wave', me && me.em);
ok('emt が秒で載る', me && Number.isInteger(me.emt) && me.emt > 1_700_000_000, me && String(me.emt));
ok('emd が長さ(2.5秒)で載る', me && me.emd === 2.5, me && String(me.emd));

console.log('\n[3] 座標や名前は今までどおり');
ok('rm がある', me && typeof me.rm === 'number');
ok('x/z/r がある', me && ['x', 'z', 'r'].every((k) => typeof me[k] === 'number'));
ok('av がある', me && typeof me.av === 'object');
ok('v は 1 のまま（既存の読み取りを壊さない）', p.v === 1, String(p.v));

console.log('\n[4] Spaceキーのジャンプは hop で届く');
await sleep(600); // エモートの連打制限(500ms)を避ける
ws.send(JSON.stringify({ t: 'emote', e: 'hop' }));
await sleep(200);
p = await getPresence();
me = (p.web || []).find((w) => w.n === welcome.n);
ok('em が hop になる', me && me.em === 'hop', me && me.em);
ok('hop の長さは0.72秒（物理と同じ）', me && me.emd === 0.72, me && String(me.emd));

console.log('\n[5] 再生が終わると項目が消える');
await sleep(900); // hop は0.72秒なので、これで終わっている
p = await getPresence();
me = (p.web || []).find((w) => w.n === welcome.n);
ok('em が消える（「終わった」の合図は要らない）', me && me.em === undefined, me && String(me.em));

console.log('\n[6] 知らないエモートは弾く');
await sleep(600);
ws.send(JSON.stringify({ t: 'emote', e: 'moonwalk' }));
await sleep(200);
p = await getPresence();
me = (p.web || []).find((w) => w.n === welcome.n);
ok('知らないidは載らない', me && me.em === undefined, me && String(me.em));

ws.close();

// ---- 後片付け: 立てたイベントを消す ----
const admin = await connect();
admin.send(JSON.stringify({ t: 'join', n: '片付け係', ev: evId, vid: 'ffeeddcc99887766' }));
await waitFor(admin, 'welcome');
admin.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(300);
admin.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
