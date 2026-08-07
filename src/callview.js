import * as THREE from 'three';

// ============================================================
// ビデオ通話の映像（2026-08-08・loyさん指定）
//
// > ビデオ通話はアバターの顔をリアルタイムで映す通話
//
// ★ なぜこの形か
//   ・**カメラの許可が要らない**（実写を使わない）。この世界の中で完結する
//   ・**通信量がほぼゼロ**。相手のアバターは既に自分の画面に居るので、
//     それを小さなカメラで写すだけ。映像はネットワークに流れない
//   ・⚠ 逆に言うと、**相手が同じ会場に居ないと映らない**（居ないアバターは写せない）。
//     離れた場所同士の通話は、別の仕組み（実映像）が要る。いまは「同じ会場の中」限定
//
// ⚠ 小さな描画をもう1つ増やすので、**160×160**に抑え、**15コマ/秒**に間引く。
//   loyさんの環境はGPUを使わない設定なので、ここをケチらないと本編が重くなる。
// ============================================================

const SIZE = 160;
const FPS = 15;

/**
 * 通話の映像を1つ作る。
 * @param {THREE.Scene} scene 会場のシーン（相手のアバターが居る場所）
 */
export function createCallView(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.cssText = 'width:100%;border-radius:12px;background:#05070f;display:block;'
    + 'border:1px solid rgba(255,255,255,0.18);image-rendering:auto;';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

  /**
   * ⚠ アバターの入れ物そのものは持たない。**毎回ひき直す**。
   *   見た目を変えた人は入れ物ごと作り直されるので、掴んだままだと
   *   壊れた映像が固まって残る（2026-08-08 検証役の指摘）
   */
  let resolve = null;
  let timer = null;
  let onLost = null;
  const head = new THREE.Vector3();

  function draw() {
    const target = resolve ? resolve() : null;
    if (!target || !target.parent) {
      // 相手が退室した／見えなくなった → 回し続けない
      const cb = onLost;
      stop();
      if (cb) cb();
      return;
    }
    // 顔の高さ（アバターの目の高さは約0.79m。身長の倍率も掛かる）
    target.getWorldPosition(head);
    const scale = target.scale.x || 1;
    head.y += 0.79 * scale;
    // 相手の正面（アバターは +Z を向いているので、その向きに合わせて前へ出る）
    const yaw = target.rotation.y;
    // ⚠ 近すぎると髪と顔で画面が埋まる（2026-08-08 スクショで確認）。
    //   1.15m 離して、胸から上が入るように少し引く
    camera.position.set(head.x + Math.sin(yaw) * 1.15, head.y + 0.06, head.z + Math.cos(yaw) * 1.15);
    camera.lookAt(head.x, head.y - 0.06, head.z);
    renderer.render(scene, camera);
  }

  function stop() {
    resolve = null;
    onLost = null;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    canvas,
    /**
     * 誰を映すか。**入れ物ではなく「引いてくる関数」**を渡す。
     * @param {null|(()=>object|null)} getter null で止める
     * @param {object} [o] o.onLost 相手が居なくなったときに呼ぶ
     */
    setTarget(getter, o = {}) {
      stop();
      resolve = typeof getter === 'function' ? getter : null;
      onLost = o.onLost || null;
      if (resolve) {
        timer = setInterval(draw, Math.round(1000 / FPS));
        draw();
      }
    },
    dispose() {
      stop();
      renderer.dispose();
    },
  };
}
