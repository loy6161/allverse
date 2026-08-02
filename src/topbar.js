// ============================================================
// 右上のツールバー（2026-08-03追加）
//
// なぜ作るか（loyさんの指摘 2026-08-03）:
//   > ヘルプは右上の方がいいかも。右下はあくまで動画のコントローラーだから
//   > それ以外のルームとか参加者ボタンも右上のエリアの方が目的にあってる。
//   > 右上エリアを整理してまとめて。
//
//   これまで ❓ヘルプ / 🚪イベント・ルーム / 👥参加者 は「動画のコントロール」の
//   中に間借りしていた。動画と関係ない機能が動画パネルの中にあるので、
//   置き場所と役割がちぐはぐだった。しかも右下が混み合い、
//   YouTubeチャット枠がボタンを覆って押せなくなる事故も起きた（同日）。
//
// 線引き:
//   右下（動画パネル）… 再生・ミュート・音量・📺スクリーン変更・⛶全画面
//                        ＝**映像に関するものだけ**
//   右上（ここ）      … アバター変更・❓ヘルプ・🚪イベント/ルーム・👥参加者・
//                        🏷ネームプレート・👁UI非表示
//                        ＝**会場と自分に関するもの**
//
// 並び順の考え方:
//   よく押すものを左（＝画面の内側）に置く。右端に行くほど「たまにしか触らない」。
//   表示の切り替え（🏷👁）はいちばん右で、押し間違えても実害がない位置。
// ============================================================

const STYLE_ID = 'vc-topbar-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-topbar {
  position: fixed;
  top: 16px; right: 16px;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 12px;
  background: rgba(10, 10, 30, 0.62);
  border: 1px solid rgba(120, 140, 200, 0.28);
  backdrop-filter: blur(8px);
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
}

/* 仕切り線。「自分と会場」と「表示の切り替え」を視覚的に分ける */
.vc-topbar-sep {
  width: 1px; height: 22px;
  background: rgba(255,255,255,0.18);
  flex: 0 0 auto;
}

/* このバーに入るボタンの共通の見た目。
   各モジュールが自前のclassを持っているので、ここで上書きして揃える */
.vc-topbar button {
  /* 元々 position:fixed で画面の隅に貼り付いていたボタンを取り込むので、
     ここで並びの中に戻す。これが無いとバーの外に飛び出したままになる */
  position: static;
  top: auto; right: auto; bottom: auto; left: auto;
  margin: 0;
  width: 34px; height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.06);
  color: #eaf6ff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  flex: 0 0 auto;
}
.vc-topbar button:hover {
  border-color: rgba(0,255,234,0.6);
  background: rgba(0,255,234,0.12);
}
/* 押されている状態（パネルを開いている等）は各モジュールが is-on を付ける */
.vc-topbar button.is-on {
  border-color: rgba(0,255,234,0.85);
  background: rgba(0,255,234,0.2);
}

/* アバター変更だけは文字ボタンなので幅を広げる。
   ⚠ #avatar-btn は style.css で ID指定 の position:fixed / top / right を持っている。
   クラス+要素の指定ではIDに負けて上書きできず、バーの中に入らずに
   元の位置へ浮いたままになっていた（2026-08-03 loyさん指摘）。
   ここはID込みの指定にして必ず勝たせる */
.vc-topbar #avatar-btn,
.vc-topbar .vc-topbar-wide {
  position: static;
  top: auto; right: auto; bottom: auto; left: auto;
  margin: 0;
  width: auto;
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
  flex: 0 0 auto;
}

/* UI非表示（Hキー）に追従する。
   ⚠ 表示トグル自身は消さない。消すと戻す手段が無くなる（viewmode.js 側で制御） */
body.vc-ui-hidden .vc-topbar { display: none; }

@media (max-width: 640px) {
  .vc-topbar {
    top: 10px; right: 10px;
    gap: 6px;
    padding: 5px 6px;
    /* 画面幅に入りきらないときは折り返す。突き抜けさせない */
    flex-wrap: wrap;
    max-width: calc(100vw - 20px);
    justify-content: flex-end;
  }
  .vc-topbar button { width: 32px; height: 32px; font-size: 14px; }
  .vc-topbar .vc-topbar-wide { padding: 0 9px; font-size: 11px; }
}
`;
  document.head.appendChild(style);
}

/**
 * 右上のツールバーを作る。
 *
 * 使い方: 各モジュールには `slot` を渡す。渡された側は
 * `slot.appendChild(btn)` するだけでよい（動画パネルの slot と同じ作法）。
 *
 * @returns {{root:HTMLElement, slot:HTMLElement, addTail:(el:HTMLElement)=>void}}
 */
export function initTopBar() {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'vc-topbar';

  // 会場と自分に関するボタンが入る場所（アバター変更・ヘルプ・ルーム・参加者）
  const slot = document.createElement('div');
  slot.style.display = 'flex';
  slot.style.alignItems = 'center';
  slot.style.gap = '8px';

  const sep = document.createElement('div');
  sep.className = 'vc-topbar-sep';

  // 表示の切り替え（🏷👁）が入る場所。仕切り線の右側
  const tail = document.createElement('div');
  tail.style.display = 'flex';
  tail.style.alignItems = 'center';
  tail.style.gap = '8px';

  root.append(slot, sep, tail);
  document.body.appendChild(root);

  return {
    root,
    slot,
    /** 表示の切り替え系をいちばん右に置く */
    addTail(el) {
      tail.appendChild(el);
    },
  };
}
