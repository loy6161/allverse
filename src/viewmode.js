// 表示モード
//
// - 「⛶ スクリーン全画面」ボタン / Fキー … シアターモード。
//   OSの全画面ではなく、**ウィンドウの中でスクリーン（映像）だけを大きく映す**。
//   カメラがスクリーン正面へ回り込み、画面いっぱいに映像が広がる。
//   移動キーを押す、Escを押す、もう一度Fを押すと元の三人称表示に戻る。
// - Hキー … UI（HUD・チャット・各種ボタン）を隠す/戻す
//
// ブラウザ自体を全画面にしたい場合はF11（ブラウザの標準機能）を使う。

const STYLE_ID = 'vc-viewmode-style';
const HIDDEN_CLASS = 'vc-ui-hidden';
const THEATER_CLASS = 'vc-theater';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-view-btn {
      position: fixed;
      top: 104px;
      right: 16px;
      z-index: 10;
      padding: 8px 14px;
      font-size: 13px;
      color: #eee;
      background: rgba(10, 10, 30, 0.6);
      border: 1px solid rgba(255, 176, 92, 0.45);
      border-radius: 8px;
      backdrop-filter: blur(6px);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .vc-view-btn:hover {
      background: rgba(255, 176, 92, 0.22);
      box-shadow: 0 0 10px rgba(255, 176, 92, 0.45);
    }

    /* UI非表示モード: 3D空間とライブ映像だけを残す */
    body.${HIDDEN_CLASS} #hud,
    body.${HIDDEN_CLASS} #chat-root,
    body.${HIDDEN_CLASS} #avatar-btn,
    body.${HIDDEN_CLASS} .vc-emote-bar,
    body.${HIDDEN_CLASS} .vc-screen-btn,
    body.${HIDDEN_CLASS} .vc-screen-panel,
    body.${HIDDEN_CLASS} .vc-pc-bar,
    body.${HIDDEN_CLASS} .vc-mobile-joystick-base,
    body.${HIDDEN_CLASS} .vc-mobile-chat-toggle,
    body.${HIDDEN_CLASS} .vc-view-btn {
      display: none !important;
    }

    /* シアターモード中は、映像の邪魔になるものだけ隠す（音量操作は残す） */
    body.${THEATER_CLASS} .vc-emote-bar,
    body.${THEATER_CLASS} .vc-mobile-joystick-base {
      display: none !important;
    }

    /* UI非表示中・シアター中に出しておく案内 */
    .vc-view-restore {
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 12;
      padding: 6px 12px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.55);
      background: rgba(10, 10, 30, 0.45);
      border-radius: 6px;
      backdrop-filter: blur(4px);
      cursor: pointer;
      font-family: inherit;
      border: none;
      display: none;
    }
    body.${HIDDEN_CLASS} .vc-view-restore { display: block; }

    .vc-theater-hint {
      position: fixed;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 12;
      padding: 6px 14px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.6);
      background: rgba(10, 10, 30, 0.5);
      border-radius: 6px;
      backdrop-filter: blur(4px);
      font-family: inherit;
      pointer-events: none;
      display: none;
    }
    body.${THEATER_CLASS} .vc-theater-hint { display: block; }
    body.${HIDDEN_CLASS} .vc-theater-hint { display: none; }

    @media (max-width: 640px) {
      .vc-view-btn { top: 104px; padding: 6px 10px; font-size: 12px; }
    }
  `;
  document.head.appendChild(style);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// controls: initControls の戻り値（setTheater を持つ）
export function initViewMode({ controls } = {}) {
  injectStyle();

  const btn = document.createElement('button');
  btn.className = 'vc-view-btn';
  btn.type = 'button';
  btn.title = 'スクリーンを画面いっぱいに表示 (F) ／ UI非表示 (H)';
  btn.textContent = '⛶ スクリーン全画面';
  document.body.appendChild(btn);

  const restore = document.createElement('button');
  restore.className = 'vc-view-restore';
  restore.type = 'button';
  restore.textContent = 'UIを表示 (H)';
  document.body.appendChild(restore);

  const hint = document.createElement('div');
  hint.className = 'vc-theater-hint';
  hint.textContent = 'スクリーン全画面中 — 移動キー / Esc / F で戻る';
  document.body.appendChild(hint);

  let theater = false;

  function applyTheater(on) {
    theater = on;
    document.body.classList.toggle(THEATER_CLASS, on);
    btn.textContent = on ? '⛶ 元の視点に戻す' : '⛶ スクリーン全画面';
    if (controls && controls.setTheater) {
      controls.setTheater(on, () => {
        // 移動で自動解除されたときにUI表示も戻す
        theater = false;
        document.body.classList.remove(THEATER_CLASS);
        btn.textContent = '⛶ スクリーン全画面';
      });
    }
  }

  function toggleTheater() {
    applyTheater(!theater);
  }

  function setUIHidden(hidden) {
    document.body.classList.toggle(HIDDEN_CLASS, hidden);
  }

  function toggleUI() {
    setUIHidden(!document.body.classList.contains(HIDDEN_CLASS));
  }

  btn.addEventListener('click', toggleTheater);
  restore.addEventListener('click', () => setUIHidden(false));

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      e.preventDefault();
      toggleTheater();
    } else if (k === 'h') {
      e.preventDefault();
      toggleUI();
    } else if (e.key === 'Escape') {
      if (theater) applyTheater(false);
      if (document.body.classList.contains(HIDDEN_CLASS)) setUIHidden(false);
    }
  });

  return { toggleTheater, setUIHidden, isTheater: () => theater };
}
