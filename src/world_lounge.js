// ============================================================
// 別会場（ラウンジ）のサンプル（2026-08-06追加）
//
// loyさん「あと、別会場を作りたい。入り口出ると別会場に移動みたいなサンプルを作って。
//          任せるので。」
//
// ★ 作りの方針（なぜこうしたか）
//
// 「別のワールドを読み込んで差し替える」方式にはしていない。
// 差し替えると、**同じ部屋にいる人どうしが見えなくなる**（位置は同期しているのに、
// 相手の座標が自分の会場に無い）。サーバーの部屋の作りを変える話になり、
// サンプルの範囲を超える。
//
// 代わりに **同じシーンの離れた場所（x=+70）に建てて、そこへ歩いて移動する**。
//   ・位置の同期はそのまま効く＝ラウンジに居る人どうしはちゃんと見える
//   ・会場を出入りしてもサーバー側は何も変わらない（部屋も同じ）
//   ・遠くに居るときは丸ごと非表示にするので、描画の負担はほぼ増えない
//
// ⚠ ライトを足していない（**わざと**）。three のライトはシーン全体に効くので、
//   ここで2つ足すと clubVERSE 側の1画素あたりの計算量まで増える。
//   loyさんの環境はGPUを使わない設定（CPU描画）なので、そこが直接重さになる。
//   なので**光の要らない材質（MeshBasicMaterial）**だけで組んでいる。
//   アバターは会場の環境光（HemisphereLight・距離減衰なし）で見える。
// ============================================================

import * as THREE from 'three';
import { createTextSprite } from './avatar.js';

/**
 * ラウンジを建てる場所。clubVERSE（x=-13〜25）と重ならない離れた所。
 *
 * ⚠ **±100 を超えてはいけない**。サーバーは座標の絶対値が100を超える位置を
 *   捨てる（server.js の MAX_COORD_ABS）。最初 x=200 で作ったら、
 *   ラウンジに居る間だけ**他の人に位置が伝わらない**状態になっていた。
 *   x=70 なら部屋の端（±11）を入れても 59〜81 で収まる。
 */
export const LOUNGE_ORIGIN = new THREE.Vector3(70, 0, 0);

/** 部屋の広さ（原点からの半分の長さ） */
const HALF_X = 11;
const HALF_Z = 9;

/** ここより東（+X）に居たら「ラウンジに居る」とみなす境目（会場の東端は x=25） */
export const LOUNGE_BORDER_X = 45;

/**
 * clubVERSE 側の出口。ここを越えるとラウンジへ移動する。
 * 入り口の階段を下りきったあたり（実測: 床は z≒23 で終わる）。
 */
export const CLUB_EXIT = { minX: -6, maxX: 24, fromZ: 20.5 };

/** ラウンジ側の出口（clubVERSEへ戻る）。部屋の西の端 */
export const LOUNGE_EXIT = { fromXOffset: -HALF_X + 1.2 };

/**
 * ラウンジを作ってシーンに足す。
 * clubVERSE と同じ形の値（bounds / spawnPoint / groundYAt）を返すので、
 * 操作まわりはそのまま使い回せる。
 */
