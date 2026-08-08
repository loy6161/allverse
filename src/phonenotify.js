// ============================================================
// スマホの通知トースト（2026-08-08・loyさん依頼）
//
// > 送金、フレンド申請、メッセージ、通話などは通知が欲しい。
//
// ★ なぜ noticebar.js を使い回さないか
//   noticebar.js は運営メッセージ用の**1枠だけ**の仕組み（消すまで出したまま）。
//   こちらは「送金・申請・メッセージ・着信」が**同時に複数件届く**ことがあり、
//   かつ**数秒で自動的に消える**必要がある。1枠を使い回すと後から来た通知が
//   前の通知を消してしまうので、別に**積み重ねられる**トーストを用意する。
//
// ★ 押すとその件の画面が開く（loyさん指定）。
//   中身は onClick 任せにして、ここでは「出す・消す・押されたら呼ぶ」だけを持つ。
// ============================================================

const STYLE_ID = 'vc-toast-style';
/** 何もしなくても消えるまでの時間（ms）。長すぎると画面を占領し続ける */
const AUTO_MS = 5200;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* ⚠ スマホ本体(z-index:62)より前面に出す。押しやすいよう右上に積む */
.vc-toast-wrap {
  position: fixed; top: 16px; right: 18px; z-index: 70;
  display: flex; flex-direction: column; gap: 8px;
  width: min(300px, calc(100vw - 32px));
  pointer-events: none;
}
.vc-toast {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border-radius: 12px; cursor: pointer;
  background: rgba(10,12,24,0.92); border: 1px solid rgba(0,255,234,0.5);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 14px rgba(0,255,234,0.15);
  color: #eaf6ff; font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  pointer-events: auto;
  animation: vc-toast-in 0.2s ease-out;
}
.vc-toast:hover { border-color: #00ffea; }
.vc-toast-out { animation: vc-toast-out 0.2s ease-in forwards; }
@keyframes vc-toast-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@keyframes vc-toast-out { from { opacity: 1; } to { opacity: 0; transform: translateX(16px); } }
.vc-toast-ico { flex: 0 0 auto; font-size: 20px; line-height: 1.2; }
.vc-toast-body { flex: 1 1 auto; min-width: 0; }
.vc-toast-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
.vc-toast-text {
  font-size: 11px; line-height: 1.5; color: rgba(220,235,255,0.8);
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
@media (max-width: 640px), (max-height: 480px) {
  .vc-toast-wrap { top: 8px; right: 8px; left: 8px; width: auto; }
}
`;
  document.head.appendChild(style);
}

/**
 * トースト置き場を1つ作る。
 * @returns {{push:(n:{icon?:string,title?:string,text?:string,onClick?:()=>void})=>void}}
 */
export function initPhoneNotify() {
  injectStyle();
  const wrap = document.createElement('div');
  wrap.className = 'vc-toast-wrap';
  document.body.appendChild(wrap);

  return {
    /** 通知を1件出す。数秒で自動的に消える。押すと onClick を呼んで消える */
    push({ icon, title, text, onClick } = {}) {
      const el = document.createElement('div');
      el.className = 'vc-toast';
      const ic = document.createElement('span');
      ic.className = 'vc-toast-ico';
      ic.textContent = icon || '🔔';
      const body = document.createElement('div');
      body.className = 'vc-toast-body';
      const t = document.createElement('div');
      t.className = 'vc-toast-title';
      t.textContent = title || '';
      const tx = document.createElement('div');
      tx.className = 'vc-toast-text';
      tx.textContent = text || '';
      body.append(t, tx);
      el.append(ic, body);
      wrap.appendChild(el);

      let removed = false;
      const remove = () => {
        if (removed) return;
        removed = true;
        clearTimeout(timer);
        el.classList.add('vc-toast-out');
        setTimeout(() => el.remove(), 200);
      };
      el.addEventListener('click', () => {
        if (onClick) onClick();
        remove();
      });
      const timer = setTimeout(remove, AUTO_MS);
    },
  };
}
