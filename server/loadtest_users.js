// ============================================================
// 同時接続の負荷テスト（2026-08-06追加）
//
// loyさん「ユーザーが何人くらいは入れるかをテストしたいんだから。」
//
// ★ 何が壁になるか
//   位置の配信は **人数の2乗**で増える。
//   1人が10Hzで位置を送り、それが同室の全員へ配られるので、
//   N人だと 1秒あたり N × 10 × (N-1) 通。
//     30人 →   8,700通/秒
//     60人 →  35,400通/秒
//    100人 →  99,000通/秒
//   ここがサーバーのCPUを食い切ると、位置が遅れ始める＝カクつく。
//
// ★ 測り方
//   仮想のクライアントをM個つないで、本物と同じ 10Hz で位置を送る。
//   別に「観測役」を1人立て、**自分が送った合図が返ってくるまでの時間**（往復）を測る。
//   人数を増やしながら、往復が伸び始める点＝限界を探す。
//
// 使い方（サーバーを起動した状態で）:
//   cd server && node loadtest_users.js            … 既定の段階で測る
//   node loadtest_users.js 10,30,60,120,200        … 人数を指定
//   ROOMS=4 node loadtest_users.js 200             … 4ルームに分けて200人
//   WS_URL=wss://... HTTP_URL=https://... node loadtest_users.js
//
// ⚠ 本番（Render）に向けるときは、必ず本人の許可を取ってから。
//   同時接続を増やす行為そのものが本番の負荷になる。
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_URL = process.env.HTTP_URL || 'http://localhost:5179';
/** いくつのルームに分けるか（1なら全員同じ部屋＝いちばん厳しい条件） */
const ROOMS = Math.max(1, Number(process.env.ROOMS) || 1);
/** 位置を送る間隔（本物のクライアントと同じ 10Hz） */
const POS_INTERVAL_MS = 100;
/** 1段階あたりの計測時間 */
const MEASURE_MS = Number(process.env.MEASURE_MS) || 8000;

const steps = (process.argv[2] || '10,30,60,120,200')
  .split(',')
  .map((s) => Math.trunc(Number(s)))
  .filter((n) => n > 0);

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
    const timer = setTimeout(() => reject(new Error('接続がタイムアウト')), 15000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** 1人ぶんの仮想クライアント */
async function spawnClient(evId, room, index) {
  const ws = await connect();
  let joined = false;
  let received = 0;
  ws.on('message', (raw) => {
    received++;
    if (!joined) {
      try {
        if (JSON.parse(raw.toString()).t === 'welcome') joined = true;
      } catch {
        /* 壊れた行は無視 */
      }
    }
  });
  // ⚠ ふつうのお客さん（user）として入る。
  //   ローカルはログイン無しだと**全員が管理者**になり、管理者の位置は
  //   「イベント全体（＝全ルーム）」へ配られるので、ルームで分けた意味が消える
  //   （実測: 16ルームに分けても通数が減らず、原因がこれだった）。
  //   devRole はローカル専用で、Render 上では効かない
  ws.send(JSON.stringify({
    t: 'join',
    n: `負荷${index}`,
    ev: evId,
    rm: room, // ⚠ ルーム指定のフィールド名は `rm`。`room` だと無視されて全員1部屋になる
    vid: String(1e15 + index),
    devRole: 'user',
  }));
  // 位置を10Hzで送り続ける（本物と同じ動き。少しずつ歩く）
  let t = index;
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    t += 0.1;
    ws.send(JSON.stringify({
      t: 'pos',
      x: Math.sin(t * 0.7) * 8,
      z: Math.cos(t * 0.5) * 8,
      r: Math.trunc((t * 20) % 360),
      m: true,
    }));
  }, POS_INTERVAL_MS);
  return {
    ws,
    stop() {
      clearInterval(timer);
      try {
        ws.close();
      } catch {
        /* 既に閉じている */
      }
    },
    stats: () => ({ joined, received }),
  };
}

/**
 * 観測役。チャットを打って、それが自分に返ってくるまでの時間を測る。
 * （サーバーが詰まると、この往復が伸びる）
 */
