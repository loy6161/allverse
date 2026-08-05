import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addMoon, addStars } from './night_sky.js';

// ------------------------------------------------------------------
// clubVERSE（VRChatの実ワールドから持ってきた会場）
//
// U:\UNITY\WORLD\project\VERSE CITY2025 の書き出し用シーンを
// FBX → Blender → GLB に変換したもの。変換時にやったこと:
//   ・当たり判定専用オブジェクトを削除
//   ・法線マップを破棄（3枚で26MB。lilToonの平坦な見た目では差が出ない）
//   ・テクスチャを半分に縮小し WebP 化（82.8MB → 約4MB）
//   ・マテリアル別に1メッシュへ結合（描画コール 320 → 16）
//
// 実測値（GLB内の座標。原点は会場の中心、床スラブの底が y=0）:
//   幅 58.35m × 奥行 67.04m × 高さ 21.28m ／ 三角形 62,871 ／ マテリアル 16
//   ステージ天面 y=2.78、ステージ前端 z=-18.07、背面ガラス z=-30、天井ガラス y=20.8
//
// 注意: シェーダーはlilToonから変換されているので、VRChatと同じ見た目にはならない。
// 「造形が同じで、雰囲気を寄せる」方針（2026-07-30 確定）。
// ------------------------------------------------------------------

const MODEL_URL = 'assets/world/clubverse.glb';

// GLB内で「歩く床の面」がある高さ。床スラブが厚さ1.4mあり、その天面がここ。
// アバターの足元は y=0 前提なので、モデル全体をこのぶん下げて辻褄を合わせる。
// （これを入れるまでアバターが床に1.4m埋まっていた。2026-07-30 修正）
const FLOOR_TOP_Y = 1.4;

// スクリーンを置く場所（モデルを下げたあとのワールド座標）。
// ステージ背面(幅20.86m・z=-30)の手前。背面ぴったりに置くと装飾の縦柱が
// 映像の上に重なって観られないので、柱より手前に出す。
export const CLUB_SCREEN = {
  x: 4.88,
  y: 8 - FLOOR_TOP_Y,
  z: -28.3,
  width: 16,
  height: 9,
};

// 歩ける範囲。床の高さを 2m 格子で実測し、天面が一様に平ら（GLB内 y=1.4）な
// 範囲だけを囲っている。当たり判定はまだ入れていないので矩形のまま。
//   除外したもの: ステージ(z<-17)／西側の一段高い台(x<-13)／東と南の階段(z>5, x>25)
const BOUNDS = { minX: -13, maxX: 25, minZ: -16.5, maxZ: 5 };

/** 入場位置。ステージ正面の少し手前（ステージ前端は z=-18） */
const SPAWN = new THREE.Vector3(CLUB_SCREEN.x, 0, -6);

/**
 * ステージの上（2026-08-04追加）。管理人・VIPだけが上がれる範囲。
 *
 * 実測値（このファイル冒頭のコメント）から取っている:
 *   ステージ天面 y=2.78（モデルを FLOOR_TOP_Y=1.4 下げるので、床からは 1.38）
 *   ステージ前端 z=-18.07 ／ 背面ガラス z=-30 ／ 背面の幅 20.86m
 *
 * ⚠ minZ は背面ガラスより少し手前(-29)にしてある。ぴったりに置くと
 *   ガラスや装飾の柱にめり込んで見える。
 * ⚠ maxZ は客席の手前端(-16.5)と繋げてある。ここに隙間があると
 *   「客席からステージへ歩いて上がれない」孤島になる。
 *
 * ★ **歩ける範囲(maxZ)と、高さが上がる位置(topFromZ)は別物**（2026-08-04 修正）。
 *   maxZ を天面の判定にも使うと、**ステージ前端より手前（客席の一番前の床）でも
 *   1.38m浮いてしまう**。ここは実際には床なので、天面は前端より奥だけに効かせる。
 *   （VRChat側からの指摘「客席とステージの間に段差がある場合、その真上に人が来ると
 *     レイが変なものを拾うのでは」で気づいた。こちら側にも同じ穴があった）
 *
 * ⚠ この範囲の座標は presence.json を通じてVRChat側へそのまま流れる。
 *   高さは送っていないので、向こうは床をレイキャストで拾う実装になっている（返答⑧）。
 */
