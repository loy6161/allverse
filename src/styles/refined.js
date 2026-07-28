import * as THREE from 'three';

// =====================================================================
// 「refined」案
// 見た目を実際に確認しながら作り直したアバター。
// 過去案の失敗（顔が前髪に隠れる／腕が胴から浮く／頭身が宣言と違う）を
// 構造的に起こらないようにしている。
//   - 顔は頭の球より前に出した板に描き、前髪は眉より上にしか置かない
//   - 肩・股関節に球を入れてパーツの継ぎ目を埋める
//   - 最後に実測して身長を正規化し、足元をy=0に合わせる
// =====================================================================

export const STYLE_INFO = {
  id: 'refined',
  name: '改訂案',
  desc: '顔が見えること・継ぎ目が無いことを最優先に作り直した案',
};

const TARGET_HEIGHT = 1.55;

// ---- 共有リソース（色に依存しないもの） ----
const gradientMap = (() => {
  const data = new Uint8Array([90, 90, 90, 180, 180, 180, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1420, side: THREE.BackSide });

function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...opts });
}

// ---- 顔テクスチャ ----
// 目は「顔の高さの中央よりやや下」に置く。前髪はこの線より上にしか来ない。
const FACE_EYE_Y = 0.56; // テクスチャ内での目の高さ（0=上, 1=下）

