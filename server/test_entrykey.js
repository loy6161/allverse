// ============================================================
// 入口の鍵（ENTRY_KEY）の自己テスト
//
// 使い方:
//   ENTRY_KEY=testkey12345 PORT=5203 node server.js
//   ENTRY_KEY=testkey12345 WS_URL=ws://localhost:5203/ws node test_entrykey.js
//
// 鍵を設定しない状態でも走らせて、「今までどおり誰でも入れる」ことを確かめること
// （移行の安全策なので、ここが壊れると本番が突然閉まる）。
// ============================================================

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const BASE = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const KEY = process.env.ENTRY_KEY || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

async function get(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') || '' };
}

async function main() {
  const status = await (await fetch(`${BASE}/api/status`)).json();
  console.log(`=== 入口の鍵テスト (${BASE}) ／ 鍵: ${status.entryGate ? '有効' : '無効'} ===`);

  if (!KEY) {
    // ---- 鍵なしの運用（移行の安全策）----
    check('鍵が未設定なら /api/status の entryGate は false', status.entryGate === false);
    const top = await get('/');
    check('鍵が未設定なら直リンクで普通に開ける', top.status === 200 && top.text.includes('<'),
      `status=${top.status}`);
    finish();
    return;
  }

  check('鍵が有効なら /api/status の entryGate は true', status.entryGate === true);

  // ---- 鍵なしの直リンクは閉まっている ----
  const bare = await get('/');
  check('鍵なしの直リンクは 404', bare.status === 404, `status=${bare.status}`);
  check('鍵なしの応答に会場の中身が入っていない', !bare.text.includes('ALLVERSE') && bare.text.length < 200,
    `${bare.text.length}バイト`);
  check('鍵なしの応答にサービス名も案内文も出ない', !/ALLVERSE|VERSE CITY|会場|ライブ/.test(bare.text));

  const indexHtml = await get('/index.html');
  check('index.html を直接叩いても 404', indexHtml.status === 404, `status=${indexHtml.status}`);

  const wrong = await get(`/?k=${KEY}x`);
  check('鍵が違えば 404', wrong.status === 404, `status=${wrong.status}`);
  const short = await get('/?k=abc');
  check('鍵の長さが違っても落ちずに 404', short.status === 404, `status=${short.status}`);
  const empty = await get('/?k=');
  check('鍵が空でも 404', empty.status === 404, `status=${empty.status}`);

  // ---- 正しい鍵なら開く ----
  const ok = await get(`/?k=${KEY}`);
  check('正しい鍵なら 200 で会場が開く', ok.status === 200 && ok.text.includes('<'), `status=${ok.status}`);

  // ---- 閉じてはいけないもの ----
  // presence.json を閉じると VRChat 側（Cloudflare Worker）が取れなくなる。
  // ここが壊れるとVRCの客席からブラウザ勢が消えるので、必ず開いたままにする
  const presence = await get('/api/presence.json');
  check('presence.json は鍵なしでも 200（VRChat連携が死ぬため閉じない）', presence.status === 200,
    `status=${presence.status}`);
  const cfg = await get('/api/config');
  check('/api/config は鍵なしでも 200（入場画面の初期化に使う）', cfg.status === 200, `status=${cfg.status}`);

  // ---- 部品は鍵なしでも取れる（意図どおり）----
  // JSや3Dモデル単体では会場に入れないので、ここまで閉じる必要はない。
  // 閉じると、鍵つきで開いたページからの読み込みまで巻き込んで壊れる
  const js = await get('/src/main.js');
  check('部品(JS)は鍵なしでも取れる（単体では会場に入れないため）', js.status === 200, `status=${js.status}`);

  // ---- キャッシュ ----
  const res = await fetch(`${BASE}/`);
  check('閉じた応答はキャッシュさせない（鍵を変えたあと古い応答が残らない）',
    (res.headers.get('cache-control') || '').includes('no-store'),
    res.headers.get('cache-control') || 'なし');

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