const STAGE = {
  minX: -5.5,
  maxX: 15.3,
  // 背面ガラス(z=-30)の少し手前まで。
  // ⚠ -29 だとVRChat側が天面と実測した位置（VRC Z=-101／ブラウザ z=-29.09）が
  //   わずかに範囲外になり、そこだけ床に落ちていた（2026-08-04 突き合わせで判明）
  minZ: -29.6,
  // 歩ける奥行きの手前端。客席と地続きにするため客席の端に合わせる
  maxZ: -16.5,
  // ここより奥（zが小さい側）が「ステージの上」。手前は客席の床のまま
  topFromZ: -18.07,
  topY: 2.78 - FLOOR_TOP_Y,
};

function makePlaceholderTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 288;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 512, 288);
  g.addColorStop(0, '#0a0a1a');
  g.addColorStop(1, '#1a0a20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 288);
  ctx.strokeStyle = 'rgba(0,255,234,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 284);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------
// マテリアルの作り直し
//
// FBX経由で来たマテリアルは全部「metalness 0 / roughness 0.55 / ベース白」に
// 潰れている（lilToonの情報がFBXに乗らないため）。そのままだと会場全体が
// 白飛びして、金属もガラスもただの白い板に見える。
// 名前で用途を判定して、three.js側の値を入れ直す。
//
// 判定は上から順に、最初に当たったルールを使う（MI_Metal_Silver と
// メッシュ_silver のように "silver" が被るものがあるため順序が意味を持つ）。
// ------------------------------------------------------------------

const MATERIAL_RULES = [
  // --- ガラス（透過していなかったので入れ直す）---
  // clubVERSE_glass_cl は天井ガラス(563m2)。VRChat側では発光扱いだが、
  // そのまま白発光させると空が真っ白になるので発光は切って素通しにする。
  // ガラスが白く見える主因は映り込み（envMapIntensity）。透過度そのものより
  // ここを絞らないと、外の星空が白い膜の向こうになる（2026-07-30 指摘で判明）
  {
    test: (n) => n === 'clubVERSE_glass_cl',
    apply: (m) => {
      m.transparent = true;
      m.opacity = 0.08;
      m.color.setHex(0x9fb6d8);
      m.emissive.setHex(0x000000);
      m.roughness = 0.05;
      m.metalness = 0.0;
      m.envMapIntensity = 0.35;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
    },
  },
  {
    test: (n) => n.includes('glass'),
    apply: (m) => {
      m.transparent = true;
      m.opacity = 0.1;
      m.color.setHex(0x8ba7c8);
      m.emissive.setHex(0x000000);
      m.roughness = 0.06;
      m.metalness = 0.0;
      m.envMapIntensity = 0.4;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
    },
  },

  // --- 金属 ---
  // 「サンプルの時の床みたいなシェーダー」（world.js の floorMat: 暗くて艶がある）に寄せる。
  // 床(MI_Metal_TILE_Silver_2)はタイル模様を残したいので、色を落として艶だけ足す。
  {
    test: (n) => n.includes('TILE'),
    apply: (m) => {
      // タイル柄のテクスチャがほぼ白なので、色で大きく落とさないと床が真っ白に飛ぶ。
      // 落としきった上で艶（metalness/roughness）だけ残すのが world.js の floorMat と同じ狙い
      m.color.setHex(0x24262e);
      m.metalness = 0.4;
      m.roughness = 0.45;
      m.envMapIntensity = 0.9;
    },
  },
  {
    test: (n) => n.startsWith('MI_Metal'),
    apply: (m) => {
      // 明るいままだとステージ脇の壁が一面の灰色に見えて白っぽく浮く。
      // 金属は「色を落として艶で見せる」（world.js の floorMat と同じ考え方）
      m.color.setHex(0x2f333b);
      m.metalness = 0.85;
      m.roughness = 0.3;
      m.envMapIntensity = 0.8;
    },
  },
  {
    // メッシュ_silver（金網。もともと BLEND 指定）
    test: (n) => n.includes('silver'),
    apply: (m) => {
      m.transparent = true;
      m.color.setHex(0x4a4e58);
      m.metalness = 0.8;
      m.roughness = 0.4;
      m.envMapIntensity = 0.6;
    },
  },

  // --- 発光まわり ---
  // VRChat では AudioLink で音に反応して光る部分。ここでは音を拾っていないので
  // 一定の明るさで置く。色はネオンのライトブルー（2026-07-30 指定）。
  //
  // clubVERSE_black_LTCGI はここに入れないこと。名前は LTCGI（VRChat側の発光の仕組み）だが
  // 実体は2階BackStageの床で、光らせると床が黄色く見える。下の clubVERSE_black で黒く塗る。
  {
    test: (n) => n.includes('AudioLink'),
    apply: (m) => {
      // テクスチャは外す（2026-07-30 指定）。柄が乗るとネオン管に見えないため、
      // 均一なフラット発光にする
      m.map = null;
      m.emissiveMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.color.setHex(0x08131c);
      m.emissive.setHex(0x5ccfff);
      m.emissiveIntensity = 0.7;
      m.roughness = 0.6;
      m.metalness = 0.0;
      m.envMapIntensity = 0.1;
    },
  },
  {
    // LED パネル（LED_4_WH / LED_4_WH_1）
    test: (n) => n.startsWith('LED'),
    apply: (m) => {
      m.color.setHex(0x08131c);
      m.emissive.setHex(0x8ae4ff);
      m.emissiveIntensity = 0.6;
      m.roughness = 0.5;
      m.metalness = 0.0;
      m.envMapIntensity = 0.1;
    },
  },
  {
    // ステージ手前の水面
    test: (n) => n.startsWith('Water'),
    apply: (m) => {
      m.color.setHex(0x0a1420);
      m.emissive.setHex(0x2a4a6a);
      m.emissiveIntensity = 0.25;
      m.roughness = 0.08;
      m.metalness = 0.6;
      m.envMapIntensity = 1.0;
    },
  },

  // --- その他の内装 ---
  {
    // 白大理石。テクスチャがそのまま白いので、色で落として夜の会場に馴染ませる
    test: (n) => n.startsWith('Marble'),
    apply: (m) => {
      m.color.setHex(0x6e6a66);
      m.roughness = 0.35;
      m.metalness = 0.1;
      m.envMapIntensity = 0.35;
    },
  },
  {
    // 躯体（壁・天井・柱）と2階BackStageの床（clubVERSE_black_LTCGI）。
    // 名前は black だが FBX 経由で灰色まで持ち上がっていて、
    // そのまま出すとステージ背面の壁が白っぽく浮く（「白すぎる」の主因のひとつ）
    test: (n) => n.startsWith('clubVERSE_black'),
    apply: (m) => {
      m.color.setHex(0x14151a);
      m.roughness = 0.8;
      m.metalness = 0.05;
      m.envMapIntensity = 0.12;
    },
  },
  {
    test: (n) => n.includes('wood'),
    apply: (m) => {
      m.color.setHex(0x8a7159);
      m.roughness = 0.7;
      m.metalness = 0.0;
      m.envMapIntensity = 0.2;
    },
  },
];

/**
 * 上のどのルールにも当たらなかったときの既定値。
 * 現在のGLBの16マテリアルは全部ルールに当たるので、ここは
 * 会場を作り直してマテリアルが増えたときの保険（白飛びさせないための下限）。
 */
function applyDefaultMaterial(m) {
  m.roughness = 0.75;
  m.metalness = 0.05;
  m.envMapIntensity = 0.18;
  m.color.multiplyScalar(0.6);
}

// ------------------------------------------------------------------
// 映り込み用の環境
//
// 最初は three 付属の RoomEnvironment を使っていたが、あれは「白い studio」で、
// 会場が白飛びしていた原因そのものだった（床の明るさを実測したところ、
// ライトを全部消しても 0.40、環境マップを外すと 0.07 まで落ちた）。
// 夜のクラブに合う暗い箱を自分で組んで、金属にはネオンだけを映り込ませる。
// ------------------------------------------------------------------
function makeClubEnvironment() {
  const env = new THREE.Scene();

  const panel = (color, w, h, pos, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    env.add(m);
  };

  // 囲いの箱（内側を向いた暗い面）
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(60, 26, 70),
    new THREE.MeshBasicMaterial({ color: 0x111624, side: THREE.BackSide }),
  );
  env.add(box);

  // 天井側だけ夜空の色。天井ガラスと磨いた床がここを拾う
  panel(0x1a2440, 60, 70, [0, 12.9, 0], [Math.PI / 2, 0, 0]);

  // 金属に映る光。室内のネオンがライトブルーなので、両脇もそれに合わせる。
  // ステージ方向だけマゼンタを残して奥行きを出す。
  // 彩度を上げすぎると壁一面がその色に染まるので、原色より一段落としてある
  panel(0x6e2450, 26, 12, [0, 6, -34], null);
  panel(0x2e6e8c, 8, 18, [-29.5, 7, -6], [0, Math.PI / 2, 0]);
  panel(0x2e6e8c, 8, 18, [29.5, 7, -6], [0, -Math.PI / 2, 0]);
  panel(0x1d3c5c, 20, 6, [0, 2, 34], null);

  return env;
}

