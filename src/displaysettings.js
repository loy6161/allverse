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

import { getBubbleSec, setBubbleSec, BUBBLE_CHOICES, bubbleLabel, getChatEmote, setChatEmote } from './bubbletime.js';
import { getEmoteLayout, setEmoteLayout, resetEmoteOrder } from './emoteprefs.js';
import { getSelfView, setSelfView, getReflection, setReflectionPref } from './selfview.js';

/**
 * 表示のせっていを描く。
 * @param {HTMLElement} body 描き先
 * @param {{onEmotePrefsChange?:()=>void}} [p] 設定を変えたときに知らせる相手
 */
export function renderDisplaySettings(
  body,
  { onEmotePrefsChange, onChatEmoteChange, onSelfViewChange, onReflectionChange } = {},
) {
  body.innerHTML = '';

  // ---- 床の反射（2026-08-04追加） ----
  // loyさん「あと、反射ってできるの？アバターやエモートは対象外で」
  // ⚠ 会場をもう1回描くので負荷が上がる。端末で選べるようにしてある
  const boxR = document.createElement('div');
  boxR.className = 'vc-help-box';
  const hR = document.createElement('div');
  hR.className = 'vc-help-h';
  hR.textContent = '床に会場を映す（反射）';
  boxR.appendChild(hR);
  const noteR = document.createElement('div');
  noteR.className = 'vc-help-note';
  noteR.textContent =
    '床に柱やステージが映り込むようになります。アバターとエモートは映りません。'
    + '会場をもう一度描くぶん動きが重くなることがあるので、カクつくときは切ってください。'
    + 'この設定はこの端末にだけ保存されます。';
  boxR.appendChild(noteR);
  const rowR = document.createElement('div');
  rowR.className = 'vc-help-choices';
  let curRef = getReflection();
  const refBtns = [];
  function paintRef() {
    for (const b of refBtns) b.classList.toggle('active', (b.dataset.v === 'on') === curRef);
  }
  for (const [v, label] of [['on', '映す'], ['off', '映さない']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vc-help-choice';
    b.dataset.v = v;
    b.textContent = label;
    b.addEventListener('click', () => {
      curRef = setReflectionPref(v === 'on');
      paintRef();
      if (onReflectionChange) onReflectionChange(curRef);
    });
    refBtns.push(b);
    rowR.appendChild(b);
  }
  paintRef();
  boxR.appendChild(rowR);
  body.appendChild(boxR);

  // ---- 自分の姿を出す（2026-08-04追加） ----
  // loyさん「1人称やスクリーン全画面にしてても自分の動きがわかるから応援しやすくて良いかなって」
  const boxS = document.createElement('div');
  boxS.className = 'vc-help-box';
  const hS = document.createElement('div');
  hS.className = 'vc-help-h';
  hS.textContent = '自分の姿を小窓に出す';
  boxS.appendChild(hS);
  const noteS = document.createElement('div');
  noteS.className = 'vc-help-note';
  noteS.textContent =
    '自分のアバターを正面から映す小窓を出します。一人称のときやスクリーンを画面いっぱいにしているときでも、自分がどう動いているかが分かります。名前と吹き出しは映りません。窓は上の帯をつかんで動かせます（パソコンのみ）。この設定はこの端末にだけ保存されます。';
  boxS.appendChild(noteS);

  const rowS = document.createElement('div');
  rowS.className = 'vc-help-choices';
  let curSelf = getSelfView();
  const selfBtns = [];
  function paintSelf() {
    for (const b of selfBtns) b.classList.toggle('active', (b.dataset.v === 'on') === curSelf);
  }
  for (const [v, label] of [['on', '出す'], ['off', '出さない']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vc-help-choice';
    b.dataset.v = v;
    b.textContent = label;
    b.addEventListener('click', () => {
      curSelf = setSelfView(v === 'on');
      paintSelf();
      if (onSelfViewChange) onSelfViewChange(curSelf);
    });
    selfBtns.push(b);
    rowS.appendChild(b);
  }
  paintSelf();
  boxS.appendChild(rowS);
  body.appendChild(boxS);

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

  // ---- YouTubeのコメントでアバターを動かす（2026-08-03追加） ----
  const boxC = document.createElement('div');
  boxC.className = 'vc-help-box';
  const hC = document.createElement('div');
  hC.className = 'vc-help-h';
  hC.textContent = 'YouTubeのコメントでアバターを動かす';
  boxC.appendChild(hC);
  const noteC = document.createElement('div');
  noteC.className = 'vc-help-note';
  noteC.textContent =
    'YouTubeチャンネルを連携していると、自分のコメントに合わせてアバターがエモートします（888で拍手、乾杯で乾杯、↑でジャンプ、そのほかの絵文字はペンライト）。連投したぶんだけ続けて動きます。';
  boxC.appendChild(noteC);

  const rowC = document.createElement('div');
  rowC.className = 'vc-help-choices';
  let curChat = getChatEmote();
  const chatBtns = [];
  function paintChat() {
    for (const b of chatBtns) b.classList.toggle('active', (b.dataset.v === 'on') === curChat);
  }
  for (const [v, label] of [['on', '動かす'], ['off', '動かさない']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vc-help-choice';
    b.dataset.v = v;
    b.textContent = label;
    b.addEventListener('click', () => {
      curChat = setChatEmote(v === 'on');
      paintChat();
      if (onChatEmoteChange) onChatEmoteChange(curChat);
    });
    chatBtns.push(b);
    rowC.appendChild(b);
  }
  paintChat();
  boxC.appendChild(rowC);
  body.appendChild(boxC);

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
