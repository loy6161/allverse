// エモート中継・共有スクリーンの自己テスト
// 使い方: サーバーを起動した状態で `node test_emote_screen.js`
import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5179/ws';
const HTTP_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

function connect(name) {
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
      ws.send(JSON.stringify({ t: 'join', n: name, av: { h: 'short', hc: 0, sc: 0, bc: 0 } }));
      resolve({ ws, inbox });
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (inbox, t) => inbox.find((m) => m.t === t);

async function main() {
  const a = await connect('EmoteA');
  const b = await connect('EmoteB');
  await wait(400);

  // 1. welcome に screen（既定動画）が入っている
  const welcomeB = find(b.inbox, 'welcome');
  check(
    'welcomeにscreen(既定動画ID)が含まれる',
    !!welcomeB && typeof welcomeB.screen === 'string' && welcomeB.screen.length === 11,
    JSON.stringify(welcomeB && welcomeB.screen),
  );

  // 2. エモートが相手に中継され、自分には届かない
  a.inbox.length = 0;
  b.inbox.length = 0;
  a.ws.send(JSON.stringify({ t: 'emote', e: 'wave' }));
  await wait(300);
  const emoteAtB = find(b.inbox, 'emote');
  check('エモートが相手に中継される', !!emoteAtB && emoteAtB.e === 'wave', JSON.stringify(emoteAtB));
  check('エモートは自分には届かない', !find(a.inbox, 'emote'));

  // 3. 未知のエモートidは破棄される
  b.inbox.length = 0;
  a.ws.send(JSON.stringify({ t: 'emote', e: 'evil-crash' }));
  await wait(300);
  check('未知のエモートidは破棄される', !find(b.inbox, 'emote'));

  // 4. スクリーン変更が両者に届く（発信者にも返る）
  a.inbox.length = 0;
  b.inbox.length = 0;
  a.ws.send(JSON.stringify({ t: 'screen', v: 'dQw4w9WgXcQ' }));
  await wait(300);
  const scrA = find(a.inbox, 'screen');
  const scrB = find(b.inbox, 'screen');
  check(
    'スクリーン変更が発信者にも届く',
    !!scrA && scrA.v === 'dQw4w9WgXcQ' && scrA.by === 'EmoteA',
    JSON.stringify(scrA),
  );
  check('スクリーン変更が相手にも届く', !!scrB && scrB.v === 'dQw4w9WgXcQ', JSON.stringify(scrB));

  // 5. 不正な動画IDは破棄される
  b.inbox.length = 0;
  a.ws.send(JSON.stringify({ t: 'screen', v: 'javascript:alert(1)' }));
  await wait(300);
  check('不正な動画IDは破棄される', !find(b.inbox, 'screen'));

  // 6. 途中入場者のwelcomeに変更後の動画IDが入る
  const c = await connect('EmoteC');
  await wait(400);
  const welcomeC = find(c.inbox, 'welcome');
  check(
    '途中入場者が現在のスクリーンを受け取る',
    !!welcomeC && welcomeC.screen === 'dQw4w9WgXcQ',
    JSON.stringify(welcomeC && welcomeC.screen),
  );

  a.ws.close();
  b.ws.close();
  c.ws.close();

  // HTTPが生きていることも確認（回帰チェック）
  const res = await fetch(`${HTTP_URL}/api/presence.json`);
  check('presence.jsonが引き続き200を返す', res.status === 200);

  await wait(200);
  console.log('=== 結果サマリ ===');
  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`));
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('テスト実行エラー:', e);
  process.exit(1);
});
