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
  /* 位置と幅は placeNotice() が実測して決める（2026-08-03）。
     ここの値は、その計算が走る前の初期値でしかない */
  top: 16px;
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

@media (max-width: 640px), (max-height: 480px) {
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
      placeNotice();
    }
  }

  /**
   * 運営メッセージの置き場所（2026-08-03）。
   *
   * loyさんの指示:
   *   > 運営コメントも一番上にした方がスペース的にバランスいいよ。
   *
   * なので**画面の一番上（top:16px）に置く**。左上の会場名・右上のツールバーと
   * 同じ段に並ぶことになるので、**その2つに届かない幅に抑える**。
   * 幅で抑えずに「HUDの下へ逃がす」方式にすると、上の空きが余ったまま
   * 3段（会場名／ヒント／運営メッセージ）に積み上がって窮屈になる。
   *
   * 画面が狭くて幅を確保できないときだけ、従来どおりHUDの下へ回す。
   */
  function placeNotice() {
    // 緊急は画面幅いっぱいの帯なので、位置の計算に手を出さない
    if (current && current.level === 'emergency') {
      el.style.left = '';
      el.style.width = '';
      el.style.transform = '';
      el.style.top = '';
      return;
    }

    const room = document.getElementById('room-info');
    const bar = document.querySelector('.vc-topbar');
    const leftEnd = room ? room.getBoundingClientRect().right : 0;
    const rightStart = bar ? bar.getBoundingClientRect().left : window.innerWidth;
    const gap = rightStart - leftEnd - 24;

    if (gap >= 260) {
      // 一番上、会場名とツールバーの「間」に置く。
      // ⚠ 画面の中央に寄せると、会場名の枠と1pxだけ重なるようなことが起きる。
      //   空いている範囲の中で中央に置けば、幅がどう変わっても食い込まない
      const w = Math.min(680, Math.floor(gap));
      el.style.top = '16px';
      el.style.width = `${w}px`;
      el.style.left = `${Math.round(leftEnd + 12 + (gap - w) / 2)}px`;
      el.style.transform = 'none';
      return;
    }

    // 幅が足りない（狭い画面）。従来どおり画面中央・HUDの下へ
    // ⚠ 2026-08-08 loyさん実機指摘「横画面の時に運営メッセージでボタンが見えない」。
    //   HUD（左上の会場名）の下にしか逃がしていなかったため、横画面（幅より高さが
    //   小さい端末）では右上のツールバー(.vc-topbar)の方が幅が広く、中央寄せの
    //   お知らせ帯（最大680px）がツールバーの下に潜り込んで見た目上ボタンを覆っていた。
    //   HUDとツールバーの両方より下へ逃がす
    const hud = document.getElementById('hud');
    const hudBottom = hud ? hud.getBoundingClientRect().bottom : 60;
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const b = Math.max(hudBottom, barBottom);
    el.style.top = `${Math.max(16, Math.round(b) + 10)}px`;
    el.style.left = '50%';
    el.style.width = '';
    el.style.transform = 'translateX(-50%)';
  }

  // 幅が変わると左右の空きも変わるので、置き直す
  window.addEventListener('resize', () => {
    if (current) placeNotice();
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
