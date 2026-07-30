// soundgate.js
// スマホ向け「タップで音を出す」ボタン
//
// なぜ要るか:
//   スマホ・タブレットのブラウザは「音ありの自動再生」を禁止している。
//   音ありで始めようとすると、再生そのものが始まらない
//   （2026-07-31 loyさん報告「スマホだと再生はじまらない。リシンクしても停止のまま」）。
//   消音での自動再生は許されているので、まず消音で流し、音は本人のタップで出す。
//
// なぜ動画パネルのミュートボタンでは足りないか:
//   スマホでは動画パネル自体が右上の ⚙ の中に隠れていて、初見では見つけられない。
//   「音が出ない」と思われて終わるので、画面の目立つ場所に出す。
//
// タップしたときに再生も一緒に投げているのは、消音の自動再生すら弾かれた端末で、
// そのタップ（ユーザー操作）を再生開始のきっかけにするため。

const STYLE_ID = 'vc-soundgate-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-soundgate {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 50%;
      z-index: 14;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 999px;
      border: 1px solid rgba(0, 255, 234, 0.6);
      background: rgba(10, 10, 30, 0.82);
      color: #eafcff;
      font-size: 14px;
      font-weight: bold;
      font-family: inherit;
      cursor: pointer;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 0 24px rgba(0, 255, 234, 0.35);
      animation: vc-soundgate-pulse 2s ease-in-out infinite;
    }
    @keyframes vc-soundgate-pulse {
      0%, 100% { box-shadow: 0 0 18px rgba(0, 255, 234, 0.3); }
      50%      { box-shadow: 0 0 30px rgba(0, 255, 234, 0.6); }
    }
    .vc-soundgate:active { filter: brightness(1.2); }

    /* UI非表示中は出さない */
    body.vc-ui-hidden .vc-soundgate { display: none !important; }
  `;
  document.head.appendChild(style);
}

/**
 * @param {{player: object, onTap?: () => void}} p
 *   player … screen.js の player（unMute / play / onState を使う）
 * @returns {{destroy: () => void}}
 */
export function initSoundGate({ player, onTap }) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-soundgate';
  btn.textContent = '🔇 タップで音を出す';
  document.body.appendChild(btn);

  let done = false;
  function hide() {
    if (done) return;
    done = true;
    btn.remove();
  }

  btn.addEventListener('click', () => {
    // このタップがユーザー操作なので、ここで音を出して再生も投げる。
    // 消音の自動再生すら弾かれていた場合はここで初めて再生が始まる
    player.unMute();
    player.play();
    if (onTap) onTap();
    hide();
  });

  // 本人が動画パネルのミュートボタンで先に音を出したなら、この案内は用済み
  const off = player.onState((s) => {
    if (!done && s.muted === false && s.playing) hide();
  });

  return {
    destroy() {
      if (off) off();
      hide();
    },
  };
}
