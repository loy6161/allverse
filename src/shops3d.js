import * as THREE from 'three';

// ============================================================
// 街のお店・カジノ（**中に入れる建物**） — 2026-08-08
//
// loyさん「建物内でお店やカジノ店など作りたい」。
// 最初のモックは扉の前でパネルが開くだけだったが、「次は建物の中に入れるように」と
// 決まったので、**歩いて入れる部屋**にした。中の台に近づくと、その台の画面が開く。
//
// ★ 作りの方針（world_lounge.js と同じ考え方をそのまま踏襲）
//   ・**別ワールドに差し替えない。** 同じシーンの同じ場所に建てる。
//     差し替えると同じ部屋にいる人どうしが見えなくなる（座標は同期しているのに姿が無い）
//   ・**ライトを足さない。** three のライトはシーン全体に効くので、
//     loyさんの環境（CPU描画）では1画素あたりの計算が全体で重くなる。
//     光の要らない材質（MeshBasicMaterial）だけで組む
//   ・遠いときは丸ごと非表示にする（描画の負担を増やさない）
//
// ⚠ 置き場所は**会場の西**。clubVERSE の床は南（z>22）に無く、
//   会場の敷地（x -45..55 / z -50..40）の中は床のある所にしか立てないため、
//   南に置いた最初の版は**扉の前に立てなかった**（2026-08-07 loyさん「いけない」）。
// ============================================================

/** 部屋の高さ */
const WALL_H = 5;
/** 入口の大きさ */
const DOOR_W = 4.4;
const DOOR_H = 3.4;

/**
 * 建物の定義。
 * pos は部屋の中心。入口は東（+X＝会場側）に開けてある。
 * fixtures は中に置く台。近づくと対応する画面が開く（tab は shopui.js のタブid）
 */
export const SHOP_BUILDINGS = [
  {
    id: 'shop',
    label: 'VERSE SHOP',
    neon: 0x00ffea,
    wall: 0x1b3a55,
    pos: [-72, 0, -18],
    half: [8, 7], // 16m × 14m
    fixtures: [
      { id: 'counter', tab: 'shop', label: 'お店', at: [-4, -3], color: 0x27618a },
      { id: 'gacha', tab: 'gacha', label: 'ガチャ', at: [-4, 3], color: 0xffd86b },
    ],
  },
  {
    id: 'casino',
    label: 'VERSE CASINO',
    neon: 0xff00e5,
    wall: 0x3a1b45,
    pos: [-72, 0, 14],
    half: [8, 7],
    fixtures: [
      { id: 'slot', tab: 'slot', label: 'スロット', at: [-4, -3], color: 0xff5fd2 },
      { id: 'gacha2', tab: 'gacha', label: 'ガチャ', at: [-4, 3], color: 0xffd86b },
    ],
  },
];

/** 台に近づいたと見なす距離（m） */
export const FIXTURE_RANGE = 2.8;
/** 建物を出す距離（これより遠いと丸ごと非表示） */
const SHOW_DIST = 90;

function signSprite(text, color) {
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
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sp.scale.set((cv.width / cv.height) * 2.4, 2.4, 1);
  return sp;
}

/**
 * お店の建物を作って scene に足す。
 * @returns {{ spots: object[], update:(x:number,z:number)=>void, dispose:()=>void }}
 */
