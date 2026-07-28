import * as THREE from 'three';

// ------------------------------------------------------------------
// 比較案1：「アニメ等身」— 6.5頭身前後のVRoid/VRChat風スリム体型。
// avatar.js の技法（CanvasTexture顔・MeshToonMaterial+gradientMap・
// 反転ハル輪郭線）を参考にしつつ、造形は完全に別物（スリム長身・
// 上下に分かれた服・大きめの目）にした比較用アバター。
// ------------------------------------------------------------------

export const STYLE_INFO = {
  id: 'anime_tall',
  name: 'アニメ等身',
  desc: '6.5頭身のVRoid風スリム体型',
};

// ------------------------------------------------------------------
// 寸法定数（すべて「相対単位」。最後にバウンディングボックスを測って
// 身長1.6m・足元y=0へ正規化するので、ここでの絶対値そのものは
// 頭身バランス＝相対比だけが意味を持つ）
// ------------------------------------------------------------------

const HEAD_R = 0.19;
const HEAD_SCALE = { x: 1, y: 0.95, z: 0.92 }; // わずかに縦長・薄めの卵型でスリムな顔立ちに
const NECK_R = 0.055;
const NECK_H = 0.13; // はっきり見える長めの首
const NECK_OVERLAP = 0.02;
const HEAD_OVERLAP = 0.03;

const HIP_Y = 1.2; // 脚の長さ（脚がプロポーションの主な高さを稼ぐ）
const FOOT_R = 0.075;

const TORSO_TOP_Y = 0.68; // 胴（upperGroupローカル）: 襟ぐりの高さ
const SHOULDER_Y = 0.6; // 肩幅ピーク
const WAIST_TOP_Y = 0.3; // ボトムスの上端＝ベルトライン

const ARM_R_TOP = 0.052;
const ARM_R_BOTTOM = 0.04;
const ARM_LEN = 0.92;
const HAND_R = 0.05;

const LEG_R_TOP = 0.082;
const LEG_R_BOTTOM = 0.062;
const LEG_LEN = 1.2;

const SHOULDER_X = 0.145 + ARM_R_TOP * 0.55;
const ARM_REST_X = -0.05;
const ARM_REST_Z = 0.11;
const LEG_STANCE_X = 0.09; // 細身の脚なので股幅を狭めに

// ---- トゥーン用グラデーションマップ ----
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

const SHOE_MAT = new THREE.MeshToonMaterial({ color: '#20202a', gradientMap: GRADIENT_MAP });
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: '#0c0714', side: THREE.BackSide });

// ---- 共有ジオメトリ ----
const HEAD_GEO = new THREE.SphereGeometry(HEAD_R, 14, 10);
const FACE_PLANE_GEO = new THREE.PlaneGeometry(HEAD_R * 1.3, HEAD_R * 1.15);
const NECK_GEO = new THREE.CylinderGeometry(NECK_R, NECK_R * 1.12, NECK_H, 8, 1, true);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, LEG_LEN, 8, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, 8, 1, true);
const FOOT_GEO = new THREE.SphereGeometry(FOOT_R, 6, 5);
const HAND_GEO = new THREE.SphereGeometry(HAND_R, 6, 5);
const COLLAR_RING_GEO = new THREE.CylinderGeometry(0.08, 0.072, 0.03, 10, 1, true);
const BELT_RING_GEO = new THREE.CylinderGeometry(0.125, 0.118, 0.05, 10, 1, true);
const CUFF_RING_GEO = new THREE.CylinderGeometry(ARM_R_BOTTOM * 1.15, ARM_R_BOTTOM * 1.35, 0.035, 10, 1, true);
const HEM_RING_GEO = new THREE.CylinderGeometry(0.155, 0.145, 0.03, 10, 1, true);

