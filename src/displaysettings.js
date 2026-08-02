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

/**
 * 表示のせっていを描く。
 * @param {HTMLElement} body 描き先
 */
export function renderDisplaySettings(body) {
  body.innerHTML = '';

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
