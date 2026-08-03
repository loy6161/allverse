// ============================================================
// 「どういうときにYouTubeのAPIを叩くのか」を実際のサーバーで確かめる（2026-08-04追加）
//
// loyさんの確認事項:
//   > イベント立っていても、人がいない場合は止める。
//   > イベント立っていてもYouTube連携がOFFなら止める。
//   > になってる？
//
// 枠切れは本番の配信を止める（2026-08-03に実際に止まった）。
// 「止まっているはず」を口で言うのではなく、数字で見張る。
//
// 実行（サーバーを起動した状態で）:
//   cd server
//   YOUTUBE_API_KEY=dummy PORT=5212 node server.js
//   WS_URL=ws://localhost:5212/ws HTTP_URL=http://localhost:5212 node test_ytreaders.js
//
// ⚠ ダミーキーなので実際にYouTubeへは繋がらない。ここで見たいのは
//   「読み取り係が動いているか(reading)」「叩いた回数(calls)」だけ。
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
const status = async () => (await fetch(`${HTTP_URL}/api/status`)).json();

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

const VIDEO = 'aaaaaaaaaaa'; // 11文字ならなんでもよい（実際には取りに行かない）

console.log('[0] 前提');
let st = await status();
ok('YouTubeのキーが設定されている（テスト用ダミーでよい）', st.ytRead.keySet === true);

console.log('\n[1] イベントが立っていなければ、そもそも読み取り係がいない');
ok('reading が 0', st.ytRead.reading === 0, String(st.ytRead.reading));
const callsAtStart = st.ytRead.calls;

console.log('\n[2] イベントを立てても、YouTube連携がOFFなら止まったまま');
const created = await post('/api/admin/event', { name: '読み取りテスト', videoId: VIDEO });
const evId = created.ev.id;
ok('イベントを立てられた', Boolean(evId), evId);
ok('連携OFFの既定で立つ', created.ev.chatMode === 'local', created.ev.chatMode);
await sleep(300);
st = await status();
ok('★連携OFFなら読み取り係は動かない', st.ytRead.reading === 0, `reading=${st.ytRead.reading}`);

console.log('\n[3] 連携ONにすると読み取り係が起きる');
const ws = await connect();
ws.send(JSON.stringify({ t: 'join', n: '見張り', ev: evId, vid: 'cc11dd22ee33ff44' }));
await waitFor(ws, 'welcome');
ws.send(JSON.stringify({ t: 'event-update', id: evId, chatMode: 'youtube' }));
await sleep(400);
st = await status();
ok('連携ONで読み取り係が1つ動く', st.ytRead.reading === 1, `reading=${st.ytRead.reading}`);

console.log('\n[4] ★会場に誰もいなくなったら、APIを叩かない');
ws.close();
await sleep(500);
st = await status();
const before = st.ytRead;
ok('人がいなくなった', (st.rooms || []).every((r) => r.count === 0),
  JSON.stringify(st.rooms));
// 読み取り係は残るが「叩かない」のが正しい姿。
// 係ごと消すと、人が入ってきたときに起こす仕掛けが別途要って複雑になる
ok('読み取り係は残っている（人が来たらすぐ再開できるように）', st.ytRead.reading === 1);
// しばらく待って、叩いた回数が増えないことを見る。
// ⚠ 待ち時間は「失敗したあとの間隔」より長く取ること。
//   ダミーキーなので直前の1回は必ず失敗しており、次の tick は
//   YT_POLL_MS の2倍あとに来る。そこを待たないと「まだ tick が来ていないだけ」を
//   「読まなかった」と取り違える（2026-08-04 実際に取り違えた）
await sleep(7000);
st = await status();
ok('★誰もいない間は叩いた回数が増えない', st.ytRead.calls === before.calls,
  `${before.calls} → ${st.ytRead.calls}`);
ok('「読まなかった」として数えられている', st.ytRead.skipped > before.skipped,
  `${before.skipped} → ${st.ytRead.skipped}`);

console.log('\n[5] 連携をOFFに戻すと読み取り係が止まる');
const ws2 = await connect();
ws2.send(JSON.stringify({ t: 'join', n: '片付け', ev: evId, vid: 'aa99bb88cc77dd66' }));
await waitFor(ws2, 'welcome');
ws2.send(JSON.stringify({ t: 'event-update', id: evId, chatMode: 'local' }));
await sleep(400);
st = await status();
ok('★連携OFFで読み取り係が消える', st.ytRead.reading === 0, `reading=${st.ytRead.reading}`);

console.log('\n[6] イベントを消すと当然止まる');
ws2.send(JSON.stringify({ t: 'event-update', id: evId, chatMode: 'youtube' }));
await sleep(300);
ws2.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(400);
st = await status();
ok('イベントが消えた', !(st.events || []).some((e) => e.id === evId));
ok('★読み取り係も消える', st.ytRead.reading === 0, `reading=${st.ytRead.reading}`);
ws2.close();

console.log('\n[7] ここまでで無駄打ちしていない');
st = await status();
console.log(`  叩いた回数: ${callsAtStart} → ${st.ytRead.calls} ／ 読まなかった回数: ${st.ytRead.skipped}`);

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
