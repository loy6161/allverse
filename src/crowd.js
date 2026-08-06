// ============================================================
// 群衆（大人数のNPC）— 2026-08-06追加
//
// loyさん「NPCの上限を100000人くらいまでできない？負荷テストしたい」
//
// ★ なぜ別の仕組みが要るのか
//   ふつうのNPC（players.js）は1体が**アバターそのもの**で、
//   メッシュ11個＋ネームプレート1枚＝**1体につき約12回の描画**、517三角形。
//   10万体だと **120万回の描画** になり、どんなGPUでも止まる（CPU描画なら論外）。
//
// ★ やり方: インスタンス描画
//   単純な人型（体＋頭＝12面）を1つ作り、位置と色だけを配列で持って
//   **全員まとめて1回で描く**。10万体でも描画コールは1回。
//   代わりに、名前も吹き出しもエモートも無い（遠くの人影という扱い）。
//
//   近くの何人かはふつうのNPC（players.js）のまま出すので、
//   「近くはちゃんとした人・遠くは人影」という見え方になる。
//
// ⚠ 光の要らない材質（MeshBasicMaterial）で作る。
//   会場にライトを足さない方針と揃える（three のライトはシーン全体に効く）。
// ============================================================

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/** 人影の色（暗い会場でシルエットとして見える程度に散らす） */
const SHIRT_COLORS = [0xdfe6f2, 0xffd9a8, 0xc9e8ff, 0xffc9e8, 0xd6ffd9, 0xfff0b8];

/** 1体ぶんの形（体＋頭）。三角形は12+12=24面ぶん */
function makeFigureGeometry() {
  const body = new THREE.BoxGeometry(0.42, 0.95, 0.28);
  body.translate(0, 0.475, 0);
  const head = new THREE.BoxGeometry(0.34, 0.34, 0.32);
  head.translate(0, 1.12, 0);
  const g = BufferGeometryUtils.mergeGeometries([body, head], false);
  body.dispose();
  head.dispose();
  return g;
}

/**
 * 群衆を作る。
 * @param {THREE.Scene} scene
 * @param {{max?:number}} [opt] max … 用意しておく最大人数（あとから増やせない）
 */
export function createCrowd(scene, { max = 100000 } = {}) {
  const geo = makeFigureGeometry();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0; // 最初は誰も居ない
  // ⚠ 視錐台カリングを切る。中身の位置を自分で動かすので、
  //   three が最初に計算した範囲のままだと、範囲外と判断されて丸ごと消える
  mesh.frustumCulled = false;
  scene.add(mesh);

  // 色は1体ずつ持たせる（InstancedMesh の色は専用の入れ物を使う）
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const _c = new THREE.Color();

  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);

  /** 1体ぶんの居場所と揺れ方。配列で持つ（オブジェクトを10万個作らない） */
  const px = new Float32Array(max);
  const pz = new Float32Array(max);
  const phase = new Float32Array(max);
  const yaw = new Float32Array(max);
  let count = 0;

  /**
   * 人数を合わせる。増やすぶんだけ場所を決める（減らすときは末尾から）。
   * @param {number} n 人数
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds 散らす範囲
   */
  function setCount(n, bounds) {
    const target = Math.max(0, Math.min(max, Math.floor(Number(n) || 0)));
    const b = bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    for (let i = count; i < target; i++) {
      px[i] = b.minX + Math.random() * (b.maxX - b.minX);
      pz[i] = b.minZ + Math.random() * (b.maxZ - b.minZ);
      phase[i] = Math.random() * Math.PI * 2;
      yaw[i] = Math.random() * Math.PI * 2;
      _c.setHex(SHIRT_COLORS[i % SHIRT_COLORS.length]);
      mesh.instanceColor.setXYZ(i, _c.r, _c.g, _c.b);
    }
    count = target;
    mesh.count = target;
    mesh.instanceColor.needsUpdate = true;
    // 位置を1回書き込む（update が呼ばれる前に見えるように）
    writeMatrices(0);
    return count;
  }

  /**
   * 位置を書き込む。
   * ⚠ 10万体ぶんの行列を毎フレーム書き直すと、それだけでCPUが埋まる。
   *   **揺らすのは手前の一部だけ**にして、残りは動かさない（負荷テストの主眼は描画側）。
   */
  const ANIMATE_MAX = 400;
  function writeMatrices(t) {
    const animate = Math.min(count, ANIMATE_MAX);
    for (let i = 0; i < count; i++) {
      const y = i < animate ? Math.abs(Math.sin(t * 1.6 + phase[i])) * 0.06 : 0;
      _pos.set(px[i], y, pz[i]);
      _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw[i]);
      _m.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(i, _m);
      // 揺らさない人はもう書き換えないので、最初の1回で終わり
      if (i >= animate && t > 0) break;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    /** いまの人数 */
    count: () => count,
    setCount,
    /** 毎フレーム呼ぶ（手前のぶんだけ軽く揺らす） */
    update(t) {
      if (count === 0) return;
      writeMatrices(t);
    },
    /** 実験の記録用 */
    debugInfo: () => ({ crowd: count, max, trisPerFigure: 24 }),
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
