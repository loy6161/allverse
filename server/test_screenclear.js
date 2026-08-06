// ============================================================
// スクリーンの動画を「消せる」ことのテスト（2026-08-06追加）
//
// loyさんの要望:
//   > 動画のURL入ってない時はスクリーン非表示。
//   > 一度入れた動画を消す方法。
//   > 消したらスクリーンもOFF。
//
// ★ 見張りたいこと:
//   ① 空文字を送ると動画が消え、**その場の全員に伝わる**（各自の画面でスクリーンが消える）
//   ② 消したあとに入れ直せる
//   ③ でたらめな文字列は今までどおり弾く（消す＝空文字だけを特別扱いする）
//
// 実行（サーバーを起動した状態で）:
//   cd server && node test_screenclear.js
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

const created = await post('/api/admin/event', { name: 'スクリーン消去テスト', videoId: 'unrobrGhlv0' });
const evId = created.ev.id;
ok('動画つきでイベントを立てられた', Boolean(evId), evId);

const staff = await connect();
staff.send(JSON.stringify({ t: 'join', n: '運営', ev: evId, vid: '1122334455667788' }));
const welcome = await waitFor(staff, 'welcome');
ok('入場した時点で動画が入っている', welcome.screen === 'unrobrGhlv0', welcome.screen);

const guest = await connect();
guest.send(JSON.stringify({ t: 'join', n: 'お客さん', ev: evId, vid: '8877665544332211' }));
await waitFor(guest, 'welcome');

console.log('\n[1] ★動画を消せる（空文字）。その場の全員に伝わる');
const toGuest = waitFor(guest, 'screen', 3000).catch(() => null);
staff.send(JSON.stringify({ t: 'screen', v: '' }));
const got = await toGuest;
ok('お客さんにも「消えた」が届く', got && got.v === '', got ? JSON.stringify(got.v) : '届かない');
await sleep(300);
const afterClear = await eventInfo(evId);
ok('サーバー側の動画も空になる', afterClear && afterClear.v === '',
  afterClear ? JSON.stringify(afterClear.v) : '取れない');

console.log('\n[2] 消したあとに入場した人にも「動画なし」で届く（スクリーンを出さないため）');
const later = await connect();
later.send(JSON.stringify({ t: 'join', n: 'あとから来た人', ev: evId, vid: '5555666677778888' }));
const w2 = await waitFor(later, 'welcome');
ok('welcome の screen が空', !w2.screen, JSON.stringify(w2.screen));

console.log('\n[3] 消したあとに入れ直せる');
const back = waitFor(guest, 'screen', 3000).catch(() => null);
staff.send(JSON.stringify({ t: 'screen', v: 'dQw4w9WgXcQ' }));
const b = await back;
ok('新しい動画が全員に届く', b && b.v === 'dQw4w9WgXcQ', b ? b.v : '届かない');
await sleep(300);
const afterSet = await eventInfo(evId);
ok('サーバー側にも入っている', afterSet && afterSet.v === 'dQw4w9WgXcQ',
  afterSet && afterSet.v);

console.log('\n[4] でたらめな文字列は今までどおり弾く（空文字だけを特別扱いする）');
const noChange = waitFor(guest, 'screen', 1200).catch(() => null);
staff.send(JSON.stringify({ t: 'screen', v: 'これは動画IDではない' }));
const n = await noChange;
ok('配られない', n === null, n ? JSON.stringify(n.v) : '');
await sleep(200);
const unchanged = await eventInfo(evId);
ok('サーバー側も変わらない', unchanged && unchanged.v === 'dQw4w9WgXcQ',
  unchanged && unchanged.v);

for (const ws of [staff, guest, later]) ws.close();
await post('/api/admin/event-delete', { id: evId }).catch(() => {});

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
