// ============================================================
// presence.json の吹き出し項目 c[] の自動テスト（2026-08-03追加・申し送り⑦）
//
// ★ このテストの主目的は「会場の独自チャットが公開URLへ漏れないこと」。
//   presence.json / live.json は認証なしで誰でも取れるので、
//   ここが壊れると入場者どうしの会話が外から全部読めるようになる。
//   c に載ってよいのは **YouTube由来の発言だけ**（元から公開の場での発言なので）。
//   判断の経緯: docs/HANDOFF_UNITY_7_BUBBLE.md「決定2」
//
// 実行（サーバーを起動した状態で）:
//   cd server
//   YOUTUBE_API_KEY=dummy PORT=5204 node server.js
//   WS_URL=ws://localhost:5204/ws HTTP_URL=http://localhost:5204 node test_bubble_presence.js
//
// ⚠ YOUTUBE_API_KEY が要るのは「合言葉の発行」がキー未設定だと断られるため。
//   ダミーで構わない（テスト用イベントは chatMode:'local' なので、
//   YouTubeへ実際に取りに行く読み取り係は起動しない）。
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

// ---- 準備 ----
const created = await post('/api/admin/event', { name: '吹き出しpresenceテスト' });
const evId = created && created.ev && created.ev.id;
ok('テスト用イベントを立てられた', Boolean(evId), evId);

const VISITOR = 'bb11cc22dd33ee44';
const CHANNEL = 'UC_test_bubble_0001';

const ws = await connect();
ws.send(JSON.stringify({ t: 'join', av: {}, n: '吹き太郎', ev: evId, vid: VISITOR }));
const welcome = await waitFor(ws, 'welcome');
ok('入場できた', Boolean(welcome.id), welcome.n);

// VRChatの客席に出す設定にしないと presence に載らない
ws.send(JSON.stringify({ t: 'event-update', id: evId, vrc: true }));
await sleep(300);

const findMe = (p) => (p.web || []).find((w) => w.n === welcome.n);

console.log('\n[1] 何も喋っていないときは c が無い');
let p = await getPresence();
let me = findMe(p);
ok('presence に自分が載っている', Boolean(me));
ok('c が無い', me && me.c === undefined);

console.log('\n[2] ★会場の独自チャットは c に載らない（公開URLへ漏らさない）');
ws.send(JSON.stringify({ t: 'chat', txt: '会場のみんなにだけ言いたい内緒の話' }));
await sleep(300);
p = await getPresence();
me = findMe(p);
ok('会場チャットの直後でも c が無い', me && me.c === undefined, me && JSON.stringify(me.c));
ok('presence 全体を文字列にしても会場チャットの本文が出てこない',
  !JSON.stringify(p).includes('内緒の話'));

console.log('\n[3] 合言葉でYouTubeと結びつける');
ws.send(JSON.stringify({ t: 'yt-code' }));
const codeMsg = await waitFor(ws, 'yt-code');
ok('合言葉が発行された', codeMsg.ok === true && /^AV-/.test(codeMsg.code || ''),
  codeMsg.code || codeMsg.why);

const linked = await post('/api/_yt-inject', {
  eventId: evId,
  channelId: CHANNEL,
  name: 'テスト視聴者',
  text: `${codeMsg.code} つなげます`,
});
ok('注入口が受け付けた', linked.ok === true, JSON.stringify(linked));
await waitFor(ws, 'yt-linked').catch(() => null);
await sleep(200);

console.log('\n[4] YouTubeのコメントは c に載る');
await post('/api/_yt-inject', {
  eventId: evId,
  channelId: CHANNEL,
  name: 'テスト視聴者',
  text: 'この曲すき！',
});
await sleep(200);
p = await getPresence();
me = findMe(p);
ok('c が載る', Boolean(me && me.c), me && JSON.stringify(me.c));
ok('c[0] が本文', me && me.c && me.c[0] === 'この曲すき！', me && me.c && me.c[0]);
ok('c[1] が秒（ミリ秒ではない）',
  me && me.c && Number.isInteger(me.c[1]) && me.c[1] > 1_700_000_000 && me.c[1] < 100_000_000_000,
  me && me.c && String(me.c[1]));

console.log('\n[5] 本文は40文字でカットされる（30KB制約）');
const LONG = 'あ'.repeat(60);
await post('/api/_yt-inject', { eventId: evId, channelId: CHANNEL, name: 'テスト視聴者', text: LONG });
await sleep(200);
p = await getPresence();
me = findMe(p);
ok('c[0] が40文字以内', me && me.c && [...me.c[0]].length <= 40,
  me && me.c && `${[...me.c[0]].length}文字`);

console.log('\n[6] ★そのあと会場チャットを打つと c が消える（後戻りしない）');
// ここが今回いちばん壊れやすい。YouTubeで喋ったあと会場チャットを打った人の
// 発言が、YouTube由来の扱いのまま残って公開URLに出続けてはいけない
ws.send(JSON.stringify({ t: 'chat', txt: 'こっちは会場だけの話' }));
await sleep(300);
p = await getPresence();
me = findMe(p);
ok('会場チャットで上書きすると c が消える', me && me.c === undefined, me && JSON.stringify(me.c));
ok('presence 全体にも会場チャットの本文が出てこない', !JSON.stringify(p).includes('会場だけの話'));

console.log('\n[7] 既存の項目を壊していない');
ok('v は 1 のまま（契約は変えていない）', p.v === 1, String(p.v));
ok('rm/x/z/r/av は今までどおり',
  me && typeof me.rm === 'number' && ['x', 'z', 'r'].every((k) => typeof me[k] === 'number')
    && typeof me.av === 'object');
ok('yt[] は空のまま（結びついていない人の発言は出さない）',
  Array.isArray(p.yt) && p.yt.length === 0);

console.log('\n[8] サイズ（VRChatの文字列ダウンロード上限に対する余裕）');
// 2026-08-03 実測: 上限いっぱいの60人を実際に入場させ、全員をYouTubeと結びつけ、
// 全員が40文字＋エモートを同時に出している状態で **19.1KB**（上限30KB）。
// 名前は自動の「ゲスト003」だったので、12文字の日本語名なら +約1.4KB で約20.5KB。
// ここは常設のテストなので実人数ぶんしか測れない。概算で見張るだけにしてある
const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
console.log(`  いまの presence.json: ${bytes} バイト（実在 ${p.web.length} 人）`);
// 最悪ケースの見積り: 60人全員が40文字（日本語＝1文字3バイト）を同時に喋っている状態
const worstPerPerson = 40 * 3 + 20; // 本文＋時刻＋JSONの記号ぶん
const worst = bytes + (60 - p.web.length) * 200 + 60 * worstPerPerson;
console.log(`  60人が全員同時に喋った場合の概算: 約${Math.ceil(worst / 1024)}KB`);
ok('概算でも30KBに収まる', worst < 30 * 1024, `${Math.ceil(worst / 1024)}KB`);

ws.close();

// ---- 後片付け ----
const admin = await connect();
admin.send(JSON.stringify({ t: 'join', n: '片付け係', ev: evId, vid: 'ff00ee11dd22cc33' }));
await waitFor(admin, 'welcome');
admin.send(JSON.stringify({ t: 'event-delete', id: evId }));
await sleep(300);
admin.close();

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
