import * as THREE from 'three';

// =====================================================================
// アバター案パック
//
// これまでの失敗から得た指針:
//   1. 目は描き込まない（黒い矩形＋赤み）。描くほど怖くなる
//   2. 目は顔の下寄り・大きめ・離し気味に置くと幼く可愛くなる
//   3. 髪は「1枚のかぶり物」にすると帽子に見える。**毛束の集合**にする
//      （Blenderで面を削って確かめた結果、顔まわりの開き方が印象を決める）
//   4. シルエット命：大きい頭／ダボっとした服／細い脚／ごついブーツ
//   5. 太い黒のアウトライン
//
// 1ファイルで複数の案を作り分ける。VARIANTS に定義を足せば案が増える。
// =====================================================================

const OUTLINE_COLOR = 0x14101a;
const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

function flat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function outlined(geo, mat, thickness = 1.06) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  const o = new THREE.Mesh(geo, outlineMat);
  o.scale.setScalar(thickness);
  g.add(o);
  return g;
}

// ---------------------------------------------------------------------
// 顔テクスチャ
// ---------------------------------------------------------------------
function makeFace(opts, expression = 'default') {
  const {
    eyeStyle = 'rect', // rect | round | tall
    eyeY = 0.6,
    eyeDX = 0.19,
    eyeW = 0.125,
    eyeH = 0.2,
    blush = true,
  } = opts;

  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const cx = S / 2;
  const ey = S * eyeY;
  const ink = '#171017';

  if (blush) {
    c.fillStyle = 'rgba(255,140,150,0.4)';
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.ellipse(cx + sx * S * (eyeDX + 0.075), ey + S * 0.05, S * 0.05, S * 0.03, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  const closed = expression === 'closed' || expression === 'happy';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * S * eyeDX;
    if (closed) {
      c.strokeStyle = ink;
      c.lineWidth = S * 0.03;
      c.lineCap = 'butt';
      c.beginPath();
      c.moveTo(ex - S * eyeW * 0.55, ey + S * eyeH * 0.08);
      c.lineTo(ex, ey - S * eyeH * 0.2);
      c.lineTo(ex + S * eyeW * 0.55, ey + S * eyeH * 0.08);
      c.stroke();
      continue;
    }
    const w = S * eyeW;
    const h = S * eyeH;
    const g = c.createLinearGradient(0, ey - h / 2, 0, ey + h / 2);
    g.addColorStop(0, '#141014');
    g.addColorStop(0.6, '#171017');
    g.addColorStop(0.61, '#8f2f38');
    g.addColorStop(1, '#d0616b');
    c.fillStyle = g;

    if (eyeStyle === 'round') {
      c.beginPath();
      c.ellipse(ex, ey, w * 0.55, h * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    } else if (eyeStyle === 'tall') {
      c.beginPath();
      c.roundRect(ex - w * 0.38, ey - h / 2, w * 0.76, h, w * 0.3);
      c.fill();
    } else {
      c.fillRect(ex - w / 2, ey - h / 2, w, h);
    }
    // ハイライト
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(ex - w * 0.34, ey - h * 0.38, w * 0.2, h * 0.16);
  }

  // 口
  c.fillStyle = '#e0606a';
  if (expression === 'happy') {
    c.beginPath();
    c.moveTo(cx - S * 0.03, ey + S * 0.1);
    c.lineTo(cx + S * 0.03, ey + S * 0.1);
    c.lineTo(cx, ey + S * 0.14);
    c.closePath();
    c.fill();
  } else {
    c.fillRect(cx - S * 0.016, ey + S * 0.098, S * 0.032, S * 0.018);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------
// 毛束を頭のまわりに並べる（顔の前は開ける）
// ---------------------------------------------------------------------
function buildStrandHair(parent, R, hairMat, opts) {
  const {
    count = 14,
    openAngle = 1.05, // 顔側に開ける角度（ラジアン・片側）
    len = 1.15,
    width = 0.3,
    tilt = 0.06,
    frontLen = 0.55, // 前髪（開口の上）の長さ
    topY = 0.42,
  } = opts;

  // 後ろ〜横をぐるりと囲む毛束
  for (let i = 0; i < count; i++) {
    const a = openAngle + ((Math.PI * 2 - openAngle * 2) * i) / (count - 1);
    const jitter = (i % 3) * 0.06;
    const strand = outlined(
      new THREE.ConeGeometry(R * width, R * (len + jitter), 3),
      hairMat,
      1.05,
    );
    strand.position.set(
      Math.sin(a) * R * 0.86,
      R * (topY - 0.42),
      Math.cos(a) * R * 0.86,
    );
    strand.rotation.x = Math.PI;
    strand.rotation.y = a;
    strand.rotation.z = Math.sin(a) * tilt;
    strand.scale.set(1, 1, 0.42);
    parent.add(strand);
  }

  // 頭頂の丸み（毛束の根元を隠す）
  const crown = outlined(
    new THREE.SphereGeometry(R * 1.02, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.46),
    hairMat,
    1.04,
  );
  crown.position.y = R * 0.02;
  parent.add(crown);

  // 前髪（開口の上に垂らす）
  for (let i = -2; i <= 2; i++) {
    const w = i === 0 ? width * 1.1 : width;
    const l = i % 2 === 0 ? frontLen : frontLen * 0.72;
    const tip = outlined(new THREE.ConeGeometry(R * w, R * l, 3), hairMat, 1.05);
    tip.position.set(i * R * 0.3, R * (topY - l * 0.5), R * 0.72 - Math.abs(i) * R * 0.15);
    tip.rotation.x = Math.PI;
    tip.scale.set(1, 1, 0.34);
    parent.add(tip);
  }
}

// ---------------------------------------------------------------------
// 案の定義
// ---------------------------------------------------------------------
export const VARIANTS = {
  bob: {
    name: 'A: ボブ',
    desc: '毛束を頭のまわりに並べたボブ。基本形',
    head: 1.0,
    headScale: [1.0, 0.98, 0.92],
    face: { eyeStyle: 'rect', eyeY: 0.6, eyeDX: 0.19, eyeW: 0.125, eyeH: 0.2 },
    hair: { count: 14, openAngle: 1.0, len: 1.15, width: 0.3, frontLen: 0.55 },
    body: { topR: [0.5, 0.78], topH: 1.5, legR: 0.16, ahoge: true, headphones: true },
  },
  fluffy: {
    name: 'B: ふわふわ',
    desc: '毛束を多く・短めにして丸いシルエットに',
    head: 1.05,
    headScale: [1.0, 0.95, 0.95],
    face: { eyeStyle: 'round', eyeY: 0.62, eyeDX: 0.2, eyeW: 0.15, eyeH: 0.17 },
    hair: { count: 18, openAngle: 0.95, len: 0.8, width: 0.34, frontLen: 0.42, topY: 0.5 },
    body: { topR: [0.52, 0.82], topH: 1.45, legR: 0.15, ahoge: true, headphones: false },
  },
  longhair: {
    name: 'C: ロング',
    desc: '毛束を長く垂らしたロングヘア',
    head: 1.0,
    headScale: [1.0, 0.98, 0.92],
    face: { eyeStyle: 'tall', eyeY: 0.6, eyeDX: 0.185, eyeW: 0.12, eyeH: 0.22 },
    hair: { count: 13, openAngle: 1.25, len: 1.8, width: 0.3, frontLen: 0.48, tilt: 0.02 },
    body: { topR: [0.48, 0.74], topH: 1.55, legR: 0.15, ahoge: false, headphones: false },
  },
  hood: {
    name: 'D: フード',
    desc: 'フードを被った版。髪をほぼ隠して顔だけ見せる',
    head: 1.0,
    headScale: [1.0, 0.98, 0.92],
    face: { eyeStyle: 'rect', eyeY: 0.6, eyeDX: 0.19, eyeW: 0.13, eyeH: 0.19 },
    hair: { count: 8, openAngle: 1.25, len: 0.7, width: 0.26, frontLen: 0.45 },
    body: { topR: [0.55, 0.85], topH: 1.6, legR: 0.16, ahoge: false, headphones: false, hood: true },
  },
};

// ---------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------
export function createVariant(variantId, config = {}) {
  const V = VARIANTS[variantId] || VARIANTS.bob;
  const {
    bodyColor = '#ffdbac',
    hairColor = '#3a2a1e',
    shirtColor = '#f5f5f5',
    bottomColor,
    accentColor = '#ff4fd8',
  } = config;

  const skinMat = flat(bodyColor);
  const hairMat = flat(hairColor);
  const topMat = flat(shirtColor);
  const legMat = flat(bottomColor || new THREE.Color(shirtColor).multiplyScalar(0.3).getHex());
  const bootMat = flat(0x2b2733);
  const accMat = flat(accentColor);

  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);

  const R = V.head;
  const B = V.body;

  // 脚
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.26, 1.5, 0);
    upper.add(hip);
    const leg = outlined(new THREE.CylinderGeometry(B.legR, B.legR * 0.9, 1.0, 7), legMat, 1.09);
    leg.position.y = -0.5;
    hip.add(leg);
    const boot = outlined(new THREE.BoxGeometry(0.42, 0.4, 0.6), bootMat, 1.07);
    boot.position.set(0, -1.12, 0.08);
    hip.add(boot);
    const sole = outlined(new THREE.BoxGeometry(0.46, 0.1, 0.64), accMat, 1.05);
    sole.position.set(0, -1.3, 0.08);
    hip.add(sole);
    legs.push(hip);
  }

  // トップス
  const top = outlined(
    new THREE.CylinderGeometry(B.topR[0], B.topR[1], B.topH, 9, 1),
    topMat,
    1.05,
  );
  top.position.y = 1.6 + B.topH / 2;
  upper.add(top);

  // 腕
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(sx * (B.topR[0] + 0.12), 1.6 + B.topH - 0.2, 0);
    upper.add(sh);
    const sleeve = outlined(new THREE.CylinderGeometry(0.21, 0.18, 0.95, 7), topMat, 1.07);
    sleeve.position.y = -0.5;
    sh.add(sleeve);
    const hand = outlined(new THREE.BoxGeometry(0.24, 0.28, 0.2), skinMat, 1.09);
    hand.position.y = -1.06;
    sh.add(hand);
    sh.rotation.z = sx * 0.1;
    arms.push(sh);
  }

  // 頭
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.6 + B.topH + R * 0.72;
  upper.add(headGroup);

  const head = outlined(new THREE.SphereGeometry(R, 9, 7), skinMat, 1.04);
  head.scale.set(...V.headScale);
  headGroup.add(head);

  // 顔
  const faces = {
    default: makeFace(V.face, 'default'),
    happy: makeFace(V.face, 'happy'),
    closed: makeFace(V.face, 'closed'),
  };
  const faceMat = new THREE.MeshBasicMaterial({
    map: faces.default,
    transparent: true,
    depthWrite: false,
  });
  const FP = Math.PI * 0.82;
  const FT0 = Math.PI * 0.22;
  const FTL = Math.PI * 0.6;
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.012, 24, 18, Math.PI / 2 - FP / 2, FP, FT0, FTL),
    faceMat,
  );
  face.scale.set(...V.headScale);
  face.renderOrder = 3;
  headGroup.add(face);

  // 髪
  const hairGroup = new THREE.Group();
  headGroup.add(hairGroup);
  if (!B.hood) {
    buildStrandHair(hairGroup, R, hairMat, V.hair);
    if (B.ahoge) {
      // 細すぎるとアンテナに見えるので、幅のある板状の毛束にする
      const ahoge = outlined(new THREE.ConeGeometry(R * 0.36, R * 0.8, 3), hairMat, 1.06);
      ahoge.position.set(-R * 0.14, R * 1.18, R * 0.02);
      ahoge.rotation.z = 0.34;
      ahoge.scale.set(1, 1, 0.22);
      hairGroup.add(ahoge);
    }
  } else {
    // フード：**正面を大きく開けた殻**にする。
    // 全周を覆うと顔が完全に隠れてしまうので、phiの範囲で前を開ける。
    buildStrandHair(hairGroup, R * 0.88, hairMat, V.hair);
    const OPEN = Math.PI * 0.62; // 前方に開ける角度
    const hoodShell = outlined(
      new THREE.SphereGeometry(
        R * 1.26,
        10,
        7,
        Math.PI / 2 + OPEN / 2,
        Math.PI * 2 - OPEN,
        0,
        Math.PI * 0.78,
      ),
      topMat,
      1.04,
    );
    hoodShell.position.y = R * 0.04;
    hoodShell.scale.set(1.0, 1.0, 1.02);
    hairGroup.add(hoodShell);

    // フードの縁（開口をぐるりと囲むリング）
    const rim = outlined(new THREE.TorusGeometry(R * 1.12, R * 0.1, 4, 12), topMat, 1.05);
    rim.rotation.x = Math.PI * 0.46;
    rim.position.set(0, R * 0.02, R * 0.12);
    hairGroup.add(rim);

    // 後頭部のふくらみ
    const hoodBack = outlined(new THREE.SphereGeometry(R * 1.1, 9, 7), topMat, 1.05);
    hoodBack.scale.set(0.92, 0.8, 0.62);
    hoodBack.position.set(0, -R * 0.36, -R * 0.72);
    hairGroup.add(hoodBack);
  }

  // ヘッドホン
  if (B.headphones) {
    const band = outlined(new THREE.TorusGeometry(R * 1.06, R * 0.075, 4, 10, Math.PI), flat(0x2b2733), 1.06);
    band.rotation.y = Math.PI / 2;
    headGroup.add(band);
    for (const sx of [-1, 1]) {
      const cup = outlined(new THREE.CylinderGeometry(R * 0.3, R * 0.3, R * 0.2, 7), flat(0x2b2733), 1.06);
      cup.position.set(sx * R * 1.02, R * 0.02, 0);
      cup.rotation.z = Math.PI / 2;
      headGroup.add(cup);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.2, R * 0.24, 7), accMat);
      pad.position.set(sx * R * 1.08, R * 0.02, 0);
      pad.rotation.z = Math.PI / 2;
      headGroup.add(pad);
    }
  }

  // 正規化＆接地
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
  const s = 1.45 / Math.max(0.01, box.max.y - box.min.y);
  upper.scale.setScalar(s);
  const baseY = -box.min.y * s;
  upper.position.y = baseY;

  // アニメーション
  let t = 0;
  let blink = 2 + Math.random() * 3;
  let moving = false;
  root.userData.setMoving = (m) => {
    moving = m;
  };
  root.userData.update = (dt) => {
    t += dt;
    blink -= dt;
    if (blink <= 0) {
      faceMat.map = faces.closed;
      if (blink < -0.11) {
        faceMat.map = faces.default;
        blink = 2.5 + Math.random() * 3.5;
      }
    }
    if (moving) {
      const w = t * 8;
      arms[0].rotation.x = Math.sin(w) * 0.55;
      arms[1].rotation.x = -Math.sin(w) * 0.55;
      legs[0].rotation.x = -Math.sin(w) * 0.5;
      legs[1].rotation.x = Math.sin(w) * 0.5;
      upper.position.y = baseY + Math.abs(Math.sin(w)) * 0.025;
    } else {
      const b = Math.sin(t * 1.6);
      arms[0].rotation.x = b * 0.05;
      arms[1].rotation.x = -b * 0.05;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;
      upper.position.y = baseY;
      headGroup.rotation.z = Math.sin(t * 0.55) * 0.02;
    }
  };

  return root;
}
