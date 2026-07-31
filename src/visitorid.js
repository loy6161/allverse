// ============================================================
// 匿名の訪問者ID（累計の数え方「案A」・2026-07-31 loyさん決定）
//
// なぜ要るのか:
//   イベントの「累計で何人来たか」を数えたい。ログインした人はGoogleアカウントで
//   区別できるが、ゲストは接続ごとに「ゲスト001」を振っているだけなので、
//   同じ人がリロードすると別人として数えられてしまう。
//
// 何を保存するのか:
//   ランダムな16バイトの数字だけ。名前・メール・IPは一切含まない。
//   この値だけでは誰か分からず、こちらから個人を特定することもできない。
//   保存先はこのブラウザのlocalStorageで、消せばまた別の番号になる。
//
// 何に使うのか:
//   入場ログの「同じ人かどうか」の判定だけ。追跡や広告には使わない。
//   ログイン済みの人はこの値ではなくアカウント側で数えるので、実質ゲスト専用。
//
// ※ ブラウザに識別子を持たせるので、入場前に読める場所に断り書きを置いている
//   （ルーム選択画面の「入場する」の真上。`src/placepick.js` の .vc-place-terms）
// ============================================================

const KEY = 'allverse.visitor.v1';

/** 16バイトの乱数を16進で。crypto が無い環境でも止まらないようにフォールバックを持つ */
function newId() {
  try {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // 乱数が使えない古い環境。衝突しても集計が少しズレるだけなので実害は小さい
    let s = '';
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 32);
  }
}

/**
 * この端末の訪問者IDを返す。無ければ作って保存する。
 * localStorage が使えない（プライベートモード等）ときは空文字を返し、
 * サーバー側は「その接続かぎりの人」として扱う。
 * @returns {string}
 */
export function getVisitorId() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[a-f0-9]{8,32}$/.test(saved)) return saved;
    const id = newId();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return '';
  }
}