function makeFaceTexture(expression = 'default') {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);

  const eyeY = S * FACE_EYE_Y;
  const eyeDX = S * 0.2; // 中心からの目の距離
  const cx = S / 2;

  const drawEye = (sx) => {
    const ex = cx + sx * eyeDX;
    if (expression === 'closed' || expression === 'happy') {
      // 閉じ目（弧を上に凸で描くと笑顔になる）
      c.strokeStyle = '#2b2029';
      c.lineWidth = S * 0.028;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(ex, eyeY + S * 0.02, S * 0.062, Math.PI * 1.12, Math.PI * 1.88);
      c.stroke();
      return;
    }
    // 白目（アニメ調に大きめ）
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(ex, eyeY, S * 0.078, S * 0.105, 0, 0, Math.PI * 2);
    c.fill();
    // 虹彩（上が濃く下が明るいグラデーション）
    const g = c.createLinearGradient(ex, eyeY - S * 0.09, ex, eyeY + S * 0.09);
    g.addColorStop(0, '#33254d');
    g.addColorStop(0.5, '#6b4fa8');
    g.addColorStop(1, '#b79ce4');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(ex, eyeY + S * 0.008, S * 0.064, S * 0.088, 0, 0, Math.PI * 2);
    c.fill();
    // 瞳孔
    c.fillStyle = '#211830';
    c.beginPath();
    c.ellipse(ex, eyeY + S * 0.014, S * 0.03, S * 0.045, 0, 0, Math.PI * 2);
    c.fill();
    // ハイライト（大小2つ）
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(ex - S * 0.024, eyeY - S * 0.036, S * 0.024, S * 0.029, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(ex + S * 0.028, eyeY + S * 0.04, S * 0.012, 0, Math.PI * 2);
    c.fill();
    // まつげ（上まぶたを太く）
    c.strokeStyle = '#2b2029';
    c.lineWidth = S * 0.028;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(ex, eyeY + S * 0.006, S * 0.086, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    // 目尻の跳ね
    c.lineWidth = S * 0.017;
    c.beginPath();
    c.moveTo(ex + sx * S * 0.075, eyeY - S * 0.055);
    c.lineTo(ex + sx * S * 0.105, eyeY - S * 0.092);
    c.stroke();
  };

  drawEye(-1);
  drawEye(1);

  // 眉（目より上・前髪に隠れない位置）
  c.strokeStyle = 'rgba(70,52,44,0.85)';
  c.lineWidth = S * 0.016;
  c.lineCap = 'round';
  for (const sx of [-1, 1]) {
    const bx = cx + sx * eyeDX;
    c.beginPath();
    c.moveTo(bx - sx * S * 0.05, eyeY - S * 0.125);
    c.quadraticCurveTo(bx, eyeY - S * 0.152, bx + sx * S * 0.05, eyeY - S * 0.128);
    c.stroke();
  }

  // 口
  c.strokeStyle = '#8d4a52';
  c.lineWidth = S * 0.016;
  c.beginPath();
  if (expression === 'happy') {
    c.arc(cx, eyeY + S * 0.1, S * 0.038, Math.PI * 0.12, Math.PI * 0.88);
  } else if (expression === 'smile') {
    c.arc(cx, eyeY + S * 0.105, S * 0.03, Math.PI * 0.15, Math.PI * 0.85);
  } else {
    c.arc(cx, eyeY + S * 0.098, S * 0.022, Math.PI * 0.2, Math.PI * 0.8);
  }
  c.stroke();

  // 頬の赤み
  c.fillStyle = 'rgba(240,140,150,0.28)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * eyeDX * 1.5, eyeY + S * 0.055, S * 0.05, S * 0.03, 0, 0, Math.PI * 2);
    c.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const FACE_TEXTURES = {
  default: makeFaceTexture('default'),
  smile: makeFaceTexture('smile'),
  happy: makeFaceTexture('happy'),
  closed: makeFaceTexture('closed'),
};

// ---- 本体 ----
export function createStyleAvatar(config = {}) {
  const {
    bodyColor = '#ffdbac',
    hairStyle = 'short',
    hairColor = '#4a2c17',
    shirtColor = '#3b82f6',
  } = config;

  const skinMat = toon(bodyColor);
  const hairMat = toon(hairColor);
  const shirtMat = toon(shirtColor);
  const pantsMat = toon(new THREE.Color(shirtColor).multiplyScalar(0.45).getHex());
  const shoeMat = toon(0x2f2a3a);

  const root = new THREE.Group();

  // 比率（頭の半径を基準に組み立て、最後に正規化する）
  // 頭を大きめに取ると、同じ身長でもキャラクターらしい可愛さが出る（約5頭身）
  const HEAD_R = 0.62;

  // ---------- 胴体 ----------
  // 肩から腰へ、断面を変えながら滑らかに繋ぐ（Lathe）
  const torsoProfile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.25, 0.03),
    new THREE.Vector2(0.29, 0.26),
    new THREE.Vector2(0.245, 0.6), // ウエストをしっかり絞る
    new THREE.Vector2(0.3, 0.92),
    new THREE.Vector2(0.27, 1.16),
    new THREE.Vector2(0.13, 1.25),
    new THREE.Vector2(0.001, 1.27),
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoProfile, 20);
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  const upper = new THREE.Group();
  root.add(upper);
  upper.add(torso);

  // 腰から下（ズボン）
  const hipGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.25, 0.02),
      new THREE.Vector2(0.29, 0.16),
      new THREE.Vector2(0.25, 0.3),
      new THREE.Vector2(0.001, 0.33),
    ],
    18,
  );
  const hip = new THREE.Mesh(hipGeo, pantsMat);
  hip.position.y = -0.3;
  upper.add(hip);

  // 襟（首と服の境目を隠す）
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 8, 18), shirtMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.24;
  upper.add(collar);

  // ---------- 首・頭 ----------
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 14), skinMat);
  neck.position.y = 1.3;
  upper.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 1.36 + HEAD_R * 0.82;
  upper.add(headGroup);

  // 頭は縦にわずかに潰した球（真球より顔が収まりやすい）
  const headGeo = new THREE.SphereGeometry(HEAD_R, 26, 20);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.scale.set(0.94, 1.0, 0.9);
  headGroup.add(head);

  // 輪郭線（頭と胴のみ）
  const headOutline = new THREE.Mesh(headGeo, outlineMat);
  headOutline.scale.copy(head.scale).multiplyScalar(1.045);
  headGroup.add(headOutline);
  const torsoOutline = new THREE.Mesh(torsoGeo, outlineMat);
  torsoOutline.scale.setScalar(1.04);
  upper.add(torsoOutline);

  // 顔（頭の表面より前に出す＝絶対に埋まらない）
  const faceMat = new THREE.MeshBasicMaterial({
    map: FACE_TEXTURES.default,
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(HEAD_R * 1.72, HEAD_R * 1.72), faceMat);
  face.position.set(0, HEAD_R * 0.04, HEAD_R * 0.9);
  face.renderOrder = 2;
  headGroup.add(face);

  // 耳
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.17, 10, 8), skinMat);
    ear.position.set(sx * HEAD_R * 0.9, -HEAD_R * 0.05, 0);
    ear.scale.set(0.6, 1, 0.8);
    headGroup.add(ear);
  }

  // ---------- 髪 ----------
  // 目の高さ = face中心 + (0.5 - FACE_EYE_Y) * 面の高さ。前髪はこれより上だけ。
  const faceH = HEAD_R * 1.72;
  const eyeWorldY = face.position.y + (0.5 - FACE_EYE_Y) * faceH;
  const FRINGE_BOTTOM = eyeWorldY + faceH * 0.13; // 眉より上

  const hairGroup = new THREE.Group();
  headGroup.add(hairGroup);

  // 頭頂のキャップ。**目より下に来ないよう浅く**する（顔を隠さないための要）
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_R * 1.06, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.4),
    hairMat,
  );
  cap.scale.set(0.98, 1.02, 0.96);
  hairGroup.add(cap);

  // 後頭部と横は別パーツで低い位置まで覆う（前には出さない）
  const backHair = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.04, 20, 16), hairMat);
  backHair.scale.set(1.0, 1.02, 0.62);
  backHair.position.z = -HEAD_R * 0.42;
  hairGroup.add(backHair);

  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.5, 12, 10), hairMat);
    side.position.set(sx * HEAD_R * 0.82, HEAD_R * 0.05, -HEAD_R * 0.05);
    side.scale.set(0.5, 1.25, 0.95);
    hairGroup.add(side);
  }

  // 前髪: 眉の上に収まる帯。中央で分けて左右に流す
  for (const sx of [-1, 1]) {
    const bang = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.55, 12, 10), hairMat);
    bang.position.set(sx * HEAD_R * 0.34, FRINGE_BOTTOM + HEAD_R * 0.3, HEAD_R * 0.62);
    bang.scale.set(1.15, 0.72, 0.5);
    bang.rotation.z = sx * 0.32;
    hairGroup.add(bang);
  }
  // 生え際の中央
  const bangC = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.42, 12, 10), hairMat);
  bangC.position.set(0, FRINGE_BOTTOM + HEAD_R * 0.42, HEAD_R * 0.66);
  bangC.scale.set(1.1, 0.6, 0.45);
  hairGroup.add(bangC);

  // 天使の輪
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(HEAD_R * 0.72, HEAD_R * 0.035, 6, 22),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hairColor).lerp(new THREE.Color(0xffffff), 0.55),
      transparent: true,
      opacity: 0.5,
    }),
  );
  halo.rotation.x = Math.PI / 2 - 0.24;
  halo.position.set(0, HEAD_R * 0.52, -HEAD_R * 0.04);
  hairGroup.add(halo);

  if (hairStyle === 'long') {
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(HEAD_R * 0.72, HEAD_R * 1.5, 5, 14), hairMat);
    back.position.set(0, -HEAD_R * 0.85, -HEAD_R * 0.42);
    back.scale.set(1, 1, 0.55);
    hairGroup.add(back);
  } else if (hairStyle === 'twin') {
    for (const sx of [-1, 1]) {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 0.3, 12, 10), hairMat);
      knot.position.set(sx * HEAD_R * 0.92, HEAD_R * 0.28, -HEAD_R * 0.1);
      hairGroup.add(knot);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(HEAD_R * 0.26, HEAD_R * 1.15, 5, 12), hairMat);
      tail.position.set(sx * HEAD_R * 1.12, -HEAD_R * 0.4, -HEAD_R * 0.16);
      tail.rotation.z = sx * 0.3;
      hairGroup.add(tail);
    }
  } else if (hairStyle === 'hat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 1.5, HEAD_R * 1.5, HEAD_R * 0.07, 22), toon(0x2f2a3a));
    brim.position.y = HEAD_R * 0.66;
    hairGroup.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(HEAD_R * 0.82, HEAD_R * 0.92, HEAD_R * 0.62, 20), toon(0x2f2a3a));
    crown.position.y = HEAD_R * 0.96;
    hairGroup.add(crown);
    const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 0.92, HEAD_R * 0.05, 6, 20), shirtMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = HEAD_R * 0.7;
    hairGroup.add(band);
  }

  // ---------- 腕 ----------
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.27, 1.1, 0);
    upper.add(shoulder);

    // 肩の球で胴との継ぎ目を埋める
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), shirtMat);
    shoulder.add(joint);

    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.072, 0.4, 12), shirtMat);
    upperArm.position.y = -0.2;
    shoulder.add(upperArm);

    // 袖口
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.022, 6, 14), shirtMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.39;
    shoulder.add(cuff);

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 8), skinMat);
    elbow.position.y = -0.41;
    shoulder.add(elbow);

    const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.056, 0.4, 12), skinMat);
    foreArm.position.y = -0.61;
    shoulder.add(foreArm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), skinMat);
    hand.position.y = -0.85;
    hand.scale.set(0.9, 1.15, 0.72);
    shoulder.add(hand);
    // 親指のふくらみ
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), skinMat);
    thumb.position.set(-sx * 0.06, -0.82, 0.02);
    shoulder.add(thumb);

    shoulder.rotation.z = sx * 0.16;
    arms.push(shoulder);
  }

  // ---------- 脚 ----------
  const legs = [];
  for (const sx of [-1, 1]) {
    const hipJoint = new THREE.Group();
    hipJoint.position.set(sx * 0.16, -0.34, 0);
    upper.add(hipJoint);

    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 10), pantsMat);
    hipJoint.add(joint);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.1, 0.46, 12), pantsMat);
    thigh.position.y = -0.23;
    hipJoint.add(thigh);

    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.098, 10, 8), pantsMat);
    knee.position.y = -0.46;
    hipJoint.add(knee);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.44, 12), pantsMat);
    shin.position.y = -0.68;
    hipJoint.add(shin);

    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), shoeMat);
    shoe.position.set(0, -0.91, 0.05);
    shoe.scale.set(0.8, 0.62, 1.3);
    hipJoint.add(shoe);
    // 靴底
    const sole = new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 8), toon(0xe8e4ee));
    sole.position.set(0, -0.945, 0.05);
    sole.scale.set(0.81, 0.24, 1.31);
    hipJoint.add(sole);

    legs.push(hipJoint);
  }

  // ---------- 身長の正規化＆接地 ----------
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!bb) return;
    for (const c of [
      [bb.min.x, bb.min.y, bb.min.z],
      [bb.max.x, bb.max.y, bb.max.z],
      [bb.min.x, bb.max.y, bb.min.z],
      [bb.max.x, bb.min.y, bb.max.z],
    ]) {
      v.set(c[0], c[1], c[2]).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  const rawH = Math.max(0.01, box.max.y - box.min.y);
  const s = TARGET_HEIGHT / rawH;
  upper.scale.setScalar(s);
  upper.position.y = -box.min.y * s;

  // ---------- アニメーション ----------
  let t = 0;
  let blinkAt = 2 + Math.random() * 3;
  let moving = false;
  root.userData.setMoving = (m) => {
    moving = m;
  };
  root.userData.update = (dt) => {
    t += dt;
    // まばたき
    blinkAt -= dt;
    if (blinkAt <= 0) {
      faceMat.map = FACE_TEXTURES.closed;
      if (blinkAt < -0.12) {
        faceMat.map = FACE_TEXTURES.default;
        blinkAt = 2.5 + Math.random() * 3.5;
      }
    }
    if (moving) {
      const w = t * 9;
      arms[0].rotation.x = Math.sin(w) * 0.5;
      arms[1].rotation.x = -Math.sin(w) * 0.5;
      legs[0].rotation.x = -Math.sin(w) * 0.5;
      legs[1].rotation.x = Math.sin(w) * 0.5;
      upper.rotation.y = Math.sin(w) * 0.06;
      headGroup.position.y = 1.36 + HEAD_R * 0.82 + Math.abs(Math.sin(w)) * 0.02;
    } else {
      const b = Math.sin(t * 1.6);
      arms[0].rotation.x = b * 0.05;
      arms[1].rotation.x = -b * 0.05;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;
      upper.rotation.y = Math.sin(t * 0.5) * 0.03;
      headGroup.position.y = 1.36 + HEAD_R * 0.82 + b * 0.008;
    }
  };

  return root;
}
