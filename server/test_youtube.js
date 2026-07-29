// ============================================================
// YouTubeクロスポストの自己テスト（サーバー起動不要）
// 使い方: node test_youtube.js
//
// 実際の投稿はGoogleの認可が要るのでここでは試さない。
// 代わりに「発言が消えない／詰まらない／勝手に送られない」という、
// 間違えると被害が出るところだけを確かめる。
// ============================================================

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-secret';
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://allverse.onrender.com';

const yt = await import('./youtube.js');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}

console.log('=== YouTubeクロスポスト 自己テスト ===');

// ---------- 1. 認可URL ----------
const url = new URL(yt.buildAuthUrl(null));
check('認可URLはGoogleのものになる', `${url.host}${url.pathname}` === 'accounts.google.com/o/oauth2/v2/auth', url.host);
check(
  '戻り先URLがPUBLIC_URLから作られる',
  url.searchParams.get('redirect_uri') === 'https://allverse.onrender.com/api/yt/callback',
  url.searchParams.get('redirect_uri'),
);
check(
  '投稿に必要なスコープを要求する',
  url.searchParams.get('scope') === 'https://www.googleapis.com/auth/youtube.force-ssl',
  url.searchParams.get('scope'),
);
// 再起動しても認可し直しにならないよう refresh_token が要る
check('再起動後も使えるよう offline を指定する', url.searchParams.get('access_type') === 'offline');
// 別サイトから認可画面を踏ませないための合言葉
check('stateが付いている', (url.searchParams.get('state') || '').length >= 12);

// ---------- 2. 認可前は何もしない ----------
check('認可前はONにできない', yt.setEnabled(true) === false);
check('OFFのときは送信待ちに積まない', yt.enqueue({ name: 'a', txt: 'b', videoId: 'v' }).queued === false);
check('期限切れのstateは受け付けない', (await yt.handleAuthCallback(null, 'code', 'nonexistent')).ok === false);

// ---------- 3. まとめ送りの詰め込み ----------
// ここを間違えると発言が消えたり、先頭で詰まって以降が一生送られなくなる
const V = 'vid1';
const mk = (n, t, v = V) => ({ name: n, txt: t, videoId: v });

let r = yt.packMessage([mk('あ', 'いち'), mk('い', 'に'), mk('う', 'さん')], V);
check('短い発言はまとめて1通になる', r.text === 'あ: いち / い: に / う: さん' && r.rest.length === 0, r.text);

const long = 'x'.repeat(150);
r = yt.packMessage([mk('a', long), mk('b', long)], V);
check('入りきらない分は次回に回す（切り捨てない）', r.text === `a: ${long}` && r.rest.length === 1, `rest=${r.rest.length}`);

r = yt.packMessage([mk('a', 'y'.repeat(400))], V);
check('1行で上限を超えたら切り詰めて送る（詰まらせない）', r.text.length === 200 && r.rest.length === 0, `len=${r.text.length}`);

r = yt.packMessage([mk('a', '1'), mk('b', '2', 'vid2')], V);
check(
  '動画が変わったところで区切る（別の配信に混ぜない）',
  r.text === 'a: 1' && r.rest.length === 1 && r.rest[0].videoId === 'vid2',
  r.text,
);

r = yt.packMessage([], V);
check('空なら何も作らない', r.text === '' && r.rest.length === 0);

// ---------- 4. 残り回数 ----------
const st = yt.getCrossPostStatus();
check('1日に送れる回数を計算して出す', st.postsLeft === 200, `postsLeft=${st.postsLeft}（枠${st.quotaPerDay}÷50）`);
check('認可していない状態が分かる', st.configured === true && st.connected === false);

console.log('=== 結果サマリ ===');
results.forEach((x) => console.log(`${x.ok ? 'PASS' : 'FAIL'}: ${x.name}`));
const failed = results.filter((x) => !x.ok).length;
console.log(failed === 0 ? 'ALL PASS' : `${failed}件 FAIL`);
process.exit(failed === 0 ? 0 : 1);