export function createShopBuildings(scene) {
  const root = new THREE.Group();
  root.name = 'shop-buildings';
  scene.add(root);

  const spots = [];
  const groups = [];
  const disposables = [];

  // 光の計算をしない材質だけで作る（上の注意書き）
  const mat = (color, side = THREE.FrontSide) =>
    new THREE.MeshBasicMaterial({ color, fog: true, side });

  for (const b of SHOP_BUILDINGS) {
    const [ox, oy, oz] = b.pos;
    const [hx, hz] = b.half;
    const g = new THREE.Group();
    g.position.set(ox, oy, oz);
    root.add(g);
    groups.push(g);

    const add = (mesh) => {
      g.add(mesh);
      disposables.push(mesh);
      return mesh;
    };

    // ---- 床 ----
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), mat(0x1a1f2e)));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;

    // ---- 壁（両面。外から見ても建物に見えるように）----
    const wall = (w, h, pos, rotY) => {
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(b.wall, THREE.DoubleSide)));
      m.position.set(pos[0], pos[1], pos[2]);
      if (rotY) m.rotation.y = rotY;
      return m;
    };
    wall(hx * 2, WALL_H, [0, WALL_H / 2, -hz], 0); // 北
    wall(hx * 2, WALL_H, [0, WALL_H / 2, hz], 0); // 南
    wall(hz * 2, WALL_H, [-hx, WALL_H / 2, 0], Math.PI / 2); // 西（奥）

    // ---- 東の壁は入口ぶんを開ける（門の左右＋上）----
    const sideW = (hz * 2 - DOOR_W) / 2;
    wall(sideW, WALL_H, [hx, WALL_H / 2, -(DOOR_W / 2 + sideW / 2)], Math.PI / 2);
    wall(sideW, WALL_H, [hx, WALL_H / 2, DOOR_W / 2 + sideW / 2], Math.PI / 2);
    wall(DOOR_W, WALL_H - DOOR_H, [hx, DOOR_H + (WALL_H - DOOR_H) / 2, 0], Math.PI / 2);

    // 入口の光る枠。
    // ⚠ 1枚の板で塗ると**入口が塞がって見える**（2026-08-08 スクショで確認）。
    //   中が見えないと入れることが伝わらないので、**細い帯4本の縁取り**にする
    const bar = (w, h, y, z) => {
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(b.neon, THREE.DoubleSide)));
      m.position.set(hx + 0.06, y, z);
      m.rotation.y = Math.PI / 2;
    };
    const T = 0.16; // 帯の太さ
    bar(DOOR_W + T * 2, T, DOOR_H + T / 2, 0); // 上
    bar(T, DOOR_H, DOOR_H / 2, -(DOOR_W / 2 + T / 2)); // 左
    bar(T, DOOR_H, DOOR_H / 2, DOOR_W / 2 + T / 2); // 右

    // ---- 天井 ----
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), mat(0x0b0e16, THREE.DoubleSide)));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;

    // ---- ネオンの帯（内側）----
    const neonBar = (w, pos, rotY) => {
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, 0.14), mat(b.neon)));
      m.position.set(pos[0], pos[1], pos[2]);
      if (rotY) m.rotation.y = rotY;
    };
    neonBar(hx * 2 - 1, [0, 3.2, -hz + 0.03], 0);
    neonBar(hz * 2 - 1, [-hx + 0.03, 3.2, 0], Math.PI / 2);

    // ---- 看板（屋根の上・入口側）----
    const sign = add(signSprite(b.label, b.neon));
    sign.position.set(hx - 1, WALL_H + 1.8, 0);

    // ---- 台（カウンター・ガチャ台・スロット台）----
    for (const f of b.fixtures) {
      const [fx, fz] = f.at;
      const tall = f.tab !== 'shop';
      const w = tall ? 1.2 : 3.4;
      const h = tall ? 1.8 : 1.1;
      const d = 1.0;
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(0x2a3145)));
      box.position.set(fx, h / 2, fz);
      // 光る面（東向き＝入ってきた人から見える側）
      const face = add(new THREE.Mesh(new THREE.PlaneGeometry(d * 0.8, h * 0.5), mat(f.color)));
      face.position.set(fx + w / 2 + 0.02, h * 0.62, fz);
      face.rotation.y = Math.PI / 2;
      const tag = add(signSprite(f.label, f.color));
      tag.scale.multiplyScalar(0.42);
      tag.position.set(fx, h + 0.7, fz);

      spots.push({
        id: `${b.id}:${f.id}`,
        label: f.label,
        tab: f.tab,
        shop: b.id,
        x: ox + fx + 1.8, // 台の手前（東側）に立つ
        z: oz + fz,
      });
    }
  }

  return {
    spots,
    /** プレイヤーの位置を渡す。遠い建物は丸ごと消す（描画を増やさない） */
    update(px, pz) {
      for (const g of groups) {
        g.visible = Math.hypot(g.position.x - px, g.position.z - pz) < SHOW_DIST;
      }
    },
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

/** いちばん近い台。範囲外なら null */
export function nearestSpot(spots, x, z) {
  let best = null;
  let bestD = FIXTURE_RANGE;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
