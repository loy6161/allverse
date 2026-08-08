import * as THREE from 'three';

// ============================================================
// スマホVR（二眼モード） — 2026-08-08・loyさん依頼
//
// > 優先順位はスマホVR。なぜならPCVR勢はVRChat会場で見れるから。
// > いままでVRやったことない人にも体験する機会をっていう思いがある。
// > とりあえず移動とかは無くて会場のホール内だけの観覧専用でいいと思う。
// > ボタンで二眼モードに切り替わるだけで。
//
// ★ なぜ WebXR を使わないか
//   スマホのブラウザは **immersive-vr に対応していない**（Google Daydream の終了で
//   Chrome から外れ、iOS Safari は元から非対応）。Cardboard 型のゴーグルで見るには
//   **自前で画面を左右に分けて、ジャイロで首を振る**しかない。
//   PCVR / Quest単体は WebXR が使えるが、今回は対象外（loyさん判断）。
//
// ★ 酔わせない作り
//   ・**動かさない**。立ち位置は二眼にした場所で固定、首振りだけ。
//     VR酔いの主因は「自分は動いていないのに視界が動く」ことなので、移動を作らない
//   ・カメラの高さは目線（1.5m）。三人称の背後カメラは使わない
//
// ⚠ 描画は**両目ぶんで2回**になる。ブルームと自分の姿の小窓は止める（呼ぶ側で対応）。
// ============================================================

const STYLE_ID = 'vc-vr-style';
/** 本人が選んだ「絵の回し方」を覚えておく場所 */
const ROT_KEY = 'vc.vr.rotStep';

/**
 * 二眼の間は**画面のものを全部消す**。
 * ⚠ 既存の「UI非表示(👁)」だけでは消えないもの（📱ボタン・右上バー・動画パネル等）が残る。
 *   レンズ越しには読めないので、視界の隅で光るだけの邪魔物になる
 */
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* ⚠ スクリーンの映像の層（.vc-screen-layer）は**残す**。
   映像はYouTubeのiframeで、キャンバスの穴から透かして見せているため、
   ここを隠すとスクリーンが真っ暗になる（2026-08-08 loyさんの実機で発生） */
