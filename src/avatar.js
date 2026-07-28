import * as THREE from 'three';

// ------------------------------------------------------------------
// プリセット式・デフォルメちびキャラアバター（VRoid/VRChat系トゥーン調）
// ------------------------------------------------------------------

export const AVATAR_PARTS = {
  bodyColors: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#3a2a1e', '#7fe6ff', '#ff8fe6'],
  hairStyles: ['short', 'long', 'twin', 'hat'],
  hairColors: ['#1a1a1a', '#4a2c17', '#caa06b', '#e0483a', '#ff6fd8', '#4fd8ff', '#8a5fff', '#f2f2f2'],
  shirtColors: ['#00ffea', '#ff00e5', '#ffb400', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f5f5f5'],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomConfig() {
  return {
    bodyColor: pick(AVATAR_PARTS.bodyColors),
    hairStyle: pick(AVATAR_PARTS.hairStyles),
    hairColor: pick(AVATAR_PARTS.hairColors),
    shirtColor: pick(AVATAR_PARTS.shirtColors),
  };
}

// ------------------------------------------------------------------
// 共有リソース（全アバター共通・色に依存しないもの）
// メッシュ数・GC負荷を抑えるため、形状はモジュール読み込み時に一度だけ生成して使い回す。
// ------------------------------------------------------------------

const HEAD_R = 0.22;
const NECK_R = 0.075;
const NECK_H = 0.09;
const TORSO_TOP_Y = 0.5; // = shoulderY（腰base=0からの高さ）
const ARM_R_TOP = 0.062;
const ARM_R_BOTTOM = 0.046;
const ARM_LEN = 0.34;
const HAND_R = 0.06;
const LEG_R_TOP = 0.1;
const LEG_R_BOTTOM = 0.074;
const LEG_LEN = 0.44;
const FOOT_R = 0.09;
const HIP_Y = 0.5;
const SHOULDER_X = 0.175 + ARM_R_TOP + 0.025; // 胸幅 + 腕半径 + 隙間

// ---- トゥーン用グラデーションマップ（2〜3段の階調を手続き生成） ----
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

// 靴（全アバター共通のニュートラル色。ユーザー色に依存しないので共有できる）
const SHOE_MAT = new THREE.MeshToonMaterial({ color: '#22222c', gradientMap: GRADIENT_MAP });

// 輪郭線（反転ハル方式）：常に単色の黒なので全アバターで共有できる
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: '#0c0714', side: THREE.BackSide });

// ---- 共有ジオメトリ（色を持たないので全アバター・全パーツで使い回せる） ----
const HEAD_GEO = new THREE.SphereGeometry(HEAD_R, 14, 10);
const FACE_PLANE_GEO = new THREE.PlaneGeometry(HEAD_R * 1.32, HEAD_R * 1.18);
const NECK_GEO = new THREE.CylinderGeometry(NECK_R, NECK_R * 1.05, NECK_H, 8, 1, true);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, LEG_LEN, 8, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, 8, 1, true);
const FOOT_GEO = new THREE.SphereGeometry(FOOT_R, 6, 5);
const HAND_GEO = new THREE.SphereGeometry(HAND_R, 6, 5);
const COLLAR_RING_GEO = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 10, 1, true);
const WAIST_RING_GEO = new THREE.CylinderGeometry(0.16, 0.15, 0.06, 10, 1, true);
const CUFF_RING_GEO = new THREE.CylinderGeometry(ARM_R_BOTTOM * 1.15, ARM_R_BOTTOM * 1.35, 0.045, 10, 1, true);
const PENLIGHT_GEO = new THREE.CapsuleGeometry(0.022, 0.34, 4, 8);

