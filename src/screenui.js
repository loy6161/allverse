// screenui.js
// VERSE CITY スクリーン動画の変更パネル
// 画面右上（アバター変更ボタンの下）に「📺 スクリーン」ボタンを設置し、
// クリックで開閉する小パネルからYouTube動画ID/URLを変更できるようにする。
// 変更はこの会場にいる全員に反映される想定なので、その旨をパネル内で明記する。

const STYLE_ID = 'vc-screenui-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* 動画URL変更ボタン: 右下の動画パネル内に置かれる */
    .vc-screen-btn {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #eee;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 176, 92, 0.3);
      border-radius: 7px;
      cursor: pointer;
      padding: 0;
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
      transition: background 0.15s, box-shadow 0.15s;
    }

    .vc-screen-btn:hover {
      background: rgba(255, 176, 92, 0.25);
      box-shadow: 0 0 8px rgba(255, 176, 92, 0.4);
    }

    /* パネルは動画パネルの上に開く */
    .vc-screen-panel {
      position: fixed;
      bottom: 108px;
      right: 16px;
      z-index: 10;
      width: 260px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: rgba(10, 8, 24, 0.7);
      border: 1px solid rgba(255, 0, 229, 0.4);
      border-radius: 10px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 0 18px rgba(0, 255, 234, 0.15), inset 0 0 24px rgba(255, 0, 229, 0.05);
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
      color: #e8e8f5;
    }

    .vc-screen-panel.vc-screen-hidden {
      display: none;
    }

    .vc-screen-current {
      font-size: 12px;
      color: #9a9ab0;
      word-break: break-all;
    }

    .vc-screen-current-id {
      color: #4dfcff;
      font-weight: 700;
    }

    .vc-screen-desc {
      font-size: 11px;
      line-height: 1.5;
      color: #b8b8cc;
    }

    .vc-screen-row {
      display: flex;
      gap: 6px;
    }

    .vc-screen-input {
      flex: 1;
      min-width: 0;
      background: rgba(10, 8, 24, 0.6);
      border: 1px solid rgba(0, 255, 234, 0.35);
      border-radius: 8px;
      padding: 8px 10px;
      color: #f1f1fa;
      font-size: 12px;
      outline: none;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .vc-screen-input::placeholder {
      color: #7d7d99;
    }

    .vc-screen-input:focus {
      border-color: rgba(0, 255, 234, 0.9);
      box-shadow: 0 0 10px rgba(0, 255, 234, 0.4);
    }

    .vc-screen-clear {
      width: 100%;
      margin-top: 8px;
      border: 1px solid rgba(255, 140, 160, 0.5);
      background: rgba(255, 140, 160, 0.12);
      color: rgba(255, 200, 210, 0.95);
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
    }
    .vc-screen-clear:hover:not(:disabled) {
      background: rgba(255, 140, 160, 0.22);
    }

    .vc-screen-apply {
      flex-shrink: 0;
      border: 1px solid rgba(255, 0, 229, 0.5);
      background: linear-gradient(135deg, rgba(0, 255, 234, 0.25), rgba(255, 0, 229, 0.25));
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: filter 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 0 10px rgba(255, 0, 229, 0.25);
    }

    .vc-screen-apply:hover {
      filter: brightness(1.25);
      box-shadow: 0 0 14px rgba(255, 0, 229, 0.5);
    }

    .vc-screen-apply:active {
      filter: brightness(0.95);
    }

    .vc-screen-error {
      font-size: 11px;
      color: #ff6b6b;
      min-height: 14px;
    }

    @media (max-width: 640px), (max-height: 480px) {
      /* このパネルを開くボタン(📺)は動画のコントロールの中にあるので、
         そのコントロール自身より上の段に出す */
      .vc-screen-panel {
        right: 12px;
        left: 12px;
        width: auto;
        max-width: none;
        bottom: var(--m-panel2-bottom);
        max-height: calc(100vh - var(--m-panel2-bottom) - 145px);
        overflow-y: auto;
      }
    }
  `;
  document.head.appendChild(style);
}

// 対応パターン:
//  - https://www.youtube.com/watch?v=VIDEOID (他クエリ付与OK)
//  - https://m.youtube.com/watch?v=VIDEOID
//  - https://youtu.be/VIDEOID
//  - https://www.youtube.com/live/VIDEOID
//  - https://www.youtube.com/embed/VIDEOID
//  - 動画ID単体（11文字の [A-Za-z0-9_-]）
function extractVideoId(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;

  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = s.match(/youtube\.com\/live\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  return null;
}

export function initScreenUI({ onChange, slot }) {
  injectStyle();

  let open = false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-screen-btn';
  btn.textContent = '\u{1F4FA}'; // 📺（動画URLの変更）
  btn.title = '流す動画を変える';

  const panel = document.createElement('div');
  panel.className = 'vc-screen-panel vc-screen-hidden';

  const current = document.createElement('div');
  current.className = 'vc-screen-current';
  const currentLabel = document.createElement('span');
  currentLabel.textContent = '現在の動画: ';
  const currentId = document.createElement('span');
  currentId.className = 'vc-screen-current-id';
  currentId.textContent = '-';
  current.appendChild(currentLabel);
  current.appendChild(currentId);

  const desc = document.createElement('div');
  desc.className = 'vc-screen-desc';
  desc.textContent =
    'YouTubeのURLまたは動画IDを入力して変更してください。この会場にいる全員のスクリーンが切り替わります。';

  const row = document.createElement('div');
  row.className = 'vc-screen-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'vc-screen-input';
  input.placeholder = 'YouTube URL または 動画ID';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'vc-screen-apply';
  applyBtn.textContent = '変更';

  row.appendChild(input);
  row.appendChild(applyBtn);

  // 動画を消す（2026-08-06追加・loyさん「一度入れた動画を消す方法」）。
  // 消すとスクリーンの面ごと消える（screen.js の clearVideo）
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'vc-screen-clear';
  clearBtn.textContent = '動画を消す（スクリーンも消える）';

  const error = document.createElement('div');
  error.className = 'vc-screen-error';

  panel.appendChild(current);
  panel.appendChild(desc);
  panel.appendChild(row);
  panel.appendChild(clearBtn);
  panel.appendChild(error);

  (slot || document.body).appendChild(btn);
  document.body.appendChild(panel);

  function openPanel() {
    open = true;
    panel.classList.remove('vc-screen-hidden');
  }

  function closePanel() {
    open = false;
    panel.classList.add('vc-screen-hidden');
    error.textContent = '';
  }

  function togglePanel() {
    if (open) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function applyInput() {
    const videoId = extractVideoId(input.value);
    if (!videoId) {
      error.textContent = 'YouTubeのURLまたは動画ID(11文字)を正しく入力してください。';
      return;
    }
    error.textContent = '';
    onChange(videoId);
    closePanel();
  }

  // 会場全員の画面から映像が消えるので、押し間違いを防ぐために一度聞く
  clearBtn.addEventListener('click', () => {
    if (!window.confirm('スクリーンの動画を消します。会場にいる全員の画面から映像とスクリーンが消えます。よろしいですか？')) return;
    error.textContent = '';
    input.value = '';
    onChange('');
    closePanel();
  });

  btn.addEventListener('click', togglePanel);
  applyBtn.addEventListener('click', applyInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyInput();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      closePanel();
    }
  });

  function setCurrent(videoId) {
    currentId.textContent = videoId || '（動画なし・スクリーン非表示）';
    // 消すものが無いときは押せないようにする
    clearBtn.disabled = !videoId;
    clearBtn.style.opacity = videoId ? '' : '0.45';
    clearBtn.style.cursor = videoId ? '' : 'not-allowed';
  }

  /** 動画の差し替えは管理者だけなので、権限が無い人にはボタンごと出さない */
  function setVisible(v) {
    btn.style.display = v ? '' : 'none';
    if (!v) closePanel();
  }

  return { close: closePanel, setCurrent, setVisible };
}
