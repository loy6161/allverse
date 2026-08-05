// ============================================================
// 合言葉つきイベントの入場判定（2026-08-04追加）
//
// loyさんの指示:
//   > パスワード必要なイベントでも管理人は入力無しではいれるようにして。管理できないので。
//
// ★ 見張りたいのは2つ:
//   ① 管理者は合言葉なしで入れる（締め出されると荒らしを止められない）
//   ② **それ以外の人は今までどおり弾かれる**（ここが緩むと合言葉の意味が消える）
//
// ⚠ 入場(join)と移動(move)の両方を見る。2026-08-02、move 側で合言葉を見ておらず
//   素通りできる穴があった。片方だけ直すと同じことが起きる。
//
// 実行（ログインを無効にしたサーバーで。ローカルは既定で全員が管理者扱い）:
//   cd server && ALLOW_DEV_ROLE=1 PORT=5182 node server.js
//   WS_URL=ws://localhost:5182/ws HTTP_URL=http://localhost:5182 node test_entrycode.js
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_URL = process.env.HTTP_URL || 'http://localhost:5179';
const CODE = 'himitsu';

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
/** welcome（入れた）か denied（弾かれた）か、先に来た方を返す */
function firstReply(ws, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ t: 'timeout' }), timeoutMs);
    ws.on('message', function onMsg(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome' || m.t === 'denied') {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(m);
      }
    });
  });
}

/** devRole を指定して入場を試す（ALLOW_DEV_ROLE のときだけ効く開発用の口） */
async function tryJoin(evId, role, code, vid) {
  const ws = await connect();
  const msg = { t: 'join', n: 'テスト', ev: evId, vid, devRole: role };
  if (code !== undefined) msg.code = code;
  ws.send(JSON.stringify(msg));
  const r = await firstReply(ws);
  return { ws, r };
}

const created = await post('/api/admin/event', { name: '合言葉テスト', code: CODE });
const evId = created.ev && created.ev.id;
ok('合言葉つきイベントを立てられた', Boolean(evId), evId);
ok('合言葉が設定されている', created.ev && created.ev.code === CODE, created.ev && created.ev.code);

console.log('\n[1] ★管理者は合言葉なしで入れる');
const a = await tryJoin(evId, 'admin', undefined, 'aaaa000000000001');
ok('合言葉を送らなくても入れる', a.r.t === 'welcome', `${a.r.t} ${a.r.reason || ''}`);
a.ws.close();

const a2 = await tryJoin(evId, 'admin', 'まちがい', 'aaaa000000000002');
ok('間違った合言葉でも入れる（そもそも見ない）', a2.r.t === 'welcome', `${a2.r.t} ${a2.r.reason || ''}`);
a2.ws.close();

console.log('\n[2] ★管理者以外は今までどおり弾かれる');
for (const role of ['vip', 'user', 'guest']) {
  const c = await tryJoin(evId, role, undefined, `bbbb00000000000${role.length}`);
  ok(`${role} は合言葉なしだと入れない`, c.r.t === 'denied' && c.r.reason === 'bad-code',
    `${c.r.t} ${c.r.reason || ''}`);
  c.ws.close();
  await sleep(150);
}

console.log('\n[3] 正しい合言葉なら誰でも入れる');
for (const role of ['vip', 'user']) {
  const c = await tryJoin(evId, role, CODE, `cccc00000000000${role.length}`);
  ok(`${role} は正しい合言葉で入れる`, c.r.t === 'welcome', `${c.r.t} ${c.r.reason || ''}`);
  c.ws.close();
  await sleep(150);
}

console.log('\n[4] 合言葉の無いイベントは今までどおり');
const open = await post('/api/admin/event', { name: 'パブリック' });
const openId = open.ev.id;
const o = await tryJoin(openId, 'guest', undefined, 'dddd000000000001');
ok('パブリックはゲストでも入れる', o.r.t === 'welcome', `${o.r.t} ${o.r.reason || ''}`);
o.ws.close();

console.log('\n[5] ★移動(move)でも同じ扱い（片方だけ直すと穴が開く）');
// パブリックに入ってから、合言葉つきへ移動する
const mover = await connect();
mover.send(JSON.stringify({ t: 'join', n: '移動する人', ev: openId, vid: 'eeee000000000001', devRole: 'user' }));
await firstReply(mover);
const moved = firstReply(mover);
mover.send(JSON.stringify({ t: 'move', ev: evId })); // 合言葉なし
const mr = await moved;
ok('一般は合言葉なしで移動できない', mr.t === 'denied' && mr.reason === 'bad-code',
  `${mr.t} ${mr.reason || ''}`);
mover.close();

const admin = await connect();
admin.send(JSON.stringify({ t: 'join', n: '運営', ev: openId, vid: 'ffff000000000001', devRole: 'admin' }));
await firstReply(admin);
const movedOk = new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ t: 'timeout' }), 3000);
  admin.on('message', function onMsg(raw) {
    const m = JSON.parse(raw.toString());
    if (m.t === 'moved' || m.t === 'denied') {
      clearTimeout(timer);
      admin.off('message', onMsg);
      resolve(m);
    }
  });
});
admin.send(JSON.stringify({ t: 'move', ev: evId })); // 合言葉なし
const ar = await movedOk;
ok('★管理者は合言葉なしで移動できる', ar.t === 'moved', `${ar.t} ${ar.reason || ''}`);

admin.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(200);
admin.send(JSON.stringify({ t: 'event-delete', id: openId }));
await sleep(300);
admin.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
