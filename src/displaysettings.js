// ============================================================
// 表示のせってい（2026-08-03。ヘルプから独立させた）
//
// なぜ分けたか（loyさん指摘 2026-08-03）:
//   > ヘルプに「表示設定」が入ってるのおかしくない？
//   > それなら「設定」ボタンは別にした方がいい。
//   ヘルプは「使い方を読む場所」であって「設定を変える場所」ではない。
//   読むものと変えるものが同じ画面にあると、どちらを探せばいいか分からなくなる。
//
// ここは「自分の画面だけに効く設定」を置く場所。
// 会場全体に効く設定（定員・合言葉・運営メッセージ等）は🚪パネルのまま。
// ============================================================

import { getBubbleSec, setBubbleSec, BUBBLE_CHOICES, bubbleLabel } from './bubbletime.js';
import { getEmoteLayout, setEmoteLayout, resetEmoteOrder } from './emoteprefs.js';

/**
 * 表示のせっていを描く。
 * @param {HTMLElement} body 描き先
 * @param {{onEmotePrefsChange?:()=>void}} [p] 設定を変えたときに知らせる相手
 */
export function renderDisplaySettings(body, { onEmotePrefsChange } = {}) {
  body.innerHTML = '';

  // ---- エモートの並べ方（2026-08-03追加） ----
  // loyさん「ページ切り替えじゃなくて2段にもできるようにしたいね。選べる方がいい」
  const boxE = document.createElement('div');
  boxE.className = 'vc-help-box';
  const hE = document.createElement('div');
  hE.className = 'vc-help-h';
  hE.textContent = 'エモートの並べ方';
  boxE.appendChild(hE);

  const noteE = document.createElement('div');
  noteE.className = 'vc-help-note';
  noteE.textContent =
    '画面下のエモートを、6個ずつ切り替えて使うか、12個を2段で全部出すかを選べます。';
  boxE.appendChild(noteE);

  const rowE = document.createElement('div');
  rowE.className = 'vc-help-choices';
  let curLayout = getEmoteLayout();
  const layoutBtns = [];
  function paintLayout() {
    for (const b of layoutBtns) b.classList.toggle('active', b.dataset.v === curLayout);
  }
  for (const [v, label] of [['page', '6個ずつ（0キーで切替）'], ['rows', '12個を2段で出す']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vc-help-choice';
    b.dataset.v = v;
    b.textContent = label;
    b.addEventListener('click', () => {
      curLayout = setEmoteLayout(v);
      paintLayout();
      if (onEmotePrefsChange) onEmotePrefsChange();
    });
    layoutBtns.push(b);
    rowE.appendChild(b);
  }
  paintLayout();
  boxE.appendChild(rowE);

  const noteE2 = document.createElement('div');
  noteE2.className = 'vc-help-note';
  noteE2.textContent =
    'エモートはドラッグで入れ替えられます（パソコンのみ）。よく使うものを数字キーの手前に置いておけます。数字キー1〜6は印が付いている段に効き、0で段が切り替わります。';
  boxE.appendChild(noteE2);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'vc-help-choice';
  resetBtn.textContent = '並び順を元に戻す';
  resetBtn.addEventListener('click', () => {
    resetEmoteOrder();
    if (onEmotePrefsChange) onEmotePrefsChange();
  });
  boxE.appendChild(resetBtn);
  body.appendChild(boxE);

  // ---- 吹き出しの表示時間 ----
  const box = document.createElement('div');
  box.className = 'vc-help-box';

  const h = document.createElement('div');
  h.className = 'vc-help-h';
  h.textContent = '吹き出しの表示時間';
  box.appendChild(h);

  const note = document.createElement('div');
  note.className = 'vc-help-note';
  note.textContent =
    'アバターの上に出るセリフを、何秒間そのままにしておくかを選べます。この設定はこの端末にだけ保存されます。';
  box.appendChild(note);

  const row = document.createElement('div');
  row.className = 'vc-help-choices';

  let current = getBubbleSec();
  const buttons = [];
  function paint() {
    for (const b of buttons) b.classList.toggle('active', Number(b.dataset.sec) === current);
  }
  for (const sec of BUBBLE_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vc-help-choice';
    b.dataset.sec = String(sec);
    b.textContent = bubbleLabel(sec);
    b.addEventListener('click', () => {
      current = setBubbleSec(sec);
      paint();
    });
    buttons.push(b);
    row.appendChild(b);
  }
  paint();
  box.appendChild(row);

  const note2 = document.createElement('div');
  note2.className = 'vc-help-note';
  // 「消さない」を選んだ人が、古いセリフが残り続けるのを不具合と思わないように書いておく
  note2.textContent =
    '「消さない」を選ぶと、その人が次に発言するまでセリフが残ります（放置されたままにならないよう、10分で消えます）。';
  box.appendChild(note2);
  body.appendChild(box);

  // ---- ウィンドウの位置と大きさ ----
  const box2 = document.createElement('div');
  box2.className = 'vc-help-box';
  const h2 = document.createElement('div');
  h2.className = 'vc-help-h';
  h2.textContent = 'ウィンドウの位置と大きさ';
  const n2 = document.createElement('div');
  n2.className = 'vc-help-note';
  n2.textContent =
    'チャットとYouTubeチャットは、上の帯をつかんで動かせます。右下のつまみで大きさも変えられます。帯の「畳む」を押すと帯だけの状態になり、もう一度押すと戻ります（YouTubeのチャットを使っているときに会場のチャットを畳んでおく、といった使い方ができます）。位置・大きさ・畳んだ状態はこの端末に保存され、次に来たときも同じ状態で始まります。元に戻したいときは「位置を戻す」を押してください。（スマホでは配置が固定です）';
  box2.append(h2, n2);
  body.appendChild(box2);
}
