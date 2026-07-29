// mobile.js
// スマホ向け操作UI（バーチャルジョイスティック／ピンチズーム／チャットと動画操作の折りたたみ）
//
// 画面の使い方（2026-07-30 指定）:
//   下から  操作キー(左) ＋ チャットアイコン(右) … 一番下の段
//           エモート … チャットアイコンの真上に縦一列（emotebar.js 側で指定）
//   右上から UI非表示 / ネームプレート → アバター変更 → ⚙(動画のコントロール)
// チャットと動画のコントロールは同時に開かない（どちらも横幅いっぱいを使うため）。
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
      flex: 0 0 auto;
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

    /* 動画のコントロールを開く歯車。右上のアバター変更ボタンの真下に置く */
    .vc-m-gear {
      position: fixed;
      top: 95px;
      right: 12px;
      z-index: 13;
      width: 34px;
      height: 34px;
      display: none; /* 出すのは狭い画面のときだけ（下の media query） */
      align-items: center;
      justify-content: center;
      font-size: 15px;
      color: #eee;
      background: rgba(10, 10, 30, 0.6);
      border: 1px solid rgba(255, 176, 92, 0.45);
      border-radius: 9px;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      padding: 0;
      font-family: inherit;
    }
    .vc-m-gear.is-on {
      background: rgba(255, 176, 92, 0.35);
      box-shadow: 0 0 10px rgba(255, 176, 92, 0.6);
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

      /* 一番下の段: 操作キー（左）とチャットアイコン（右） */
      .vc-mobile-joystick-base {
        left: 16px;
        bottom: var(--m-bottom);
      }
      .vc-mobile-chat-toggle {
        right: 16px;
        bottom: var(--m-bottom);
      }

      .vc-m-gear { display: flex; }

      /* チャットログは操作キーより上。開いている間だけ出るので画面を広く使う */
      #chat-root {
        left: 12px;
        bottom: var(--m-panel-bottom);
      }
      .vc-chat-panel {
        width: calc(100vw - 24px);
        max-width: calc(100vw - 24px);
      }
      .vc-chat-log {
        width: 100%;
        height: 130px;
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
  // スマホ用UIが動いていることの印。
  // 「動画パネルを隠して ⚙ から開く」等の切り替えを、この印が付いているときだけに限定する。
  // 画面幅だけで判断すると、PCで窓を細くした人が動画操作に触れなくなってしまう
  document.body.classList.add('vc-mobile');

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
  // チャット（右下）と動画のコントロール（右上の⚙）の開閉
  //
  // どちらも横幅いっぱいを使うので同時には開かない。開いている間は
  // 縦一列のエモートも退避する（CSSの body.vc-m-chat-open / vc-m-video-open で制御）。
  // ---------------------------------------------------------------------
  chatRoot.style.display = 'none';

  const chatToggle = document.createElement('button');
  chatToggle.type = 'button';
  chatToggle.className = 'vc-mobile-chat-toggle';
  chatToggle.title = 'チャット';
  chatToggle.textContent = '\u{1F4AC}'; // 💬
  document.body.appendChild(chatToggle);

  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'vc-m-gear';
  gear.title = '動画のコントロール';
  gear.textContent = '\u2699'; // ⚙
  document.body.appendChild(gear);

  let chatOpen = false;
  let videoOpen = false;

  function apply() {
    chatRoot.style.display = chatOpen ? '' : 'none';
    chatToggle.textContent = chatOpen ? '✕' : '\u{1F4AC}';
    gear.textContent = videoOpen ? '✕' : '\u2699';
    gear.classList.toggle('is-on', videoOpen);
    document.body.classList.toggle('vc-m-chat-open', chatOpen);
    document.body.classList.toggle('vc-m-video-open', videoOpen);
  }
  apply();

  chatToggle.addEventListener('click', () => {
    chatOpen = !chatOpen;
    if (chatOpen) videoOpen = false; // 片方を開いたらもう片方は閉じる
    apply();
  });

  gear.addEventListener('click', () => {
    videoOpen = !videoOpen;
    if (videoOpen) chatOpen = false;
    apply();
  });

  return { enabled: true };
}
