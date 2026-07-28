import * as THREE from 'three';

// =====================================================================
// 「refined」案 — シンプル・チビ路線
//
// 反省: 大きくて描き込んだ目を作ると「怖い」方向に行く（不気味の谷）。
//       Mii / Crossy Road / どうぶつの森 のような「点に近い目＋にっこり」の方が
//       ずっと可愛く、ローポリとも相性が良い。
// 方針: 情報量を足すのではなく減らす。丸い・柔らかい・3頭身。
// =====================================================================

export const STYLE_INFO = {
  id: 'refined',
  name: '改訂案（シンプル）',
  desc: '3頭身・点目とにっこり口。描き込まずに丸さと配色で可愛さを出す',
};

const TARGET_HEIGHT = 1.35;

const gradientMap = (() => {
  // 2段だけの素直なトゥーン（陰を濃くしすぎると怖くなる）
  const data = new Uint8Array([170, 170, 170, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

function toon(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

// ---- 顔テクスチャ ----
// 目は小さめの縦長。まつげ・眉・虹彩は描かない（描くほど怖くなる）
const FACE_EYE_Y = 0.52;

function makeFaceTexture(expression = 'default') {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);

  const cx = S / 2;
  const eyeY = S * FACE_EYE_Y;
  const eyeDX = S * 0.135;
  const ink = '#3b3340';

  // 頬（先に薄く敷く）
  c.fillStyle = 'rgba(255,150,150,0.3)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * S * 0.215, eyeY + S * 0.055, S * 0.045, S * 0.028, 0, 0, Math.PI * 2);
    c.fill();
  }

  const closed = expression === 'closed' || expression === 'happy';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeDX;
    if (closed) {
      // にっこり閉じ目（上に凸のアーチ）
      c.strokeStyle = ink;
      c.lineWidth = S * 0.026;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(ex, eyeY + S * 0.015, S * 0.045, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
    } else {
      // 点に近い縦長の目＋小さなハイライト1点
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(ex, eyeY, S * 0.034, S * 0.046, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.ellipse(ex - S * 0.011, eyeY - S * 0.016, S * 0.011, S * 0.013, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  // 口（小さく、にっこり）
  c.strokeStyle = ink;
  c.lineWidth = S * 0.017;
  c.lineCap = 'round';
  c.beginPath();
  if (expression === 'happy') {
    c.arc(cx, eyeY + S * 0.075, S * 0.032, Math.PI * 0.1, Math.PI * 0.9);
  } else if (expression === 'smile') {
    c.arc(cx, eyeY + S * 0.078, S * 0.025, Math.PI * 0.12, Math.PI * 0.88);
  } else {
    c.arc(cx, eyeY + S * 0.08, S * 0.018, Math.PI * 0.15, Math.PI * 0.85);
  }
  c.stroke();

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
  const pantsMat = toon(new THREE.Color(shirtColor).multiplyScalar(0.5).getHex());
  const shoeMat = toon(0x4a4453);

  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);

  // 頭の半径を1として組み立て、最後に正規化。全体で約3頭身。
  const R = 1;

  // ---------- 脚（短く・太め） ----------
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.34, 1.55, 0);
    upper.add(hip);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 6, 14), pantsMat);
    leg.position.y = -0.5;
    hip.add(leg);

    // 靴は丸く、前に出す
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), shoeMat);
    shoe.position.set(0, -1.0, 0.09);
    shoe.scale.set(0.95, 0.7, 1.25);
    hip.add(shoe);

    legs.push(hip);
  }

  // ---------- 胴（丸くずんぐり） ----------
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 0.62, 8, 20), shirtMat);
  torso.position.y = 2.35;
  torso.scale.set(1, 1, 0.92);
  upper.add(torso);

  // ---------- 腕（短く・ミトン） ----------
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.66, 2.62, 0);
    upper.add(shoulder);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 6, 12), shirtMat);
    arm.position.y = -0.34;
    shoulder.add(arm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), skinMat);
    hand.position.y = -0.74;
    hand.scale.set(0.95, 1, 0.85);
    shoulder.add(hand);

    shoulder.rotation.z = sx * 0.2;
    arms.push(shoulder);
  }

  // ---------- 頭（大きく丸く） ----------
  const headGroup = new THREE.Group();
  headGroup.position.y = 3.62;
  upper.add(headGroup);

  const headGeo = new THREE.SphereGeometry(R, 28, 22);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.scale.set(1, 0.96, 0.94);
  headGroup.add(head);

  // 顔は頭の丸みに沿った殻に描く（板だと横から消える・縁が浮く）
  const FACE_PHI = Math.PI * 0.66;
  const FACE_THETA_START = Math.PI * 0.26;
  const FACE_THETA_LEN = Math.PI * 0.5;
  const faceMat = new THREE.MeshBasicMaterial({
    map: FACE_TEXTURES.default,
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(
      R * 1.006,
      30,
      24,
      Math.PI / 2 - FACE_PHI / 2,
      FACE_PHI,
      FACE_THETA_START,
      FACE_THETA_LEN,
    ),
    faceMat,
  );
  face.scale.copy(head.scale);
  face.renderOrder = 2;
  headGroup.add(face);

  const eyeLocalY = Math.cos(FACE_THETA_START + FACE_THETA_LEN * FACE_EYE_Y) * R;

  // ---------- 髪 ----------
  const hairGroup = new THREE.Group();
  headGroup.add(hairGroup);

  // 頭頂のふんわりしたキャップ。目の高さより下には絶対に来ない
  const capBottom = eyeLocalY + R * 0.26;
  const capTheta = Math.acos(Math.min(0.98, Math.max(-0.98, capBottom / (R * 1.05))));
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.05, 26, 18, 0, Math.PI * 2, 0, capTheta),
    hairMat,
  );
  cap.scale.set(1.0, 1.03, 0.98);
  hairGroup.add(cap);

  // 後頭部（前には出さない）
  const back = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 22, 18), hairMat);
  back.scale.set(0.99, 1.0, 0.6);
  back.position.z = -R * 0.44;
  hairGroup.add(back);

  if (hairStyle === 'long') {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.62, R * 1.0, 6, 14), hairMat);
    tail.position.set(0, -R * 0.85, -R * 0.5);
    tail.scale.set(1, 1, 0.5);
    hairGroup.add(tail);
  } else if (hairStyle === 'twin') {
    for (const sx of [-1, 1]) {
      const t = new THREE.Group();
      t.position.set(sx * R * 0.8, R * 0.5, -R * 0.15);
      t.rotation.z = sx * 0.75;
      hairGroup.add(t);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 0.32, 12, 10), hairMat);
      ball.position.y = -R * 0.28;
      ball.scale.set(0.9, 1.15, 0.9);
      t.add(ball);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(R * 0.24, 12, 10), hairMat);
      tip.position.y = -R * 0.72;
      tip.scale.set(0.85, 1.1, 0.85);
      t.add(tip);
    }
  } else if (hairStyle === 'hat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.42, R * 1.42, R * 0.09, 24), shirtMat);
    brim.position.y = R * 0.52;
    hairGroup.add(brim);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(R * 0.78, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), shirtMat);
    crown.position.y = R * 0.5;
    crown.scale.set(1, 1.1, 1);
    hairGroup.add(crown);
  }

  // ---------- 正規化＆接地 ----------
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
  const s = TARGET_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
  upper.scale.setScalar(s);
  upper.position.y = -box.min.y * s;

  // ---------- アニメーション ----------
  let t = 0;
  let blink = 2 + Math.random() * 3;
  let moving = false;
  const headBaseY = headGroup.position.y;

  root.userData.setMoving = (m) => {
    moving = m;
  };
  root.userData.update = (dt) => {
    t += dt;
    blink -= dt;
    if (blink <= 0) {
      faceMat.map = FACE_TEXTURES.closed;
      if (blink < -0.11) {
        faceMat.map = FACE_TEXTURES.default;
        blink = 2.5 + Math.random() * 3.5;
      }
    }
    if (moving) {
      const w = t * 8.5;
      arms[0].rotation.x = Math.sin(w) * 0.6;
      arms[1].rotation.x = -Math.sin(w) * 0.6;
      legs[0].rotation.x = -Math.sin(w) * 0.55;
      legs[1].rotation.x = Math.sin(w) * 0.55;
      upper.position.y = -box.min.y * s + Math.abs(Math.sin(w)) * 0.03;
      headGroup.rotation.z = Math.sin(w) * 0.05;
    } else {
      const b = Math.sin(t * 1.7);
      arms[0].rotation.x = b * 0.06;
      arms[1].rotation.x = -b * 0.06;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;
      upper.position.y = -box.min.y * s;
      headGroup.position.y = headBaseY + b * 0.015;
      headGroup.rotation.z = Math.sin(t * 0.6) * 0.03;
    }
  };

  return root;
}
