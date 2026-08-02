// ============================================================
// ウィンドウを掴んで動かす・大きさを変える（2026-08-03追加）
//
// loyさんの要望:
//   > チャットウインドウをドラッグで移動と、リサイズも自由にできた方がいいね。
//   > 位置移動は各ウインドウできた方がいいのかも。
//
// なぜ要るか:
//   会場のチャット・YouTubeチャット・各種パネルは画面の隅に固定で置いてあり、
//   映像や他のUIと重なったときに逃がす手段が無かった。
//   実際「チャットがコントローラーと少しかぶってる」という指摘が出ている。
//   置き場所をこちらが決め切るより、本人が動かせる方が確実。
//
// 方針:
//   ・**位置と大きさは端末に保存**する。次に来たときも同じ配置で始まる
//     （NPCのスライダーと同じ考え方）
//   ・**画面の外に出さない**。出すと二度と掴めなくなる。
//     ウィンドウの幅が変わったときも画面内へ引き戻す
//   ・**スマホでは無効**。狭い画面で小さな窓を動かすのは操作として現実的でなく、
//     既に `--m-*` 変数で積み方を決めてある。触ると両方壊れる
//   ・掴む場所（ハンドル）は上部の帯。**帯以外を掴んでもドラッグしない**
//     （チャットの文字を選択できなくなるため）
// ============================================================

const STYLE_ID = 'vc-float-style';
const STORE_PREFIX = 'vc.win.';

/** これより狭い画面では移動・リサイズを無効にする（スマホ想定） */
const MIN_SCREEN_W = 700;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-float-head {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  border-radius: 10px 10px 0 0;
  background: rgba(255,255,255,0.07);
  border-bottom: 1px solid rgba(255,255,255,0.12);
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(220,235,255,0.75);
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  cursor: move;
  user-select: none;
  flex: 0 0 auto;
}
.vc-float-head-title { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-float-head-grip { opacity: 0.5; font-size: 12px; }

/* 掴んでいる間は、下の3D空間がドラッグ回転しないようにする */
body.vc-float-dragging { cursor: move; user-select: none; }
body.vc-float-dragging canvas { pointer-events: none; }

/* 右下のつまみ。ここだけで大きさを変える */
.vc-float-resize {
  position: absolute;
  right: 0; bottom: 0;
  width: 18px; height: 18px;
  cursor: nwse-resize;
  z-index: 2;
  background:
    linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.35) 60%, transparent 60%,
    transparent 70%, rgba(255,255,255,0.35) 70%, rgba(255,255,255,0.35) 80%, transparent 80%);
  border-bottom-right-radius: 10px;
}

/* 元の位置に戻すボタン（ヘッダー内） */
.vc-float-reset,
.vc-float-fold {
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.06);
  color: #dfeaff;
  border-radius: 6px;
  font-size: 10px;
  padding: 2px 7px;
  cursor: pointer;
  flex: 0 0 auto;
}
.vc-float-reset:hover,
.vc-float-fold:hover { background: rgba(255,255,255,0.18); }

/* 折りたたみ中は帯だけ残す。
   YouTubeチャットを開いているときは会場のチャットが要らなくなるので、
   閉じずに畳んでおけるようにした（2026-08-03 loyさん要望） */
.vc-float-folded > *:not(.vc-float-head) { display: none !important; }
.vc-float-folded {
  height: auto !important;
  min-height: 0 !important;
  resize: none;
}

