import * as THREE from 'three';

// ------------------------------------------------------------------
// 比較案2：「シンプル低ポリ」— cluster/Metaのアバターのような、
// 装飾を削ぎ落とした万人向けの人型。avatar.js の技法（CanvasTexture顔）
// だけ参考にしつつ、造形・質感は案1（anime_tall）とはっきり異なる
// 方向（丸み・低ポリ・マット質感・輪郭線なし）にした比較用アバター。
// ------------------------------------------------------------------

export const STYLE_INFO = {
  id: 'simple_lowpoly',
  name: 'シンプル低ポリ',
  desc: '5.5頭身の丸みマット低ポリ体型',
};

// ------------------------------------------------------------------
// 寸法定数（相対単位。最後にバウンディングボックスで身長1.6m・
// 足元y=0へ正規化するので、ここでの値は相対比＝頭身バランスのみが意味を持つ）
// ------------------------------------------------------------------

const HEAD_R = 0.22;
const HEAD_SCALE = { x: 1, y: 0.95, z: 0.95 }; // ほぼ球のまま、わずかに柔らかく
const NECK_R = 0.075;
const NECK_H = 0.08; // 短め・ほぼ隠れる首（この案では首の演出は最小限でよい）
const NECK_OVERLAP = 0.015;
const HEAD_OVERLAP = 0.025;

const HIP_Y = 0.95; // 脚の長さ
const FOOT_R = 0.1;
const LEG_R_TOP = 0.11;
const LEG_R_BOTTOM = 0.095;
const LEG_STANCE_X = 0.11;

const TORSO_TOP_Y = 0.91; // 胴の高さ（upperGroupローカル、腰=0～肩口）
const TORSO_R = 0.3; // 胴のベース半径（丸み球を縦に伸ばして「丸みのある箱」を作る）
const SHOULDER_Y = TORSO_TOP_Y * 0.8;
const SHOULDER_X = TORSO_R * 0.98;

const ARM_R_TOP = 0.075;
const ARM_R_BOTTOM = 0.065;
const ARM_LEN = 0.72;
const HAND_R = 0.09;

const ARM_REST_Z = 0.14; // 腕をやや外に開いて休ませる（球体胴に食い込ませない）
const RADIAL_SEG = 6; // 低ポリ感を残すため角柱寄りの分割数

// ---- マット質感（トゥーン輪郭線なし・フラットシェーディングで面を見せる） ----
function matteMat(color) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

const SHOE_MAT = new THREE.MeshStandardMaterial({ color: '#2a2a32', flatShading: true, roughness: 0.9, metalness: 0 });

// ---- 共有ジオメトリ（低ポリ：分割数を絞って面を見せる） ----
const HEAD_GEO = new THREE.IcosahedronGeometry(HEAD_R, 0);
const FACE_PLANE_GEO = new THREE.PlaneGeometry(HEAD_R * 1.1, HEAD_R * 0.9);
const NECK_GEO = new THREE.CylinderGeometry(NECK_R, NECK_R * 1.1, NECK_H, RADIAL_SEG, 1, true);
const TORSO_GEO = new THREE.SphereGeometry(TORSO_R, RADIAL_SEG, 5);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, HIP_Y, RADIAL_SEG, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, RADIAL_SEG, 1, true);
const FOOT_GEO = new THREE.IcosahedronGeometry(FOOT_R, 0);
const HAND_GEO = new THREE.IcosahedronGeometry(HAND_R, 0);

