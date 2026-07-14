import * as THREE from 'three';

// =====================================================================
// VERSE CITY - ライブ会場ワールド（仮モデル）
// clubVERSE を仮再現する夜のネオンシティ × ライブ会場
// =====================================================================

// ---------------------------------------------------------------------
// ユーティリティ: CanvasTexture 生成
// ---------------------------------------------------------------------

function makeScreenTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 背景グラデーション
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, '#050014');
  grad.addColorStop(0.5, '#1a0033');
  grad.addColorStop(1, '#000814');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 格子ライン
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
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

  // メインテキスト（グロー）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 130px "Arial Black", sans-serif';

  ctx.shadowColor = '#ff00ff';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#ff33ff';
  ctx.fillText('VERSE', canvas.width / 2, canvas.height / 2 - 70);

  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#33ffff';
  ctx.fillText('CITY', canvas.width / 2, canvas.height / 2 + 90);

  ctx.shadowBlur = 0;
  ctx.font = '32px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('c l u b V E R S E   L I V E', canvas.width / 2, canvas.height / 2 + 180);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // 急角度から見ても文字が潰れないように
  return tex;
}

function makeWindowTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = 6;
  const rows = 14;
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;

  // 簡易乱数（seed固定でビルごとに柄を変える）
  let s = seed;
  function rand() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }

  const hueA = 190; // シアン系
  const hueB = 300; // マゼンタ系

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = rand() > 0.55;
      if (!lit) continue;
      const hue = rand() > 0.5 ? hueA : hueB;
      const light = 55 + rand() * 25;
      ctx.fillStyle = `hsl(${hue}, 90%, ${light}%)`;
      ctx.fillRect(
        c * cellW + cellW * 0.15,
        r * cellH + cellH * 0.2,
        cellW * 0.7,
        cellH * 0.6
      );
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // タイル目地
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.25)';
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

  // 中心付近を少し明るく（ダンスフロア感）
  const grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 20,
    canvas.width / 2, canvas.height / 2, 260
  );
  grad.addColorStop(0, 'rgba(0,255,255,0.12)');
  grad.addColorStop(1, 'rgba(0,255,255,0)');
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

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const dancefloorRings = [];
  const beacons = [];

  // ---- 背景・霧 ----
  scene.background = new THREE.Color(0x030308);
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.018);

  // ---- ライト ----
  const ambient = new THREE.AmbientLight(0x556688, 0.85);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x6666ff, 0x221133, 0.7);
  scene.add(hemi);

  const moonLight = new THREE.DirectionalLight(0x8899ff, 0.25);
  moonLight.position.set(-20, 30, -10);
  scene.add(moonLight);

  // ---- 地面 ----
  const floorTex = makeFloorTexture();
  const floorGeo = new THREE.CircleGeometry(40, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.3,
    emissive: 0x0a1a2a,
    emissiveIntensity: 0.3,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ダンスフロア中央の発光リング（複数）
  const ringColors = [0x00ffff, 0xff00ff, 0x8000ff];
  for (let i = 0; i < 3; i++) {
    const ringGeo = new THREE.RingGeometry(4 + i * 3.2, 4.4 + i * 3.2, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColors[i % ringColors.length],
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.userData.baseOpacity = 0.35;
    ring.userData.phase = i * 1.3;
    group.add(ring);
    dancefloorRings.push(ring);
  }

  // ---- メインステージ ----
  const stageGroup = new THREE.Group();
  stageGroup.position.set(0, 0, -15);
  group.add(stageGroup);

  const stageWidth = 16;
  const stageDepth = 8;
  const stageHeight = 1.2;

  const stageBaseGeo = new THREE.BoxGeometry(stageWidth, stageHeight, stageDepth);
  const stageBaseMat = new THREE.MeshStandardMaterial({
    color: 0x111120,
    roughness: 0.4,
    metalness: 0.6,
    emissive: 0x220033,
    emissiveIntensity: 0.4,
  });
  const stageBase = new THREE.Mesh(stageBaseGeo, stageBaseMat);
  stageBase.position.y = stageHeight / 2;
  stageBase.castShadow = true;
  stageBase.receiveShadow = true;
  stageGroup.add(stageBase);

  // ステージ縁の発光ライン
  const edgeGeo = new THREE.BoxGeometry(stageWidth + 0.15, 0.12, stageDepth + 0.15);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 1.5,
    roughness: 0.3,
  });
  const stageEdge = new THREE.Mesh(edgeGeo, edgeMat);
  stageEdge.position.y = stageHeight + 0.02;
  stageGroup.add(stageEdge);

  // 背面LEDスクリーン
  const screenTex = makeScreenTexture('VERSE CITY');
  const screenGeo = new THREE.PlaneGeometry(14, 7);
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenTex,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, stageHeight + 4.2, -stageDepth / 2 - 0.05); // 枠(z=-0.2〜-0.5)より手前に出してZファイティング回避
  stageGroup.add(screen);

  // スクリーン枠
  const frameGeo = new THREE.BoxGeometry(14.6, 7.6, 0.3);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a12,
    emissive: 0xff00ff,
    emissiveIntensity: 0.3,
    roughness: 0.5,
    metalness: 0.5,
  });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, stageHeight + 4.2, -stageDepth / 2 - 0.35);
  stageGroup.add(frame);

  // ステージ両脇の柱（トラス風）
  const pillarGeo = new THREE.BoxGeometry(0.5, 8, 0.5);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a,
    emissive: 0x00ffff,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0.7,
  });
  const pillarPositions = [
    [-stageWidth / 2 - 0.5, 4, -stageDepth / 2],
    [stageWidth / 2 + 0.5, 4, -stageDepth / 2],
    [-stageWidth / 2 - 0.5, 4, stageDepth / 2],
    [stageWidth / 2 + 0.5, 4, stageDepth / 2],
  ];
  const trussPillars = [];
  for (const [x, y, z] of pillarPositions) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, y, z);
    pillar.castShadow = true;
    stageGroup.add(pillar);
    trussPillars.push(pillar);
  }

  // ---- ライブ照明（スポットライト + 光線コーン） ----
  const spotLights = [];
  const spotCones = [];
  const spotColors = [0x00ffff, 0xff00ff, 0xffff00, 0x00ff88];

  const spotOriginY = 7.5;
  const spotOriginPositions = [
    [-6, spotOriginY, -12],
    [-2, spotOriginY, -12],
    [2, spotOriginY, -12],
    [6, spotOriginY, -12],
  ];

  for (let i = 0; i < spotOriginPositions.length; i++) {
    const [x, y, z] = spotOriginPositions[i];
    const color = spotColors[i % spotColors.length];

    const spot = new THREE.SpotLight(color, i === 1 ? 25 : 15, 30, Math.PI / 7, 0.4, 1.5);
    spot.position.set(x, y, z);
    const target = new THREE.Object3D();
    target.position.set(x * 0.3, 0, -15);
    stageGroup.add(target);
    spot.target = target;

    // 影を落とすのは1〜2灯のみ（性能配慮）
    if (i === 1 || i === 2) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(512, 512);
      spot.shadow.camera.near = 1;
      spot.shadow.camera.far = 40;
    }
    stageGroup.add(spot);
    spotLights.push(spot);

    // 光線を表現する半透明コーン（頂点=光源側、底面=床側）
    const coneGeo = new THREE.ConeGeometry(2.2, 7.5, 24, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(x, y - 3.75, z);
    cone.userData.baseX = x;
    cone.userData.baseZ = z;
    cone.userData.phase = i * 1.1;
    stageGroup.add(cone);
    spotCones.push(cone);
  }

  // ---- 周囲のビル群 ----
  const buildingGroup = new THREE.Group();
  group.add(buildingGroup);

  const windowTex1 = makeWindowTexture(11);
  const windowTex2 = makeWindowTexture(37);
  const neonPanelColors = [0x00ffff, 0xff00ff, 0xffff00, 0xff3366, 0x33ff99];

  const buildingCount = 16;
  const radiusMin = 26;
  const radiusMax = 34;

  for (let i = 0; i < buildingCount; i++) {
    const angle = (i / buildingCount) * Math.PI * 2 + (i % 2) * 0.15;
    const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;

    // ステージ正面(z=+18付近)にはビルを置かず視界を確保
    if (z > 10 && Math.abs(x) < 10) continue;

    const width = 3 + Math.random() * 3;
    const depth = 3 + Math.random() * 3;
    const height = 6 + Math.random() * 20;

    const windowTex = i % 2 === 0 ? windowTex1 : windowTex2;
    const tex = windowTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, Math.round(height / 6)));

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x14141f,
      roughness: 0.7,
      metalness: 0.2,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
    });

    const bldg = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMat);
    bldg.position.set(x, height / 2, z);
    bldg.rotation.y = Math.random() * Math.PI;
    bldg.castShadow = false;
    bldg.receiveShadow = true;
    buildingGroup.add(bldg);

    // ネオン看板パネル（ところどころ）
    if (Math.random() > 0.4) {
      const panelColor = neonPanelColors[i % neonPanelColors.length];
      const panelMat = new THREE.MeshStandardMaterial({
        color: panelColor,
        emissive: panelColor,
        emissiveIntensity: 1.8,
        roughness: 0.4,
      });
      const panelW = width * 0.7;
      const panelH = 1 + Math.random() * 1.5;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), panelMat);
      const side = Math.random() > 0.5 ? 1 : -1;
      panel.position.set(0, height * (0.3 + Math.random() * 0.4), (depth / 2 + 0.02) * side);
      if (side < 0) panel.rotation.y = Math.PI;
      bldg.add(panel);
    }

    // 屋上の点滅灯
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff3355,
      emissive: 0xff3355,
      emissiveIntensity: 2,
    });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), beaconMat);
    beacon.position.set(0, height / 2 + 0.2, 0);
    bldg.add(beacon);
    beacons.push(beacon);
  }

  // ---- 観客エリアの簡易柵/装飾（雰囲気付け） ----
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x222233,
    emissive: 0x00ffff,
    emissiveIntensity: 0.4,
    roughness: 0.5,
    metalness: 0.5,
  });
  const barrierGeo = new THREE.BoxGeometry(1.6, 0.6, 0.15);
  const barrierCount = 14;
  const barrierRadius = 10;
  for (let i = 0; i < barrierCount; i++) {
    const a = (i / barrierCount) * Math.PI * 1.1 - Math.PI * 0.55;
    const x = Math.sin(a) * barrierRadius;
    const z = -8 + Math.cos(a) * barrierRadius * 0.35;
    const bar = new THREE.Mesh(barrierGeo, barrierMat);
    bar.position.set(x, 0.3, z);
    bar.rotation.y = -a;
    group.add(bar);
  }

  // =====================================================================
  // アニメーション用ステート
  // =====================================================================

  function update(dt, elapsedTime) {
    // ダンスフロアのリングを明滅させる
    for (const ring of dancefloorRings) {
      const pulse = 0.25 + Math.sin(elapsedTime * 1.5 + ring.userData.phase) * 0.15;
      ring.material.opacity = Math.max(0.05, pulse);
    }

    // スポットライトの色相・角度をゆっくり回す
    for (let i = 0; i < spotLights.length; i++) {
      const spot = spotLights[i];
      const hue = (elapsedTime * 0.05 + i * 0.25) % 1;
      const c = new THREE.Color();
      c.setHSL(hue, 1, 0.55);
      spot.color.copy(c);

      const swing = Math.sin(elapsedTime * 0.6 + i * 1.7) * 4;
      spot.target.position.x = spotOriginPositions[i][0] * 0.3 + swing;
      spot.target.position.z = -15 + Math.cos(elapsedTime * 0.4 + i) * 3;
    }

    // 光線コーンも同じ色・角度に追従
    for (let i = 0; i < spotCones.length; i++) {
      const cone = spotCones[i];
      const hue = (elapsedTime * 0.05 + i * 0.25) % 1;
      cone.material.color.setHSL(hue, 1, 0.55);
      const swing = Math.sin(elapsedTime * 0.6 + i * 1.7) * 0.35;
      cone.rotation.z = swing;
      cone.rotation.x = Math.cos(elapsedTime * 0.4 + i) * 0.15;
    }

    // トラス柱のemissive明滅
    const trussPulse = 0.5 + Math.sin(elapsedTime * 2) * 0.3;
    for (const pillar of trussPillars) {
      pillar.material.emissiveIntensity = trussPulse;
    }

    // 屋上ビーコンの点滅
    const beaconBlink = (Math.sin(elapsedTime * 3) + 1) / 2;
    for (const beacon of beacons) {
      beacon.material.emissiveIntensity = 0.5 + beaconBlink * 2.5;
    }
  }

  return {
    update,
    bounds: { minX: -35, maxX: 35, minZ: -35, maxZ: 35 },
    spawnPoint: new THREE.Vector3(0, 0, 18),
  };
}
