import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ------------------------------------------------------------------
// clubVERSE（VRChatの実ワールドから持ってきた会場）
//
// U:\UNITY\WORLD\project\VERSE CITY2025 の書き出し用シーンを
// FBX → Blender → GLB に変換したもの。変換時にやったこと:
//   ・当たり判定専用オブジェクトを削除
//   ・法線マップを破棄（3枚で26MB。lilToonの平坦な見た目では差が出ない）
//   ・テクスチャを半分に縮小し WebP 化（82.8MB → 約4MB）
//   ・マテリアル別に1メッシュへ結合（描画コール 320 → 16）
//   ・原点合わせ（会場の中心が0,0、床が y=0）
//
// 実測値（変換後）:
//   幅 58.35m × 奥行 67.04m × 高さ 21.28m ／ 三角形 62,871 ／ マテリアル 16
//   ステージ天面 y=2.78、ステージ前端 z=-18.07、背面ガラス z=-30
//
// 注意: シェーダーはlilToonから変換されているので、VRChatと同じ見た目にはならない。
// 「造形が同じで、雰囲気を寄せる」方針（2026-07-30 確定）。
// ------------------------------------------------------------------

const MODEL_URL = 'assets/world/clubverse.glb';

// スクリーンを置く場所。ステージ背面(STAGE_BACK_GLASS: 幅20.86m・z=-30)の手前。
// 背面ぴったりに置くと、装飾の縦柱が映像の上に重なって観られないので、柱より手前に出す。
export const CLUB_SCREEN = {
  x: 4.88,
  y: 8,
  z: -28.3,
  width: 16,
  height: 9,
};

// 歩ける範囲。床の高さを4m刻みで実測して決めた（当たり判定は入れていないので矩形で囲うだけ）。
// 床があるのは x -20〜28 / z -28〜20。壁の内側に少し余裕を持たせている
const BOUNDS = { minX: -19, maxX: 27, minZ: -27, maxZ: 19 };

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

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer 金属の映り込み用の環境マップを作るのに使う
 */
export function createClubWorld(scene, { renderer } = {}) {
  scene.background = new THREE.Color(0x05060f);
  scene.fog = new THREE.Fog(0x05060f, 60, 140);

  // ---- 明かり ----
  // VRChat側は焼いた光（Bakery）で見せているが、それは持ってきていない。
  // ブラウザ側は素直にライトを置いて雰囲気を寄せる。影は落とさない（負荷とフラットな見た目のため）
  scene.add(new THREE.HemisphereLight(0x8899ff, 0x140a20, 0.30));

  const key = new THREE.DirectionalLight(0xfff0e0, 0.45);
  key.position.set(12, 26, 10);
  scene.add(key);

  const back = new THREE.DirectionalLight(0x88aaff, 0.20);
  back.position.set(-14, 18, -24);
  scene.add(back);

  // ステージ側からの照り返し。会場の奥が真っ暗にならないように
  const stageGlow = new THREE.PointLight(0xff66dd, 15, 40, 2);
  stageGlow.position.set(CLUB_SCREEN.x, 6, -24);
  scene.add(stageGlow);

  // 金属マテリアル（MI_Metal系）が真っ黒にならないよう、環境を1枚用意する
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    // 金属の映り込みだけを目的にしているので、明るさへの寄与は控えめでよい
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
      model.traverse((o) => {
        if (!o.isMesh) return;
        // 影は使わない方針（2026-07-29 確定）
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = true;
      });
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
    ready: loading,
    isLoaded: () => loaded,
    error: () => failed,
    update() {
      // 会場自体は動かない。動くものを足すならここ
    },
  };
}
