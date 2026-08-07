import * as THREE from 'three';

// ============================================================
// 街に置く「入れるお店」の建物 — **モック**（2026-08-07）
//
// loyさん「建物内でお店やカジノ店など作りたい」。
//
// ⚠ いまは**扉に近づくと画面が開く**だけで、建物の中には入りません。
//   中を歩ける部屋にするのは次の段階（docs/SPEC_POINTS.md）。
//   まず「歩く → 店に入る → 買う → 着る」の流れが成立するかを見るためのモックです。
//
// 置き場所は**会場を出てすぐの大通り沿い**（街に出る立ち位置は (4.5, 40)）。
// ⚠ 最初は x=±30 に置いたら**画面に入らなかった**（20m先で視界の幅は片側9mほどしかない）。
//   21km²の街は自動生成で見分けがつかないので、出てすぐ目に入る位置に置くこと。
// ============================================================

/** 建物の定義。id は shopui.js の kind と揃える */
export const SHOP_BUILDINGS = [
  {
    id: 'shop',
    label: 'VERSE SHOP',
    color: 0x1b3a55,
    neon: 0x00ffea,
    pos: [-14, 0, 46], // 会場を出てすぐ左（南西）
    size: [16, 9, 14],
  },
  {
    id: 'casino',
    label: 'VERSE CASINO',
    color: 0x3a1b45,
    neon: 0xff00e5,
    pos: [22, 0, 46], // 会場を出てすぐ右（南東）
    size: [16, 11, 14],
  },
];

/** 扉の前に立ったと見なす距離（m） */
export const DOOR_RANGE = 5;

function label(text, color) {
  const pad = 24;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 64px "Yu Gothic UI", sans-serif';
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = 96;
  const c2 = cv.getContext('2d');
  c2.font = 'bold 64px "Yu Gothic UI", sans-serif';
  c2.textBaseline = 'middle';
  c2.fillStyle = '#' + color.toString(16).padStart(6, '0');
  c2.shadowColor = c2.fillStyle;
  c2.shadowBlur = 24;
  c2.fillText(text, pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((cv.width / cv.height) * 2.4, 2.4, 1);
  return sp;
}

/**
 * 建物を作って scene に足す。
 * @returns {{ doors: {id:string,label:string,x:number,z:number}[], dispose:()=>void }}
 */
export function createShopBuildings(scene) {
  const root = new THREE.Group();
  root.name = 'shop-buildings';
  scene.add(root);

  const doors = [];
  const disposables = [];

  for (const b of SHOP_BUILDINGS) {
    const [w, h, d] = b.size;
    const [x, y, z] = b.pos;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: b.color, fog: true }),
    );
    body.position.set(x, y + h / 2, z);
    root.add(body);
    disposables.push(body);

    // 扉（手前＝会場側＝ -Z 面）。光らせて「ここが入口」と分かるようにする
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 4.4),
      new THREE.MeshBasicMaterial({ color: b.neon, fog: true }),
    );
    const doorZ = z - d / 2 - 0.05;
    door.position.set(x, 2.2, doorZ);
    root.add(door);
    disposables.push(door);

    // 看板（建物の上）
    const sign = label(b.label, b.neon);
    sign.position.set(x, y + h + 2.2, doorZ);
    root.add(sign);
    disposables.push(sign);

    doors.push({ id: b.id, label: b.label, x, z: doorZ - 1.5 });
  }

  return {
    doors,
    dispose() {
      for (const o of disposables) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      }
      scene.remove(root);
    },
  };
}

/** いちばん近い扉。範囲外なら null */
export function nearestDoor(doors, x, z) {
  let best = null;
  let bestD = DOOR_RANGE;
  for (const dr of doors) {
    const d = Math.hypot(dr.x - x, dr.z - z);
    if (d < bestD) {
      bestD = d;
      best = dr;
    }
  }
  return best;
}
