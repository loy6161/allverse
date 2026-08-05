// ============================================================
// fps表示（2026-08-04追加・管理者/VIP用）
//
// loyさん「fpsって管理者用に表示できない？」
//
// 何のために出すか: 本番中に「重い」と言われたとき、**何を切れば戻るか**を
// その場で判断するため。fpsだけ見ても打つ手が決まらないので、
// 一緒に「人数・NPC数・ブルームと反射のON/OFF」も並べる。
//
// ⚠ ここでは重い計算をしない（測る側が重くなったら意味がない）。
//   毎フレームやるのは足し算だけで、画面の書き換えは0.5秒に1回。
// ============================================================

const STYLE_ID = 'vc-fps-style';
const STORE_KEY = 'vc-fps';

/** 画面の書き換え間隔。毎フレーム書き換えると、それ自体が負荷になる */
const REFRESH_MS = 500;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-fps {
  position: fixed;
  left: 12px;
  top: 92px;
  z-index: 30;
  padding: 6px 9px;
  border-radius: 8px;
  background: rgba(6, 8, 20, 0.72);
  border: 1px solid rgba(0, 255, 234, 0.35);
  color: #d8f6ff;
  font: 11px/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
  white-space: pre;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.vc-fps b { color: #7cffdc; font-weight: bold; }
.vc-fps .warn { color: #ffd147; }
.vc-fps .bad { color: #ff8ca0; }
.vc-fps.vc-hidden { display: none; }
/* UI非表示（Hキー）に追従する */
body.vc-ui-hidden .vc-fps { display: none; }
@media (max-width: 640px) {
  .vc-fps { left: 8px; top: 76px; font-size: 10px; }
}
`;
  document.head.appendChild(style);
}

/**
 * 出すかどうかの保存。**既定はOFF**（常に出ていると邪魔なので、見たいときだけ）。
 * 「一度も選んでいない」と「OFFを選んだ」を区別する必要はない（どちらもOFF）。
 */
export function getFpsMeter() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFpsMeter(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}

/**
 * fps表示を作る。
 * @param {{getStats:() => {people:number, npc:number, bloom:boolean, reflect:boolean}}} p
 *   毎回の書き換え時に呼ばれる。重い処理を入れないこと
 */
export function initFpsMeter({ getStats }) {
  injectStyle();

  const box = document.createElement('div');
  box.className = 'vc-fps vc-hidden';
  document.body.appendChild(box);

  let enabled = false;
  let frames = 0;
  let acc = 0; // 経過時間の合計（ms）
  let worst = 0; // その区間でいちばん遅かったフレーム（ms）
  let last = performance.now();

  function paint(fps, avgMs) {
    const s = getStats ? getStats() : {};
    // 60fpsが出ていなくても、30を割らなければ体感は保つ。色で段階を出す
    const cls = fps >= 50 ? '' : fps >= 30 ? 'warn' : 'bad';
    box.innerHTML =
      `<b class="${cls}">${fps.toFixed(0)} fps</b>  ${avgMs.toFixed(1)}ms`
      + ` (最遅 ${worst.toFixed(1)}ms)\n`
      + `人 ${s.people ?? '-'}  NPC ${s.npc ?? '-'}\n`
      + `ブルーム ${s.bloom ? 'ON' : 'OFF'}  反射 ${s.reflect ? 'ON' : 'OFF'}`;
  }

  return {
    /** 毎フレーム呼ぶ。ここでやるのは足し算と、0.5秒に1回の書き換えだけ */
    tick() {
      if (!enabled) return;
      const now = performance.now();
      const ms = now - last;
      last = now;
      frames++;
      acc += ms;
      if (ms > worst) worst = ms;
      if (acc >= REFRESH_MS) {
        paint((frames * 1000) / acc, acc / frames);
        frames = 0;
        acc = 0;
        worst = 0;
      }
    },
    setEnabled(on) {
      enabled = Boolean(on);
      box.classList.toggle('vc-hidden', !enabled);
      if (enabled) {
        // 表示した直後に前回の残りで変な値が出ないよう測り直す
        frames = 0;
        acc = 0;
        worst = 0;
        last = performance.now();
      }
    },
    isEnabled: () => enabled,
  };
}