// 胴・上半身（ブラウス／トップス）：くびれのないスリムなラインで襟ぐりへ絞る
const TOP_GEO = new THREE.LatheGeometry(
  [
    [0.1, WAIST_TOP_Y - 0.02],
    [0.128, 0.42],
    [0.145, SHOULDER_Y],
    [0.118, 0.65],
    [0.075, TORSO_TOP_Y],
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  10
);

// 下半身（ボトムス）：腰から裾へわずかにフレアするショート丈スカート/ショーツ状
const BOTTOM_GEO = new THREE.LatheGeometry(
  [
    [0.095, -0.06],
    [0.15, -0.02],
    [0.135, 0.14],
    [0.112, WAIST_TOP_Y + 0.02],
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  10
);

// ---- 髪パーツ用ジオメトリ ----
const HAIR_CAP_GEO = new THREE.SphereGeometry(HEAD_R * 1.1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
const HAIR_FRINGE_GEO = new THREE.SphereGeometry(HEAD_R * 0.68, 8, 6, 0, Math.PI, 0, Math.PI * 0.6);
const HAIR_LONG_BACK_GEO = new THREE.CylinderGeometry(HEAD_R * 0.92, HEAD_R * 0.35, HEAD_R * 3.4, 8, 1, true);
const HAIR_TWIN_TAIL_GEO = new THREE.CapsuleGeometry(HEAD_R * 0.19, HEAD_R * 1.6, 3, 7);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(HEAD_R * 1.22, HEAD_R * 1.22, HEAD_R * 0.12, 12, 1, false);
const HAT_CONE_GEO = new THREE.ConeGeometry(HEAD_R * 0.78, HEAD_R * 1.55, 12, 1, false);
const HAT_POM_GEO = new THREE.SphereGeometry(HEAD_R * 0.16, 6, 6);
const HAIR_HIGHLIGHT_GEO = new THREE.SphereGeometry(HEAD_R * 1.15, 12, 4, Math.PI * 0.15, Math.PI * 0.7, 0, Math.PI * 0.3);

// ------------------------------------------------------------------
// 顔テクスチャ（静止画1枚。比較用のため表情差し替え・まばたきは持たない）
// 大きめの目・小さめの口でアニメ調を強調する。
// ------------------------------------------------------------------

let faceTextureCache = null;

function drawFace(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  const leftX = size * 0.33;
  const rightX = size * 0.67;
  const eyeY = size * 0.52;
  const eyeW = size * 0.19; // 大きめの目
  const eyeH = size * 0.24;

  // 頬
  ctx.save();
  ctx.globalAlpha = 0.3;
  [leftX - size * 0.02, rightX + size * 0.02].forEach((cx) => {
    const grad = ctx.createRadialGradient(cx, size * 0.68, 1, cx, size * 0.68, size * 0.09);
    grad.addColorStop(0, '#ff8fae');
    grad.addColorStop(1, 'rgba(255,143,174,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, size * 0.68, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  [leftX, rightX].forEach((ex) => {
    // 白目
    ctx.fillStyle = '#fffdfb';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW * 0.5, eyeH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 瞳（大きめ・グラデーションで奥行き）
    const irisGrad = ctx.createRadialGradient(
      ex - eyeW * 0.06, eyeY - eyeH * 0.05, eyeW * 0.05,
      ex, eyeY + eyeH * 0.05, eyeW * 0.44
    );
    irisGrad.addColorStop(0, '#4a3a5e');
    irisGrad.addColorStop(1, '#1c1420');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeH * 0.05, eyeW * 0.42, eyeH * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // 上まぶたライン
    ctx.strokeStyle = '#140b12';
    ctx.lineWidth = size * 0.02;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - eyeH * 0.06, eyeW * 0.52, eyeH * 0.5, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    // まつげ
    ctx.lineWidth = size * 0.028;
    ctx.beginPath();
    ctx.moveTo(ex + eyeW * 0.46, eyeY - eyeH * 0.32);
    ctx.lineTo(ex + eyeW * 0.6, eyeY - eyeH * 0.46);
    ctx.stroke();

    // ハイライト2点
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex - eyeW * 0.14, eyeY - eyeH * 0.16, eyeW * 0.13, eyeH * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + eyeW * 0.15, eyeY + eyeH * 0.2, eyeW * 0.06, 0, Math.PI * 2);
    ctx.fill();
  });

  // 眉（細め）
  ctx.lineCap = 'round';
  [leftX, rightX].forEach((ex) => {
    ctx.strokeStyle = '#2a1c22';
    ctx.lineWidth = size * 0.013;
    ctx.beginPath();
    ctx.moveTo(ex - eyeW * 0.42, eyeY - eyeH * 0.82);
    ctx.quadraticCurveTo(ex, eyeY - eyeH * 1.0, ex + eyeW * 0.42, eyeY - eyeH * 0.78);
    ctx.stroke();
  });

  // 口（小さめ）
  ctx.strokeStyle = '#8a4a58';
  ctx.lineWidth = size * 0.013;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.465, size * 0.755);
  ctx.quadraticCurveTo(size * 0.5, size * 0.785, size * 0.535, size * 0.755);
  ctx.stroke();
}

function getFaceTexture() {
  if (faceTextureCache) return faceTextureCache;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  drawFace(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  faceTextureCache = tex;
  return tex;
}

// ---- 髪パーツ生成 ----------------------------------------------------

function addFringe(group, hairMat) {
  const fringe = new THREE.Mesh(HAIR_FRINGE_GEO, hairMat);
  fringe.position.set(0, HEAD_R * 0.32, HEAD_R * 0.7);
  fringe.rotation.x = -0.4;
  fringe.scale.set(1.32, 0.7, 0.5);
  group.add(fringe);
}

function addHairHighlight(group, hairColor) {
  const bright = new THREE.Color(hairColor).lerp(new THREE.Color('#ffffff'), 0.62);
  const mat = new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 0.5, depthWrite: false });
  const band = new THREE.Mesh(HAIR_HIGHLIGHT_GEO, mat);
  band.rotation.y = (Math.random() - 0.5) * 0.5;
  band.rotation.z = (Math.random() - 0.5) * 0.12;
  band.renderOrder = 1;
  group.add(band);
}

function buildHair(style, hairColor) {
  const group = new THREE.Group();
  const mat = toonMat(hairColor, 0.04);

  if (style === 'long') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    addFringe(group, mat);
    const back = new THREE.Mesh(HAIR_LONG_BACK_GEO, mat);
    back.position.set(0, -HEAD_R * 1.5, -HEAD_R * 0.4);
    back.rotation.x = 0.08;
    group.add(back);
  } else if (style === 'twin') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    addFringe(group, mat);
    [-1, 1].forEach((side) => {
      const tail = new THREE.Mesh(HAIR_TWIN_TAIL_GEO, mat);
      tail.position.set(side * HEAD_R * 1.08, -HEAD_R * 0.35, -HEAD_R * 0.1);
      tail.rotation.z = side * 0.55;
      tail.rotation.x = 0.3;
      group.add(tail);
    });
  } else if (style === 'hat') {
    addFringe(group, mat);
    const brim = new THREE.Mesh(HAT_BRIM_GEO, mat);
    brim.position.set(0, HEAD_R * 0.52, 0);
    group.add(brim);
    const cone = new THREE.Mesh(HAT_CONE_GEO, mat);
    cone.position.set(0, HEAD_R * 0.52 + HEAD_R * 0.78 + HEAD_R * 0.08, 0);
    group.add(cone);
    const pom = new THREE.Mesh(HAT_POM_GEO, mat);
    pom.position.set(0, HEAD_R * 0.52 + HEAD_R * 1.56 + HEAD_R * 0.15, 0);
    group.add(pom);
  } else {
    // 'short'（既定）
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    group.add(cap);
    addFringe(group, mat);
  }

  addHairHighlight(group, hairColor);
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
  root.name = 'avatar_anime_tall';

  const skinMat = toonMat(bodyColor, 0.05);
  const bottomMat = skinMat.clone();
  bottomMat.color.set(bodyColor).multiplyScalar(0.55);
  bottomMat.emissive.set(bodyColor).multiplyScalar(0.03);
  const topMat = toonMat(shirtColor, 0.07);
  const trimMat = topMat.clone();
  trimMat.color.multiplyScalar(0.6);
  trimMat.emissive.multiplyScalar(0.5);

  // ---- 脚 ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG_STANCE_X, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, bottomMat);
    mesh.position.y = -(LEG_LEN / 2);
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, SHOE_MAT);
    foot.position.y = -LEG_LEN + FOOT_R * 0.25;
    foot.position.z = FOOT_R * 0.3;
    foot.scale.set(0.85, 0.45, 1.2);
    pivot.add(foot);

    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身グループ ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  // ボトムス（スカート/ショーツ状。裾ラインで縁取り）
  const bottom = new THREE.Mesh(BOTTOM_GEO, bottomMat);
  upperGroup.add(bottom);
  const hemRing = new THREE.Mesh(HEM_RING_GEO, bottomMat);
  hemRing.position.y = -0.055;
  upperGroup.add(hemRing);

  // ベルト（上下の切り替え目を明示）
  const belt = new THREE.Mesh(BELT_RING_GEO, trimMat);
  belt.position.y = WAIST_TOP_Y;
  upperGroup.add(belt);

  // トップス（ブラウス）
  const top = new THREE.Mesh(TOP_GEO, topMat);
  upperGroup.add(top);
  const topOutline = new THREE.Mesh(TOP_GEO, OUTLINE_MAT);
  topOutline.scale.set(1.06, 1.03, 1.06);
  top.add(topOutline);

  const collarRing = new THREE.Mesh(COLLAR_RING_GEO, trimMat);
  collarRing.position.y = TORSO_TOP_Y - 0.01;
  upperGroup.add(collarRing);

  const neck = new THREE.Mesh(NECK_GEO, skinMat);
  neck.position.y = TORSO_TOP_Y - NECK_OVERLAP + NECK_H / 2;
  upperGroup.add(neck);

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    pivot.rotation.z = side * ARM_REST_Z;
    pivot.rotation.x = ARM_REST_X;

    const mesh = new THREE.Mesh(ARM_GEO, skinMat);
    mesh.position.y = -(ARM_LEN / 2);
    pivot.add(mesh);

    const cuff = new THREE.Mesh(CUFF_RING_GEO, trimMat);
    cuff.position.y = -ARM_LEN + 0.09;
    pivot.add(cuff);

    const hand = new THREE.Mesh(HAND_GEO, skinMat);
    hand.position.y = -ARM_LEN + HAND_R * 0.2;
    hand.scale.set(0.9, 0.85, 1);
    pivot.add(hand);

    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upperGroup.add(armL, armR);

  // ---- 頭 ----
  const headY = TORSO_TOP_Y - NECK_OVERLAP + NECK_H - HEAD_OVERLAP + HEAD_R * 0.85;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(HEAD_GEO, skinMat);
  head.scale.set(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);
  headGroup.add(head);

  const headOutline = new THREE.Mesh(HEAD_GEO, OUTLINE_MAT);
  headOutline.scale.set(1.06, 1.06, 1.06);
  head.add(headOutline);

  const faceMat = new THREE.MeshBasicMaterial({ map: getFaceTexture(), transparent: true, depthWrite: false });
  const face = new THREE.Mesh(FACE_PLANE_GEO, faceMat);
  face.position.set(0, HEAD_R * 0.02, HEAD_R * 0.9);
  face.renderOrder = 2;
  headGroup.add(face);

  const hair = buildHair(hairStyle, hairColor);
  headGroup.add(hair);

  // ---- 静止アバター用の空更新フック（比較用のためアニメーション不要） ----
  root.userData.update = (dt) => {};

  // ---- 身長1.6m・足元y=0へ正規化 ----
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const naturalHeight = box.max.y - box.min.y;
  const scale = naturalHeight > 0 ? 1.6 / naturalHeight : 1;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  return root;
}
