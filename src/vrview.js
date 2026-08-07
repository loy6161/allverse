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
body.vc-vr-on > *:not(canvas):not(.vc-vr-hint) { display: none !important; }
body.vc-vr-on { overflow: hidden; background: #000; }
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
export function createVrView({ renderer, scene, camera, getPlayer, onChange = () => {}, onMessage = () => {} }) {
  const stereo = new THREE.StereoCamera();
  stereo.eyeSep = EYE_SEP;

  let on = false;
  let wakeLock = null;
  /** ジャイロから作った姿勢 */
  const orient = new THREE.Quaternion();
  /** 端末の画面の向き（横持ちの補正に使う） */
  let screenAngle = 0;
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
    setFromDeviceOrientation(deg2rad(e.beta), deg2rad(e.alpha), deg2rad(e.gamma), deg2rad(screenAngle));
    if (!gyroReady) {
      gyroReady = true;
      // ⚠ ジャイロの方位は**北が基準**なので、そのまま使うと
      //   「ゴーグルを覗いたらステージが背中側」になりうる。
      //   最初の1回で「二眼にした瞬間に向いていた方向」へ合わせ込む
      const gyroYaw = new THREE.Euler().setFromQuaternion(orient, 'YXZ').y;
      yawFix.setFromAxisAngle(up, baseYaw - gyroYaw);
    }
  }

  function onScreenOrientation() {
    screenAngle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
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

  /** 抜け方の案内。二眼の**両目の下**に出す（片方だけだと目に入らない） */
  let hint = null;
  function showHint() {
    if (hint) return;
    hint = document.createElement('div');
    hint.className = 'vc-vr-hint';
    hint.textContent = '画面をタップすると戻ります';
    hint.style.cssText = 'position:fixed;left:0;right:0;bottom:10px;z-index:90;'
      + 'display:flex;justify-content:space-around;pointer-events:none;'
      + 'font-size:11px;color:rgba(255,255,255,0.55);'
      + 'font-family:"Hiragino Kaku Gothic ProN","Yu Gothic UI",sans-serif;';
    hint.innerHTML = '<span>画面をタップすると戻ります</span><span>画面をタップすると戻ります</span>';
    document.body.appendChild(hint);
    // 数秒で薄くする（ずっと出ていると視界の邪魔）
    setTimeout(() => {
      if (hint) hint.style.opacity = '0.25';
    }, 6000);
  }

  function hideHint() {
    if (hint) hint.remove();
    hint = null;
  }

  function onTapOut() {
    if (on) stop();
  }

  async function start() {
    if (on) return;
    injectStyle();
    const ok = await askGyro();
    if (!ok) {
      onMessage('首振りの許可が取れなかったので、VR表示は使えません（設定 → Safari → モーションとカメラのアクセス）');
      return;
    }
    on = true;
    // 二眼にした瞬間の向きを覚えておく（ジャイロをここへ合わせ込む）
    gyroReady = false;
    baseYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    yawFix.identity();
    orient.identity();
    onScreenOrientation();
    window.addEventListener('deviceorientation', onDeviceOrientation);
    window.addEventListener('orientationchange', onScreenOrientation);
    // 全画面（できる端末だけ）。iOS Safari は全画面にできないので、そのまま続ける
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch { /* 全画面にならなくても見られる */ }
    try {
      if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
        await window.screen.orientation.lock('landscape');
      }
    } catch { /* iOS など。横向きは本人に回してもらう */ }
    keepAwake();
    document.body.classList.add('vc-ui-hidden', 'vc-vr-on');
    showHint();
    // ⚠ 抜け道を必ず残す。ここを塞ぐと**ゴーグルに入れたまま戻れない**
    window.addEventListener('pointerdown', onTapOut);
    onChange(true);
  }

  function stop() {
    if (!on) return;
    on = false;
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    window.removeEventListener('orientationchange', onScreenOrientation);
    window.removeEventListener('pointerdown', onTapOut);
    releaseAwake();
    hideHint();
    const player = getPlayer();
    if (player) player.visible = true; // 二眼のあいだ消していた自分の姿を戻す
    document.body.classList.remove('vc-ui-hidden', 'vc-vr-on');
    try {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    } catch { /* 抜けられなくても操作はできる */ }
    // 画面いっぱいに戻す（分割の設定を残さない）
    renderer.setScissorTest(false);
    const size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setScissor(0, 0, size.x, size.y);
    onChange(false);
  }

  return {
    isOn: () => on,
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
      if (gyroReady) camera.quaternion.copy(camQuat.copy(yawFix).multiply(orient));
      else camera.quaternion.setFromAxisAngle(up, baseYaw);
      camera.updateMatrixWorld(true);
      stereo.update(camera);

      const size = new THREE.Vector2();
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
    },
  };
}
