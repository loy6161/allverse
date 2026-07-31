// ============================================================
// イベントログ（入退場の記録・集計・CSV・PORTAL連携API）の自己テスト
//
// 使い方: サーバーを起動した状態で `node test_logs.js`
//   例) PORT=5200 STATS_TOKEN=testtoken node server.js
//       WS_URL=ws://localhost:5200/ws STATS_TOKEN=testtoken node test_logs.js
//
// 前半は server/stats.js の集計だけを直接検証する（サーバー不要の純粋関数）。
// 後半は実際に入退場して、記録が残るところまで通しで確かめる。
// ============================================================

import WebSocket from 'ws';
import { summarize, changePoints, gridSeries, autoStepMs, visitsCsv, seriesCsv } from './stats.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_BASE = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const STATS_TOKEN = process.env.STATS_TOKEN || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------
// 1. 集計（純粋関数）
// ------------------------------------------------------------

function testStats() {
  console.log('\n--- 集計ロジック（サーバー不要） ---');

  const T = 1_700_000_000_000; // 基準時刻（固定値。実行時刻に左右されないように）
  const run = { runId: 'r1', eventId: 'e1', name: 'テスト', openedAt: T, closedAt: T + 3600_000 };

  // 3人。うち1人は同じ訪問者として2回入っている（同じブラウザで入り直した）
  //   A: 1分 〜 11分（10分）
  //   B: 2分 〜 22分（20分）
  //   C: 1分 〜 4分（3分）      ← 2〜4分の間だけ3人が重なる＝ここがピーク
  //   A: 30分 〜 31分（1分・2回目）
  const visits = [
    { visitor: 'g:aaa', kind: 'guest', name: 'A', room: 1, joinedAt: T + 60_000, leftAt: T + 660_000 },
    { visitor: 'g:bbb', kind: 'guest', name: 'B', room: 1, joinedAt: T + 120_000, leftAt: T + 1_320_000 },
    { visitor: 'u:ccc', kind: 'user', name: 'C', room: 1, joinedAt: T + 60_000, leftAt: T + 240_000 },
    { visitor: 'g:aaa', kind: 'guest', name: 'A', room: 1, joinedAt: T + 1_800_000, leftAt: T + 1_860_000 },
  ];

  const s = summarize(run, visits, T + 3600_000);
  // T+120秒の瞬間だけ A・B・C の3人が重なる
  check('ピーク同接が正しい', s.peak === 3, `peak=${s.peak}`);
  check('ピークの時刻が正しい', s.peakAt === T + 120_000, `peakAt=${(s.peakAt - T) / 1000}秒後`);
  check('累計ユニークは訪問者の種類数（案A）', s.unique === 3, `unique=${s.unique}`);
  check('のべ入場回数は行数', s.entries === 4, `entries=${s.entries}`);
  check('ログイン/ゲストの内訳が出る', s.entriesLoggedIn === 1 && s.entriesGuest === 3,
    `${s.entriesLoggedIn}/${s.entriesGuest}`);
  // (600 + 1200 + 180 + 60) / 4 = 510秒
  check('平均滞在が正しい', s.avgStaySec === 510, `avg=${s.avgStaySec}s`);
  check('最長滞在が正しい', s.maxStaySec === 1200, `max=${s.maxStaySec}s`);
  // のべ滞在2040秒 ÷ 開催3600秒 = 0.566...
  check('平均同接はのべ滞在÷開催時間', Math.abs(s.avgConcurrent - 0.57) < 0.01, `${s.avgConcurrent}`);
  check('開催時間が正しい', s.durationSec === 3600, `${s.durationSec}s`);
  check('閉じた開催は live=false', s.live === false);

  // 同時刻に1人出て1人入るケースでピークが増えない
  const swap = [
    { visitor: 'g:x', kind: 'guest', name: 'X', room: 1, joinedAt: T, leftAt: T + 1000 },
    { visitor: 'g:y', kind: 'guest', name: 'Y', room: 1, joinedAt: T + 1000, leftAt: T + 2000 },
  ];
  check('入れ替わりで同接が増えない', summarize({ openedAt: T, closedAt: T + 2000 }, swap, T + 2000).peak === 1);

  // 在室中（leftAt=null）の扱い
  const live = [{ visitor: 'g:z', kind: 'guest', name: 'Z', room: 1, joinedAt: T, leftAt: null }];
  const ls = summarize({ openedAt: T, closedAt: null }, live, T + 600_000);
  check('在室中は live=true で今の人数が出る', ls.live === true && ls.nowInside === 1);
  check('在室中の滞在は「今」までで数える', ls.avgStaySec === 600, `${ls.avgStaySec}s`);

  // 変化点と1分刻み
  const cp = changePoints(visits, T + 3600_000);
  check('変化点は時刻順に並ぶ', cp.every((p, i) => i === 0 || cp[i - 1].t <= p.t), `${cp.length}点`);
  const grid = gridSeries(visits, { from: T, to: T + 600_000, stepMs: 60_000 });
  check('1分刻みの経過が作れる', grid.length === 11, `${grid.length}点`);
  check('経過の値が実際の同接と一致する', grid[2].n === 3, `2分後=${grid[2].n}人`);

  // CSV
  const csv1 = visitsCsv(run, visits, T + 3600_000);
  check('訪問ログCSVにBOMが付く（Excelの文字化け対策）', csv1.charCodeAt(0) === 0xfeff);
  check('訪問ログCSVは 見出し＋4行', csv1.trim().split('\r\n').length === 5);
  const csv2 = seriesCsv(run, visits, { stepMs: 60_000, now: T + 3600_000 });
  check('同接の経過CSVが作れる', csv2.includes('同時接続数') && csv2.trim().split('\r\n').length === 62);

  // 刻みの自動決定（1分固定だと短いイベントの山がまるごと消える）
  check('短いイベントは細かい刻みになる', autoStepMs(27_000) === 1000, `${autoStepMs(27_000)}ms`);
  check('1時間なら30秒刻み', autoStepMs(3600_000) === 30_000, `${autoStepMs(3600_000)}ms`);
  check('3時間なら2分刻み', autoStepMs(3 * 3600_000) === 120_000, `${autoStepMs(3 * 3600_000)}ms`);
  const shortRun = { openedAt: T, closedAt: T + 27_000 };
  const shortVisits = [
    { visitor: 'g:1', kind: 'guest', name: '1', room: 1, joinedAt: T + 5_000, leftAt: T + 20_000 },
    { visitor: 'g:2', kind: 'guest', name: '2', room: 1, joinedAt: T + 6_000, leftAt: T + 20_000 },
  ];
  const shortSeries = gridSeries(shortVisits, {
    from: T, to: T + 27_000, stepMs: autoStepMs(27_000),
  });
  check('短いイベントでもグラフに山が出る', Math.max(...shortSeries.map((p) => p.n)) === 2,
    `最大${Math.max(...shortSeries.map((p) => p.n))}人・${shortSeries.length}点`);

  // 空でも落ちない
  check('記録0件でも落ちない', summarize(run, [], T).peak === 0 && visitsCsv(run, []).length > 0);
}

