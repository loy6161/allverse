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
  // ⚠ ライトの強さだけを倍率で動かす。色は変えない。
  //   色まで変えると「白すぎる」を直したとき(2026-07-30)の調整が壊れる。
  //   環境マップ（金属の映り込み）も触らない。あれを明るくすると壁が白く浮く。
  //
  // ⚠ 上げすぎると床のゴールドのロゴと金属が白飛びする。
  //   実際に見ながら決められるよう3段階に留め、いちばん上でも1.5倍までにしてある。
  const BASE = {
    hemi: hemi.intensity,
    key: key.intensity,
    back: back.intensity,
    stageGlow: stageGlow.intensity,
    floorGlow: floorGlow.intensity,
  };
  /** 明るさの段階 → 倍率。'normal' がこれまでの見た目（既定） */
  const BRIGHTNESS = { normal: 1.0, bright: 1.22, brightest: 1.5 };

  function setBrightness(level) {
    const k = BRIGHTNESS[level] ? level : 'normal';
    const f = BRIGHTNESS[k];
    hemi.intensity = BASE.hemi * f;
    key.intensity = BASE.key * f;
    back.intensity = BASE.back * f;
    // 演出の光（ステージのピンク・床の照り返し）は伸びを抑える。
    // 同じ倍率で上げると、明るくというより「色が濃くなる」方向に転ぶため
    const g = 1 + (f - 1) * 0.6;
    stageGlow.intensity = BASE.stageGlow * g;
    floorGlow.intensity = BASE.floorGlow * g;
    return k;
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
      loaded = true;
      return model;
    })
    .catch((e) => {
      failed = String(e && e.message ? e.message : e);
      console.error('[world_club] 会場の読み込みに失敗:', failed);
    });

  return {
    kind: 'club',
    bounds: BOUNDS,
    spawnPoint: SPAWN,
    screen: CLUB_SCREEN,
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
