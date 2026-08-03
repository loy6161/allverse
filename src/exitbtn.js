// ============================================================
// 退室ボタン（2026-08-04追加）
//
// テストユーザーの要望（2026-08-03 本番テスト）:
//   > 退室ボタンが欲しい。で、最初のルーム選択画面へ
//
// それまでは**タブを閉じるしか会場から出る方法が無かった**。
// 別のイベントへ移るだけなら 🚪 パネルで済むが、
// 「いったん出て入り直す」（アバターを変える・別の名前で入る等）ができなかった。
//
// ⚠ 出る方法はページの読み込み直しにしてある。
//   ワールドを途中まで作った状態から手で巻き戻すより確実で、
//   同じ理由で キック／入場拒否 も location.reload() を使っている（main.js の showEntryBlocked）。
//   見た目と名前はブラウザに保存してあるので、選び直しにはならない。
// ============================================================

let styled = false;

function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
.vc-exit-btn { color: #ffd9d9; }
.vc-exit-btn:hover { background: rgba(255,120,120,0.18); border-color: rgba(255,120,120,0.5); }
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * 退室ボタンを右上バーに置く。
 *
 * @param {object} p
 * @param {HTMLElement} p.slot 右上バーの置き場所（topBar.slot）
 * @param {() => void} [p.onBeforeExit] 出る直前にやること（接続を切るなど）
 */
export function initExitButton({ slot, onBeforeExit }) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-room-btn vc-exit-btn';
  btn.title = '会場から出る';
  btn.textContent = '🏃退室';

  btn.addEventListener('click', () => {
    // 押し間違いで会場から飛び出すと、ライブの最中だと戻るのに手間がかかる。
    // 「別の部屋へ移りたいだけ」の人は 🚪 で済むので、そちらも案内する
    const okToExit = window.confirm(
      '会場から出て、入場画面に戻ります。\n\n' +
        '（部屋やイベントを移りたいだけなら、🚪 からそのまま移動できます）',
    );
    if (!okToExit) return;
    if (onBeforeExit) {
      try {
        onBeforeExit();
      } catch {
        /* 接続を切れなくても、読み込み直せば結局切れる */
      }
    }
    location.reload();
  });

  slot.appendChild(btn);
  return { element: btn };
}
