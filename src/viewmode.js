// 表示モード: 全画面表示と、UIを隠して映像・空間だけを見るモード
//
// - 右上の「⛶」ボタン（またはFキー）で全画面を切り替える
// - Hキーで画面上のUI（HUD・チャット・各種ボタン）をまとめて隠す/戻す
//   「今はライブ映像だけ見ていたい」という時のため

const STYLE_ID = 'vc-viewmode-style';
const HIDDEN_CLASS = 'vc-ui-hidden';

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
    body.${HIDDEN_CLASS} .vc-mobile-joystick-base,
    body.${HIDDEN_CLASS} .vc-mobile-chat-toggle,
    body.${HIDDEN_CLASS} .vc-view-btn {
      display: none !important;
    }

    /* UI非表示中に出しておく復帰用の小さな案内 */
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

export function initViewMode() {
  injectStyle();

  const btn = document.createElement('button');
  btn.className = 'vc-view-btn';
  btn.type = 'button';
  btn.title = '全画面 (F) ／ UI非表示 (H)';
  btn.textContent = '⛶ 全画面';
  document.body.appendChild(btn);

  // UI非表示中でも戻せるように、小さな復帰ボタンを常設しておく
  const restore = document.createElement('button');
  restore.className = 'vc-view-restore';
  restore.type = 'button';
  restore.textContent = 'UIを表示 (H)';
  document.body.appendChild(restore);

  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  function syncLabel() {
    btn.textContent = isFullscreen() ? '⛶ 全画面を解除' : '⛶ 全画面';
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      // ブラウザが拒否した場合（権限・非対応）は何もしない
    }
    syncLabel();
  }

  function setUIHidden(hidden) {
    document.body.classList.toggle(HIDDEN_CLASS, hidden);
  }

  function toggleUI() {
    setUIHidden(!document.body.classList.contains(HIDDEN_CLASS));
  }

  btn.addEventListener('click', toggleFullscreen);
  restore.addEventListener('click', () => setUIHidden(false));
  document.addEventListener('fullscreenchange', syncLabel);

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (k === 'h') {
      e.preventDefault();
      toggleUI();
    }
  });

  return { toggleFullscreen, setUIHidden, isFullscreen };
}