function tuneMaterials(model) {
  const done = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || done.has(m.uuid)) continue;
      done.add(m.uuid);
      const name = m.name || '';
      const rule = MATERIAL_RULES.find((r) => r.test(name));
      if (rule) rule.apply(m);
      else applyDefaultMaterial(m);
      m.needsUpdate = true;
    }
  });
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer 金属の映り込み用の環境マップを作るのに使う
 */
export function createClubWorld(scene, { renderer } = {}) {
  // 夜空は仮ワールドと同じ深い紺（「サンプルの時の夜空と月は残す」方針）。
  // 天井ガラスと背面ガラスが透けるようになったので、ここが会場の中からも見える。
  scene.background = new THREE.Color(0x03050f);
  scene.fog = new THREE.Fog(0x05060f, 70, 190);

  // 月。天井ガラス越しに見上げると入る位置に置いている（会場の右前方・仰角約45度）
  addMoon(scene, { position: [55, 95, -75], radius: 22, glowScale: 80 });

  // 星空。会場の外に球状にばら撒いたパーティクル。
  // 天井ガラスと背面ガラス越しに見える（ガラスの映り込みを絞ったのはこのため）
  addStars(scene);

  // ---- 明かり ----
  // VRChat側は焼いた光（Bakery）で見せているが、それは持ってきていない。
  // ブラウザ側は素直にライトを置いて雰囲気を寄せる。影は落とさない（負荷とフラットな見た目のため）。
  // 白飛びの指摘（2026-07-30）を受けて全体的に落とし、色を夜寄りに振っている。
  const hemi = new THREE.HemisphereLight(0x9a9cb4, 0x1a1220, 2.3);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffe6c8, 1.5);
  key.position.set(12, 26, 10);
  scene.add(key);

  const back = new THREE.DirectionalLight(0x6688cc, 0.7);
  back.position.set(-14, 18, -24);
  scene.add(back);

  // ステージ側からの照り返し。会場の奥が真っ暗にならないように
  const stageGlow = new THREE.PointLight(0xff66dd, 22, 40, 2);
  stageGlow.position.set(CLUB_SCREEN.x, 5, -24);
  scene.add(stageGlow);

  // 客席側の足元を拾う光。低い位置に置くと真下の床だけ白く飛ぶので、
  // 高めから広く落として「床がうっすら艶を返す」程度に留める。
  // 色を付けると床のゴールドのロゴがその色に染まるので、ほぼ白（やや寒色）にしてある
  const floorGlow = new THREE.PointLight(0xdfe8ff, 40, 46, 2);
  floorGlow.position.set(CLUB_SCREEN.x, 8, -6);
  scene.add(floorGlow);

  // ---- 会場の明るさ（2026-08-04追加）----
  //
  // loyさん「もうちょっとブラウザ会場明るくていいかも」＋
  // 「3段階を管理者+VIPは設定から調整できるといいかもね」「運営やVIPが変えて全体へ反映」。
  //
  // ★ ここは2回作り直している。経緯を残す（同じ回り道をしないため）。
  //
  //   1回目: **ライトの強さ**を倍率で上げた → **見た目がほとんど変わらなかった**
  //     （loyさん「切り替えても変わらないね」）。会場のマテリアルは373個中325個が自発光・
  //     141個がほぼ黒で、**自発光も映り込みもライトの影響を受けない**。実測1.19倍。
  //
  //   2回目: **トーンマッピングの露出**を上げた → よく効いたが、
  //     **アバターまで白飛びした**（loyさん「一番明るいのはアバターが白飛びしちゃうね」）。
  //     露出は画面全体に掛かるので、明るいアバターやスクリーンの映像まで飛ぶ。
  //
  //   3回目（いま）: **会場のマテリアルの色**を明るくする。
  //     これなら**会場だけ**が明るくなり、アバターは元のまま。
  //     loyさんの狙い「右のVRC側と会場のイメージが違いすぎる。もっと明るいんだよね。
  //     でもそれはライティングの問題じゃなかったみたいだね。床などのマテリアルの設定だね」
  //     に沿う直し方でもある。
  //
  // ⚠ **露出（toneMappingExposure）は触らない。** アバターが白飛びする。
  // ⚠ 明るくする対象は**レイを撃って実際に当たったもの**だけに絞ってある（推測で選ばない）:
  //     客席の床   … MI_Metal_TILE_Silver_2
  //     左右の壁・柱 … MI_Metal1
  //     ステージ天面 … MI_Metal_Silver
  //     躯体・天井   … clubVERSE_black
  // ⚠ 元は 2026-07-30 に「白すぎる」を直して暗く落とした値。**既定(normal)はその値のまま**なので、
  //   何も選ばなければ見た目は変わらない。
  const BASE = {
    hemi: hemi.intensity,
    key: key.intensity,
    back: back.intensity,
    stageGlow: stageGlow.intensity,
    floorGlow: floorGlow.intensity,
    exposure: renderer ? renderer.toneMappingExposure : 1,
  };

  /** 明るくする対象。名前はレイキャストで特定したもの */
  const LIT_MATERIALS = [
    'MI_Metal_TILE_Silver_2',
    'MI_Metal1',
    'MI_Metal_Silver',
    'clubVERSE_black',
  ];
  /** uuid → 元の色と映り込みの強さ（初回に覚える） */
  const matBase = new Map();

  /**
   * 明るさの段階。
   *
   * mat ……… 会場のマテリアルの色にかける倍率
   * metal …… 金属さの上限（下げるほど色が乗って明るく見える）
   * env ……… 金属の映り込みの強さにかける倍率（**いちばんよく効く**）
   * light …… ライト（補助。床や壁のわずかな反射ぶん）
   * exposure … 画面全体の露出。⚠ **アバターと映像にも掛かる**
   *
   * ⚠ 金属は色を上げてもあまり明るくならない（拡散反射しないため）。
   *   実測: 色だけ2.7倍 → 1.25倍 ／ 映り込み8倍 → 1.54倍 ／ 組み合わせ → 1.68倍。
   *
   * 実測（会場の中からカメラを向け、画面全体の平均。白飛びはどれも0%）:
   *   normal 16.5 ／ bright 22.6（1.37倍） ／ brightest 27.7（1.68倍）
   *   ＋露出ぶんを足した「明るめ（会場＋全体）」系はさらに伸びる
   */
  const BRIGHTNESS = {
    normal: { mat: 1.0, metal: 1, env: 1.0, light: 1.0, exposure: 1.0 },
    // 会場だけを明るくする（アバターと映像はそのまま）
    bright: { mat: 2.7, metal: 0.3, env: 2.0, light: 1.15, exposure: 1.0 },
    brightest: { mat: 4.0, metal: 0.2, env: 3.0, light: 1.3, exposure: 1.0 },
    // 会場を明るくしたうえで、画面全体も少し持ち上げる。
    // ⚠ アバターと映像も明るくなる。上げすぎるとアバターが白飛びするので 1.25 で止める
    //   （loyさん 2026-08-04「一番明るいのはアバターが白飛びしちゃうね」）
    'bright+': { mat: 2.7, metal: 0.3, env: 2.0, light: 1.15, exposure: 1.15 },
    'brightest+': { mat: 4.0, metal: 0.2, env: 3.0, light: 1.3, exposure: 1.25 },
  };

  let level = 'normal';

  /** 会場のマテリアルを明るさに合わせて塗り直す（読み込み後でないと対象が無い） */
  function applyMaterials() {
    if (!model) return;
    const { mat, env, metal } = BRIGHTNESS[level];
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !LIT_MATERIALS.includes(m.name)) continue;
        if (!matBase.has(m.uuid)) {
          matBase.set(m.uuid, {
            color: m.color.getHex(),
            env: m.envMapIntensity ?? 1,
            metal: m.metalness ?? 0,
          });
        }
        const b = matBase.get(m.uuid);
        // ⚠ 元の色に倍率を掛ける（足し算にすると色味が転ぶ）。1.0 を超えないよう頭打ちにする
        m.color.setHex(b.color);
        m.color.multiplyScalar(mat);
        m.color.r = Math.min(1, m.color.r);
        m.color.g = Math.min(1, m.color.g);
        m.color.b = Math.min(1, m.color.b);
        m.envMapIntensity = b.env * env;
        // 金属さを**下げる**方向にだけ効かせる（元から低いものを上げない）
        m.metalness = Math.min(b.metal, metal);
      }
    });
  }

  function setBrightness(next) {
    level = BRIGHTNESS[next] ? next : 'normal';
    const { light, exposure } = BRIGHTNESS[level];
    // ⚠ 露出は画面全体（アバター・スクリーンの映像も）に掛かる。
    //   「+」の付いた段階でだけ 1.0 より上げている
    if (renderer) renderer.toneMappingExposure = BASE.exposure * exposure;
    hemi.intensity = BASE.hemi * light;
    key.intensity = BASE.key * light;
    back.intensity = BASE.back * light;
    // 演出の光（ステージのピンク・床の照り返し）は伸びを抑える。
    // 同じ倍率で上げると、明るくというより「色が濃くなる」方向に転ぶため
    const g = 1 + (light - 1) * 0.6;
    stageGlow.intensity = BASE.stageGlow * g;
    floorGlow.intensity = BASE.floorGlow * g;
    applyMaterials();
    return level;
  }

  // 金属とガラスの映り込み用の環境マップ
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(makeClubEnvironment(), 0.04).texture;
  }

  // ---- スクリーン ----
  // screen.js がこの面（PlaneGeometry 16x9）を探して「穴」に差し替え、
  // 背後のYouTube iframe を覗かせる。
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(CLUB_SCREEN.width, CLUB_SCREEN.height),
    new THREE.MeshBasicMaterial({ map: makePlaceholderTexture(), toneMapped: false }),
  );
  screen.position.set(CLUB_SCREEN.x, CLUB_SCREEN.y, CLUB_SCREEN.z);
  scene.add(screen);

  // ---- 会場本体 ----
  let model = null;
  let loaded = false;
  let failed = '';

  const loader = new GLTFLoader();
  const loading = loader
    .loadAsync(MODEL_URL)
    .then((gltf) => {
      model = gltf.scene;
      // 床の天面をアバターの足元（y=0）に合わせる
      model.position.y = -FLOOR_TOP_Y;
      model.traverse((o) => {
        if (!o.isMesh) return;
        // 影は使わない方針（2026-07-29 確定）
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = true;
      });
      tuneMaterials(model);
      scene.add(model);
      // ⚠ レイキャストは matrixWorld を見る。会場は二度と動かないので、ここで一度だけ確定させる。
      //   これを入れないと、描画が始まる前にレイを撃ったとき**GLB内の座標のまま**当たり、
      //   高さが 1.4m ズレる（2026-08-04 実際に踏んだ）
      model.updateMatrixWorld(true);
      loaded = true;
      // ⚠ 明るさの設定は**読み込みより先に届く**（welcome の方が速い）。
      //   ここで塗り直さないと、選ばれている段階が効かないまま始まる
      applyMaterials();
      return model;
    })
    .catch((e) => {
      failed = String(e && e.message ? e.message : e);
      console.error('[world_club] 会場の読み込みに失敗:', failed);
    });

  // ---- ステージの上の高さ（2026-08-04追加）----
  //
  // ★ 矩形の近似をやめ、**実際のモデルの床をレイキャストで拾う**。
  //
  //   きっかけはVRChat側の実測報告（返答②）。あちらがワールド全域でレイを撃った結果、
  //   **ステージは矩形ではなかった**。こちらの近似（x -5.5〜15.3／z -18.07〜-29）には、
  //   実際には天面ではなく「段」や「床」の場所が含まれていて、
  //   そこに立つとブラウザだけ 1.38m 浮くことになる。
  //   VRChat側は形を仮定せず毎回床を拾う作りにしたので、こちらも同じにして揃える。
  //
  // ⚠ レイは「立てる面の最高＝ステージ天面のすぐ上」から**下向きに短く**撃つ。
  //   高い位置から撃つと、天井や上空の物を拾って人が宙に浮く
  //   （VRChat側が実際にこれを踏んだ。あちらは trapper という上空の物を拾っていた）。
  // ⚠ 判定するのは**ステージの矩形の中だけ**。会場全体に広げると、
  //   水面や小物を拾って客席の歩きが変わってしまう（いまは平らな床として扱っている）。
  const _ray = new THREE.Raycaster();
  const _from = new THREE.Vector3();
  const _down = new THREE.Vector3(0, -1, 0);
  // 撃ち始めの高さ。ステージ天面(1.38)より少し上。ここを上げると上空の物を拾い始める
  const RAY_FROM_Y = STAGE.topY + 0.9;
  // 撃つ長さ。床(0)まで届けばよい。長くすると床下の造形を拾う
  const RAY_LEN = RAY_FROM_Y + 0.4;
  /**
   * 立てる面として認める高さの上限。
   * ⚠ 天面(1.38)ちょうどで切らないこと。実測すると**段や縁で 1.49 まで出る**ので、
   *   きつく切ると「そこだけ床に落ちる」不自然な段差になる（2026-08-04 実際に踏んだ）。
   */
  const STANDABLE_MAX_Y = STAGE.topY + 0.5;

  /**
   * その位置の「立てる面」の高さ。ステージの矩形の外、または未読み込みなら 0（床）。
   * @returns {number} 足元のy
   */
  function groundYAt(x, z) {
    if (!loaded || !model) return 0;
    if (x < STAGE.minX || x > STAGE.maxX || z < STAGE.minZ || z > STAGE.maxZ) return 0;
    _from.set(x, RAY_FROM_Y, z);
    _ray.set(_from, _down);
    _ray.far = RAY_LEN;
    const hits = _ray.intersectObject(model, true);
    if (!hits.length) return 0;
    const y = hits[0].point.y;
    // 想定外の高さを拾ったら床に落とす保険（VRChat側と同じ考え方）。
    // 0未満（床下）や、立てる面としてあり得ない高さのものは信用しない
    if (!Number.isFinite(y) || y < 0 || y > STANDABLE_MAX_Y) return 0;
    return y;
  }

  return {
    kind: 'club',
    bounds: BOUNDS,
    spawnPoint: SPAWN,
    screen: CLUB_SCREEN,
    /** ステージの上。管理人・VIPだけが上がれる（イベント設定でON/OFF） */
    stage: STAGE,
    /** その位置の足元の高さ。ステージの実形状をレイで拾う（矩形の近似ではない） */
    groundYAt,
    /** 会場の明るさを変える（'normal' / 'bright' / 'brightest'）。運営が決めて全員に効く */
    setBrightness,
    ready: loading,
    isLoaded: () => loaded,
    error: () => failed,
    /**
     * 会場の造形だけを消す（スクリーン・月・星空は残る）。
     *
     * シアター表示でカメラをスクリーン正面へ引くとき、縦画面では16m幅の映像を
     * 細い画面に収めるために30m下がる必要があり、その間に柱が入って映像が隠れる。
     * 距離を詰めると今度は画角が極端に広がって映像が小さくなるので、
     * 「観るときは会場を消す」で解決している（2026-07-30）。
     */
    setVenueVisible(v) {
      if (model) model.visible = v;
    },
    update() {
      // 会場自体は動かない。動くものを足すならここ
    },
  };
}