// ------------------------------------------------------------
// 2. 通し（サーバーが要る）
// ------------------------------------------------------------

function connect(opts = {}) {
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
      ws.send(JSON.stringify({ t: 'join', av: {}, ...opts }));
      resolve({ ws, inbox, send: (o) => ws.send(JSON.stringify(o)) });
    });
  });
}

async function waitFor(c, pred, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = c.inbox.find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  return null;
}

async function postJson(pathname, body) {
  const res = await fetch(HTTP_BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function postText(pathname, body) {
  const res = await fetch(HTTP_BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  testStats();

  console.log(`\n--- 通しテスト (${WS_URL}) ---`);

  // ---- イベントを立てる ----
  const created = await postJson('/api/admin/event', {
    devRole: 'admin',
    name: `記録テスト${Date.now() % 10000}`,
    cap: 10,
  });
  const ev = created.data && created.data.ev;
  check('テスト用のイベントを立てられる', Boolean(ev), created.data && created.data.error);
  if (!ev) return finish();

  // ---- 3接続。うち2つは同じ匿名ID（同じブラウザで入り直した想定）----
  const vidA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const vidB = '0f8e7d6c5b4a39281706f5e4d3c2b1a0';

  const g1 = await connect({ ev: ev.id, devRole: 'guest', vid: vidA });
  const g2 = await connect({ ev: ev.id, devRole: 'guest', vid: vidB });
  const u1 = await connect({ ev: ev.id, devRole: 'user', devEmail: 'log-test@example.com', devName: 'ログ試験' });
  const w1 = await waitFor(g1, (m) => m.t === 'welcome');
  const w3 = await waitFor(u1, (m) => m.t === 'welcome');
  check('3人が入場できた', Boolean(w1) && Boolean(w3));
  await sleep(400); // 記録の書き込みを待つ

  const list1 = await postJson('/api/admin/logs', { devRole: 'admin' });
  const run1 = list1.data && list1.data.runs.find((r) => r.eventId === ev.id);
  check('立てたイベントが記録一覧に出る', Boolean(run1), run1 && run1.name);
  check('開催中は live=true', run1 && run1.live === true);
  check('ピーク同接が3になる', run1 && run1.peak === 3, run1 && `peak=${run1.peak}`);
  check('累計ユニークが3人', run1 && run1.unique === 3, run1 && `unique=${run1.unique}`);
  check('いま3人が在室として出る', run1 && run1.nowInside === 3, run1 && `${run1.nowInside}`);

  // ---- 1人だけ抜けて、同じ匿名IDで入り直す ----
  g1.ws.close();
  await sleep(400);
  const g1b = await connect({ ev: ev.id, devRole: 'guest', vid: vidA });
  await waitFor(g1b, (m) => m.t === 'welcome');
  await sleep(400);

  const list2 = await postJson('/api/admin/logs', { devRole: 'admin' });
  const run2 = list2.data && list2.data.runs.find((r) => r.eventId === ev.id);
  check('のべ入場回数は4回に増える', run2 && run2.entries === 4, run2 && `entries=${run2.entries}`);
  check('累計ユニークは3人のまま（案A：同じブラウザは同じ人）', run2 && run2.unique === 3,
    run2 && `unique=${run2.unique}`);
  check('ログイン/ゲストの内訳が出る', run2 && run2.entriesLoggedIn === 1 && run2.entriesGuest === 3,
    run2 && `${run2.entriesLoggedIn}/${run2.entriesGuest}`);

  // ---- 明細とCSV ----
  const detail = await postJson('/api/admin/log', { devRole: 'admin', runId: run2.runId });
  check('明細に訪問ログが入る', detail.data && detail.data.visits.length === 4,
    detail.data && `${detail.data.visits.length}件`);
  check('明細に同接の経過が入る',
    detail.data && Array.isArray(detail.data.series) && detail.data.series.length >= 2 && detail.data.stepMs > 0,
    detail.data && `${detail.data.series.length}点・${detail.data.stepMs}ms刻み`);
  check('退場した行に滞在時間が入る',
    detail.data && detail.data.visits.some((v) => v.leftAt != null && v.leftAt > v.joinedAt));
  check('メールアドレスそのものは記録に残らない',
    detail.data && !JSON.stringify(detail.data.visits).includes('log-test@example.com'));

  // fetch の text() は仕様どおりBOMを取り除くので、ここでは中身で確かめる
  // （BOMが実際に付いているかは上の純粋関数テスト側で見ている）
  const csv = await postText('/api/admin/log', { devRole: 'admin', runId: run2.runId, format: 'csv-visits' });
  check('訪問ログCSVがダウンロードできる', csv.status === 200 && csv.text.includes('訪問者ID'),
    `status=${csv.status}`);
  const csvS = await postText('/api/admin/log', { devRole: 'admin', runId: run2.runId, format: 'csv-series' });
  check('同接の経過CSVがダウンロードできる', csvS.status === 200 && csvS.text.includes('同時接続数'));

  // ---- 権限 ----
  // ログイン未設定（GOOGLE_CLIENT_ID なし）のときは、既存の方針どおり
  // 「管理機能を誰でも触れる」状態なので、ここでは権限を検証できない。
  // ログインを設定した環境でのみ、トークン無しが弾かれることを確かめる
  const status = await (await fetch(`${HTTP_BASE}/api/status`)).json();
  if (status.login) {
    const denied = await postJson('/api/admin/logs', {});
    check('ログインしていないと記録を見られない', denied.status === 401, `status=${denied.status}`);
  } else {
    console.log('[SKIP] 権限テスト（GOOGLE_CLIENT_ID 未設定＝誰でも管理機能を触れる運用のため）');
  }

  // ---- PORTAL連携API ----
  const noToken = await fetch(`${HTTP_BASE}/api/stats.json`);
  if (STATS_TOKEN) {
    check('合言葉なしのPORTAL連携APIは401', noToken.status === 401, `status=${noToken.status}`);
    const okRes = await fetch(`${HTTP_BASE}/api/stats.json`, {
      headers: { Authorization: `Bearer ${STATS_TOKEN}` },
    });
    const okData = await okRes.json();
    check('合言葉ありなら集計が取れる', okRes.status === 200 && Array.isArray(okData.events),
      `status=${okRes.status}`);
    check('PORTALには訪問者ごとの行を出さない', !JSON.stringify(okData).includes('visitor'));
  } else {
    check('STATS_TOKEN 未設定ならPORTAL連携APIは開かない', noToken.status === 403, `status=${noToken.status}`);
  }

  // ---- 閉じても記録は残る ----
  const admin = await connect({ ev: ev.id, devRole: 'admin' });
  await waitFor(admin, (m) => m.t === 'welcome');
  admin.send({ t: 'event-delete', id: ev.id });
  await sleep(600);

  const list3 = await postJson('/api/admin/logs', { devRole: 'admin' });
  const run3 = list3.data && list3.data.runs.find((r) => r.eventId === ev.id);
  check('閉じたイベントも記録に残る', Boolean(run3));
  check('閉店時刻が入る（live=false）', run3 && run3.live === false && run3.closedAt > run3.openedAt);
  check('閉店で全員の滞在が閉じる', run3 && run3.nowInside === 0, run3 && `${run3.nowInside}`);
  check('閉店後もピークの値は残る', run3 && run3.peak >= 3, run3 && `peak=${run3.peak}`);

  for (const c of [g2, u1, g1b, admin]) {
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  }
  await sleep(200);
  finish();
}

function finish() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} PASS ===`);
  if (pass !== results.length) {
    console.log('失敗:', results.filter((r) => !r.ok).map((r) => r.name).join(' / '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('テストが異常終了:', e);
  process.exit(1);
});
