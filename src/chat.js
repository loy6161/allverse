// chat.js
// ALLVERSE テキストチャットUI
// index.html の #chat-root 内にチャットパネルを構築する。

import { APP_NAME } from './brand.js';

const STYLE_ID = 'verse-chat-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #chat-root {
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
    }

    .vc-chat-panel {
      width: 320px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: auto;
    }

    .vc-chat-log {
      width: 320px;
      height: 220px;
      overflow-y: auto;
      background: rgba(10, 8, 24, 0.55);
      border: 1px solid rgba(0, 255, 255, 0.35);
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
      color: #e8e8f5;
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
      color: #f1f1fa;
    }

    .vc-chat-line.vc-system {
      text-align: center;
      color: #9a9ab0;
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
      background: rgba(10, 8, 24, 0.6);
      border: 1px solid rgba(0, 255, 255, 0.35);
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
      nameSpan.textContent = name;

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
