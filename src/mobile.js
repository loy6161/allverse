// mobile.js
// スマホ向け操作UI（バーチャルジョイスティック／ピンチズーム／チャット折りたたみ）
// タッチ端末（または ?mobile=1）のときだけ initMobile() が UI を構築する。
// PC(マウスのみ)環境では何もせず { enabled: false } を返す。

const STYLE_ID = 'vc-mobile-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-mobile-joystick-base {
      position: fixed;
      left: 24px;
      bottom: 24px;
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 45%, rgba(0, 255, 234, 0.14), rgba(10, 8, 24, 0.55) 70%);
      border: 1px solid rgba(0, 255, 234, 0.4);
      box-shadow: 0 0 18px rgba(0, 255, 234, 0.25), inset 0 0 20px rgba(255, 0, 229, 0.08);
      touch-action: none;
      z-index: 10;
      user-select: none;
      -webkit-user-select: none;
    }

    .vc-mobile-joystick-knob {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 48px;
      height: 48px;
      margin-left: -24px;
      margin-top: -24px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95), rgba(0, 255, 234, 0.6) 55%, rgba(255, 0, 229, 0.55) 100%);
      box-shadow: 0 0 14px rgba(0, 255, 234, 0.85), 0 0 26px rgba(255, 0, 229, 0.5);
      pointer-events: none;
      will-change: transform;
    }

    .vc-mobile-chat-toggle {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 1px solid rgba(255, 0, 229, 0.5);
      background: linear-gradient(135deg, rgba(0, 255, 234, 0.25), rgba(255, 0, 229, 0.25));
      color: #ffffff;
      font-size: 22px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 11;
      cursor: pointer;
      box-shadow: 0 0 14px rgba(255, 0, 229, 0.35);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }

    .vc-mobile-chat-toggle:active {
      filter: brightness(1.2);
    }

    @media (max-width: 640px) {
      /* join-screen: 縦長パネルを画面内で縦スクロールできるようにする */
      #join-screen {
        align-items: flex-start;
        overflow-y: auto;
        padding: 24px 0;
      }
      .join-panel {
        max-height: none;
      }

      /* chat-root: 画面幅からはみ出さない＆ジョイスティックと重ならない位置に引き上げ */
      #chat-root {
        bottom: 150px;
      }
      .vc-chat-panel {
        width: calc(100vw - 90px);
        max-width: calc(100vw - 90px);
      }
      .vc-chat-log {
        width: 100%;
        height: 150px;
      }

      /* キーボード操作説明は不要／室内情報は小さく */
      #controls-help {
        display: none;
      }
      #room-info {
        padding: 5px 10px;
        gap: 8px;
      }
      #room-name {
        font-size: 14px;
      }
      #player-count {
        font-size: 11px;
      }
    }
  `;
  document.head.appendChild(style);
}

export function initMobile({ controls, chatRoot }) {
  const isTouch =
    'ontouchstart' in window || navigator.maxTouchPoints > 0 || location.search.includes('mobile=1');
  if (!isTouch) return { enabled: false };

  injectStyle();

  // ---------------------------------------------------------------------
  // バーチャルジョイスティック（左下）
  // ---------------------------------------------------------------------
  const base = document.createElement('div');
  base.className = 'vc-mobile-joystick-base';

  const knob = document.createElement('div');
  knob.className = 'vc-mobile-joystick-knob';
  base.appendChild(knob);
  document.body.appendChild(base);

  const KNOB_RANGE = 34; // ノブが動ける最大距離(px)
  let joystickPointerId = null;
  let originX = 0;
  let originY = 0;

  function setKnobOffset(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function resetJoystick() {
    setKnobOffset(0, 0);
    controls.setAnalog(0, 0);
  }
  resetJoystick();

  function updateFromPoint(clientX, clientY) {
    let dx = clientX - originX;
    let dy = clientY - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > KNOB_RANGE) {
      const s = KNOB_RANGE / dist;
      dx *= s;
      dy *= s;
    }
    setKnobOffset(dx, dy);

    const nx = dx / KNOB_RANGE; // -1..1 (右+)
    const ny = dy / KNOB_RANGE; // -1..1 (下+)
    controls.setAnalog(-ny, nx); // 上方向 = fw+1
  }

  base.addEventListener('pointerdown', (e) => {
    if (joystickPointerId !== null) return;
    joystickPointerId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    const rect = base.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    updateFromPoint(e.clientX, e.clientY);
    e.preventDefault();
  });

  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joystickPointerId) return;
    updateFromPoint(e.clientX, e.clientY);
  });

  function endJoystick(e) {
    if (e.pointerId !== joystickPointerId) return;
    joystickPointerId = null;
    resetJoystick();
  }
  base.addEventListener('pointerup', endJoystick);
  base.addEventListener('pointercancel', endJoystick);
  base.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === joystickPointerId) {
      joystickPointerId = null;
      resetJoystick();
    }
  });

  // ---------------------------------------------------------------------
  // ピンチズーム（2本指。ジョイスティック操作中の指は除外）
  // ---------------------------------------------------------------------
  const activePointers = new Map(); // pointerId -> {x, y}
  let pinchPrevDist = null;
  const PINCH_SENS = 0.015;

  function pinchPointerIds() {
    const ids = [];
    activePointers.forEach((_pos, id) => {
      if (id !== joystickPointerId) ids.push(id);
    });
    return ids;
  }

  function distanceBetween(idA, idB) {
    const a = activePointers.get(idA);
    const b = activePointers.get(idB);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  window.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = pinchPointerIds();
    pinchPrevDist = ids.length === 2 ? distanceBetween(ids[0], ids[1]) : null;
  });

  window.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = pinchPointerIds();
    if (ids.length === 2) {
      const dist = distanceBetween(ids[0], ids[1]);
      if (pinchPrevDist !== null) {
        const delta = (pinchPrevDist - dist) * PINCH_SENS;
        if (delta !== 0) controls.zoom(delta);
      }
      pinchPrevDist = dist;
    } else {
      pinchPrevDist = null;
    }
  });

  function releasePointer(e) {
    activePointers.delete(e.pointerId);
    const ids = pinchPointerIds();
    pinchPrevDist = ids.length === 2 ? distanceBetween(ids[0], ids[1]) : null;
  }
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);

  // ---------------------------------------------------------------------
  // チャット折りたたみ（右下トグル）
  // ---------------------------------------------------------------------
  chatRoot.style.display = 'none';

  const chatToggle = document.createElement('button');
  chatToggle.type = 'button';
  chatToggle.className = 'vc-mobile-chat-toggle';
  chatToggle.textContent = '\u{1F4AC}'; // 💬
  document.body.appendChild(chatToggle);

  let chatOpen = false;
  chatToggle.addEventListener('click', () => {
    chatOpen = !chatOpen;
    chatRoot.style.display = chatOpen ? '' : 'none';
    chatToggle.textContent = chatOpen ? '✕' : '\u{1F4AC}'; // ✕ : 💬
  });

  return { enabled: true };
}