@media (max-width: 700px) {
  /* スマホでは掴む帯もつまみも出さない（動かせないので出すと嘘になる） */
  .vc-float-head, .vc-float-resize { display: none !important; }
}
`;
  document.head.appendChild(style);
}

function loadSaved(key) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

function save(key, v) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(v));
  } catch {
    /* 保存できなくても動作は続ける（プライベートモード等） */
  }
}

function clearSaved(key) {
  try {
    localStorage.removeItem(STORE_PREFIX + key);
  } catch {
    /* noop */
  }
}

export function isFloatEnabled() {
  return window.innerWidth >= MIN_SCREEN_W;
}

/**
 * 要素をドラッグで動かせるようにする。必要ならリサイズも。
 *
 * @param {HTMLElement} el 対象（position:fixed であること）
 * @param {Object} p
 * @param {string} p.key 保存に使う名前（ウィンドウごとに一意）
 * @param {string} p.title 掴む帯に出す名前
 * @param {boolean} [p.resizable=true] 大きさも変えられるようにするか
 * @param {number} [p.minW=220] 最小の幅
 * @param {number} [p.minH=140] 最小の高さ
 * @param {(size:{w:number,h:number})=>void} [p.onResize] 大きさが変わったとき
 * @returns {{reset:()=>void, head:HTMLElement}}
 */
export function makeFloating(el, { key, title, resizable = true, minW = 220, minH = 140, onResize } = {}) {
  injectStyle();

  // 掴む帯。既に自前のヘッダーを持っているウィンドウもあるが、
  // 「どこを掴めばいいか」を統一したいので、専用の帯を必ず先頭に足す
  const head = document.createElement('div');
  head.className = 'vc-float-head';
  const titleEl = document.createElement('span');
  titleEl.className = 'vc-float-head-title';
  titleEl.textContent = title || '';
  const grip = document.createElement('span');
  grip.className = 'vc-float-head-grip';
  grip.textContent = '⠿';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'vc-float-reset';
  resetBtn.textContent = '位置を戻す';

  // 折りたたみ（2026-08-03追加）。
  // loyさん「ブラウザのチャットはYouTubeのチャット開いたら要らなくなるので
  // 折りたたむか閉じるかできたらいいかもね」。
  // **閉じる**ではなく**畳む**にしたのは、閉じると開き直す入口が要るため。
  // 帯だけ残しておけば、そのまま押して戻せる
  const foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'vc-float-fold';
  foldBtn.textContent = '畳む';

  head.append(grip, titleEl, foldBtn, resetBtn);
  el.insertBefore(head, el.firstChild);

  // 大きさを変えるつまみ
  let grabber = null;
  if (resizable) {
    grabber = document.createElement('div');
    grabber.className = 'vc-float-resize';
    el.appendChild(grabber);
  }

  // 位置を left/top で持つため、いまの見た目の位置を測って固定に置き換える。
  // right/bottom 指定のままだと、動かしたときに伸び縮みして落ち着かない
  let applied = false;
  function toAbsolute() {
    if (applied) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.round(r.left)}px`;
    el.style.top = `${Math.round(r.top)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    applied = true;
  }

  /** 画面の外に出さない。出すと掴めなくなって詰む */
  function clamp() {
    // ⚠ まだ動かされていない（CSSの right/bottom で貼り付いている）ものには手を出さない。
    //   ここで left/top を書き込むと bottom 指定が効かなくなり、
    //   畳んで開いたときに下端がズレる（2026-08-03 実測で発覚）。
    //   CSSで隅に貼り付いている間は、そもそも画面外に出ることがない
    if (!applied) return;
    const r = el.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - r.width);
    const maxTop = Math.max(0, window.innerHeight - r.height);
    const left = Math.min(Math.max(0, parseFloat(el.style.left) || r.left), maxLeft);
    const top = Math.min(Math.max(0, parseFloat(el.style.top) || r.top), maxTop);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function persist() {
    const r = el.getBoundingClientRect();
    const prev = loadSaved(key) || {};
    save(key, {
      left: Math.round(r.left),
      top: Math.round(r.top),
      w: Math.round(r.width),
      // 畳んでいる間の高さは「帯だけ」の高さなので保存しない。
      // 保存すると、開き直したときに帯の高さのままになる
      h: folded ? prev.h : Math.round(r.height),
      folded,
    });
  }

  /** 保存してあった配置を戻す */
  function restore() {
    if (!isFloatEnabled()) return;
    const v = loadSaved(key);
    if (!v) return;
    toAbsolute();
    if (Number.isFinite(v.w) && Number.isFinite(v.h)) {
      el.style.width = `${Math.max(minW, v.w)}px`;
      el.style.height = `${Math.max(minH, v.h)}px`;
      if (onResize) onResize({ w: v.w, h: v.h });
    }
    if (Number.isFinite(v.left) && Number.isFinite(v.top)) {
      el.style.left = `${v.left}px`;
      el.style.top = `${v.top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    // 畳んだまま閉じた人は、次も畳んだ状態で始める
    if (v.folded) applyFold(true, { persist: false });
    clamp();
  }

  // ---- ドラッグ ----
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseLeft = 0;
  let baseTop = 0;

  head.addEventListener('pointerdown', (e) => {
    if (!isFloatEnabled()) return;
    // ⚠ 帯の中のボタン（畳む／位置を戻す）を押したときはドラッグを始めない。
    //   ここで preventDefault してしまうと click が発火せず、
    //   **ボタンが反応しなくなる**（2026-08-03「折りたためないね」の原因）。
    //   resetBtn だけを除外していたため foldBtn が押せなかった。
    //   個別に列挙すると足すたびに漏れるので、帯の中のボタン全部を対象にする
    if (e.target instanceof Element && e.target.closest('button')) return;
    toAbsolute();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const r = el.getBoundingClientRect();
    baseLeft = r.left;
    baseTop = r.top;
    document.body.classList.add('vc-float-dragging');
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    el.style.left = `${Math.round(baseLeft + (e.clientX - startX))}px`;
    el.style.top = `${Math.round(baseTop + (e.clientY - startY))}px`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('vc-float-dragging');
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    clamp();
    persist();
  }
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // ---- リサイズ ----
  if (grabber) {
    let sizing = false;
    let sx = 0;
    let sy = 0;
    let bw = 0;
    let bh = 0;

    grabber.addEventListener('pointerdown', (e) => {
      if (!isFloatEnabled()) return;
      toAbsolute();
      sizing = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      bw = r.width;
      bh = r.height;
      document.body.classList.add('vc-float-dragging');
      grabber.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    grabber.addEventListener('pointermove', (e) => {
      if (!sizing) return;
      const w = Math.max(minW, Math.round(bw + (e.clientX - sx)));
      const h = Math.max(minH, Math.round(bh + (e.clientY - sy)));
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      if (onResize) onResize({ w, h });
    });

    function endSize(e) {
      if (!sizing) return;
      sizing = false;
      document.body.classList.remove('vc-float-dragging');
      try {
        grabber.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      clamp();
      persist();
    }
    grabber.addEventListener('pointerup', endSize);
    grabber.addEventListener('pointercancel', endSize);
  }

  // 画面の大きさが変わったとき、外に出たままにしない
  window.addEventListener('resize', () => {
    if (!applied) return;
    clamp();
  });

  // ---- 折りたたみ ----
  let folded = false;
  /** 畳む前の高さ。戻すときにこれに復帰する */
  let heightBeforeFold = '';

  function applyFold(on, { persist: doPersist = true } = {}) {
    // 畳む前の下端を覚えておく。
    // ⚠ top を固定したまま高さだけ縮めると、帯が元の**上端**に残って
    //   下に大きな空白ができる。チャットは画面の下に置くものなので、
    //   畳んだら「チャット欄の下の位置」に来る方が自然
    //   （2026-08-03 loyさん「チャット欄の下の位置になってくれた方が親切かも」）
    const bottomBefore = el.getBoundingClientRect().bottom;

    folded = Boolean(on);
    if (folded) {
      heightBeforeFold = el.style.height || '';
      el.classList.add('vc-float-folded');
      foldBtn.textContent = '開く';
      foldBtn.title = 'チャットを開く';
    } else {
      el.classList.remove('vc-float-folded');
      if (heightBeforeFold) el.style.height = heightBeforeFold;
      foldBtn.textContent = '畳む';
      foldBtn.title = 'チャットを畳む（帯だけ残ります）';
    }

    // 下端を畳む前と同じ位置に保つ。
    // まだ left/top へ置き換えていない（＝CSSの bottom で貼り付いている）場合は、
    // 何もしなくても下端が保たれるので触らない
    if (applied) {
      const h = el.getBoundingClientRect().height;
      el.style.top = `${Math.round(bottomBefore - h)}px`;
    }

    if (doPersist) {
      const v = loadSaved(key) || {};
      // 畳んだ/開いた後の位置も一緒に残す。
      // ここで位置を保存しないと、次に開いたとき上下がズレる
      const r = el.getBoundingClientRect();
      save(key, {
        ...v,
        folded,
        ...(applied ? { left: Math.round(r.left), top: Math.round(r.top) } : {}),
      });
    }
    clamp();
  }

  foldBtn.addEventListener('click', () => applyFold(!folded));

  function reset() {
    clearSaved(key);
    applyFold(false, { persist: false });
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.width = '';
    el.style.height = '';
    applied = false;
    if (onResize) onResize({ w: 0, h: 0 });
  }
  resetBtn.addEventListener('click', reset);

  restore();

  return { reset, head };
}
