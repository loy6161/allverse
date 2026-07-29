import * as THREE from 'three';
import { APP_NAME } from './brand.js';
import { addMoon, makeGlowTexture } from './night_sky.js';

// =====================================================================
// VERSE CITY - ライブ会場ワールド
// clubVERSE（VRChat版）の実写を目標に、暖色ネオン×紺色の夜空で寄せた再現
// 参照仕様: docs/WORLD_REFERENCE.md
// =====================================================================

// 暖色ネオンのメインパレット（オレンジ〜温白）。青紫は差し色のみ。
const NEON_WARM_A = 0xffb066; // オレンジ寄りの温白
const NEON_WARM_B = 0xffe3bf; // ほぼ白に近い温白
const NEON_ACCENT_VIOLET = 0x7c4dff; // 差し色

// ---------------------------------------------------------------------
// ユーティリティ: CanvasTexture 生成
// ---------------------------------------------------------------------

function makeScreenTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 背景グラデーション（紺〜黒）
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, '#050810');
  grad.addColorStop(0.5, '#0a1024');
  grad.addColorStop(1, '#04060e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 格子ライン（温白の薄いライン）
  ctx.strokeStyle = 'rgba(255, 210, 160, 0.10)';
  ctx.lineWidth = 2;
  for (let x = 0; x < canvas.width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // メインテキスト（暖色グロー）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 130px "Arial Black", sans-serif';

  ctx.shadowColor = '#ff9d4d';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#ffd7a8';
  ctx.fillText('VERSE', canvas.width / 2, canvas.height / 2 - 70);

  ctx.shadowColor = '#ffb066';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#fff1dd';
  ctx.fillText('CITY', canvas.width / 2, canvas.height / 2 + 90);

  ctx.shadowBlur = 0;
  ctx.font = '32px sans-serif';
  ctx.fillStyle = 'rgba(255,240,220,0.7)';
  ctx.fillText('c l u b V E R S E   L I V E', canvas.width / 2, canvas.height / 2 + 180);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// makeGlowTexture / makeMoonTexture は clubVERSE 側でも使うので night_sky.js へ移した。


function makeFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#07070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // タイル目地（暖色の薄いライン）
  ctx.strokeStyle = 'rgba(255, 176, 102, 0.14)';
  ctx.lineWidth = 3;
  const step = 64;
  for (let x = 0; x <= canvas.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // 中心付近を暖色でわずかに明るく（ダンスフロア感）
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 20,
    canvas.width / 2, canvas.height / 2, 260
  );
  grad.addColorStop(0, 'rgba(255,176,102,0.10)');
  grad.addColorStop(1, 'rgba(255,176,102,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------

export function createWorld(scene, opts = {}) {
  const lowSpec = opts.lowSpec === true;

  const group = new THREE.Group();
  scene.add(group);

  const dancefloorRings = [];

  // ---- 背景・霧（深い紺の夜空） ----
  scene.background = new THREE.Color(0x03050f);
  scene.fog = new THREE.FogExp2(0x050a18, 0.015);

  // ---- ライト ----
  // ステージ照明を撤去したぶん、アバターが暗くならないよう環境光を補っている
  const ambient = new THREE.AmbientLight(0x44557a, 0.85);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x33406a, 0x241a0c, 0.85);
  scene.add(hemi);

  // 月明かり（暖色寄りの薄い directional light。影は落とさない）
  const moonLight = new THREE.DirectionalLight(0xfff0da, 0.55);
  moonLight.position.set(30, 60, -180);
  scene.add(moonLight);

  // スクリーン側からの照り返し（客席に立つ人の顔が見えるように）
  const screenFill = new THREE.DirectionalLight(0xffd9ac, 0.45);
  screenFill.position.set(0, 6, -12);
  scene.add(screenFill);

  // =====================================================================
  // 巨大な月
  // =====================================================================
  addMoon(group, { position: [18, 68, -210], radius: 24, glowScale: 90 });

  // ---- 地面（暗く艶のある床） ----
  // 鏡面反射（Reflector）は 2026-07-29 に廃止した。
  // 反射像は見る角度によって照明やネオンをそのまま映し返すため、浅い角度で必ず眩しくなる。
  // 明るさを下げても角度次第で再発するので、機能ごと外している（ユーザー判断: 反射は不要）。
  // 描画も1パス減るので負荷も下がる。
  const floorGeo = new THREE.CircleGeometry(40, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a10,
    roughness: 0.62,
    metalness: 0.3,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = !lowSpec;
  group.add(floor);

  // 床の質感ディテール（タイル目地＋中央の暖色グラデーション）
  const floorDetailTex = makeFloorTexture();
  const floorDetailMat = new THREE.MeshBasicMaterial({
    map: floorDetailTex,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const floorDetail = new THREE.Mesh(floorGeo, floorDetailMat);
  floorDetail.rotation.x = -Math.PI / 2;
  floorDetail.position.y = 0.015;
  group.add(floorDetail);

  // ダンスフロア中央の発光リング（暖色メイン＋差し色1本）
  const ringColors = [NEON_WARM_A, NEON_WARM_B, NEON_ACCENT_VIOLET];
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.RingGeometry(4 + i * 3.2, 4.4 + i * 3.2, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColors[i % ringColors.length],
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.userData.baseOpacity = 0.35;
    ring.userData.phase = i * 1.3;
    group.add(ring);
    dancefloorRings.push(ring);
  }

  // =====================================================================
  // スクリーン設置エリア
  // ステージ（床の段差）は「スクリーンに近づくと登ってしまう／めり込む」ため撤去し、
  // 平らな床のまま、LEDスクリーンだけを設置している。
  // LEDスクリーンはワールド座標 (0, 5.4, -18.95) / 幅14×高さ7 固定（screen.jsが重ねる）
  // =====================================================================
  const stageGroup = new THREE.Group();
  stageGroup.position.set(0, 0, -15);
  group.add(stageGroup);

  const stageHeight = 1.2; // スクリーン高さの基準として残す（床の段差そのものは無い）
  const stageRadius = 8.5; // 意匠（ネオン等）の配置基準として残す
  const screenLocalZ = -18.95 - stageGroup.position.z; // = -3.95（スクリーンのワールド座標を固定するため直接計算）

  // 背面LEDスクリーン（位置・サイズ固定: 幅14×高さ7、ワールド(0,5.4,-18.95)）
  const screenTex = makeScreenTexture(APP_NAME);
  const screenGeo = new THREE.PlaneGeometry(14, 7);
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenTex,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, stageHeight + 4.2, screenLocalZ);
  stageGroup.add(screen);

  // スクリーン枠（screenより奥に配置してZファイティング回避）
  const frameGeo = new THREE.BoxGeometry(14.6, 7.6, 0.3);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a10,
    emissive: NEON_WARM_A,
    emissiveIntensity: 0.35,
    roughness: 0.5,
    metalness: 0.5,
  });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, stageHeight + 4.2, screenLocalZ - 0.3);
  stageGroup.add(frame);

  // ---- 汎用の箱ジオメトリ（意匠で使い回す） ----
  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);

  // ステージ・トラス柱・スピーカー・スポットライトは撤去した。
  // 理由: スクリーンの近くで見たいのに段差や機材にぶつかる／めり込むため。
  // 会場の明るさは環境光とネオンの意匠で確保している。
  const trussPillars = [];
  const spotLights = [];
  const spotCones = [];

  // =====================================================================
  // V字/への字のネオンライン（会場の象徴的な意匠。左右対称）
  // =====================================================================
  const neonBarGeo = new THREE.BoxGeometry(1, 1, 1);
  const neonGlowTex = makeGlowTexture('rgba(255,240,220,0.95)', 'rgba(255,176,102,0.4)');

  function createNeonChevron(mirror) {
    const chevron = new THREE.Group();
    const armLength = 9;
    const angle = THREE.MathUtils.degToRad(22); // 垂直からの開き角
    const thickness = 0.22;

    const coreMat = new THREE.MeshStandardMaterial({
      color: NEON_WARM_B,
      emissive: NEON_WARM_A,
      emissiveIntensity: 4.5,
      roughness: 0.25,
      toneMapped: false,
    });
    const haloMat = new THREE.MeshBasicMaterial({
      color: NEON_WARM_A,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (const side of [-1, 1]) {
      const dir = side * mirror;

      // ネオンの芯（明るい発光バー）
      const core = new THREE.Mesh(neonBarGeo, coreMat);
      core.scale.set(thickness, armLength, thickness);
      core.position.set((Math.sin(angle) * armLength * dir) / 2, (Math.cos(angle) * armLength) / 2, 0);
      core.rotation.z = -angle * dir;
      chevron.add(core);

      // にじみ（太め・低不透明度の同形状を重ねてブルーム風の見た目に）
      const halo = new THREE.Mesh(neonBarGeo, haloMat);
      halo.scale.set(thickness * 3.2, armLength * 1.02, thickness * 3.2);
      halo.position.copy(core.position);
      halo.rotation.copy(core.rotation);
      chevron.add(halo);
    }

    // 光芒スプライト（カメラ常に正対、ソフトなグローでブルームを代替）
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: neonGlowTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.scale.set(14, 18, 1);
    glow.position.set(0, armLength * 0.55, 0.2);
    chevron.add(glow);

    return chevron;
  }

  const chevronLeft = createNeonChevron(-1);
  chevronLeft.position.set(-13.5, 3.4, screenLocalZ - 1.2);
  stageGroup.add(chevronLeft);

  const chevronRight = createNeonChevron(1);
  chevronRight.position.set(13.5, 3.4, screenLocalZ - 1.2);
  stageGroup.add(chevronRight);

  // =====================================================================
  // 板状モノリス群（黒〜濃灰の細長い構造物。窓のあるビルは廃止）
  // =====================================================================
  const monolithGroup = new THREE.Group();
  group.add(monolithGroup);

  const monolithBodyGeo = new THREE.BoxGeometry(1, 1, 1); // scaleで使い回す
  const monolithEdgeGeo = new THREE.BoxGeometry(1, 1, 1); // 発光ラインもscaleで使い回す

  const monolithBodyMat = new THREE.MeshStandardMaterial({
    color: 0x0b0b0f,
    roughness: 0.75,
    metalness: 0.25,
    emissive: 0x050508,
    emissiveIntensity: 0.3,
  });

  const monolithCount = lowSpec ? 14 : 26;
  const radiusMin = 24;
  const radiusMax = 34;
  const edgeGlowMeshes = [];

  for (let i = 0; i < monolithCount; i++) {
    const angle = (i / monolithCount) * Math.PI * 2 + (i % 2) * 0.15;
    const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;

    // ステージ正面（客席側の視界）にはモノリスを置かない
    if (z > 10 && Math.abs(x) < 10) continue;

    const width = 1.6 + Math.random() * 2.2;
    const depth = 1.2 + Math.random() * 1.6;
    const height = 7 + Math.random() * 22;

    const body = new THREE.Mesh(monolithBodyGeo, monolithBodyMat);
    body.scale.set(width, height, depth);
    body.position.set(x, height / 2, z);
    body.rotation.y = Math.random() * Math.PI;
    body.castShadow = false;
    body.receiveShadow = true;
    monolithGroup.add(body);

    // 縦の発光エッジライン（暖色 or 差し色の青紫を稀に）
    const edgeColor = Math.random() > 0.15 ? NEON_WARM_A : NEON_ACCENT_VIOLET;
    const edgeMat = new THREE.MeshStandardMaterial({
      color: edgeColor,
      emissive: edgeColor,
      emissiveIntensity: 2.4,
      roughness: 0.3,
      toneMapped: false,
    });
    const edge = new THREE.Mesh(monolithEdgeGeo, edgeMat);
    const edgeThickness = 0.06;
    edge.scale.set(edgeThickness, height * 0.92, edgeThickness);
    const side = Math.random() > 0.5 ? 1 : -1;
    edge.position.set((width / 2) * side * 0.98, 0, (depth / 2) * 0.98);
    body.add(edge);
    edgeGlowMeshes.push(edge);

    // 上部の横向き発光ライン（一部のみ）
    if (Math.random() > 0.5) {
      const bandMat = new THREE.MeshStandardMaterial({
        color: NEON_WARM_B,
        emissive: NEON_WARM_B,
        emissiveIntensity: 1.8,
        roughness: 0.3,
        toneMapped: false,
      });
      const band = new THREE.Mesh(monolithEdgeGeo, bandMat);
      band.scale.set(width * 0.9, 0.05, depth * 1.02);
      band.position.set(0, height * (0.28 + Math.random() * 0.3), 0);
      body.add(band);
    }
  }

  // 観客エリアの柵も撤去（スクリーンへ自由に近づけるように、床には何も置かない）

  // =====================================================================
  // 光の粒子（空間に舞う小さな光の粒）
  // =====================================================================
  const particleCount = lowSpec ? 220 : 1400;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleBaseY = new Float32Array(particleCount);
  const particlePhase = new Float32Array(particleCount);
  const particleColors = new Float32Array(particleCount * 3);

  const warmColorA = new THREE.Color(NEON_WARM_A);
  const warmColorB = new THREE.Color(0xfff4e0);

  for (let i = 0; i < particleCount; i++) {
    const radius = Math.random() * 33;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const y = 0.5 + Math.random() * 13;

    particlePositions[i * 3] = x;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = z;
    particleBaseY[i] = y;
    particlePhase[i] = Math.random() * Math.PI * 2;

    const mixed = warmColorA.clone().lerp(warmColorB, Math.random());
    particleColors[i * 3] = mixed.r;
    particleColors[i * 3 + 1] = mixed.g;
    particleColors[i * 3 + 2] = mixed.b;
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const particleDotTex = makeGlowTexture('rgba(255,255,255,1)', 'rgba(255,200,150,0.6)');
  const particleMat = new THREE.PointsMaterial({
    size: 0.22,
    map: particleDotTex,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  group.add(particles);

  // =====================================================================
  // アニメーション用ステート
  // =====================================================================

  const tmpColor = new THREE.Color();

  function update(dt, elapsedTime) {
    // ダンスフロアのリングを明滅させる
    for (const ring of dancefloorRings) {
      const pulse = 0.25 + Math.sin(elapsedTime * 1.5 + ring.userData.phase) * 0.15;
      ring.material.opacity = Math.max(0.05, pulse);
    }

    // スポットライトの色相・角度をゆっくり回す（暖色域中心、たまに青紫）
    for (let i = 0; i < spotLights.length; i++) {
      const spot = spotLights[i];
      const hue = (0.08 + Math.sin(elapsedTime * 0.07 + i) * 0.06 + i * 0.02) % 1;
      tmpColor.setHSL(hue, 0.85, 0.6);
      spot.color.copy(tmpColor);

      const swing = Math.sin(elapsedTime * 0.6 + i * 1.7) * 4;
      spot.target.position.x = spotOriginPositions[i][0] * 0.3 + swing;
      spot.target.position.z = screenLocalZ + 11 + Math.cos(elapsedTime * 0.4 + i) * 3;
    }

    // 光線コーンも同じ色・角度に追従
    for (let i = 0; i < spotCones.length; i++) {
      const cone = spotCones[i];
      const hue = (0.08 + Math.sin(elapsedTime * 0.07 + i) * 0.06 + i * 0.02) % 1;
      cone.material.color.setHSL(hue, 0.85, 0.6);
      const swing = Math.sin(elapsedTime * 0.6 + i * 1.7) * 0.35;
      cone.rotation.z = swing;
      cone.rotation.x = Math.cos(elapsedTime * 0.4 + i) * 0.15;
    }

    // トラス柱のemissive明滅
    const trussPulse = 0.5 + Math.sin(elapsedTime * 2) * 0.3;
    for (const pillar of trussPillars) {
      pillar.material.emissiveIntensity = trussPulse;
    }

    // モノリスの縦エッジラインをごくゆっくり明滅させて生っぽさを出す
    for (let i = 0; i < edgeGlowMeshes.length; i++) {
      const edge = edgeGlowMeshes[i];
      edge.material.emissiveIntensity = 2.0 + Math.sin(elapsedTime * 0.8 + i * 0.7) * 0.5;
    }

    // 光の粒子：ゆるやかに上下しつつ全体をゆっくり回転
    const posAttr = particleGeo.attributes.position;
    for (let i = 0; i < particleCount; i++) {
      const y = particleBaseY[i] + Math.sin(elapsedTime * 0.3 + particlePhase[i]) * 0.6;
      posAttr.array[i * 3 + 1] = y;
    }
    posAttr.needsUpdate = true;
    particles.rotation.y += dt * 0.015;
  }

  return {
    update,
    bounds: { minX: -35, maxX: 35, minZ: -35, maxZ: 35 },
    spawnPoint: new THREE.Vector3(0, 0, 18),
  };
}
