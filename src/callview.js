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

  let target = null;
  let timer = null;
  const head = new THREE.Vector3();

  function draw() {
    if (!target) return;
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

  return {
    canvas,
    /** 誰を映すか（アバターの入れ物）。null で止める */
    setTarget(obj) {
      target = obj || null;
      if (target && !timer) timer = setInterval(draw, Math.round(1000 / FPS));
      if (!target && timer) {
        clearInterval(timer);
        timer = null;
      }
      if (target) draw();
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      renderer.dispose();
    },
  };
}
