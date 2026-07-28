import * as THREE from 'three';

// ------------------------------------------------------------------
// 案1: ミニデフォルメ（2.5頭身・身長1.1m前後）
// 頭を大きく体を小さく丸くした「ねんどろいど」的バランス。
// 頭が大きいぶん表情を主役にするため、CanvasTextureの顔を大きく描く。
// トゥーンシェード＋太めの輪郭線（反転ハル）で「わちゃわちゃ可愛い」群衆を狙う。
// ------------------------------------------------------------------

export const STYLE_INFO = {
  id: 'mini_deform',
  name: 'ミニデフォルメ',
  desc: '2.5頭身の振り切ったミニキャラ',
};

// ---- サイズ定数（身長1.1m前後・約2.5頭身） --------------------------
// 頭頂までの計算目安（全て絶対Y、原点=足元）:
//   FOOT_Y(0.05) + LEG_LEN(0.22)=HIP_Y(0.27) → 頭中心 abs 0.77 → 頭頂 abs 約1.03
//   + 髪の盛り上がり分で 1.1m 前後に収まる。
const HEAD_R = 0.27;
const FOOT_R = 0.1;
const FOOT_Y = 0.05; // 足（接地パーツ）の中心高さ
const LEG_R_TOP = 0.12;
const LEG_R_BOTTOM = 0.1;
const LEG_LEN = 0.22;
const HIP_Y = FOOT_Y + LEG_LEN; // 0.27 : upperGroup / 脚pivotの基準高さ
const TORSO_R = 0.2;
const TORSO_Y = 0.16; // upperGroup基準での胴体中心オフセット
const SHOULDER_Y = TORSO_Y + TORSO_R * 0.55; // upperGroup基準
const ARM_R_TOP = 0.075;
const ARM_R_BOTTOM = 0.069;
const ARM_LEN = 0.19;
const HAND_R = 0.095;
const HEAD_Y = 0.5; // upperGroup基準。胴体に大きくめり込ませ、首を省略して一体感を出す
const SHOULDER_X = TORSO_R * 0.92;
const LEG_X = TORSO_R * 0.42;

// ---- トゥーン用グラデーションマップ（階調3段） ----
function createGradientMap(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT_MAP = createGradientMap(3);

function toonMat(color, emissiveFactor = 0.05) {
  const emissive = new THREE.Color(color).multiplyScalar(emissiveFactor);
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT_MAP, emissive });
}

// 靴（共通ニュートラル色。ユーザー色に依存しないので共有できる）
const SHOE_MAT = new THREE.MeshToonMaterial({ color: '#2a2230', gradientMap: GRADIENT_MAP });

// 輪郭線（反転ハル方式・やや太め）
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: '#160a1e', side: THREE.BackSide });

// ---- 共有ジオメトリ（色を持たないので全アバターで使い回せる） ----
const HEAD_GEO = new THREE.SphereGeometry(HEAD_R, 16, 12);
const FACE_PLANE_GEO = new THREE.PlaneGeometry(HEAD_R * 1.5, HEAD_R * 1.3);
const TORSO_GEO = new THREE.SphereGeometry(TORSO_R, 14, 10);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, LEG_LEN, 10, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, 8, 1, true);
const FOOT_GEO = new THREE.SphereGeometry(FOOT_R, 8, 6);
const HAND_GEO = new THREE.SphereGeometry(HAND_R, 8, 6);

