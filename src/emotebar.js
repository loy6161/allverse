// emotebar.js
// VERSE CITY エモートバー
// 画面下部中央に配置する丸いエモートボタン群。クリック/タップ、または数字キー1〜6で
// onEmote(id) を呼び出す。連打防止のため発火後0.5秒はボタンを一時的に無効化する。

const STYLE_ID = 'vc-emotebar-style';

// 左から順に表示するエモート一覧（数字キー1〜6に対応）
const EMOTES = [
  { id: 'wave', emoji: '\u{1F44B}', label: '手をふる' }, // 👋
  { id: 'clap', emoji: '\u{1F44F}', label: '拍手' }, // 👏
  { id: 'jump', emoji: '\u{2934}\u{FE0F}', label: 'ジャンプ' }, // ⤴️
  { id: 'dance', emoji: '\u{1F57A}', label: 'おどる' }, // 🕺
  { id: 'heart', emoji: '\u{1F497}', label: 'ハート' }, // 💗
  { id: 'penlight', emoji: '\u{1F526}', label: 'ペンライト' }, // 🔦
];

const COOLDOWN_MS = 500;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-emote-bar {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(10, 8, 24, 0.55);
      border: 1px solid rgba(0, 255, 234, 0.35);
      border-radius: 999px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 0 18px rgba(255, 0, 229, 0.15), inset 0 0 20px rgba(0, 255, 234, 0.05);
      pointer-events: auto;
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
    }

    .vc-emote-btn {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1px solid rgba(0, 255, 234, 0.4);
      background: rgba(10, 8, 24, 0.6);
      color: #ffffff;
      font-size: 22px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: transform 0.12s ease, box-shadow 0.15s ease, filter 0.15s ease, opacity 0.15s ease,
        border-color 0.15s ease;
    }

    .vc-emote-btn:hover {
      border-color: rgba(255, 0, 229, 0.75);
      box-shadow: 0 0 14px rgba(0, 255, 234, 0.7), 0 0 22px rgba(255, 0, 229, 0.4);
      transform: translateY(-2px);
    }

    .vc-emote-btn:active,
    .vc-emote-btn.vc-emote-fire {
      transform: scale(0.92);
      filter: brightness(1.3);
      box-shadow: 0 0 20px rgba(0, 255, 234, 0.9), 0 0 30px rgba(255, 0, 229, 0.7);
    }

    .vc-emote-btn:disabled {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
      transform: none;
      filter: none;
      box-shadow: none;
    }

    .vc-emote-key {
      position: absolute;
      right: -2px;
      bottom: -2px;
      min-width: 14px;
      font-size: 9px;
      line-height: 14px;
      text-align: center;
      color: #0a0818;
      background: rgba(0, 255, 234, 0.85);
      border-radius: 7px;
      padding: 0 2px;
      pointer-events: none;
    }

    /* 画面が狭いと、下の段（チャット320 + エモート368 + 動画360 ＋ 余白）が
       横に並びきらず重なる（2026-08-03 loyさん指摘）。
       必要なのは約1096px。それを下回る幅では、エモートを**動画のコントロールの上の段**へ
       逃がし、右寄せにしてチャットからも離す。
       スマホ（640px以下）は別の積み方（--m-* 変数）なので対象外にする */
    @media (min-width: 641px) and (max-width: 1180px) {
      .vc-emote-bar {
        left: auto;
        right: 16px;
        /* 動画のコントロール（高さ約72）＋余白のぶん持ち上げる */
        bottom: 104px;
        transform: none;
      }
    }

    @media (max-width: 640px) {
      /* スマホは右下のチャットアイコンの真上から縦一列に伸ばす。
         幅をチャットアイコン(56px)と揃えて、右端で一直線に並ぶようにしている */
      .vc-emote-bar {
        left: auto;
        right: 16px;
        bottom: var(--m-emote-bottom);
        transform: none;
        flex-direction: column;
        gap: 6px;
        padding: 5px; /* 5+44+5+border2 = 56px でチャットアイコンと同じ幅になる */
        border-radius: 999px;
      }
      .vc-emote-btn {
        width: 44px;
        height: 44px;
        font-size: 18px;
      }
      /* チャットや動画コントロールを開いている間は、縦に長いエモートが被るので退避 */
      body.vc-m-chat-open .vc-emote-bar,
      body.vc-m-video-open .vc-emote-bar {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

export function initEmoteBar({ onEmote }) {
  injectStyle();

  let enabled = true;
  let cooling = false;

  const bar = document.createElement('div');
  bar.className = 'vc-emote-bar';

  const buttons = [];

  EMOTES.forEach((emote, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vc-emote-btn';
    btn.title = emote.label;
    btn.setAttribute('aria-label', emote.label);
    btn.textContent = emote.emoji;

    const keyBadge = document.createElement('span');
    keyBadge.className = 'vc-emote-key';
    keyBadge.textContent = String(index + 1);
    btn.appendChild(keyBadge);

    btn.addEventListener('click', () => fire(emote.id, btn));

    bar.appendChild(btn);
    buttons.push(btn);
  });

  document.body.appendChild(bar);

  function fire(id, btn) {
    if (!enabled || cooling) return;
    cooling = true;

    onEmote(id);

    if (btn) {
      btn.classList.add('vc-emote-fire');
      setTimeout(() => btn.classList.remove('vc-emote-fire'), 180);
    }

    buttons.forEach((b) => {
      b.disabled = true;
    });

    setTimeout(() => {
      cooling = false;
      if (enabled) {
        buttons.forEach((b) => {
          b.disabled = false;
        });
      }
    }, COOLDOWN_MS);
  }

  function onKeydown(e) {
    if (isTypingTarget(document.activeElement)) return;
    const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (idx === -1) return;
    fire(EMOTES[idx].id, buttons[idx]);
  }
  window.addEventListener('keydown', onKeydown);

  function setEnabled(value) {
    enabled = !!value;
    bar.style.display = enabled ? '' : 'none';
    if (!cooling) {
      buttons.forEach((b) => {
        b.disabled = !enabled;
      });
    }
  }

  function destroy() {
    window.removeEventListener('keydown', onKeydown);
    bar.remove();
  }

  return { setEnabled, destroy };
}
