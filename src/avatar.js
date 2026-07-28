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

  // ---- ペンライト（emote用。使い回し、通常は非表示） ----
  const penlightLen = 0.34;
  const penlightMat = new THREE.MeshStandardMaterial({
    color: '#8be8ff',
    emissive: '#66e6ff',
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.1,
  });
  const penlightMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, penlightLen, 4, 8), penlightMat);
  const handY = -(ARM_LEN + ARM_R * 2);
  penlightMesh.position.set(0, handY - penlightLen / 2 - 0.03, 0);
  penlightMesh.visible = false;
  armR.add(penlightMesh);

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
