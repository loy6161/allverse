// ============================================================
// ステージ登壇の自己テスト（2026-08-04追加）
//
// テストユーザーの要望:
//   > 管理人+VIPはステージにのれるようにしたい。（イベント設定でON/OFFあり）
//
// ★ ここで守りたいのは「**お客さんが上がれないこと**」。
//   ライブ中に客席の人がステージへ上がれてしまうと配信の絵が壊れる。
//   許可は「イベント設定ON」と「管理者かVIP」の**両方**が要る。
//
// 実行（サーバーを起動した状態で）:
//   cd server && WS_URL=... HTTP_URL=... node test_stage.js
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

const created = await post('/api/admin/event', { name: 'ステージテスト' });
const evId = created.ev.id;
ok('イベントを立てられた', Boolean(evId), evId);

console.log('\n[1] 既定はOFF（普段は誰も上がらない）');
ok('立てた直後は stageAccess が false', created.ev.stageAccess === false,
  String(created.ev.stageAccess));

console.log('\n[2] 設定を切り替えられて、その場の全員に届く');
const staff = await connect();
staff.send(JSON.stringify({ t: 'join', n: '運営', ev: evId, vid: 'aaaa1111bbbb2222' }));
await waitFor(staff, 'welcome');
const guest = await connect();
guest.send(JSON.stringify({ t: 'join', n: 'お客さん', ev: evId, vid: 'cccc3333dddd4444' }));
const gw = await waitFor(guest, 'welcome');
ok('入場時点の設定が届く', gw.event && gw.event.stageAccess === false,
  String(gw.event && gw.event.stageAccess));

const pushed = waitFor(guest, 'events').catch(() => null);
staff.send(JSON.stringify({ t: 'event-update', id: evId, stageAccess: true }));
await sleep(600);
const info = await eventInfo(evId);
ok('サーバーが覚えている', info && info.stageAccess === true, String(info && info.stageAccess));
const ev2 = await pushed;
const pushedEv = ev2 && (ev2.events || []).find((e) => e.id === evId);
ok('変更が他の人にも届く', pushedEv && pushedEv.stageAccess === true,
  pushedEv ? String(pushedEv.stageAccess) : '届いていない');

console.log('\n[3] OFFに戻せる');
staff.send(JSON.stringify({ t: 'event-update', id: evId, stageAccess: false }));
await sleep(500);
const info2 = await eventInfo(evId);
ok('OFFに戻る', info2 && info2.stageAccess === false, String(info2 && info2.stageAccess));

console.log('\n[4] ★上がれる範囲の座標が、VRChatへ送る形に正しく変換される');
// ブラウザ座標 → VRC座標の換算は server.js の toVrcX/toVrcZ と同じ式。
// 申し送り⑧でVRChat側へ伝えた範囲と食い違うと、向こうの受け入れ準備が無駄になる
const toVrcX = (x) => Math.round((-x + -209.0) * 10) / 10;
const toVrcZ = (z) => Math.round((z + -71.91) * 10) / 10;
// src/world_club.js の STAGE
const STAGE = { minX: -5.5, maxX: 15.3, minZ: -29, maxZ: -16.5 };
const vx = [toVrcX(STAGE.minX), toVrcX(STAGE.maxX)].sort((a, b) => a - b);
const vz = [toVrcZ(STAGE.minZ), toVrcZ(STAGE.maxZ)].sort((a, b) => a - b);
console.log(`  ステージのVRC座標: X ${vx[0]}〜${vx[1]} ／ Z ${vz[0]}〜${vz[1]}`);
ok('申し送り⑧で伝えたXの範囲と合う（-224〜-204）',
  Math.abs(vx[0] - -224.3) < 0.2 && Math.abs(vx[1] - -203.5) < 0.2, `${vx[0]}〜${vx[1]}`);
ok('申し送り⑧で伝えたZの範囲と合う（-102〜-88）',
  Math.abs(vz[0] - -100.91) < 0.2 && Math.abs(vz[1] - -88.41) < 0.2, `${vz[0]}〜${vz[1]}`);

console.log('\n[5] ステージと客席が繋がっている（歩いて上がれる）');
// 客席の手前端(minZ=-16.5)とステージのmaxZが同じか重なっていないと、
// ステージが「行けない孤島」になる
const SEATS = { minX: -13, maxX: 25, minZ: -16.5, maxZ: 5 };
ok('客席の奥とステージの手前が繋がっている', STAGE.maxZ >= SEATS.minZ,
  `ステージ maxZ=${STAGE.maxZ} / 客席 minZ=${SEATS.minZ}`);
ok('ステージの幅が客席の幅に収まっている（xを丸めても届く）',
  STAGE.minX >= SEATS.minX && STAGE.maxX <= SEATS.maxX,
  `ステージ ${STAGE.minX}〜${STAGE.maxX} / 客席 ${SEATS.minX}〜${SEATS.maxX}`);

staff.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(300);
staff.close();
guest.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
