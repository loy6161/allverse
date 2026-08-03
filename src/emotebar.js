// emotebar.js
// VERSE CITY エモートバー
// 画面下部中央に配置する丸いエモートボタン群。クリック/タップ、または数字キー1〜6で
// onEmote(id) を呼び出す。連打防止のため発火後0.5秒はボタンを一時的に無効化する。

import { getEmoteLayout, getEmoteOrder, setEmoteOrder } from './emoteprefs.js';

const STYLE_ID = 'vc-emotebar-style';

// エモートは2ページ。数字キー1〜6は「いま開いているページ」に対応する。
// 2ページ目＝スペシャルエモート（2026-08-03 loyさん指示で追加）。
// ⚠ 12個を1列に並べる案は採らなかった。横に長くなって画面を圧迫するうえ、
//   数字キーが1〜6で足りなくなる（7〜9,0を割り当てても覚えられない）。
const EMOTE_PAGES = [
  [
    { id: 'wave', emoji: '\u{1F44B}', label: '手をふる' }, // 👋
    { id: 'clap', emoji: '\u{1F44F}', label: '拍手' }, // 👏
    { id: 'jump', emoji: '\u{2934}\u{FE0F}', label: 'ジャンプ' }, // ⤴️
    { id: 'dance', emoji: '\u{1F57A}', label: 'おどる' }, // 🕺
    { id: 'heart', emoji: '\u{1F497}', label: 'ハート' }, // 💗
    { id: 'penlight', emoji: '\u{1F526}', label: 'ペンライト' }, // 🔦
  ],
  [
    { id: 'fist', emoji: '\u{270A}', label: 'コブシを上げる' }, // 
    { id: 'smile', emoji: '\u{1F604}', label: 'ニコニコ' }, // 
    { id: 'headbang', emoji: '\u{1F918}', label: 'ヘッドバンキング' }, // 
    { id: 'star', emoji: '\u{2B50}', label: '星' }, // 
    { id: 'firework', emoji: '\u{1F386}', label: '花火' }, // 
    { id: 'cheers', emoji: '\u{1F37A}', label: '乾杯' }, // 
  ],
];

const COOLDOWN_MS = 500;

// ページ送りボタンの絵柄
const SPECIAL_MARK = '\u{2728}';
const NORMAL_MARK = '\u{1F44B}';

// 並び順の既定（1段目＝ふつう / 2段目＝スペシャル）と、idからの逆引き
const DEFAULT_ORDER = EMOTE_PAGES.flat().map((e) => e.id);
const EMOTE_BY_ID = Object.fromEntries(EMOTE_PAGES.flat().map((e) => [e.id, e]));

