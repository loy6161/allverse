import * as THREE from 'three';

// ============================================================
// 車（2026-08-08・loyさん依頼「・車」） — **モック**
//
// ★ 作りの方針
//   ・**街は21km²ある。** 歩きだと端まで数十分かかるので、乗り物は移動のためにいる
//   ・アバターは**消さない**。車の枠の中に立たせる（脚は車体で隠れる）。
//     消すと「自分がどこに居るか」が分からなくなるうえ、
//     他の人の画面には座標だけが飛ぶので、消えた人が高速で動いて見える
//   ・**ライトを足さない**（three のライトはシーン全体に効く。CPU描画では全体が重くなる）
//   ・当たり判定は作らない。街に壁が無いので、いまは素通りで困らない
//
// ⚠ 他の人からは「速く歩いている人」に見える（車は各自の画面だけの飾り）。
//   車の位置を配るには通信の契約を増やす必要があるので、モックでは持たない。
// ============================================================

/** 街に置いてある車の位置。会場の西口を出た通り沿い */
export const PARKED = [
  { id: 'car1', x: -40, z: -6, color: 0xff5f6d },
  { id: 'car2', x: -40, z: 6, color: 0x4fd8ff },
  { id: 'car3', x: -56, z: 26, color: 0xffd86b },
];

/** 乗り込める距離（m） */
export const RIDE_RANGE = 3.2;
/** 乗っているときの速さ（歩きの何倍か） */
export const CAR_SPEED = 3.4;

function buildCar(color) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: true });
  const add = (geo, m, pos) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    g.add(mesh);
    return mesh;
  };
  // 車体（前後に長い箱）。アバターは真ん中に立つので、そこだけ空けておく
  add(new THREE.BoxGeometry(1.9, 0.5, 1.4), mat(color), [0, 0.35, 1.1]); // 前
  add(new THREE.BoxGeometry(1.9, 0.5, 1.2), mat(color), [0, 0.35, -1.2]); // 後ろ
  add(new THREE.BoxGeometry(0.25, 0.9, 2.6), mat(color), [-0.85, 0.55, 0]); // 左のドア
  add(new THREE.BoxGeometry(0.25, 0.9, 2.6), mat(color), [0.85, 0.55, 0]); // 右のドア
  add(new THREE.BoxGeometry(1.5, 0.06, 1.2), mat(0x11131c), [0, 0.12, 0]); // 床
  // 窓（前）
  add(new THREE.BoxGeometry(1.5, 0.5, 0.08), mat(0x9fd8ff), [0, 0.85, 1.75]);
  // タイヤ
  for (const [tx, tz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), mat(0x14161f), [tx, 0.34, tz]);
    w.rotation.z = Math.PI / 2;
  }
  // ライト
  add(new THREE.BoxGeometry(0.4, 0.14, 0.08), mat(0xfff3c4), [-0.6, 0.5, 1.82]);
  add(new THREE.BoxGeometry(0.4, 0.14, 0.08), mat(0xfff3c4), [0.6, 0.5, 1.82]);
  add(new THREE.BoxGeometry(0.4, 0.12, 0.08), mat(0xff5f6d), [-0.6, 0.5, -1.82]);
  add(new THREE.BoxGeometry(0.4, 0.12, 0.08), mat(0xff5f6d), [0.6, 0.5, -1.82]);
  return g;
}

/**
 * 街に車を置く。
 * @returns {{ spots:object[], pickables:THREE.Object3D[], ride:(id:string)=>void,
 *   getOff:()=>void, ridingId:()=>string, update:(player:THREE.Object3D)=>void, dispose:()=>void }}
 */
export function createCars(scene) {
  const root = new THREE.Group();
  root.name = 'cars';
  scene.add(root);

  const cars = new Map();
  const pickables = [];
  const spots = [];

  for (const p of PARKED) {
    const g = buildCar(p.color);
    g.position.set(p.x, 0, p.z);
    root.add(g);
    cars.set(p.id, g);
    const spot = { id: p.id, label: '車', kind: 'car', x: p.x, z: p.z };
    spots.push(spot);
    g.traverse((o) => {
      if (o.isMesh) {
        o.userData.car = spot;
        pickables.push(o);
      }
    });
  }

  let riding = '';

  return {
    spots,
    pickables,
    ridingId: () => riding,
    ride(id) {
      if (cars.has(id)) riding = id;
    },
    getOff() {
      // ⚠ 降りた場所に車を置き直す。**乗り込み判定は spots を見ている**ので、
      //   ここを更新しないと「目の前に車があるのに乗れない」ことになる
      //   （2026-08-08 実測して気づいた）
      const g = cars.get(riding);
      const spot = spots.find((sp) => sp.id === riding);
      if (g && spot) {
        spot.x = g.position.x;
        spot.z = g.position.z;
      }
      riding = '';
    },
    /** 毎フレーム。乗っている車をプレイヤーの足元へ運ぶ */
    update(player) {
      if (!riding || !player) return;
      const g = cars.get(riding);
      if (!g) return;
      g.position.set(player.position.x, 0, player.position.z);
      g.rotation.y = player.rotation.y;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      scene.remove(root);
    },
  };
}

/** いちばん近い車。範囲外なら null */
export function nearestCar(spots, x, z) {
  let best = null;
  let bestD = RIDE_RANGE;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
