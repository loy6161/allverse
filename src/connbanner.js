// ============================================================
// 接続が切れていることを画面に出す（2026-08-03追加）
//
// なぜ要るか:
//   本番テスト中、サーバーの再起動で中にいた人のブラウザが切断されたが、
//   **画面は普通に動いて見えるので誰も気づけなかった**。
//   NPCは歩くし自分も動けるので「今日は人が少ないな」としか思えない。
//   実際には吹き出しもチャットも他人の姿も届いていない。
//   気づける手がかりはチャット欄に流れる1行だけで、すぐ上へ流れて消える。
//
//   → 切れている間はずっと出たままにする。流れて消える形にはしない。
//
// 置き場所:
//   画面上部の中央。運営メッセージ（noticebar）と同じ「見逃してはいけない」層。
//   ⚠ UI非表示（Hキー）でも消さない。消すと、隠している間に切れたことに
//     気づけなくなる。緊急の運営メッセージと同じ扱い。
// ============================================================

const STYLE_ID = 'vc-conn-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-conn {
  position: fixed;
  top: 12px; left: 50%;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 24px));
  padding: 10px 18px;
  border-radius: 10px;
  background: rgba(60, 12, 12, 0.94);
  border: 1px solid rgba(255, 90, 90, 0.85);
  color: #ffe9e9;
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  font-size: 13px; line-height: 1.6;
  text-align: center;
  box-shadow: 0 0 24px rgba(255, 60, 60, 0.35);
  /* 運営メッセージ(45)より上。切断は「何も届いていない」状態なので最優先 */
  z-index: 50;
  display: flex; align-items: center; gap: 10px; justify-content: center;
}
.vc-conn-hidden { display: none; }

/* 繋ぎ直し中であることが分かるように、ゆっくり点滅させる */
.vc-conn-dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #ff6b6b;
  animation: vc-conn-blink 1.2s ease-in-out infinite;
  flex: 0 0 auto;
}
@keyframes vc-conn-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.vc-conn-reload {
  border: 1px solid rgba(255,255,255,0.5);
  background: rgba(255,255,255,0.1);
  color: #fff;
  border-radius: 7px;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  flex: 0 0 auto;
}
.vc-conn-reload:hover { background: rgba(255,255,255,0.22); }

@media (max-width: 640px), (max-height: 480px) {
  .vc-conn { font-size: 12px; padding: 8px 12px; top: 8px; }
}
`;
  document.head.appendChild(style);
}

/**
 * @returns {{show:(text:string)=>void, hide:()=>void, isShown:()=>boolean}}
 */
export function initConnBanner() {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'vc-conn vc-conn-hidden';

  const dot = document.createElement('span');
  dot.className = 'vc-conn-dot';

  const text = document.createElement('span');

  // 自動で戻らないとき（サーバーが長時間落ちている等）の逃げ道。
  // 「何もできない」と思わせないために置いておく
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'vc-conn-reload';
  reload.textContent = '再読み込み';
  reload.addEventListener('click', () => location.reload());

  root.append(dot, text, reload);
  document.body.appendChild(root);

  let shown = false;

  return {
    show(message) {
      text.textContent = message || '接続が切れました。繋ぎ直しています…';
      if (!shown) {
        shown = true;
        root.classList.remove('vc-conn-hidden');
      }
    },
    hide() {
      if (!shown) return;
      shown = false;
      root.classList.add('vc-conn-hidden');
    },
    isShown: () => shown,
  };
}