body.vc-vr-on > *:not(canvas):not(.vc-vr-hint):not(.vc-screen-layer) { display: none !important; }
body.vc-vr-on { overflow: hidden; background: #000; }
/* ⚠ 縦持ちのまま二眼にすると、細長い絵が2枚並ぶだけで使えない
   （2026-08-08 loyさん「縦画面の状態だと縦で分割しちゃう」）。
   スマホのブラウザは画面の向きを固定できない（iOS Safari は orientation.lock が無い）ので、
   **絵の方を90°回して**横長にする。端末を横に倒せばそのまま正しく見える。

   ⚠⚠ 回す向きは**端末を倒す向きと逆**（右に倒すなら絵は反時計回り）。同じ向きに回すと
   足し算になって**ちょうど180°＝上下さかさま**になる。
   ⚠⚠ **回す角度は JS が直接あてる**。端末の持ち方をこちらで当てにいくのを何度も外したので、
   **その場で上下をひっくり返せる操作（2本指でたたく）**を用意し、選んだ向きを覚える。
   ここ（CSS）で決めるのは置き方だけで、角度は style.transform に入れる */
body.vc-vr-on.vc-vr-rot canvas {
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  transform-origin: 50% 50% !important;
}
body.vc-vr-on canvas { touch-action: none; }
/* 映像の層をまとめた箱も、絵と同じだけ回す（中身の左右の並びは箱の中で決める） */
body.vc-vr-on.vc-vr-rot .vc-vr-stage {
  top: 50%;
  left: 50%;
  transform-origin: 50% 50%;
}
/* 案内も絵と同じだけ回す。⚠ 回さないと、端末を横に倒したときだけ文字が横倒しになる。
   置き場所は**画面の端**（視界のまん中に文字を置かない） */
body.vc-vr-on.vc-vr-rot .vc-vr-hint {
  left: 50% !important;
  right: auto !important;
  bottom: auto !important;
  top: 50% !important;
  display: block !important;
  white-space: nowrap;
  transform-origin: 50% 50%;
}
body.vc-vr-on.vc-vr-rot .vc-vr-hint span:last-child { display: none; }
`;
  document.head.appendChild(style);
}

/** 目の間隔（m）。おとなの平均 */
const EYE_SEP = 0.064;
/** 目線の高さ（m）。アバターの目の高さに合わせてある */
const EYE_HEIGHT = 1.5;

/**
 * 二眼モードを用意する。
 *
 * @param {{
 *   renderer: THREE.WebGLRenderer,
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   getPlayer: ()=>THREE.Object3D|null,
 *   onChange?: (on:boolean)=>void,
 *   onMessage?: (text:string)=>void,
 * }} opts
 */
export function createVrView({
  renderer, scene, camera, getPlayer, screen = null,
  onChange = () => {}, onMessage = () => {},
}) {
  const stereo = new THREE.StereoCamera();
  stereo.eyeSep = EYE_SEP;

  let on = false;
  /** 起動の手続き中（許可ダイアログを待っている間の二重押しを止める） */
  let starting = false;
  let wakeLock = null;
  /** ジャイロから作った姿勢 */
  const orient = new THREE.Quaternion();
  /** 端末の持ち方（度）。0=縦持ち / 90=右に倒す / -90=左に倒す。ジャイロから自分で判定する */
  let holdAngle = 0;
  /** 端末を持ち上げた姿勢（-90°回転）を打ち消すための固定回転 */
  const q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  const zee = new THREE.Vector3(0, 0, 1);
  const euler = new THREE.Euler();
  const q0 = new THREE.Quaternion();
  /** ジャイロの値が1回でも来たか（来ない端末では開始時の向きのまま） */
  let gyroReady = false;
  /** 二眼にした瞬間に向いていた方向（ラジアン・Y軸まわり） */
  let baseYaw = 0;
  /** 開始時の向きへ合わせ込むための回転 */
  const yawFix = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  /** 実際にカメラへ入れる姿勢（作業用） */
  const camQuat = new THREE.Quaternion();
  /** 画面に出す姿勢。揺れを抑えるため、目標へ少しずつ寄せる */
  const shown = new THREE.Quaternion();
  /** 絵を90°回して出しているか（端末の回転ロックが入っているときに使う） */
  let rotated = false;
  /**
   * 本人が足した回転（90°きざみ・0〜3）。2本指でたたくと増える。
   * ⚠ 端末とゴーグルの組み合わせで正しい向きが変わるので、**覚えておく**
   */
  let rotStep = 0;
  try {
    const saved = Number(localStorage.getItem(ROT_KEY));
    if (Number.isFinite(saved)) rotStep = ((saved % 2) + 2) % 2;
  } catch { /* 読めなくても既定でよい */ }
  /** 大きさの取得に使い回す（毎フレームの生成を避ける） */
  const _size = new THREE.Vector2();

  /**
   * 端末をどう持っているか（度）。0=縦持ち / 90・-90=横持ち。
   *
   * ⚠ **OSの「画面の向き」は当てにならない**（2026-08-08・実機で2回外した）。
   *   回転ロックをかけていると、端末を横に倒しても angle は 0 のままだからだ。
   *   さらに、右に倒したか左に倒したかで補正の符号が逆になり、外すと
   *   「左右に首を振っても傾くだけで横を向けない」という症状になる。
   *   → **ジャイロの gamma（左右の傾き）から、実際の持ち方を自分で判定する**。
   *     gamma は端末を右に倒すと +90 に、左に倒すと -90 に近づく
   */
  function holdAngleFromGamma(gammaDeg, betaDeg) {
    // 画面がほぼ真上／真下を向いているときは判定できないので、前の判定を保つ
    if (Math.abs(betaDeg) > 75) return holdAngle;
    if (gammaDeg > 40) return 90; // 右に倒している
    if (gammaDeg < -40) return -90; // 左に倒している
    if (Math.abs(gammaDeg) < 25) return 0; // 縦持ち
    return holdAngle; // どっちつかずの間は変えない（ぱたぱた切り替わらないように）
  }

  /**
   * 画面いっぱいに横長で描くための下ごしらえ。
   * 縦長のビューポートのときは**絵を回す**（端末の向きは固定できないため）。
   */
  /**
   * いま絵を何度回して出すか。
   * ⚠ 端末の持ち方をこちらで当てにいって**2回外している**（loyさん「さかさま」×2）。
   *   自動の推し当ては「たぶんこの向き」までにして、**本人が90°ずつ回せる**ようにした。
   *   選んだぶん（rotStep）は覚えるので、次からは開いた瞬間に正しい向きになる
   */
  function currentRotDeg() {
    // ⚠ 足せるのは**180°だけ**（2026-08-08）。90°ずつ回せるようにしたら、
    //   横長の絵を縦長の画面にそのまま置く角度（0°/180°）が選べてしまい、
    //   画面からはみ出した。**画面に必ず収まる2つ**から選ばせるのが正しい。
    //   ・縦長の画面（絵を回して出す）… 90° か 270°
    //   ・横長の画面（そのまま出す）  … 0° か 180°
    const flip = (rotStep % 2) * 180;
    if (!rotated) return flip;
    // 倒した向きを打ち消す向きが基本（右に倒したなら絵は反時計回り）
    const auto = holdAngle < 0 ? 90 : 270;
    return (auto + flip) % 360;
  }

  /**
   * 絵・映像の層・案内に、同じ回転をあてる。
   *
   * ⚠ 中心合わせに `translate(-50%,-50%)` を使わない（2026-08-08 実測して変更）。
   *   パーセントは**回す前の大きさ**を基準にするので、90°回すと縦横がひっくり返って
   *   中心がずれる（実測: 画面375×812に対して left=-187 / top=-406 まで飛び出した）。
   *   要素の大きさは自分で知っているので、**マージンで半分ずらす**のが確実
   */
  function applyRotation() {
    const deg = currentRotDeg();
    const w = rotated ? window.innerHeight : window.innerWidth;
    const h = rotated ? window.innerWidth : window.innerHeight;
    for (const el of [renderer.domElement, document.querySelector('.vc-vr-stage')]) {
      if (!el) continue;
      el.style.marginLeft = `${-w / 2}px`;
      el.style.marginTop = `${-h / 2}px`;
      el.style.transform = deg ? `rotate(${deg}deg)` : '';
    }
    if (hint) {
      // 案内は視界の下（回したあとの下）へ回り込ませる。
      // 小さな要素なので、こちらは translate のままで実害がない
      hint.style.transform = rotated
        ? `translate(-50%, -50%) rotate(${deg}deg) translateY(${Math.round(h / 2) - 26}px)`
        : '';
    }
  }

  function layout() {
    if (!on) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    rotated = vh > vw;
    document.body.classList.toggle('vc-vr-rot', rotated);
    const w = rotated ? vh : vw;
    const h = rotated ? vw : vh;
    renderer.setSize(w, h);
    camera.aspect = (w / 2) / h; // 片目ぶんの縦横比
    camera.updateProjectionMatrix();
    applyRotation();
  }

  /**
   * ジャイロの角度をカメラの姿勢に直す。
   * ⚠ three の DeviceOrientationControls と同じ式（この変換は自明ではないので写している）。
   *   alpha=方位 / beta=前後の傾き / gamma=左右の傾き、いずれも度。
   */
  function setFromDeviceOrientation(alpha, beta, gamma, orientAngle) {
    euler.set(beta, alpha, -gamma, 'YXZ'); // 端末は Z-X'-Y'' の順
    orient.setFromEuler(euler);
    orient.multiply(q1); // カメラは後ろ向きが基準
    orient.multiply(q0.setFromAxisAngle(zee, -orientAngle)); // 画面の向きぶん戻す
  }

  const deg2rad = (d) => (d || 0) * (Math.PI / 180);

  function onDeviceOrientation(e) {
    if (!on) return;
    // ⚠ PCのChromeでも**値が空のまま**このイベントが飛んでくる（2026-08-08 実測）。
    //   0として扱うと真下を向いてしまうので、値が無いときは何もしない
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    // 持ち方（縦か、右倒しか、左倒しか）をジャイロ自身から決める。
    // ⚠ OSの画面の向きは回転ロックで嘘をつくので使わない
    const nextHold = holdAngleFromGamma(e.gamma || 0, e.beta || 0);
    const heldChanged = nextHold !== holdAngle;
    if (heldChanged) {
      holdAngle = nextHold;
      layout(); // 倒した向きに合わせて、絵の回し方も変える
    }
    // ⚠⚠ 引数の順は **alpha, beta, gamma**。
    //   ここを beta, alpha の順で渡していたため、**左右に首を振っても傾くだけ**という
    //   症状になっていた（2026-08-08・イベントを合成して測って発見。
    //   「首を60°振っても水平角0°、前に30°傾けたら水平角が-30°」で入れ替わりが確定）
    setFromDeviceOrientation(deg2rad(e.alpha), deg2rad(e.beta), deg2rad(e.gamma), deg2rad(holdAngle));
    if (!gyroReady) {
      gyroReady = true;
      recenter();
      shown.copy(camQuat.copy(yawFix).multiply(orient)); // 最初は寄せずに合わせる
    } else if (heldChanged) {
      // ⚠ 持ち方（縦・右倒し・左倒し）が変わると**方位の基準ごと変わる**。
      //   合わせ直さないと、倒し方を変えただけで真後ろを向く
      //   （2026-08-08 実測: 左倒しにすると水平角が180°ずれた）
      recenter();
    }
  }

  /**
   * 正面を今向いている方へ合わせ直す（2026-08-08・loyさん
   * 「時間がたつとジャイロずれてくるから、位置リセット必要かも」）。
   *
   * ⚠ ジャイロの方位は**北が基準**で、しかも磁気や積算の誤差で少しずつずれる。
   *   ここで「いま向いている方向 ＝ 二眼にしたときの正面」に合わせ直す
   */
  function recenter() {
    const gyroYaw = new THREE.Euler().setFromQuaternion(orient, 'YXZ').y;
    yawFix.setFromAxisAngle(up, baseYaw - gyroYaw);
  }

  function onScreenOrientation() {
    layout();
  }

  /**
   * iOS は**ボタンを押した流れの中で**許可を求めないと出せない。
   * @returns {Promise<boolean>} 使えるか
   */
  async function askGyro() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try {
        const res = await D.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return true; // Android など。許可は要らない
  }

  async function keepAwake() {
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 使えなくても見られる */ }
  }

  function releaseAwake() {
    if (wakeLock) {
      try { wakeLock.release(); } catch { /* 失敗しても実害なし */ }
    }
    wakeLock = null;
  }

  /**
   * 操作の案内。
   * ⚠ 絵を90°回して出していることがあるので、案内も**同じだけ回す**。
   *   回さないと、横に倒したときだけ文字が横倒しになる
   */
  let hint = null;
  function showHint() {
    if (hint) return;
    hint = document.createElement('div');
    hint.className = 'vc-vr-hint';
    hint.style.cssText = 'position:fixed;left:0;right:0;bottom:12px;z-index:90;'
      + 'display:flex;justify-content:space-around;pointer-events:none;'
      + 'font-size:11px;color:rgba(255,255,255,0.5);text-align:center;'
      + 'font-family:"Hiragino Kaku Gothic ProN","Yu Gothic UI",sans-serif;';
    const t = 'なぞる＝向き ／ 1回＝正面 ／ 2回＝おわり ／ 2本指＝上下を直す';
    hint.innerHTML = `<span>${t}</span><span>${t}</span>`;
    document.body.appendChild(hint);
    // 数秒で薄くする（ずっと出ていると視界の邪魔）
    setTimeout(() => {
      if (hint) hint.style.opacity = '0.22';
    }, 8000);
  }

  function hideHint() {
    if (hint) hint.remove();
    hint = null;
  }

  /**
   * 画面を触ったときの動き（2026-08-08）。
   *   なぞる       … 正面の向きを変える
   *   1回たたく    … 正面に戻す（ジャイロのずれ直し）
   *   2回たたく    … 二眼をやめる
   *   **2本指でたたく … 絵の向きを90°回す**（合う向きになるまで押す。覚える）
   * ⚠ 終了を長押しにしていたら、指を置いたままで勝手に終わった（実測）ので2回たたく方式に。
   *   逆に終了を難しくしすぎると**ゴーグルに入れたまま戻れない**ので、これ以上は複雑にしない
   */
  /** これ以上動かしたら「なぞった」とみなす（px） */
  const DRAG_PX = 12;
  /** 2回目のタップがこの時間内なら「2回たたいた」とみなす（ミリ秒） */
  const DOUBLE_TAP_MS = 400;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let movedPx = 0;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  /** いま画面に触れている指（2本指を見分けるため） */
  const touching = new Set();

  function onPressStart(e) {
    if (!on) return;
    if (e.pointerId != null) touching.add(e.pointerId);
    // 2本目の指が触れた＝**絵の向きを90°回す**
    if (touching.size === 2) {
      rotStep = (rotStep + 1) % 2; // 上下をひっくり返すだけ（画面から出ないように）
      try {
        localStorage.setItem(ROT_KEY, String(rotStep));
      } catch { /* 覚えられなくても、その場では回る */ }
      applyRotation();
      dragging = true; // このあとの指離しを「たたいた」と数えない
      return;
    }
    dragging = false;
    movedPx = 0;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  /**
   * なぞって正面の向きを変える（2026-08-08・loyさん
   * 「二眼中も画面スワイプで視点は切り替えられた方がいい。
   *  ちょっとスクリーンの位置とずれた方向向いた状態で二眼にした場合、
   *  また戻って位置なおって、ってのは手間すぎるから」）。
   *
   * ⚠ 動かすのは**正面の基準**だけで、首の動き（ジャイロ）はそのまま。
   *   画面を回すのではなく「世界の向きをずらす」ので、酔いは増えない
   * ⚠ 絵を90°回して出しているときは、指の動きも同じだけ回して読む
   *   （横に倒して持っているので、**画面の縦方向**が実際の左右になる）
   */
  function onPressMove(e) {
    if (!on) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    movedPx += Math.abs(dx) + Math.abs(dy);
    if (movedPx < DRAG_PX) return;
    dragging = true;
    // 横に倒して持っているときは、指の上下が世界の左右になる。
    // ⚠ 向きは**絵の回し方に合わせる**（右倒しは絵を反時計回りに回しているので、
    //   画面を下へなぞる＝絵の中では左へ動かすことになる）
    // ⚠ 指の動きは**いま絵を何度回しているか**で読み替える（本人が回した分も含む）
    let along = dx;
    if (rotated) {
      const deg = currentRotDeg();
      if (deg === 90) along = dy;
      else if (deg === 270) along = -dy;
      else if (deg === 180) along = -dx;
    }
    baseYaw -= along * 0.006;
    recenter();
  }

  function onPressEnd(e) {
    if (!on) return;
    if (e && e.pointerId != null) touching.delete(e.pointerId);
    if (dragging) {
      // なぞったあとは「たたいた」数に入れない（続けてたたくと終了してしまう）
      lastTapAt = 0;
      return;
    }
    const x = e && e.clientX != null ? e.clientX : lastX;
    const y = e && e.clientY != null ? e.clientY : lastY;
    // ⚠ 終了は**2回たたく**。長押しにしていたら、指を画面に置いたままのときや
    //   ゴーグルの中で何かが触れ続けたときに**勝手に終わってしまった**
    //   （2026-08-08 実測。pointerdown だけ来て pointerup が来ないと700msで終了していた）
    const now = performance.now();
    // ⚠ **同じあたりを**続けてたたいたときだけ終了にする。位置を見ないと、
    //   離れた場所の操作や取りこぼしたイベントで**勝手に終わる**（2026-08-08 実測）
    const near = Math.hypot(x - lastTapX, y - lastTapY) < 60;
    if (now - lastTapAt < DOUBLE_TAP_MS && near) {
      lastTapAt = 0;
      stop();
      return;
    }
    lastTapAt = now;
    lastTapX = x;
    lastTapY = y;
    recenter(); // 1回たたく＝正面に戻す
  }

  async function start() {
    // ⚠ 許可ダイアログを待っている間に**もう一度押される**ことがある（iOSは待ちが長い）。
    //   `on` を立てるのは待ちのあとなので、ここで別の目印を使って二重起動を止める
    //   （2026-08-08 レビュー指摘）。止めないと wakeLock を取りっぱなしにする等の副作用が出る
    if (on || starting) return;
    starting = true;
    injectStyle();
    let ok = false;
    try {
      ok = await askGyro();
    } finally {
      starting = false;
    }
    if (!ok) {
      onMessage('首振りの許可が取れなかったので、VR表示は使えません（設定 → Safari → モーションとカメラのアクセス）');
      return;
    }
    on = true;

    // ★ 抜け道を**いちばん先に**登録する（2026-08-08 レビュー指摘）。
    //   この下でUIを全部隠すので、途中で何かが失敗して登録前に抜けると
    //   **ゴーグルに入れたまま、タブを閉じる以外に戻れなくなる**
    window.addEventListener('pointerdown', onPressStart);
    window.addEventListener('pointermove', onPressMove);
    window.addEventListener('pointerup', onPressEnd);
    window.addEventListener('pointercancel', onPressEnd);

    // 二眼にした瞬間の向きを覚えておく（ジャイロをここへ合わせ込む）
    gyroReady = false;
    baseYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    yawFix.identity();
    orient.identity();
    shown.identity();
    document.body.classList.add('vc-ui-hidden', 'vc-vr-on');
    layout(); // ⚠ クラスを付けてから。縦長なら絵を90°回す
    window.addEventListener('deviceorientation', onDeviceOrientation);
    window.addEventListener('orientationchange', onScreenOrientation);
    window.addEventListener('resize', onScreenOrientation);
    onChange(true);
    showHint();
    try {
      keepAwake();
      // スクリーンの映像を右目にも出す（DOMは1つしか置けないので、もう1枚 iframe を足す）
      if (screen && screen.setStereo) screen.setStereo(true);
    } catch { /* 映像が出なくても、会場は見られる */ }

    // ⚠ 全画面と向きの固定は**待たない**（2026-08-08 実測して修正）。
    //   環境によっては要求が解決も失敗もせず宙に浮き、await すると
    //   **この下の処理が永久に走らない**（右目の映像がいつまでも作られなかった）。
    //   どちらも「できたら嬉しい」程度のものなので、投げっぱなしにする
    try {
      if (document.documentElement.requestFullscreen) {
        const p = document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* 全画面にならなくても見られる */ }
    try {
      if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
        const p = window.screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* iOS など。横向きは本人に回してもらう */ }
  }

  function stop() {
    if (!on) return;
    on = false;
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    window.removeEventListener('orientationchange', onScreenOrientation);
    window.removeEventListener('resize', onScreenOrientation);
    window.removeEventListener('pointerdown', onPressStart);
    window.removeEventListener('pointermove', onPressMove);
    window.removeEventListener('pointerup', onPressEnd);
    window.removeEventListener('pointercancel', onPressEnd);
    lastTapAt = 0;
    releaseAwake();
    if (screen && screen.setStereo) screen.setStereo(false); // 右目用のiframeを片付ける
    hideHint();
    const player = getPlayer();
    if (player) player.visible = true; // 二眼のあいだ消していた自分の姿を戻す
    rotated = false;
    holdAngle = 0;
    touching.clear();
    // 回して出していたぶんを戻す
    for (const el of [renderer.domElement, document.querySelector('.vc-vr-stage')]) {
      if (!el) continue;
      el.style.transform = '';
      el.style.marginLeft = '';
      el.style.marginTop = '';
    }
    document.body.classList.remove('vc-ui-hidden', 'vc-vr-on', 'vc-vr-rot');
    try {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    } catch { /* 抜けられなくても操作はできる */ }
    // ⚠ 横向きに固定していたら必ず外す（2026-08-08 レビュー指摘）。
    //   全画面を抜けると自動で外れる端末が多いが、外れない実装だと
    //   「二眼をやめたのに横向きのまま」になる
    try {
      if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
        window.screen.orientation.unlock();
      }
    } catch { /* 外せなくても操作はできる */ }
    // 画面いっぱいに戻す（分割と、回して出すために変えた大きさを元へ）
    renderer.setScissorTest(false);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
    onChange(false);
  }

  return {
    isOn: () => on,
    /** 動作確認用の覗き口。ジャイロが届いているか・持ち方をどう判定したかを外から見る */
    debug: () => ({ on, gyroReady, holdAngle, rotated, baseYaw }),
    /**
     * この端末で出すか。
     * ⚠ `window.DeviceOrientationEvent` は**PCのChromeにも存在する**（値が来ないだけ）ので、
     *   それだけでは判定にならない。ゴーグルに入れられる端末＝**指で触れる端末**に絞る。
     *   動作確認用に `?vr=1` を付けるとPCでも出す（二眼の分割と立ち位置はPCでも見られる）
     */
    supported: () => Boolean(window.DeviceOrientationEvent)
      && (navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('vr')),
    start,
    stop,
    toggle() {
      if (on) stop();
      else start();
    },
    /**
     * 二眼で1フレーム描く。呼ぶ側は**ブルームと小窓を止める**こと。
     * ⚠ ここでカメラの位置と向きを決める（controls の三人称カメラは使わない）
     */
    render() {
      const player = getPlayer();
      if (player) {
        camera.position.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
        // ⚠ 目の位置が頭の中なので、**自分の姿は消す**（消さないと髪の内側で画面が埋まる。
        //   2026-08-08 スクショで確認）。他の人の画面からは今までどおり見えている
        player.visible = false;
      }
      // ジャイロが来ていない端末（PCでの動作確認など）では、開始時の向きのまま固定する
      if (gyroReady) {
        camQuat.copy(yawFix).multiply(orient);
        // ⚠ 生の値をそのまま入れると**細かく揺れ続ける**（2026-08-08 loyさん
        //   「なんかゆらゆらする」）。少しずつ寄せて、手ぶれを吸わせる。
        //   寄せを強くしすぎると遅れて見えるので 0.35 にしてある
        shown.slerp(camQuat, 0.35);
        camera.quaternion.copy(shown);
      } else {
        camera.quaternion.setFromAxisAngle(up, baseYaw);
      }
      camera.updateMatrixWorld(true);
      stereo.update(camera);

      const size = _size;
      renderer.getSize(size);
      const w = Math.floor(size.x / 2);
      const h = size.y;
      renderer.setScissorTest(true);

      renderer.setScissor(0, 0, w, h);
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, stereo.cameraL);

      renderer.setScissor(w, 0, w, h);
      renderer.setViewport(w, 0, w, h);
      renderer.render(scene, stereo.cameraR);

      renderer.setScissorTest(false);

      // スクリーンの映像（キャンバスの穴から透ける層）も左右に置き直す
      if (screen && screen.updateStereo) {
        screen.updateStereo(stereo.cameraL, stereo.cameraR, { w: size.x, h, rotated });
      }
    },
  };
}