// ---- 髪パーツ用の共有ジオメトリ（頭が大きいのでシルエットを大胆に作り分ける） ----
const HAIR_CAP_GEO = new THREE.SphereGeometry(HEAD_R * 1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
const HAIR_SPIKE_GEO = new THREE.ConeGeometry(HEAD_R * 0.16, HEAD_R * 0.5, 6);
const HAIR_LONG_BACK_GEO = new THREE.CapsuleGeometry(HEAD_R * 0.62, HEAD_R * 1.5, 4, 8);
const HAIR_TWIN_BUN_GEO = new THREE.SphereGeometry(HEAD_R * 0.46, 8, 7);
const HAIR_TWIN_TAIL_GEO = new THREE.CapsuleGeometry(HEAD_R * 0.16, HEAD_R * 0.7, 3, 6);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(HEAD_R * 1.35, HEAD_R * 1.35, HEAD_R * 0.12, 14, 1, false);
const HAT_DOME_GEO = new THREE.SphereGeometry(HEAD_R * 0.86, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
const HAT_POM_GEO = new THREE.SphereGeometry(HEAD_R * 0.2, 8, 6);

// ------------------------------------------------------------------
// 顔テクスチャ（CanvasTexture）：大きな目・大きめチーク・シンプルな口。
// 比較用の静止アバターなので表情は1種のみ（まばたき等のアニメは持たない）。
// 色に依存しない絵柄なので全アバターで共有できる。
// ------------------------------------------------------------------
let faceTexCache = null;
function getFaceTexture() {
  if (faceTexCache) return faceTexCache;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const leftX = size * 0.32;
  const rightX = size * 0.68;
  const eyeY = size * 0.52;
  const eyeW = size * 0.19;
  const eyeH = size * 0.24;

  // チーク（大きめ）
  ctx.save();
  ctx.globalAlpha = 0.4;
  [leftX - size * 0.04, rightX + size * 0.04].forEach((cx) => {
    const grad = ctx.createRadialGradient(cx, size * 0.68, 1, cx, size * 0.68, size * 0.13);
    grad.addColorStop(0, '#ff8fae');
    grad.addColorStop(1, 'rgba(255,143,174,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, size * 0.68, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // 目（白目・瞳グラデーション・二重ハイライト）
  [leftX, rightX].forEach((ex) => {
    ctx.fillStyle = '#fffdfb';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW * 0.5, eyeH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const irisGrad = ctx.createRadialGradient(
      ex,
      eyeY + eyeH * 0.05,
      eyeW * 0.06,
      ex,
      eyeY + eyeH * 0.1,
      eyeW * 0.46
    );
    irisGrad.addColorStop(0, '#4a3a5e');
    irisGrad.addColorStop(1, '#1c1420');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeH * 0.08, eyeW * 0.44, eyeH * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#140b12';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - eyeH * 0.02, eyeW * 0.52, eyeH * 0.5, 0, Math.PI * 1.0, Math.PI * 2.0);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex - eyeW * 0.16, eyeY - eyeH * 0.16, eyeW * 0.17, eyeH * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + eyeW * 0.18, eyeY + eyeH * 0.24, eyeW * 0.08, 0, Math.PI * 2);
    ctx.fill();
  });

  // 口（小さめのにっこりライン）
  ctx.strokeStyle = '#7a3b4a';
  ctx.lineWidth = size * 0.02;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.44, size * 0.78);
  ctx.quadraticCurveTo(size * 0.5, size * 0.83, size * 0.56, size * 0.78);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  faceTexCache = tex;
  return tex;
}

// ---- 髪生成：4スタイルをシルエットで大胆に作り分け ----
function buildHair(style, hairColor) {
  const group = new THREE.Group();
  const mat = toonMat(hairColor, 0.04);

  if (style === 'long') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    const back = new THREE.Mesh(HAIR_LONG_BACK_GEO, mat);
    back.position.set(0, -HEAD_R * 0.55, -HEAD_R * 0.3);
    back.rotation.x = 0.25;
    group.add(back);
  } else if (style === 'twin') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    [-1, 1].forEach((side) => {
      const bun = new THREE.Mesh(HAIR_TWIN_BUN_GEO, mat);
      bun.position.set(side * HEAD_R * 1.15, HEAD_R * 0.15, -HEAD_R * 0.05);
      group.add(bun);
      const tail = new THREE.Mesh(HAIR_TWIN_TAIL_GEO, mat);
      tail.position.set(side * HEAD_R * 1.3, -HEAD_R * 0.35, -HEAD_R * 0.05);
      tail.rotation.z = side * 0.5;
      group.add(tail);
    });
  } else if (style === 'hat') {
    const brim = new THREE.Mesh(HAT_BRIM_GEO, mat);
    brim.position.set(0, HEAD_R * 0.62, 0);
    group.add(brim);
    const dome = new THREE.Mesh(HAT_DOME_GEO, mat);
    dome.position.set(0, HEAD_R * 0.62, 0);
    group.add(dome);
    const pom = new THREE.Mesh(HAT_POM_GEO, mat);
    pom.position.set(0, HEAD_R * 0.62 + HEAD_R * 0.86, 0);
    group.add(pom);
  } else {
    // 'short'（既定）：丸いキャップ＋跳ねる毛束3本
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    [-0.5, 0.1, 0.6].forEach((sx, i) => {
      const spike = new THREE.Mesh(HAIR_SPIKE_GEO, mat);
      spike.position.set(sx * HEAD_R, HEAD_R * 0.78, -HEAD_R * 0.1 + i * 0.02);
      spike.rotation.z = -sx * 0.6;
      spike.rotation.x = -0.3;
      group.add(spike);
    });
  }

  return group;
}

// ------------------------------------------------------------------
// アバター本体
// ------------------------------------------------------------------
export function createStyleAvatar(config) {
  const {
    bodyColor = '#ffdbac',
    hairStyle = 'short',
    hairColor = '#1a1a1a',
    shirtColor = '#00ffea',
  } = config || {};

  const root = new THREE.Group();
  root.name = 'mini_deform_avatar';

  const skinMat = toonMat(bodyColor, 0.06);
  const shirtMat = toonMat(shirtColor, 0.08);

  // ---- 脚（短く丸いミトン足。指の表現はしない） ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG_X, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, shirtMat);
    mesh.position.y = -(LEG_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, SHOE_MAT);
    foot.position.set(0, -LEG_LEN, FOOT_R * 0.3);
    foot.scale.set(1, 0.6, 1.35);
    foot.castShadow = true;
    pivot.add(foot);

    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身（胴・腕・頭） ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  const torso = new THREE.Mesh(TORSO_GEO, shirtMat);
  torso.position.y = TORSO_Y;
  torso.scale.set(1, 0.9, 0.95);
  torso.castShadow = true;
  upperGroup.add(torso);

  const torsoOutline = new THREE.Mesh(TORSO_GEO, OUTLINE_MAT);
  torsoOutline.scale.set(1.09, 1.02, 1.06);
  torso.add(torsoOutline);

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    pivot.rotation.z = side * 0.28; // ぷにっと外に開いた休止ポーズ
    pivot.rotation.x = -0.06;

    const mesh = new THREE.Mesh(ARM_GEO, skinMat);
    mesh.position.y = -(ARM_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const hand = new THREE.Mesh(HAND_GEO, skinMat);
    hand.position.y = -ARM_LEN;
    hand.castShadow = true;
    pivot.add(hand);

    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upperGroup.add(armL, armR);

  // ---- 頭（首は省略し、胴体に大きくめり込ませて一体感を出す） ----
  const headGroup = new THREE.Group();
  headGroup.position.set(0, HEAD_Y, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(HEAD_GEO, skinMat);
  head.scale.set(1, 0.97, 0.95);
  head.castShadow = true;
  headGroup.add(head);

  const headOutline = new THREE.Mesh(HEAD_GEO, OUTLINE_MAT);
  headOutline.scale.set(1.09, 1.09, 1.09);
  head.add(headOutline);

  const faceMat = new THREE.MeshBasicMaterial({
    map: getFaceTexture(),
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(FACE_PLANE_GEO, faceMat);
  face.position.set(0, HEAD_R * 0.02, HEAD_R * 0.92);
  face.renderOrder = 2;
  headGroup.add(face);

  const hair = buildHair(hairStyle, hairColor);
  headGroup.add(hair);

  // 比較用の静止アバターなのでアニメーションは持たないが、フックだけ生やしておく
  root.userData.update = (_dt) => {};

  return root;
}