// タッチ端末では並べ替えを無効にする（押すのとドラッグの区別が付きにくいため）
const IS_TOUCH =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-emote-bar {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(10, 8, 24, 0.55);
      border: 1px solid rgba(0, 255, 234, 0.35);
      border-radius: 999px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 0 18px rgba(255, 0, 229, 0.15), inset 0 0 20px rgba(0, 255, 234, 0.05);
      pointer-events: auto;
      font-family: "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
    }

    .vc-emote-btn {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1px solid rgba(0, 255, 234, 0.4);
      background: rgba(10, 8, 24, 0.6);
      color: #ffffff;
      font-size: 22px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: transform 0.12s ease, box-shadow 0.15s ease, filter 0.15s ease, opacity 0.15s ease,
        border-color 0.15s ease;
    }

    .vc-emote-btn:hover {
      border-color: rgba(255, 0, 229, 0.75);
      box-shadow: 0 0 14px rgba(0, 255, 234, 0.7), 0 0 22px rgba(255, 0, 229, 0.4);
      transform: translateY(-2px);
    }

    .vc-emote-btn:active,
    .vc-emote-btn.vc-emote-fire {
      transform: scale(0.92);
      filter: brightness(1.3);
      box-shadow: 0 0 20px rgba(0, 255, 234, 0.9), 0 0 30px rgba(255, 0, 229, 0.7);
    }

    .vc-emote-btn:disabled {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
      transform: none;
      filter: none;
      box-shadow: none;
    }

    /* ページ送り。エモート本体と区別が付くよう枠の色を変える */
    .vc-emote-page {
      border-color: rgba(255, 0, 229, 0.6);
      background: rgba(255, 0, 229, 0.14);
    }

    /* 2段表示（2026-08-03追加）。12個を上下に分けて全部出す */
    .vc-emote-bar.vc-emote-rows {
      flex-direction: column;
      gap: 6px;
      border-radius: 26px;
    }
    .vc-emote-row { display: flex; gap: 10px; }
    /* 数字キーが効いている段が分かるようにする */
    .vc-emote-row-active { position: relative; }
    .vc-emote-row-active::before {
      content: '';
      position: absolute; left: -8px; top: 4px; bottom: 4px; width: 3px;
      border-radius: 2px;
      background: rgba(0, 255, 234, 0.8);
    }

    /* 並べ替え中の見え方 */
    .vc-emote-dragging { opacity: 0.4; }
    .vc-emote-dropzone {
      border-color: rgba(255, 0, 229, 0.95) !important;
      box-shadow: 0 0 16px rgba(255, 0, 229, 0.8);
    }

    .vc-emote-key {
      position: absolute;
      right: -2px;
      bottom: -2px;
      min-width: 14px;
      font-size: 9px;
      line-height: 14px;
      text-align: center;
      color: #0a0818;
      background: rgba(0, 255, 234, 0.85);
      border-radius: 7px;
      padding: 0 2px;
      pointer-events: none;
    }

    /* 画面が狭いと、下の段（チャット320 + エモート368 + 動画360 ＋ 余白）が
       横に並びきらず重なる（2026-08-03 loyさん指摘）。
       必要なのは約1096px。それを下回る幅では、エモートを**動画のコントロールの上の段**へ
       逃がし、右寄せにしてチャットからも離す。
       スマホ（640px以下）は別の積み方（--m-* 変数）なので対象外にする */
    @media (min-width: 641px) and (max-width: 1180px) {
      .vc-emote-bar {
        left: auto;
        right: 16px;
        /* 動画のコントロール（高さ約72）＋余白のぶん持ち上げる */
        bottom: 104px;
        transform: none;
      }
    }

    @media (max-width: 640px) {
      /* スマホは右下のチャットアイコンの真上から縦一列に伸ばす。
         幅をチャットアイコン(56px)と揃えて、右端で一直線に並ぶようにしている */
      .vc-emote-bar {
        left: auto;
        right: 16px;
        bottom: var(--m-emote-bottom);
        transform: none;
        flex-direction: column;
        gap: 6px;
        padding: 5px; /* 5+44+5+border2 = 56px でチャットアイコンと同じ幅になる */
        border-radius: 999px;
      }
      .vc-emote-btn {
        width: 44px;
        height: 44px;
        font-size: 18px;
      }
      /* チャットや動画コントロールを開いている間は、縦に長いエモートが被るので退避 */
      body.vc-m-chat-open .vc-emote-bar,
      body.vc-m-video-open .vc-emote-bar {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

export function initEmoteBar({ onEmote }) {
  injectStyle();

  let enabled = true;
  let cooling = false;

  const bar = document.createElement('div');
  bar.className = 'vc-emote-bar';

  const buttons = [];
  /**
   * いま数字キー1〜6が効く段（0＝1段目 / 1＝2段目）。
   * ページ表示では「開いているページ」、2段表示では「キーが効く段」を表す
   */
  let page = 0;
  /** 'page'（6個ずつ・0キーで切替） or 'rows'（12個を2段で全部出す） */
  let layout = getEmoteLayout();
  /** 並び順（全12種のid）。前半6つが1段目、後半6つが2段目 */
  let order = getEmoteOrder(DEFAULT_ORDER);

  // ページを切り替えるボタン。ページ表示のときだけ出す
  const pageBtn = document.createElement('button');
  pageBtn.type = 'button';
  pageBtn.className = 'vc-emote-btn vc-emote-page';
  pageBtn.addEventListener('click', () => {
    page = page === 0 ? 1 : 0;
    render();
  });

  /** 並び順から、その段に並ぶエモートを取り出す */
  function rowOf(i) {
    return order
      .slice(i * 6, i * 6 + 6)
      .map((id) => EMOTE_BY_ID[id])
      .filter(Boolean);
  }

  // ---- ドラッグで入れ替え（2026-08-03追加） ----
  // loyさん「エモートの配置はドラッグで入れ替え出来たらいいね」。
  // ⚠ 掴んだものと落とした先を**入れ替える**（差し込みではない）。
  //   差し込みだと他が全部ずれて、覚えた位置が崩れる
  let dragId = null;

  function makeBtn(emote, keyLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vc-emote-btn';
    btn.title = emote.label;
    btn.dataset.id = emote.id;
    btn.setAttribute('aria-label', emote.label);
    btn.textContent = emote.emoji;

    if (keyLabel) {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'vc-emote-key';
      keyBadge.textContent = keyLabel;
      btn.appendChild(keyBadge);
    }

    btn.addEventListener('click', () => fire(emote.id, btn));

    // 並べ替え。タッチ端末では無効（押すのとドラッグの区別が付きにくいため）
    if (!IS_TOUCH) {
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        dragId = emote.id;
        btn.classList.add('vc-emote-dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      btn.addEventListener('dragend', () => {
        dragId = null;
        btn.classList.remove('vc-emote-dragging');
      });
      btn.addEventListener('dragover', (e) => {
        if (!dragId || dragId === emote.id) return;
        e.preventDefault();
        btn.classList.add('vc-emote-dropzone');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('vc-emote-dropzone'));
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('vc-emote-dropzone');
        if (!dragId || dragId === emote.id) return;
        const a = order.indexOf(dragId);
        const b = order.indexOf(emote.id);
        if (a < 0 || b < 0) return;
        [order[a], order[b]] = [order[b], order[a]];
        setEmoteOrder(order);
        render();
      });
    }

    return btn;
  }

  function render() {
    bar.innerHTML = '';
    buttons.length = 0;
    bar.classList.toggle('vc-emote-rows', layout === 'rows');

    if (layout === 'rows') {
      // 12個を2段で全部出す。数字キーが効く段には印を付ける
      for (let i = 0; i < 2; i++) {
        const row = document.createElement('div');
        row.className = 'vc-emote-row' + (page === i ? ' vc-emote-row-active' : '');
        rowOf(i).forEach((emote, index) => {
          // キーの番号は「いま効く段」にだけ出す（出しっぱなしだと嘘になる）
          const btn = makeBtn(emote, page === i ? String(index + 1) : '');
          row.appendChild(btn);
          buttons.push(btn);
        });
        bar.appendChild(row);
      }
    } else {
      rowOf(page).forEach((emote, index) => {
        const btn = makeBtn(emote, String(index + 1));
        bar.appendChild(btn);
        buttons.push(btn);
      });
      pageBtn.textContent = page === 0 ? SPECIAL_MARK : NORMAL_MARK;
      pageBtn.title = page === 0 ? 'スペシャルエモートへ (0)' : 'ふつうのエモートへ (0)';
      bar.appendChild(pageBtn);
    }

    if (!enabled || cooling) {
      buttons.forEach((b) => {
        b.disabled = true;
      });
    }
  }

  render();
  document.body.appendChild(bar);

  function fire(id, btn) {
    if (!enabled || cooling) return;
    cooling = true;

    onEmote(id);

    if (btn) {
      btn.classList.add('vc-emote-fire');
      setTimeout(() => btn.classList.remove('vc-emote-fire'), 180);
    }

    buttons.forEach((b) => {
      b.disabled = true;
    });

    setTimeout(() => {
      cooling = false;
      if (enabled) {
        buttons.forEach((b) => {
          b.disabled = false;
        });
      }
    }, COOLDOWN_MS);
  }

  function onKeydown(e) {
    if (isTypingTarget(document.activeElement)) return;
    // 0 でページを切り替える（2026-08-03 loyさん指示）。
    // 「エモート操作はNumPadだけで完結したほうが便利」——数字キー1〜6と同じ並びに
    // 0 があるので、テンキーから手を離さずにページを行き来できる
    if (e.key === '0') {
      // ページ表示なら「開くページ」、2段表示なら「数字キーが効く段」を切り替える
      page = page === 0 ? 1 : 0;
      render();
      return;
    }
    const idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (idx === -1) return;
    const list = rowOf(page);
    if (!list[idx]) return;
    fire(list[idx].id, null);
  }
  window.addEventListener('keydown', onKeydown);

  function setEnabled(value) {
    enabled = !!value;
    bar.style.display = enabled ? '' : 'none';
    if (!cooling) {
      buttons.forEach((b) => {
        b.disabled = !enabled;
      });
    }
  }

  function destroy() {
    window.removeEventListener('keydown', onKeydown);
    bar.remove();
  }

  return {
    setEnabled,
    destroy,
    /** ⚙設定で並べ方や並び順を変えたときに呼ぶ（2026-08-03追加） */
    refreshPrefs() {
      layout = getEmoteLayout();
      order = getEmoteOrder(DEFAULT_ORDER);
      render();
    },
  };
}
