import * as THREE from 'three';

// ============================================================
// 街のコイン拾い（2026-08-08・loyさん「VCを稼ぐ方法がないと詰むね」への回答の1つ）
//
// ★ ねらい: **街を歩く理由になるもの**（GTA6のイメージ）。
//   お店やナビ地点の近くだけでなく、街のあちこちに置くことで
//   「とりあえず歩いてみる」動機になる。
//
// ★ 仕組み
//   ・決まった場所に浮かぶコインを置く。近づくと**自動で拾う**（ボタン操作なし。
//     ガチャ台のような「台の前で開く」ものと違い、歩いているだけで完結させたいため）
//   ・拾うと一定時間（COOLDOWN_MS）はその場所から消え、時間が経つとまた浮かぶ
//   ・拾った履歴はこの端末に保存する（モック）
//
// ⚠ ライトは足さない（他の3D群と同じ理由。CPU描画の負担を増やさないため）。
//   光る玉に見せたいだけなので MeshBasicMaterial だけで作る
// ============================================================

const KEY = 'vc.citycoins';
/** 1枚あたりの受け取り額（幅を持たせて「今日は多かった」を出す） */
const VALUE_MIN = 30;
const VALUE_MAX = 90;
/** 拾ってから再び浮かぶまでの時間 */
const COOLDOWN_MS = 6 * 60 * 1000;
/** 拾ったと見なす距離 */
export const PICK_RANGE = 1.6;
/** 表示を切る距離（描画の負担を増やさない） */
const SHOW_DIST = 70;

// 街のあちこち（お店・カジノ・ハウジング・車の停め場の間を縫うように配置）。
// ⚠ 会場（clubVERSE）の中には置かない。ライブの邪魔をしないため（loyさん指定）。
//   main.js の CLUB_AREA（x -45..55 / z -50..40）の**外**になるよう、
//   すべて x <= -50 に置いている（実測して x=-30 等が範囲内に入り拾えないことに気づいた）
const SPOTS = [
  { id: 'c1', x: -50, z: -25 },
  { id: 'c2', x: -55, z: 5 },
  { id: 'c3', x: -60, z: 35 },
  { id: 'c4', x: -50, z: 60 },
  { id: 'c5', x: -85, z: -5 },
  { id: 'c6', x: -50, z: -40 },
  { id: 'c7', x: -85, z: 30 },
  { id: 'c8', x: -55, z: -35 },
  { id: 'c9', x: -95, z: -30 },
  { id: 'c10', x: -60, z: 55 },
];

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* 保存できなくても遊べる */ }
}

/**
 * 街のコインを scene に置く。
 * @returns {{ update:(px:number,pz:number,onPick:(amount:number)=>void)=>void, dispose:()=>void }}
 */
export function createCityCoins(scene) {
  const root = new THREE.Group();
  root.name = 'city-coins';
  scene.add(root);

  const geo = new THREE.TorusGeometry(0.34, 0.12, 8, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd86b, fog: true });

  const coins = SPOTS.map((s) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.x, 1.1, s.z);
    m.rotation.x = Math.PI / 2.4;
    root.add(m);
    return { spot: s, mesh: m, nextAt: 0 };
  });

  let t = 0;

  return {
    /**
     * 毎フレーム呼ぶ。範囲内に入ったコインを自動で拾い、amount を onPick に渡す。
     */
    update(px, pz, onPick) {
      t += 1;
      const claims = read();
      const now = Date.now();
      let dirty = false;
      for (const c of coins) {
        const claimedAt = claims[c.spot.id] || 0;
        const cooling = claimedAt && now - claimedAt < COOLDOWN_MS;
        const d = Math.hypot(c.spot.x - px, c.spot.z - pz);
        c.mesh.visible = !cooling && d < SHOW_DIST;
        if (c.mesh.visible) {
          // ゆっくり回して「拾えるもの」だと分かるようにする
          c.mesh.rotation.z = (t + c.spot.x) * 0.03;
          if (d < PICK_RANGE) {
            claims[c.spot.id] = now;
            dirty = true;
            const amount = VALUE_MIN + Math.floor(Math.random() * (VALUE_MAX - VALUE_MIN + 1));
            if (onPick) onPick(amount);
          }
        }
      }
      if (dirty) write(claims);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      scene.remove(root);
    },
  };
}