// 胴体：くびれのあるラウンドシルエット（Latheで回転生成。上下は他パーツで隠れるので開放でOK）
const TORSO_GEO = new THREE.LatheGeometry(
  [
    [0.145, 0.0], // 腰の張り（waist ringに隠れる下端）
    [0.125, 0.16], // ウエスト（最も細い）
    [0.155, 0.32], // 胸まわり
    [0.185, 0.44], // 肩幅
    [0.175, TORSO_TOP_Y], // 肩上（首の付け根）
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  10
);

// ---- 髪パーツ用の共有ジオメトリ ----
const HAIR_CAP_GEO = new THREE.SphereGeometry(HEAD_R * 1.08, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.54);
const HAIR_FRINGE_GEO = new THREE.SphereGeometry(HEAD_R * 0.66, 8, 6, 0, Math.PI, 0, Math.PI * 0.62);
const HAIR_LONG_BACK_GEO = new THREE.CylinderGeometry(HEAD_R * 0.98, HEAD_R * 0.55, HEAD_R * 2.3, 8, 1, true);
const HAIR_TWIN_TAIL_GEO = new THREE.CapsuleGeometry(HEAD_R * 0.2, HEAD_R * 1.15, 3, 7);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(HEAD_R * 1.18, HEAD_R * 1.18, HEAD_R * 0.14, 12, 1, false);
const HAT_CONE_GEO = new THREE.ConeGeometry(HEAD_R * 0.82, HEAD_R * 1.7, 12, 1, false);
const HAT_POM_GEO = new THREE.SphereGeometry(HEAD_R * 0.17, 6, 6);

// ------------------------------------------------------------------
// 顔テクスチャ（CanvasTexture）：目・まつげ・ハイライト・眉・口・頬を描画
// 全アバター共通の絵柄（色ではなく表情そのものなので共有可）。
// まばたきは「開いた顔」「閉じた顔」2枚のテクスチャを差し替えるだけで実現し、
// アバターごとにCanvasを再描画しない（軽量）。
// ------------------------------------------------------------------

let faceTexturesCache = null;

function drawFace(ctx, size, closed) {
  ctx.clearRect(0, 0, size, size);
  const leftX = size * 0.335;
  const rightX = size * 0.665;
  const eyeY = size * 0.5;
  const eyeW = size * 0.15;
  const eyeH = size * 0.185;

  // 頬（ブラッシュ）
  ctx.save();
  ctx.globalAlpha = 0.32;
  [leftX - size * 0.02, rightX + size * 0.02].forEach((cx) => {
    const grad = ctx.createRadialGradient(cx, size * 0.66, 1, cx, size * 0.66, size * 0.1);
    grad.addColorStop(0, '#ff8fae');
    grad.addColorStop(1, 'rgba(255,143,174,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, size * 0.66, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // 目
  [leftX, rightX].forEach((ex) => {
    if (closed) {
      ctx.strokeStyle = '#140b12';
      ctx.lineWidth = size * 0.02;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeW * 0.62, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
      // まつげのはね
      ctx.beginPath();
      ctx.moveTo(ex + eyeW * 0.55, eyeY + eyeH * 0.05);
      ctx.lineTo(ex + eyeW * 0.75, eyeY - eyeH * 0.12);
      ctx.stroke();
      return;
    }

    // 白目
    ctx.fillStyle = '#fffdfb';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW * 0.5, eyeH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 瞳（大きめの黒目でVRoid風に）
    ctx.fillStyle = '#1c1420';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeH * 0.06, eyeW * 0.4, eyeH * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // まぶたの上ライン
    ctx.strokeStyle = '#140b12';
    ctx.lineWidth = size * 0.018;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - eyeH * 0.05, eyeW * 0.52, eyeH * 0.5, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    // まつげのはね
    ctx.beginPath();
    ctx.moveTo(ex + eyeW * 0.48, eyeY - eyeH * 0.3);
    ctx.lineTo(ex + eyeW * 0.72, eyeY - eyeH * 0.52);
    ctx.stroke();

    // ハイライト
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex - eyeW * 0.14, eyeY - eyeH * 0.14, eyeW * 0.14, eyeH * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + eyeW * 0.16, eyeY + eyeH * 0.22, eyeW * 0.07, 0, Math.PI * 2);
    ctx.fill();
  });

  // 眉
  ctx.strokeStyle = '#2a1c22';
  ctx.lineWidth = size * 0.016;
  ctx.lineCap = 'round';
  [leftX, rightX].forEach((ex, i) => {
    const dir = i === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(ex - dir * eyeW * 0.05 - eyeW * 0.4, eyeY - eyeH * 0.85);
    ctx.quadraticCurveTo(ex, eyeY - eyeH * 1.05, ex + eyeW * 0.4, eyeY - eyeH * 0.82);
    ctx.stroke();
  });

  // 口（小さな笑み）
  ctx.strokeStyle = '#7a3b4a';
  ctx.lineWidth = size * 0.016;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.44, size * 0.74);
  ctx.quadraticCurveTo(size * 0.5, size * 0.79, size * 0.56, size * 0.74);
  ctx.stroke();
}

function getFaceTextures() {
  if (faceTexturesCache) return faceTexturesCache;
  const size = 256;

  const openCanvas = document.createElement('canvas');
  openCanvas.width = size;
  openCanvas.height = size;
  drawFace(openCanvas.getContext('2d'), size, false);

  const closedCanvas = document.createElement('canvas');
  closedCanvas.width = size;
  closedCanvas.height = size;
  drawFace(closedCanvas.getContext('2d'), size, true);

  const open = new THREE.CanvasTexture(openCanvas);
  const closed = new THREE.CanvasTexture(closedCanvas);
  open.colorSpace = THREE.SRGBColorSpace;
  closed.colorSpace = THREE.SRGBColorSpace;
  open.needsUpdate = true;
  closed.needsUpdate = true;

  faceTexturesCache = { open, closed };
  return faceTexturesCache;
}

// ---- キャンバステキスト（ネームプレート／吹き出し） ----------------

function wrapLines(ctx, text, maxWidth, maxLines) {
  const raw = String(text);
  const lines = [];
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      continue;
    }
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur.length > 0) lines.push(cur);
  if (lines.length === 0) lines.push('');
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

function createTextSprite(text, opts = {}) {
  const {
    fontSize = 30,
    font = 'bold',
    textColor = '#ffffff',
    bgColor = 'rgba(8, 8, 22, 0.72)',
    borderColor = 'rgba(0, 255, 234, 0.85)',
    maxTextWidth = 300,
    paddingX = 20,
    paddingY = 14,
    lineHeight = 34,
    maxLines = 3,
    pixelsPerUnit = 210,
  } = opts;

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = `${font} ${fontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif`;
  const lines = wrapLines(mctx, text, maxTextWidth, maxLines);

  let textWidth = 0;
  lines.forEach((l) => {
    textWidth = Math.max(textWidth, mctx.measureText(l).width);
  });

  const width = Math.ceil(textWidth + paddingX * 2);
  const height = Math.ceil(lines.length * lineHeight + paddingY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 角丸背景
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(width, 0, width, height, r);
  ctx.arcTo(width, height, 0, height, r);
  ctx.arcTo(0, height, 0, 0, r);
  ctx.arcTo(0, 0, width, 0, r);
  ctx.closePath();
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  ctx.font = `${font} ${fontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = borderColor;
  ctx.shadowBlur = 6;
  lines.forEach((line, i) => {
    const y = paddingY + lineHeight * i + lineHeight / 2;
    ctx.fillText(line, width / 2, y);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;
  sprite.scale.set(width / pixelsPerUnit, height / pixelsPerUnit, 1);
  sprite.userData.dispose = () => {
    texture.dispose();
    material.dispose();
  };
  return sprite;
}

// ---- 髪パーツ生成 ----------------------------------------------------
// シルエットで魅せる：前髪の房（fringe）を全スタイル共通で使い、
// スタイルごとに後ろ髪・ツインテール・帽子を足す。

function addFringe(group, hairMat) {
  const fringe = new THREE.Mesh(HAIR_FRINGE_GEO, hairMat);
  fringe.position.set(0, HEAD_R * 0.3, HEAD_R * 0.72);
  fringe.rotation.x = -0.4;
  fringe.scale.set(1.3, 0.72, 0.5);
  fringe.castShadow = true;
  group.add(fringe);
}

function buildHair(style, hairColor) {
  const group = new THREE.Group();
  const mat = toonMat(hairColor, 0.04);

  if (style === 'long') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);

    const back = new THREE.Mesh(HAIR_LONG_BACK_GEO, mat);
    back.position.set(0, -HEAD_R * 0.95, -HEAD_R * 0.42);
    back.rotation.x = 0.12;
    back.castShadow = true;
    group.add(back);
  } else if (style === 'twin') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);

    [-1, 1].forEach((side) => {
      const tail = new THREE.Mesh(HAIR_TWIN_TAIL_GEO, mat);
      tail.position.set(side * HEAD_R * 1.05, -HEAD_R * 0.15, -HEAD_R * 0.15);
      tail.rotation.z = side * 0.6;
      tail.rotation.x = 0.25;
      tail.castShadow = true;
      group.add(tail);
    });
  } else if (style === 'hat') {
    addFringe(group, mat);

    const brim = new THREE.Mesh(HAT_BRIM_GEO, mat);
    brim.position.set(0, HEAD_R * 0.5, 0);
    brim.castShadow = true;
    group.add(brim);

    const cone = new THREE.Mesh(HAT_CONE_GEO, mat);
    cone.position.set(0, HEAD_R * 0.5 + HEAD_R * 0.85 + HEAD_R * 0.08, 0);
    cone.castShadow = true;
    group.add(cone);

    const pom = new THREE.Mesh(HAT_POM_GEO, mat);
    pom.position.set(0, HEAD_R * 0.5 + HEAD_R * 1.7 + HEAD_R * 0.15, 0);
    pom.castShadow = true;
    group.add(pom);
  } else {
    // 'short'（既定）：キャップ＋前髪の房でボブ感を出す
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);
  }

  return group;
}

// ---- アバター本体 -----------------------------------------------------

export function createAvatar(config) {
  const {
    bodyColor = '#ffdbac',
    hairStyle = 'short',
    hairColor = '#1a1a1a',
    shirtColor = '#00ffea',
    name = '',
  } = config || {};

  const root = new THREE.Group();
  root.name = 'avatar';

  const skinMat = toonMat(bodyColor, 0.05);
  const pantsMat = skinMat.clone();
  pantsMat.color.set(bodyColor).multiplyScalar(0.6);
  pantsMat.emissive.set(bodyColor).multiplyScalar(0.03);
  const shirtMat = toonMat(shirtColor, 0.07);
  const trimMat = shirtMat.clone();
  trimMat.color.multiplyScalar(0.55);
  trimMat.emissive.multiplyScalar(0.5);

  // ---- 脚（先細りのテーパー円柱＋足） ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.12, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, pantsMat);
    mesh.position.y = -(LEG_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, SHOE_MAT);
    foot.position.y = -LEG_LEN + FOOT_R * 0.25;
    foot.position.z = FOOT_R * 0.25;
    foot.scale.set(1, 0.55, 1.3);
    foot.castShadow = true;
    pivot.add(foot);

    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身（胴・腕・首・頭）：まとめて上下にバウンドさせる ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  const torso = new THREE.Mesh(TORSO_GEO, shirtMat);
  torso.castShadow = true;
  upperGroup.add(torso);

  const torsoOutline = new THREE.Mesh(TORSO_GEO, OUTLINE_MAT);
  torsoOutline.scale.set(1.06, 1.03, 1.06);
  torso.add(torsoOutline);

  const collarRing = new THREE.Mesh(COLLAR_RING_GEO, trimMat);
  collarRing.position.y = TORSO_TOP_Y - 0.025;
  upperGroup.add(collarRing);

  const waistRing = new THREE.Mesh(WAIST_RING_GEO, trimMat);
  waistRing.position.y = 0.03;
  upperGroup.add(waistRing);

  const neck = new THREE.Mesh(NECK_GEO, skinMat);
  neck.position.y = TORSO_TOP_Y + NECK_H / 2;
  neck.castShadow = true;
  upperGroup.add(neck);

  const shoulderY = TORSO_TOP_Y;

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, shoulderY, 0);

    const mesh = new THREE.Mesh(ARM_GEO, skinMat);
    mesh.position.y = -(ARM_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const cuff = new THREE.Mesh(CUFF_RING_GEO, trimMat);
    cuff.position.y = -ARM_LEN + 0.05;
    pivot.add(cuff);

    const hand = new THREE.Mesh(HAND_GEO, skinMat);
    hand.position.y = -ARM_LEN + HAND_R * 0.2;
    hand.scale.set(1, 0.9, 1.1);
    hand.castShadow = true;
    pivot.add(hand);

    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upperGroup.add(armL, armR);

  // ---- ペンライト（emote用。使い回し、通常は非表示） ----
  const penlightLen = 0.34;
  const penlightMat = new THREE.MeshStandardMaterial({
    color: '#8be8ff',
    emissive: '#66e6ff',
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.1,
  });
  const penlightMesh = new THREE.Mesh(PENLIGHT_GEO, penlightMat);
  const handBottomY = -ARM_LEN;
  penlightMesh.position.set(0, handBottomY - penlightLen / 2 - 0.05, 0);
  penlightMesh.visible = false;
  armR.add(penlightMesh);

  // ---- 頭 ----
  const headY = TORSO_TOP_Y + NECK_H + HEAD_R * 0.8;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(HEAD_GEO, skinMat);
  head.scale.set(1, 0.96, 0.94);
  head.castShadow = true;
  headGroup.add(head);

  const headOutline = new THREE.Mesh(HEAD_GEO, OUTLINE_MAT);
  headOutline.scale.set(1.07, 1.07, 1.07);
  head.add(headOutline);

  // 顔（CanvasTextureを前面に貼る。まばたきはテクスチャの差し替えで実現）
  const faceTex = getFaceTextures();
  const faceMat = new THREE.MeshBasicMaterial({
    map: faceTex.open,
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(FACE_PLANE_GEO, faceMat);
  face.position.set(0, HEAD_R * 0.02, HEAD_R * 0.93);
  face.renderOrder = 2;
  headGroup.add(face);

  // 髪
  const hair = buildHair(hairStyle, hairColor);
  headGroup.add(hair);

  // ---- ネームプレート ----
  let nameSprite = null;
  if (name) {
    nameSprite = createTextSprite(name, {
      fontSize: 26,
      textColor: '#eafcff',
      bgColor: 'rgba(6, 8, 20, 0.6)',
      borderColor: 'rgba(0, 255, 234, 0.85)',
      maxTextWidth: 260,
      maxLines: 1,
    });
    nameSprite.position.set(0, headY + HEAD_R + 0.34, 0);
    upperGroup.add(nameSprite);
  }

  // ---- 吹き出し（動的） ----
  let speechSprite = null;
  let speechTimer = null;
  const speechBaseY = headY + HEAD_R + (name ? 0.75 : 0.34);

  function clearSpeech() {
    if (speechTimer) {
      clearTimeout(speechTimer);
      speechTimer = null;
    }
    if (speechSprite) {
      upperGroup.remove(speechSprite);
      if (speechSprite.userData.dispose) speechSprite.userData.dispose();
      speechSprite = null;
    }
  }

  function say(text) {
    if (!text) return;
    clearSpeech();
    speechSprite = createTextSprite(text, {
      fontSize: 24,
      textColor: '#ffffff',
      bgColor: 'rgba(24, 8, 30, 0.85)',
      borderColor: 'rgba(255, 0, 229, 0.85)',
      maxTextWidth: 260,
      maxLines: 3,
    });
    speechSprite.position.set(0, speechBaseY, 0);
    upperGroup.add(speechSprite);
    speechTimer = setTimeout(() => {
      clearSpeech();
    }, 4000);
  }

  // ---- アニメーション ----
  let moving = false;
  let walkT = 0;
  let idleT = Math.random() * 10;

  // ---- まばたき ----
  let blinking = false;
  let blinkElapsed = 0;
  let blinkTimer = 1 + Math.random() * 3;
  const BLINK_DURATION = 0.12;

  function updateBlink(dt) {
    if (!blinking) {
      blinkTimer -= dt;
      if (blinkTimer <= 0) {
        blinking = true;
        blinkElapsed = 0;
        faceMat.map = faceTex.closed;
        faceMat.needsUpdate = true;
      }
    } else {
      blinkElapsed += dt;
      if (blinkElapsed >= BLINK_DURATION) {
        blinking = false;
        faceMat.map = faceTex.open;
        faceMat.needsUpdate = true;
        blinkTimer = 2.4 + Math.random() * 3.6;
      }
    }
  }

  // ---- エモート ----
  let emoteId = null;
  let emoteT = 0;
  let savedRootY = null; // jump 中に退避する root.position.y

  const EMOTE_DURATIONS = {
    wave: 2.5,
    clap: 2.5,
    jump: 2.0,
    dance: 4.0,
    heart: 3.0,
    penlight: 4.0,
  };

  // 経過時間 t / 全体の長さ dur に対して、フェードイン・アウトする 0-1 の係数
  function ease(t, dur, fade = 0.25) {
    const inV = Math.min(1, t / fade);
    const outV = Math.min(1, (dur - t) / fade);
    return Math.max(0, Math.min(inV, outV));
  }

  // 各パーツの回転・位置・スケールを基準値へ戻す（ズレの蓄積防止）
  function resetEmotePose() {
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0);
    armR.rotation.set(0, 0, 0);
    upperGroup.rotation.set(0, 0, 0);
    upperGroup.position.y = HIP_Y;
    headGroup.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    if (savedRootY !== null) {
      root.position.y = savedRootY;
      savedRootY = null;
    }
    penlightMesh.visible = false;
  }

  function endEmote() {
    resetEmotePose();
    emoteId = null;
    emoteT = 0;
  }

  function playEmote(id) {
    if (!EMOTE_DURATIONS[id]) return; // 未知のidは無視
    resetEmotePose(); // 再生中の別エモートがあれば即座にリセットして差し替え
    emoteId = id;
    emoteT = 0;
  }

  function applyEmote(id, t, dur) {
    switch (id) {
      case 'wave': {
        const env = ease(t, dur, 0.3);
        const wiggle = Math.sin(t * 9) * 0.35 * env;
        armR.rotation.z = 2.35 * env + wiggle; // 右腕を上げて左右に振る
        headGroup.rotation.z = Math.sin(t * 9) * 0.05 * env;
        break;
      }
      case 'clap': {
        const env = ease(t, dur, 0.25);
        const theta = 1.4 * env + Math.sin(t * 13) * 0.35 * env; // 速めの往復
        armL.rotation.z = theta;
        armR.rotation.z = -theta;
        upperGroup.position.y = HIP_Y + Math.sin(t * 6.5) * 0.02 * env; // わずかに上下
        break;
      }
      case 'jump': {
        if (savedRootY === null) savedRootY = root.position.y;
        const period = dur / 3; // 3回ほど跳ねる
        const phase = (t % period) / period;
        const h = Math.sin(Math.PI * phase); // 0→1→0 の弧
        root.position.y = savedRootY + h * 0.32;
        const scaleY = 1 + (h - 0.3) * 0.15;
        const scaleXZ = 1 + (0.3 - h) * 0.1;
        root.scale.set(scaleXZ, scaleY, scaleXZ); // 着地の縮み・跳躍の伸び
        legL.rotation.x = h * 0.3;
        legR.rotation.x = h * 0.3;
        armL.rotation.x = -h * 0.2;
        armR.rotation.x = -h * 0.2;
        break;
      }
      case 'dance': {
        const env = ease(t, dur, 0.3);
        const waistFreq = 3.2;
        const waist = Math.sin(t * waistFreq) * 0.3 * env; // 腰を左右に振る
        upperGroup.rotation.z = waist;
        upperGroup.position.y = HIP_Y + Math.abs(Math.sin(t * waistFreq * 2)) * 0.04 * env;
        headGroup.rotation.z = -waist * 0.4;
        legL.rotation.z = -waist * 0.5;
        legR.rotation.z = -waist * 0.5;
        const raise = 1.9 * env;
        armL.rotation.z = Math.max(0, Math.sin(t * waistFreq)) * raise; // 腕を交互に上げる
        armR.rotation.z = -Math.max(0, Math.sin(t * waistFreq + Math.PI)) * raise;
        break;
      }
      case 'heart': {
        const env = ease(t, dur, 0.35);
        const pulse = Math.sin(t * 2.5) * 0.05 * env;
        upperGroup.rotation.x = 0.16 * env; // 少し前傾
        armL.rotation.z = 2.85 * env + pulse; // 両腕を頭上で輪にする
        armR.rotation.z = -2.85 * env - pulse;
        armL.rotation.x = 0.15 * env;
        armR.rotation.x = 0.15 * env;
        break;
      }
      case 'penlight': {
        const env = ease(t, dur, 0.3);
        penlightMesh.visible = env > 0.001;
        const swing = Math.sin(t * 10) * 0.5 * env;
        armR.rotation.z = 2.1 * env + swing; // 右手のペンライトを振る
        armR.rotation.x = Math.sin(t * 5) * 0.08 * env;
        break;
      }
      default:
        break;
    }
  }

  function setMoving(v) {
    const val = !!v;
    if (val && emoteId) {
      // 移動が始まったら即座にエモートを打ち切って通常アニメへ復帰
      endEmote();
    }
    moving = val;
  }

  function update(dt) {
    updateBlink(dt);

    if (emoteId) {
      const dur = EMOTE_DURATIONS[emoteId];
      emoteT += dt;
      if (emoteT >= dur) {
        endEmote(); // 終了：基準姿勢に戻し、同フレームで通常アニメに続行
      } else {
        applyEmote(emoteId, emoteT, dur);
        return;
      }
    }

    if (moving) {
      walkT += dt * 9;
      const swing = Math.sin(walkT);
      legL.rotation.x = swing * 0.75;
      legR.rotation.x = -swing * 0.75;
      armL.rotation.x = -swing * 0.6;
      armR.rotation.x = swing * 0.6;
      upperGroup.position.y = HIP_Y + Math.abs(Math.sin(walkT)) * 0.05;
      headGroup.rotation.z = Math.sin(walkT) * 0.03;
    } else {
      idleT += dt;
      const easeT = Math.min(1, dt * 8);
      legL.rotation.x += (0 - legL.rotation.x) * easeT;
      legR.rotation.x += (0 - legR.rotation.x) * easeT;
      armR.rotation.x += (Math.sin(idleT * 1.4) * 0.06 - armR.rotation.x) * easeT;
      armL.rotation.x += (Math.sin(idleT * 1.4 + Math.PI) * 0.06 - armL.rotation.x) * easeT;
      upperGroup.position.y += (HIP_Y + Math.sin(idleT * 1.6) * 0.015 - upperGroup.position.y) * easeT;
      headGroup.rotation.z += (0 - headGroup.rotation.z) * easeT;
    }
  }

  root.userData.update = update;
  root.userData.setMoving = setMoving;
  root.userData.say = say;
  root.userData.playEmote = playEmote;

  return root;
}
