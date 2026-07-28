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
    /* シアター表示ボタン: 右下の動画パネル内に置かれる */
    .vc-view-btn {
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
      font-family: inherit;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .vc-view-btn:hover {
      background: rgba(255, 176, 92, 0.25);
      box-shadow: 0 0 8px rgba(255, 176, 92, 0.4);
    }
    .vc-view-btn.is-on {
      background: rgba(255, 176, 92, 0.35);
      box-shadow: 0 0 10px rgba(255, 176, 92, 0.6);
    }

    /* UI表示/非表示アイコン: 画面の一番右上 */
    .vc-ui-toggle {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 13;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      color: #eee;
      background: rgba(10, 10, 30, 0.6);
      border: 1px solid rgba(255, 176, 92, 0.45);
      border-radius: 9px;
      backdrop-filter: blur(6px);
      cursor: pointer;
      padding: 0;
      font-family: inherit;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .vc-ui-toggle:hover {
      background: rgba(255, 176, 92, 0.22);
      box-shadow: 0 0 10px rgba(255, 176, 92, 0.45);
    }

    /* UI非表示モード: 3D空間とライブ映像だけを残す */
    body.${HIDDEN_CLASS} #hud,
    body.${HIDDEN_CLASS} #chat-root,
    body.${HIDDEN_CLASS} #avatar-btn,
    body.${HIDDEN_CLASS} .vc-emote-bar,
    body.${HIDDEN_CLASS} .vc-screen-panel,
    body.${HIDDEN_CLASS} .vc-video-panel,
    body.${HIDDEN_CLASS} .vc-mobile-joystick-base,
    body.${HIDDEN_CLASS} .vc-mobile-chat-toggle {
      display: none !important;
    }

    /* シアターモード中は、映像の邪魔になるものだけ隠す（音量操作は残す） */
    body.${THEATER_CLASS} .vc-emote-bar,
    body.${THEATER_CLASS} .vc-mobile-joystick-base {
      display: none !important;
    }

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
      .vc-ui-toggle { top: 12px; right: 12px; width: 34px; height: 34px; }
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
// slot: 右下の動画パネル内のボタン置き場（あればシアターボタンをそこに入れる）
export function initViewMode({ controls, slot } = {}) {
  injectStyle();

  // シアター表示ボタン（動画関連なので右下の動画パネルに入れる）
  const btn = document.createElement('button');
  btn.className = 'vc-view-btn';
  btn.type = 'button';
  btn.title = 'スクリーンを画面いっぱいに表示 (F)';
  btn.textContent = '⛶';
  (slot || document.body).appendChild(btn);

  // UI表示/非表示アイコン（画面の一番右上）
  const uiToggle = document.createElement('button');
  uiToggle.className = 'vc-ui-toggle';
  uiToggle.type = 'button';
  uiToggle.title = 'UIの表示/非表示 (H)';
  uiToggle.textContent = '👁';
  document.body.appendChild(uiToggle);

  const hint = document.createElement('div');
  hint.className = 'vc-theater-hint';
  hint.textContent = 'スクリーン全画面中 — 移動キー / Esc / F で戻る';
  document.body.appendChild(hint);

  let theater = false;

  function applyTheater(on) {
    theater = on;
    document.body.classList.toggle(THEATER_CLASS, on);
    btn.classList.toggle('is-on', on);
    btn.title = on ? '元の視点に戻す (F)' : 'スクリーンを画面いっぱいに表示 (F)';
    if (controls && controls.setTheater) {
      controls.setTheater(on, () => {
        // 移動で自動解除されたとき
        theater = false;
        document.body.classList.remove(THEATER_CLASS);
        btn.classList.remove('is-on');
        btn.title = 'スクリーンを画面いっぱいに表示 (F)';
      });
    }
  }

  function toggleTheater() {
    applyTheater(!theater);
  }

  function setUIHidden(hidden) {
    document.body.classList.toggle(HIDDEN_CLASS, hidden);
    uiToggle.textContent = hidden ? '🚫' : '👁';
    uiToggle.title = hidden ? 'UIを表示 (H)' : 'UIを隠す (H)';
  }

  function toggleUI() {
    setUIHidden(!document.body.classList.contains(HIDDEN_CLASS));
  }

  btn.addEventListener('click', toggleTheater);
  uiToggle.addEventListener('click', toggleUI);

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
