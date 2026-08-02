// ============================================================
// 運営メッセージの固定枠（2026-08-02追加）
//
// なぜチャットと分けるのか:
//   「転換中です」「音声トラブルです」のような案内をチャットに流すと、
//   他の発言に押し流されて見逃される。会場のUIに専用の枠を持たせて、
//   運営が消すまで出したままにできるようにする。
//
// 3段階にしているのは、緊急度で見え方を変えるため:
//   info      … ふつうの案内（開演予定・出演者の紹介など）
//   important … 目立たせたいもの（音声トラブル・再読み込みのお願い）
//   emergency … 画面上部に固定して、UI非表示中でも出す（中止・避難の案内）
//
// 表示のもとになるデータはイベントに乗っている（サーバーが全員に配る）ので、
// 途中で変えれば会場にいる全員の画面がその場で変わる。
// ============================================================

const STYLE_ID = 'vc-notice-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-notice {
  position: fixed;
  left: 50%; transform: translateX(-50%);
  /* 2026-08-03: top:56px だと左上の操作ヒント（#controls-help）と重なり、
     運営メッセージがヒントの上に乗って両方読めなくなっていた
     （loyさん「運営コメントの位置も調整した方がいいね」）。
     ヒントの下端（16 + ルーム名の高さ + 8 + ヒント）より下へ逃がす。
     右上のツールバー（top:16, 高さ48）とも干渉しない高さ */
  top: 84px;
  width: min(680px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 9px 14px;
  border-radius: 10px;
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  font-size: 13px; line-height: 1.6;
  z-index: 45;
  display: flex; align-items: flex-start; gap: 9px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.45);
  /* 会場を見る邪魔をしないよう、枠自体はクリックを通す */
  pointer-events: none;
}
.vc-notice-hidden { display: none; }

.vc-notice-mark { flex: 0 0 auto; font-size: 15px; line-height: 1.4; }
.vc-notice-text { flex: 1 1 auto; white-space: pre-wrap; word-break: break-word; }

/* info … 落ち着いた青緑。ふだんの案内 */
.vc-notice-info {
  background: rgba(8,26,34,0.94);
  border: 1px solid rgba(0,255,234,0.45);
  color: #dff6ff;
}
/* important … 黄色。読み飛ばしてほしくないもの */
.vc-notice-important {
  background: rgba(46,34,4,0.95);
  border: 1px solid rgba(255,205,60,0.75);
  color: #ffeab0;
  font-weight: bold;
}
/* emergency … 赤。画面の一番上に置き、UI非表示中でも消さない */
.vc-notice-emergency {
  top: 0;
  width: 100vw; max-width: none;
  border-radius: 0;
  background: rgba(120,10,30,0.97);
  border: none;
  border-bottom: 1px solid rgba(255,120,140,0.8);
  color: #fff;
  font-weight: bold;
}

@media (max-width: 640px) {
  .vc-notice { top: 48px; width: calc(100vw - 16px); font-size: 12px; padding: 8px 11px; }
  .vc-notice-emergency { top: 0; width: 100vw; }
}

/* UI非表示（Hキー）に追従する。ただし緊急だけは消さない
   ——中止や避難の案内を「UIを消していたから見えなかった」で済ませないため */
body.vc-ui-hidden .vc-notice { display: none; }
body.vc-ui-hidden .vc-notice.vc-notice-emergency { display: flex; }
`;
  document.head.appendChild(style);
}

const MARKS = { info: '📢', important: '⚠️', emergency: '🚨' };

/**
 * 固定枠を1つ作る。中身はイベント設定から流し込む。
 * @returns {{set:(notice:{level:string,text:string}|null)=>void, current:()=>object|null}}
 */
export function initNoticeBar() {
  injectStyle();

  const el = document.createElement('div');
  el.className = 'vc-notice vc-notice-hidden';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const mark = document.createElement('span');
  mark.className = 'vc-notice-mark';
  const text = document.createElement('div');
  text.className = 'vc-notice-text';
  el.append(mark, text);
  document.body.appendChild(el);

  let current = null;

  function render() {
    // UI非表示との兼ね合いはCSS側で決めている（緊急だけ残す）
    el.className =
      'vc-notice' +
      (current ? '' : ' vc-notice-hidden') +
      (current ? ` vc-notice-${current.level}` : '');
    if (current) {
      mark.textContent = MARKS[current.level] || '📢';
      text.textContent = current.text;
      placeBelowHud();
    }
  }

  /**
   * 左上のHUD（会場名＋操作ヒント）の下に置く（2026-08-03追加）。
   *
   * 固定値で 56px → 84px と下げてみたが、操作ヒントは画面の幅で折り返して
   * 高さが変わるため、どの値にしても重なる幅が必ず出てくる。
   * ヒントの実際の下端を測って、その下に置くのが確実。
   */
  function placeBelowHud() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const b = hud.getBoundingClientRect().bottom;
    // HUDが隠れている（UI非表示中の緊急メッセージ等）ときは画面上部へ戻す
    el.style.top = `${Math.max(16, Math.round(b) + 10)}px`;
  }

  // 幅が変わるとヒントの折り返しも変わるので、置き直す
  window.addEventListener('resize', () => {
    if (current) placeBelowHud();
  });

  return {
    /** null を渡すと消える */
    set(notice) {
      const lv = notice && MARKS[notice.level] ? notice.level : '';
      const tx = notice && typeof notice.text === 'string' ? notice.text.trim() : '';
      current = lv && tx ? { level: lv, text: tx } : null;
      render();
    },
    /** いま出ているか（テストと動作確認用） */
    current: () => (current ? { ...current } : null),
  };
}
