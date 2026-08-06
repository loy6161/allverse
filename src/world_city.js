// ============================================================
// CITY — clubVERSE のまわりに広がる街（2026-08-06追加）
//
// ⚠ 名前は「CITY」。最初 OPEN と呼んでいたが、loyさん「『OPEN』だとわかりにくいから
//   『CITY』で。」で改名した（`?world=city`／イベント設定の「ワールド」）。
//
// ⚠ この街の中身は**仮**。loyさん:
//   > 実際に、clubVERSEの外や、もう１つANDERVERSEというライブハウスやマンションなどは
//   > VRCでは存在してて、clubVERSEの様に移植予定なのでいまはそれのテストとして
//   > 仮でやるだけ
//   なので建物は箱で置いてある。VRCから移植したモデルに差し替える前提で、
//   「区画に何を置くか」だけ差し替えれば済む形にしてある（buildTile）。
//
// loyさんの狙い（本人の言葉）:
//   > VRCは巨大なエリアは重くなるし、分割したら別ワールドになってワールド移動に
//   > なるから、それがブラウザならシームレスに移動できるってメリットがあると思う。
//   > 実質オープンワールドでも負荷にならずに巨大なエリアを作れる。その実験。
//   > VRCのALLVERSEが20平方キロメートルあっても稼働してる。
//
// ★ clubVERSE と地続き
//   街の**中央の区画には何も建てない**。そこに clubVERSE（world_club.js）が建っている。
//   座標系は共通なので、会場の入り口を出るとそのまま街路に出る。
//   **テレポートも読み込み画面も無い**（そこがVRCとの違いなので、境目を作らないこと）。
//
// ★ 何を示す実験か
//   「**総面積をいくら増やしても、1フレームの負担は増えない**」こと。
//   増えるのはメモリでも描画でもなく、**行ける場所の広さだけ**。
//
// ★ 仕組み（タイル・ストリーミング）
//   エリアを TILE m 四方のタイルに切る。プレイヤーの周りだけを:
//     ・組み立てる（BUILD_RADIUS 以内）… ジオメトリを作ってシーンに足す
//     ・描く（DRAW_RADIUS 以内）      … それより外は visible=false（描画コスト0）
//     ・捨てる（KEEP_RADIUS より外）  … dispose してメモリから消す
//   タイルの中身は**座標から決まる**（乱数を使わない）ので、
//   捨てて作り直しても同じ形に戻る＝保存が要らない。
//
// ⚠ ライトを足していない（clubVERSE と同じ理由）。three のライトはシーン全体に
//   効くので、ここで足すと本番の会場まで重くなる。光の要らない材質だけで組む。
//   代わりに霧（fog）で遠景を溶かし、タイルの切れ目を見えなくしている。
//
// ⚠ 歩いて跨ぐ。**テレポートも読み込み画面も無い**。そこが VRC との違いなので、
//   途中に「境目」を作らないこと（門・ロード画面・暗転を入れない）。
// ============================================================

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/** タイル1枚の1辺（m） */
export const TILE = 200;

/** 端から端まで（タイル数）。23×23×200m² = 21.2 km²（VRCのALLVERSE 20km²に合わせた） */
export const GRID = 23;

/** 組み立てる範囲（タイル単位。2なら5×5＝25枚） */
const BUILD_RADIUS = 2;
/** 描く範囲。組み立て済みでもこれより外は描かない */
const DRAW_RADIUS = 2;
/** これより外に出たタイルは捨てる（作り直しの往復を防ぐため、組み立て範囲より1枚広い） */
const KEEP_RADIUS = 3;

/** 見える距離。ここを超えるものは霧に溶ける（描かないタイルの切れ目を隠す） */
const VIEW_DIST = TILE * (DRAW_RADIUS + 0.5);

/** エリア全体の広さ（m） */
const HALF_WORLD = (GRID * TILE) / 2;

/**
 * 座標から決まる疑似乱数（0〜1）。
 * 乱数を使わないので、タイルを捨てて作り直しても**同じ街並みに戻る**。
 */