// ---- 髪パーツ用ジオメトリ（控えめな差だが判別できる程度に） ----
const HAIR_CAP_GEO = new THREE.SphereGeometry(HEAD_R * 1.06, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
const HAIR_BACK_NUB_GEO = new THREE.CylinderGeometry(HEAD_R * 0.5, HEAD_R * 0.3, HEAD_R * 1.05, 6, 1, true);
const HAIR_TWIN_NUB_GEO = new THREE.SphereGeometry(HEAD_R * 0.22, 6, 5);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(HEAD_R * 1.16, HEAD_R * 1.16, HEAD_R * 0.1, 10, 1, false);

// ------------------------------------------------------------------
// 顔テクスチャ（最小限：点目＋小さな口のみ。装飾なし・静止1枚）
// ------------------------------------------------------------------

let faceTextureCache = null;

function drawFace(ctx, size) {
  ctx.clearRect(0, 0, size, size);
  const leftX = size * 0.36;
  const rightX = size * 0.64;
  const eyeY = size * 0.48;
  const eyeR = size * 0.055;

  ctx.fillStyle = '#20202a';
  [leftX, rightX].forEach((ex) => {
    ctx.beginPath();
    ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = '#20202a';
  ctx.lineWidth = size * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.46, size * 0.68);
  ctx.quadraticCurveTo(size * 0.5, size * 0.7, size * 0.54, size * 0.68);
  ctx.stroke();
}

function getFaceTexture() {
  if (faceTextureCache) return faceTextureCache;
  const size = 256; // 顔は最小限の描き込みなので解像度も控えめでよい
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

// ---- 髪パーツ生成（4種：差は控えめだが判別可能） ----

function buildHair(style, hairColor) {
  const group = new THREE.Group();
  const mat = matteMat(hairColor);

  const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
  group.add(cap);

  if (style === 'long') {
    const back = new THREE.Mesh(HAIR_BACK_NUB_GEO, mat);
    back.position.set(0, -HEAD_R * 0.55, -HEAD_R * 0.35);
    back.rotation.x = 0.15;
    group.add(back);
  } else if (style === 'twin') {
    [-1, 1].forEach((side) => {
      const nub = new THREE.Mesh(HAIR_TWIN_NUB_GEO, mat);
      nub.position.set(side * HEAD_R * 1.02, -HEAD_R * 0.1, 0);
      group.add(nub);
    });
  } else if (style === 'hat') {
    const brim = new THREE.Mesh(HAT_BRIM_GEO, mat);
    brim.position.set(0, HEAD_R * 0.32, 0);
    group.add(brim);
  }
  // 'short'（既定）はキャップのみ

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
    shirtColor = '#3b82f6',
  } = config || {};

  const root = new THREE.Group();
  root.name = 'avatar_simple_lowpoly';

  const skinMat = matteMat(bodyColor);
  const pantsMat = matteMat(new THREE.Color(bodyColor).multiplyScalar(0.55).getStyle());
  const shirtMat = matteMat(shirtColor);

  // ---- 脚（先細りの低ポリ円柱＋丸い足） ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG_STANCE_X, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, pantsMat);
    mesh.position.y = -(HIP_Y / 2);
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, SHOE_MAT);
    foot.position.set(0, -HIP_Y + FOOT_R * 0.5, FOOT_R * 0.35);
    foot.scale.set(1, 0.65, 1.25);
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

  // 胴（球を縦に伸ばした丸みのある箱型）
  const torso = new THREE.Mesh(TORSO_GEO, shirtMat);
  torso.position.y = TORSO_TOP_Y / 2;
  torso.scale.set(1.05, TORSO_TOP_Y / (2 * TORSO_R), 0.92);
  upperGroup.add(torso);

  const neck = new THREE.Mesh(NECK_GEO, skinMat);
  neck.position.y = TORSO_TOP_Y - NECK_OVERLAP + NECK_H / 2;
  upperGroup.add(neck);

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    pivot.rotation.z = side * ARM_REST_Z;

    const mesh = new THREE.Mesh(ARM_GEO, shirtMat);
    mesh.position.y = -(ARM_LEN / 2);
    pivot.add(mesh);

    const hand = new THREE.Mesh(HAND_GEO, skinMat);
    hand.position.y = -ARM_LEN + HAND_R * 0.3;
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

  const faceMat = new THREE.MeshBasicMaterial({ map: getFaceTexture(), transparent: true, depthWrite: false });
  const face = new THREE.Mesh(FACE_PLANE_GEO, faceMat);
  face.position.set(0, 0, HEAD_R * 0.88);
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