export function createLounge(scene) {
  const group = new THREE.Group();
  group.position.copy(LOUNGE_ORIGIN);
  group.visible = false; // 近づくまで出さない（遠くの物を毎フレーム描かない）
  scene.add(group);

  const O = LOUNGE_ORIGIN;

  // 光の計算をしない材質だけで作る（上の注意書きを参照）
  const mat = (color) => new THREE.MeshBasicMaterial({ color });

  // ---- 床 ----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), mat(0x232838));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // 床の縁取り（歩ける範囲が目で分かるように）
  const edge = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_X * 2 - 0.6, HALF_Z * 2 - 0.6),
    new THREE.MeshBasicMaterial({ color: 0x14404d, transparent: true, opacity: 0.9 }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.01;
  group.add(edge);

  // ---- 壁（内側だけ見えればよいので裏面を描かない） ----
  const wall = (w, h, pos, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(0x222839));
    m.position.set(...pos);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  };
  const WALL_H = 5;
  wall(HALF_X * 2, WALL_H, [0, WALL_H / 2, -HALF_Z], 0); // 北
  wall(HALF_X * 2, WALL_H, [0, WALL_H / 2, HALF_Z], Math.PI); // 南
  wall(HALF_Z * 2, WALL_H, [HALF_X, WALL_H / 2, 0], -Math.PI / 2); // 東

  // ---- 天井 ----
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), mat(0x0c0f18));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  group.add(ceil);

  // ---- ネオンの帯（clubVERSEと同じ色味でつなげる） ----
  const neon = (w, h, pos, color, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(color));
    m.position.set(...pos);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
  };
  neon(HALF_X * 2 - 1, 0.14, [0, 3.2, -HALF_Z + 0.02], 0x6ff2ff, 0);
  neon(HALF_Z * 2 - 1, 0.14, [HALF_X - 0.02, 3.2, 0], 0xff5fd2, -Math.PI / 2);
  neon(HALF_X * 2 - 1, 0.14, [0, 3.2, HALF_Z - 0.02], 0x6ff2ff, Math.PI);

  // ---- ソファ代わりの台（座れはしないが、広さの目安になる） ----
  const bench = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), mat(0x232838));
    m.position.set(x, 0.225, z);
    group.add(m);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.06, d - 0.2), mat(0x2f3547));
    top.position.set(x, 0.48, z);
    group.add(top);
  };
  bench(-6, -5, 5, 1.2);
  bench(6, -5, 5, 1.2);
  bench(-6, 5, 5, 1.2);
  bench(6, 5, 5, 1.2);

  // ---- 出口（clubVERSEへ戻る門）。西側の壁の代わりに開けてある ----
  const doorFrame = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.4), mat(0x00ffea));
  doorFrame.position.set(-HALF_X + 0.03, 1.7, 0);
  doorFrame.rotation.y = Math.PI / 2;
  group.add(doorFrame);
  const doorHole = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), mat(0x05070f));
  doorHole.position.set(-HALF_X + 0.06, 1.65, 0);
  doorHole.rotation.y = Math.PI / 2;
  group.add(doorHole);
  // 西壁の残り（門の上と左右）
  wall(HALF_Z * 2, 1.6, [-HALF_X, WALL_H - 0.8, 0], Math.PI / 2);
  const sideW = (HALF_Z * 2 - 4) / 2;
  wall(sideW, 3.4, [-HALF_X, 1.7, -(4 / 2 + sideW / 2)], Math.PI / 2);
  wall(sideW, 3.4, [-HALF_X, 1.7, 4 / 2 + sideW / 2], Math.PI / 2);

  // ---- 看板（ここが別の会場だと分かるように） ----
  const sign = createTextSprite('ALLVERSE LOUNGE', {
    fontSize: 34,
    textColor: '#eafcff',
    bgColor: 'rgba(6, 8, 20, 0.0)',
    borderColor: 'rgba(0, 255, 234, 0.0)',
    maxTextWidth: 520,
    maxLines: 1,
  });
  sign.position.set(0, 3.9, -HALF_Z + 0.1);
  sign.scale.multiplyScalar(2.2);
  group.add(sign);

  return {
    kind: 'lounge',
    group,
    /** 歩ける範囲（世界座標） */
    bounds: {
      minX: O.x - HALF_X + 0.6,
      maxX: O.x + HALF_X - 0.6,
      minZ: O.z - HALF_Z + 0.6,
      maxZ: O.z + HALF_Z - 0.6,
    },
    /** 入ってきたときに立つ場所（門のすぐ内側） */
    spawnPoint: new THREE.Vector3(O.x - HALF_X + 2.5, 0, O.z),
    /** clubVERSEへ戻る門の内側に居るか */
    atExit(x, z) {
      return x <= O.x + LOUNGE_EXIT.fromXOffset && Math.abs(z - O.z) < 2;
    },
    /** 床は平ら。段差は作っていない */
    groundYAt: () => 0,
    canStandAt: () => true,
    /** 近づいたときだけ描く */
    setVisible(v) {
      group.visible = Boolean(v);
    },
  };
}

/** その座標がラウンジ側か（clubVERSE と遠くに離してあるので x で分かる） */
export function isInLounge(x) {
  return x > LOUNGE_BORDER_X;
}

/** clubVERSE の出口（入り口の階段を下りきった所）に居るか */
export function atClubExit(x, z) {
  return z >= CLUB_EXIT.fromZ && x >= CLUB_EXIT.minX && x <= CLUB_EXIT.maxX;
}