function hash01(ix, iz, salt = 0) {
  let h = (ix * 374761393 + iz * 668265263 + salt * 2246822519) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 建物の色（夜の街に合う暗い色を数種類） */
const BUILDING_COLORS = [0x1c2130, 0x232a3c, 0x1a2432, 0x272c3d];
/** ネオンの色（clubVERSE と同じ色味に揃える） */
const NEON_COLORS = [0x00ffea, 0xff00e5, 0x6ff2ff, 0xffd147];

/**
 * 巨大エリアを作る。clubVERSE と同じ形の値を返すので、操作まわりはそのまま使える。
 * @param {THREE.Scene} scene
 */
export function createCityLayer(scene, { hole } = {}) {
  // ⚠ 背景と霧は clubVERSE が持っているものを壊さない。
  //   街は clubVERSE の**まわりに足すだけ**なので、遠景を溶かす霧だけ入れる。
  //   （霧の色は夜空と同じ。ここを変えると会場の中まで色が変わる）
  if (!scene.fog) scene.fog = new THREE.Fog(0x05070f, VIEW_DIST * 0.45, VIEW_DIST);

  const root = new THREE.Group();
  scene.add(root);

  // ★ 1区画＝**描画コール1回**にする（2026-08-06）。
  //   最初は地面・道・建物・ネオンを別々のメッシュで置いていたら、
  //   25区画で描画コールが141回になった。CPUで描いている環境ではここが効くので、
  //   区画の中身を1つのジオメトリにまとめ、色は頂点色で持たせる。
  //   材質は全区画で1つだけ使い回す。
  const sharedMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });

  /** 色つきの箱・板を1つ作って、まとめる前のジオメトリとして返す */
  const _c = new THREE.Color();
  function piece(geo, color, pos, scale, rotX = 0) {
    const g = geo.clone();
    // ⚠ 順番が大事。**拡大縮小 → 回転 → 移動** の順に当てる。
    //   先に回してから拡大すると、板の「奥行き」を伸ばしたつもりが別の軸に当たり、
    //   地面が 200m×1m の細い帯になっていた（2026-08-06 実際に踏んだ）
    g.scale(scale[0], scale[1], scale[2]);
    if (rotX) g.rotateX(rotX);
    g.translate(pos[0], pos[1], pos[2]);
    _c.setHex(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // まとめるには属性の顔ぶれを揃える必要がある。uv は使わないので落とす
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    return g;
  }

  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const PLANE = new THREE.PlaneGeometry(1, 1);

  /** 組み立て済みのタイル。キーは "ix,iz" */
  const tiles = new Map();
  /** 実験の記録用。組み立て・破棄が何回起きたか */
  const stats = { built: 0, disposed: 0 };

  const key = (ix, iz) => `${ix},${iz}`;
  const half = (GRID - 1) / 2;
  /**
   * その区画を建てるか。
   * ★ **中央の区画には何も建てない**。そこに clubVERSE が建っているため
   *   （hole で「何区画ぶん空けるか」を渡す）。ここを埋めると会場に街がめり込む。
   */
  const HOLE = hole || { minIx: 0, maxIx: 0, minIz: 0, maxIz: 0 };
  const inHole = (ix, iz) =>
    ix >= HOLE.minIx && ix <= HOLE.maxIx && iz >= HOLE.minIz && iz <= HOLE.maxIz;
  const inGrid = (ix, iz) => Math.abs(ix) <= half && Math.abs(iz) <= half;

  /** そのタイルの中身を組み立てる（座標から決まるので毎回同じ形になる） */
  function buildTile(ix, iz) {
    const parts = [];

    // 地面
    parts.push(piece(PLANE, 0x0e1220, [0, 0, 0], [TILE, TILE, 1], -Math.PI / 2));
    // 道（十字）。歩く目印になり、区画が繋がって見える
    const roadW = 14;
    parts.push(piece(PLANE, 0x161b2b, [0, 0.02, 0], [TILE, roadW, 1], -Math.PI / 2));
    parts.push(piece(PLANE, 0x161b2b, [0, 0.02, 0], [roadW, TILE, 1], -Math.PI / 2));

    // 建物。1区画あたり 6〜11 棟。
    // ★ 会場のある区画には建てない（地面と道だけ残す＝会場のまわりが広場になる）
    const count = inHole(ix, iz) ? 0 : 6 + Math.floor(hash01(ix, iz, 1) * 6);
    for (let i = 0; i < count; i++) {
      const rx = hash01(ix, iz, 10 + i);
      const rz = hash01(ix, iz, 40 + i);
      const rh = hash01(ix, iz, 70 + i);
      const bx = (rx - 0.5) * (TILE - 30);
      const bz = (rz - 0.5) * (TILE - 30);
      if (Math.abs(bx) < roadW || Math.abs(bz) < roadW) continue; // 道の上には建てない
      const w = 8 + rx * 14;
      const d = 8 + rz * 14;
      const h = 6 + rh * 40;
      parts.push(piece(BOX, BUILDING_COLORS[i % BUILDING_COLORS.length], [bx, h / 2, bz], [w, h, d]));
      // ネオンの帯（街が生きて見える最低限）
      parts.push(piece(PLANE, NEON_COLORS[(i + ix + iz + 8) % NEON_COLORS.length],
        [bx, h * 0.72, bz + d / 2 + 0.05], [w * 0.8, 0.5, 1]));
    }

    const merged = BufferGeometryUtils.mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    const mesh = new THREE.Mesh(merged, sharedMat);
    mesh.position.set(ix * TILE, 0, iz * TILE);
    root.add(mesh);
    stats.built++;
    return mesh;
  }

  function disposeTile(k) {
    const mesh = tiles.get(k);
    if (!mesh) return;
    root.remove(mesh);
    // ★ ジオメトリは区画ごとに作っているので**必ず捨てる**（材質は使い回しなので触らない）。
    //   ここを忘れると、歩き回るほどGPUのメモリが増え続ける
    mesh.geometry.dispose();
    tiles.delete(k);
    stats.disposed++;
  }

  let lastIx = null;
  let lastIz = null;

  /**
   * プレイヤーの位置に合わせて、組み立て・表示・破棄を更新する。
   * 毎フレーム呼んでよい（タイルをまたいだときだけ実際の作業をする）。
   */
  function updateStreaming(x, z) {
    const ix = Math.round(x / TILE);
    const iz = Math.round(z / TILE);
    if (ix === lastIx && iz === lastIz) return false;
    lastIx = ix;
    lastIz = iz;

    // 1. 近いタイルを組み立てる
    for (let dz = -BUILD_RADIUS; dz <= BUILD_RADIUS; dz++) {
      for (let dx = -BUILD_RADIUS; dx <= BUILD_RADIUS; dx++) {
        const tx = ix + dx;
        const tz = iz + dz;
        if (!inGrid(tx, tz)) continue;
        const k = key(tx, tz);
        if (!tiles.has(k)) tiles.set(k, buildTile(tx, tz));
      }
    }
    // 2. 遠いタイルは描かない／もっと遠いものは捨てる
    for (const [k, g] of tiles) {
      const [tx, tz] = k.split(',').map(Number);
      const d = Math.max(Math.abs(tx - ix), Math.abs(tz - iz));
      if (d > KEEP_RADIUS) disposeTile(k);
      else g.visible = d <= DRAW_RADIUS;
    }
    return true;
  }

  return {
    kind: 'city',
    /** 歩ける範囲＝街ぜんぶ。区画の切れ目に壁は無い（シームレス） */
    bounds: { minX: -HALF_WORLD, maxX: HALF_WORLD, minZ: -HALF_WORLD, maxZ: HALF_WORLD },
    /** 街から入るときの立ち位置（会場の入り口の外・南の大通り） */
    spawnPoint: new THREE.Vector3(4.5, 0, 40),
    groundYAt: () => 0,
    canStandAt: () => true,
    /** 毎フレーム呼ぶ（main.js の loop から）。プレイヤーの位置を渡す */
    update(dt, t, playerX = 0, playerZ = 0) {
      updateStreaming(playerX, playerZ);
    },
    /** 会場の敷地（区画を空けてある範囲）の中か */
    isInVenue(x, z) {
      const ix = Math.round(x / TILE);
      const iz = Math.round(z / TILE);
      return inHole(ix, iz);
    },
    /** 実験の記録に使う数字 */
    debugInfo() {
      let visible = 0;
      for (const g of tiles.values()) if (g.visible) visible++;
      return {
        tile: TILE,
        grid: GRID,
        areaKm2: +((GRID * TILE * (GRID * TILE)) / 1e6).toFixed(1),
        built: tiles.size,
        visible,
        totalBuilt: stats.built,
        totalDisposed: stats.disposed,
      };
    },
    /** 実験用: 好きな場所へ飛ぶ（端まで歩くと時間がかかりすぎるため） */
    warpTo(x, z) {
      updateStreaming(x, z);
    },
  };
}
