import * as THREE from 'three';
import { itemById } from './catalog.js';

// ============================================================
// ハウジング（2026-08-08・loyさん依頼） — **モック**
//
// > ・ハウジング機能。まず部屋を借りて そこにインテリアを置いたりするやつね。
//
// ★ 作りの方針
//   ・**部屋は街の中に建てる**（別ワールドに切り替えない）。
//     切り替えると同じ部屋に居る人どうしが見えなくなるため（world_lounge.js と同じ理由）
//   ・**間取りは1つ**。借りると自分の部屋になり、鍵（＝入れるかどうか）は見ない。
//     モックなので「借りる → 置く → 見に来る」の流れが成立するかだけを見る
//   ・置いたものは**この端末に保存**する。VRChat側の設計（ECONOMY_DATA_DESIGN.md）が
//     itemId＋位置＋回転で持つ形なので、**同じ持ち方**にしておく（後で繋げるため）
//
// ⚠ 家具の3Dは作っていない。**色つきの箱**で代用する。
//   置き場所・向き・保存の形が正しいかを先に確かめるのが目的。
// ============================================================

const KEY = 'vc.house';
/** 家賃（1回きり。モックなので更新は無い） */
export const RENT = 1200;
/** 部屋の場所（街の西・お店の並びの南） */
export const ROOM_ORIGIN = { x: -72, z: 44 };
const HALF_X = 7;
const HALF_Z = 6;
const WALL_H = 3.6;

const listeners = new Set();

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || typeof v !== 'object') return { rented: false, items: [] };
    return { rented: Boolean(v.rented), items: Array.isArray(v.items) ? v.items : [] };
  } catch {
    return { rented: false, items: [] };
  }
}

function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* 保存できなくても遊べる */ }
  for (const fn of listeners) fn(v);
}

export function getHouse() {
  return read();
}

export function onHouseChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function rentRoom() {
  const v = read();
  v.rented = true;
  write(v);
}

/**
 * 家具を置く。
 * ⚠ 持ち方はVRChat側の設計に合わせる（itemId＋位置＋向き）。
 *   位置は**部屋の中の座標**（部屋を動かしても中身がついてくる）
 */
export function placeItem(itemId, x, z, rot = 0) {
  const v = read();
  if (v.items.length >= 40) return false; // 置きすぎ防止（見た目と保存量）
  v.items.push({ id: Number(itemId), x: +x.toFixed(2), z: +z.toFixed(2), r: +rot.toFixed(2) });
  write(v);
  return true;
}

export function removeLast() {
  const v = read();
  v.items.pop();
  write(v);
}

export function clearItems() {
  const v = read();
  v.items = [];
  write(v);
}

/** 家具の見た目（3Dは作っていないので、色と大きさで区別する） */
const LOOK = {
  12: { color: 0x8a5fff, size: [1.6, 0.7, 0.8] }, // ソファ
  13: { color: 0x22a05a, size: [0.5, 1.1, 0.5] }, // 観葉植物
  14: { color: 0xffd400, size: [1.0, 0.7, 0.08] }, // ポスター（壁に貼る想定）
  15: { color: 0xff00e5, size: [1.4, 0.4, 0.12] }, // ネオンサイン
};

/**
 * 部屋を建てて scene に足す。
 * @returns {{ origin:object, refresh:()=>void, update:(x:number,z:number)=>void, dispose:()=>void }}
 */
export function createRoom(scene) {
  const root = new THREE.Group();
  root.name = 'house';
  root.position.set(ROOM_ORIGIN.x, 0, ROOM_ORIGIN.z);
  scene.add(root);

  const mat = (c, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: c, fog: true, side });
  const shell = new THREE.Group();
  root.add(shell);

  // 床・壁・天井（入口は東側）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), mat(0x241f2c));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  shell.add(floor);
  const wall = (w, h, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0x2b2438, THREE.DoubleSide));
    m.position.set(pos[0], pos[1], pos[2]);
    if (rotY) m.rotation.y = rotY;
    shell.add(m);
  };
  wall(HALF_X * 2, WALL_H, [0, WALL_H / 2, -HALF_Z], 0);
  wall(HALF_X * 2, WALL_H, [0, WALL_H / 2, HALF_Z], 0);
  wall(HALF_Z * 2, WALL_H, [-HALF_X, WALL_H / 2, 0], Math.PI / 2);
  const DOOR_W = 3.2;
  const side = (HALF_Z * 2 - DOOR_W) / 2;
  wall(side, WALL_H, [HALF_X, WALL_H / 2, -(DOOR_W / 2 + side / 2)], Math.PI / 2);
  wall(side, WALL_H, [HALF_X, WALL_H / 2, DOOR_W / 2 + side / 2], Math.PI / 2);
  wall(DOOR_W, WALL_H - 2.6, [HALF_X, 2.6 + (WALL_H - 2.6) / 2, 0], Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), mat(0x141019, THREE.DoubleSide));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  shell.add(ceil);
  // 入口の枠（お店と同じ見せ方）
  for (const [w, h, y, z] of [[DOOR_W + 0.3, 0.14, 2.6, 0], [0.14, 2.6, 1.3, -DOOR_W / 2], [0.14, 2.6, 1.3, DOOR_W / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0xffd86b, THREE.DoubleSide));
    m.position.set(HALF_X + 0.05, y, z);
    m.rotation.y = Math.PI / 2;
    shell.add(m);
  }

  /** 置いた家具を入れる場所。作り直すときはここだけ空にする */
  const stuff = new THREE.Group();
  root.add(stuff);

  function refresh() {
    for (const c of [...stuff.children]) {
      stuff.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    for (const it of read().items) {
      const look = LOOK[it.id] || { color: 0x9aa0ad, size: [0.6, 0.6, 0.6] };
      const m = new THREE.Mesh(new THREE.BoxGeometry(...look.size), mat(look.color));
      m.position.set(it.x, look.size[1] / 2, it.z);
      m.rotation.y = it.r || 0;
      stuff.add(m);
    }
  }
  refresh();

  return {
    origin: ROOM_ORIGIN,
    half: { x: HALF_X, z: HALF_Z },
    refresh,
    /** 遠いときは丸ごと消す（描画を増やさない） */
    update(px, pz) {
      root.visible = Math.hypot(ROOM_ORIGIN.x - px, ROOM_ORIGIN.z - pz) < 90;
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

/** 持ち物のうち、部屋に置けるもの（家具） */
export function placeableItems(walletItems) {
  return Object.keys(walletItems || {})
    .filter((id) => walletItems[id] > 0)
    .map((id) => itemById(id))
    .filter((it) => it && it.cat === 'house');
}
