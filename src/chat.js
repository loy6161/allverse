// chat.js
// ALLVERSE テキストチャットUI
// index.html の #chat-root 内にチャットパネルを構築する。

import { APP_NAME } from './brand.js';
import { makeFloating, isFloatEnabled } from './floatwin.js';

const STYLE_ID = 'verse-chat-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #chat-root {
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
      /* 2026-08-03: 掴んで動かす・大きさを変えるために、外枠を「箱」にした。
         中身（ログと入力欄）は箱の大きさに追従する */
      display: flex;
      flex-direction: column;
      width: 320px;
      height: 300px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 120px);
    }

    .vc-chat-panel {
      /* 箱いっぱいに広がる。幅を固定していると、リサイズしても中が付いてこない */
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: auto;
    }

    .vc-chat-log {
      /* 高さは箱の余りぶん。min-height:0 が無いと flex の中で縮まない */
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      overflow-y: auto;
      /* 2026-08-03: 透過が強すぎて、明るい映像の上だと文字が読めなかった
         （loyさん「チャットの色が白くて文字が見えない」）。
         会場は暗い前提なので、パネル自体をしっかり暗くして文字を浮かせる */
      background: rgba(6, 5, 16, 0.92);
      border: 1px solid rgba(0, 255, 255, 0.28);
      border-radius: 10px;
      padding: 10px 12px;
      box-sizing: border-box;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 0 18px rgba(255, 0, 255, 0.15), inset 0 0 24px rgba(0, 255, 255, 0.05);
      font-size: 13px;
      line-height: 1.5;
      scrollbar-width: thin;
      scrollbar-color: rgba(0, 255, 255, 0.5) rgba(10, 8, 24, 0.3);
    }

    .vc-chat-log::-webkit-scrollbar {
      width: 6px;
    }
    .vc-chat-log::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 255, 0.4);
      border-radius: 4px;
    }
    .vc-chat-log::-webkit-scrollbar-track {
      background: transparent;
    }

    .vc-chat-line {
      margin: 0 0 6px 0;
      word-break: break-word;
      color: #f3f3ff;
      animation: vc-chat-fade-in 0.2s ease-out;
    }
    .vc-chat-line:last-child {
      margin-bottom: 0;
    }

    @keyframes vc-chat-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .vc-chat-name {
      font-weight: 700;
      margin-right: 6px;
    }

    .vc-chat-name.vc-name-self {
      color: #4dfcff;
      text-shadow: 0 0 6px rgba(77, 252, 255, 0.7);
    }

    .vc-chat-name.vc-name-other {
      color: #ff5fd6;
      text-shadow: 0 0 6px rgba(255, 95, 214, 0.6);
    }

    .vc-chat-text {
      color: #ffffff;
    }

    .vc-chat-line.vc-system {
      text-align: center;
      color: #b9b9cf;
      font-size: 12px;
      font-style: italic;
      margin: 4px 0;
    }

    .vc-chat-input-row {
      display: flex;
      gap: 6px;
    }

    .vc-chat-input {
      flex: 1;
      min-width: 0;
      background: rgba(6, 5, 16, 0.92);
      border: 1px solid rgba(0, 255, 255, 0.28);
      border-radius: 8px;
      padding: 8px 10px;
      color: #f1f1fa;
      font-size: 13px;
      outline: none;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .vc-chat-input::placeholder {
      color: #7d7d99;
    }

    .vc-chat-input:focus {
      border-color: rgba(0, 255, 255, 0.9);
      box-shadow: 0 0 10px rgba(0, 255, 255, 0.4);
    }

    .vc-chat-send {
      flex-shrink: 0;
      border: 1px solid rgba(255, 0, 255, 0.5);
      background: linear-gradient(135deg, rgba(0, 255, 255, 0.25), rgba(255, 0, 255, 0.25));
      color: #ffffff;
      font-weight: 700;
      font-size: 13px;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      transition: filter 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 0 10px rgba(255, 0, 255, 0.25);
    }

    .vc-chat-send:hover {
      filter: brightness(1.25);
      box-shadow: 0 0 14px rgba(255, 0, 255, 0.5);
    }

    .vc-chat-send:active {
      filter: brightness(0.95);
    }

    /* スマホは掴んで動かせないので、箱にせず従来どおりの積み方に戻す。
       積み方は style.css / mobile.js の --m-* 変数が決めている（2026-08-03） */
    @media (max-width: 640px) {
      #chat-root {
        /* auto にすると、中身が幅100%を親に問い合わせて潰れる（実測252px）。
           スマホは横いっぱいで使うので、明示的に指定する */
        width: calc(100vw - 24px);
        height: auto;
        max-height: none;
      }
      .vc-chat-log {
        /* 箱の伸縮をやめて、従来どおり決め打ちの高さにする。
           mobile.js も同じ130pxを指定している（タッチ端末のときだけ読み込まれるので、
           ここにも書いておかないと「細いPC画面」で高さが潰れる） */
        flex: 0 0 auto;
        height: 130px;
      }
    }
  `;
  document.head.appendChild(style);
}

export function initChat({ onSend }) {
  injectStyle();

  const root = document.getElementById('chat-root');
  root.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'vc-chat-panel';

  const log = document.createElement('div');
  log.className = 'vc-chat-log';

  const inputRow = document.createElement('div');
  inputRow.className = 'vc-chat-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'vc-chat-input';
  input.placeholder = 'メッセージを入力...';
  input.maxLength = 200;

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'vc-chat-send';
  sendBtn.textContent = '送信';

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  panel.appendChild(log);
  panel.appendChild(inputRow);
  root.appendChild(panel);

  function addMessage(name, text, opts = {}) {
    const line = document.createElement('p');
    line.className = 'vc-chat-line';

    if (opts.system) {
      line.classList.add('vc-system');
      line.textContent = text;
    } else {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'vc-chat-name ' + (opts.self ? 'vc-name-self' : 'vc-name-other');
      // YouTube由来の発言は出所が分かるようにする。会場で打ったものと
      // 見分けがつかないと、「消したのに残っている」等の誤解が起きる（2026-08-03追加）
      nameSpan.textContent = opts.yt ? `▶ ${name}` : name;

      const textSpan = document.createElement('span');
      textSpan.className = 'vc-chat-text';
      textSpan.textContent = text;

      line.appendChild(nameSpan);
      line.appendChild(textSpan);
    }

    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    onSend(text);
    input.value = '';
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  // 掴んで動かす・大きさを変える（2026-08-03追加）。スマホでは無効
  if (isFloatEnabled()) {
    makeFloating(root, { key: 'chat', title: 'チャット', minW: 240, minH: 160 });
  }

  // 具体的な会場名とルーム番号は、サーバーからwelcomeが届いた時点でヘッダーに出る
  addMessage('', `${APP_NAME} へようこそ！`, { system: true });

  return {
    addMessage,
    /**
     * 入力欄の表示を切り替える（2026-08-02追加）。
     *
     * YouTubeチャット連動のイベントでは発言をYouTubeへ一本化するので、
     * **入力欄だけを隠してログは残す**。ここを「パネルごと隠す」にすると、
     * 「コメントするにはログインが必要です」のような案内も一緒に消えてしまい、
     * ゲストが理由の分からないまま詰まる。
     * 隠している間、このパネルは発言欄ではなく「お知らせ欄」として働く。
     */
    setInputVisible(on) {
      inputRow.style.display = on ? '' : 'none';
    },
  };
}
