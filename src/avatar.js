import * as THREE from 'three';

// ------------------------------------------------------------------
// プリセット式・低ポリ「ちびキャラ」アバター
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

function buildHair(style, hairColor, headRadius) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.85, metalness: 0.02, flatShading: true });

  if (style === 'long') {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(headRadius * 1.06, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      mat
    );
    cap.castShadow = true;
    group.add(cap);

    const back = new THREE.Mesh(new THREE.BoxGeometry(headRadius * 1.5, headRadius * 2.4, headRadius * 0.9), mat);
    back.position.set(0, -headRadius * 1.15, -headRadius * 0.75);
    back.castShadow = true;
    group.add(back);
  } else if (style === 'twin') {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(headRadius * 1.05, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat
    );
    cap.castShadow = true;
    group.add(cap);

    [-1, 1].forEach((side) => {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(headRadius * 0.22, headRadius * 1.3, 4, 8), mat);
      tail.position.set(side * headRadius * 1.05, -headRadius * 0.3, -headRadius * 0.1);
      tail.rotation.z = side * 0.55;
      tail.castShadow = true;
      group.add(tail);
    });
  } else if (style === 'hat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(headRadius * 1.15, headRadius * 1.15, headRadius * 0.16, 12), mat);
    brim.position.set(0, headRadius * 0.55, 0);
    brim.castShadow = true;
    group.add(brim);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(headRadius * 0.85, headRadius * 1.9, 12), mat);
    cone.position.set(0, headRadius * 0.55 + headRadius * 0.95 + headRadius * 0.08, 0);
    cone.castShadow = true;
    group.add(cone);

    const pom = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.18, 8, 8), mat);
    pom.position.set(0, headRadius * 0.55 + headRadius * 1.9 + headRadius * 0.12, 0);
    pom.castShadow = true;
    group.add(pom);
  } else {
    // 'short' （既定）
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(headRadius * 1.08, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      mat
    );
    cap.castShadow = true;
    group.add(cap);
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

  const skinMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.75, metalness: 0.02, flatShading: true });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8, metalness: 0.02, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.4, metalness: 0.1 });

  const HIP_Y = 0.5;
  const LEG_R = 0.095;
  const LEG_LEN = 0.3;
  const ARM_R = 0.075;
  const ARM_LEN = 0.26;
  const TORSO_R = 0.2;
  const TORSO_LEN = 0.24;
  const HEAD_R = 0.27;

  // ---- 脚 ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.12, HIP_Y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(LEG_R, LEG_LEN, 4, 8), skinMat.clone());
    mesh.material.color.set(bodyColor).multiplyScalar(0.6); // ズボン風に少し暗めのボディ色
    mesh.position.y = -(LEG_LEN / 2 + LEG_R) + 0.02;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身（胴・腕・頭）：まとめて上下にバウンドさせる ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(TORSO_R, TORSO_LEN, 4, 8), shirtMat);
  torso.position.y = TORSO_LEN / 2 + TORSO_R;
  torso.castShadow = true;
  upperGroup.add(torso);

  const shoulderY = TORSO_LEN + TORSO_R * 1.5;

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (TORSO_R + ARM_R + 0.03), shoulderY, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(ARM_R, ARM_LEN, 4, 8), skinMat);
    mesh.position.y = -(ARM_LEN / 2 + ARM_R) + 0.02;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upperGroup.add(armL, armR);

  // ---- 頭 ----
  const headY = shoulderY + HEAD_R * 0.95;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 14, 12), skinMat);
  head.castShadow = true;
  headGroup.add(head);

  // 目
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.1, 8, 8), eyeMat);
    eye.position.set(side * HEAD_R * 0.38, HEAD_R * 0.05, HEAD_R * 0.92);
    headGroup.add(eye);
  });

  // 髪
  const hair = buildHair(hairStyle, hairColor, HEAD_R);
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

  function setMoving(v) {
    moving = !!v;
  }

  function update(dt) {
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
      const ease = Math.min(1, dt * 8);
      legL.rotation.x += (0 - legL.rotation.x) * ease;
      legR.rotation.x += (0 - legR.rotation.x) * ease;
      armR.rotation.x += (Math.sin(idleT * 1.4) * 0.06 - armR.rotation.x) * ease;
      armL.rotation.x += (Math.sin(idleT * 1.4 + Math.PI) * 0.06 - armL.rotation.x) * ease;
      upperGroup.position.y += (HIP_Y + Math.sin(idleT * 1.6) * 0.015 - upperGroup.position.y) * ease;
      headGroup.rotation.z += (0 - headGroup.rotation.z) * ease;
    }
  }

  root.userData.update = update;
  root.userData.setMoving = setMoving;
  root.userData.say = say;

  return root;
}