async function makeProbe(evId, room) {
  const ws = await connect();
  const waiting = new Map();
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.t === 'chat' && waiting.has(m.txt)) {
      const started = waiting.get(m.txt);
      waiting.delete(m.txt);
      started.resolve(Date.now() - started.at);
    }
  });
  ws.send(JSON.stringify({
    t: 'join', n: '観測', ev: evId, rm: room, vid: '999999999999999', devRole: 'user',
  }));
  await sleep(600);
  let seq = 0;
  return {
    /** 1往復を測る。返らなければ null */
    async ping(timeoutMs = 5000) {
      seq++;
      const txt = `ping-${seq}-${Date.now()}`;
      return new Promise((resolve) => {
        const at = Date.now();
        const timer = setTimeout(() => {
          waiting.delete(txt);
          resolve(null);
        }, timeoutMs);
        waiting.set(txt, {
          at,
          resolve: (ms) => {
            clearTimeout(timer);
            resolve(ms);
          },
        });
        ws.send(JSON.stringify({ t: 'chat', txt }));
      });
    },
    stop() {
      try {
        ws.close();
      } catch {
        /* 既に閉じている */
      }
    },
  };
}

async function serverStatus() {
  try {
    const r = await fetch(`${HTTP_URL}/api/status`);
    return await r.json();
  } catch {
    return null;
  }
}

console.log(`接続先: ${WS_URL}`);
console.log(`ルーム数: ${ROOMS} ／ 段階: ${steps.join(', ')} 人`);
console.log('※ 位置は本物と同じ 10Hz。配られる通数は「人数 × 10 × (同室の人数-1)」で増える\n');

// テスト用のイベントを立てる（定員は最大まで）
const created = await post('/api/admin/event', { name: '負荷テスト', cap: 60 });
if (!created.ok) {
  console.error('イベントを立てられなかった:', created.error);
  process.exit(1);
}
const evId = created.ev.id;

const clients = [];
const results = [];

for (const target of steps) {
  // 目標人数まで足す（前の段階から積み増す）
  while (clients.length < target) {
    const i = clients.length;
    const room = (i % ROOMS) + 1;
    try {
      clients.push(await spawnClient(evId, room, i));
    } catch (e) {
      console.error(`  ${i + 1}人目で接続に失敗: ${e.message}`);
      break;
    }
    // 一気につなぐと入場処理で詰まるので少しずつ
    if (i % 20 === 19) await sleep(120);
  }

  const probe = await makeProbe(evId, 1);
  await sleep(1500); // 落ち着かせる

  const t0 = Date.now();
  const before = clients.map((c) => c.stats().received);
  const pings = [];
  while (Date.now() - t0 < MEASURE_MS) {
    pings.push(await probe.ping());
    await sleep(400);
  }
  const after = clients.map((c) => c.stats().received);
  const elapsed = (Date.now() - t0) / 1000;

  const ok = pings.filter((p) => p !== null);
  const lost = pings.length - ok.length;
  ok.sort((a, b) => a - b);
  const p50 = ok.length ? ok[Math.floor(ok.length * 0.5)] : null;
  const p95 = ok.length ? ok[Math.floor(ok.length * 0.95)] : null;
  const msgs = after.reduce((s, v, i) => s + (v - before[i]), 0);
  const joined = clients.filter((c) => c.stats().joined).length;

  const st = await serverStatus();
  const inRooms = st ? (st.rooms || []).reduce((s, r) => s + r.count, 0) : null;

  results.push({
    人数: clients.length,
    入場できた: joined,
    在室: inRooms,
    往復中央値ms: p50,
    '往復95%ms': p95,
    取りこぼし: lost,
    受信通数_毎秒: Math.round(msgs / elapsed),
  });
  console.log(
    `${String(clients.length).padStart(4)}人  入場${joined}  在室${inRooms}  `
    + `往復 中央値${p50 ?? '—'}ms / 95%${p95 ?? '—'}ms  取りこぼし${lost}  `
    + `受信 ${Math.round(msgs / elapsed).toLocaleString()}通/秒`,
  );
  probe.stop();
}

console.log('\n=== まとめ ===');
console.table(results);

for (const c of clients) c.stop();
await sleep(500);
process.exit(0);
