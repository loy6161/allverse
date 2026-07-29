import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =====================================================================
// ローポリ・アバター生成器 v2（参考モデル10体の接写観察にもとづく作り直し）
//
// 観察で判明した構造（docs/AVATAR_REFERENCE_ANALYSIS.md 追記分）:
//   1. 頭は「ほぼ髪のボール」。顔は下前方に開いた小さな窓だけ
//   2. 前髪の大きな三角が窓の上から目の高さまで垂れ、その間に目が覗く
//   3. 頭（髪込み）は全身の約41% ＝ 2.4頭身。頭は幅0.52×奥行0.5のほぼ球
//   4. 体は小さく、脚は先細り。腕は体の脇に小さく
// =====================================================================

const OUTLINE = 0x14101a;

function flat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

// 三角柱（髪の房に使う平たい塊）
function wedge(w, h, d) {
  const g = new THREE.CylinderGeometry(w, w * 0.05, h, 3, 1);
  g.scale(1, 1, d / w);
  return g;
}

function frustum(rTop, rBottom, h, sides = 7) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1);
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const g = src.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  return g;
}

// ---------------------------------------------------------------------
// 頭のボールを「髪」と「顔の窓」に切り分ける
//   - 丸い多面体（icosahedron detail=1 → 80面）を使い、輪郭を丸くする
//   - 前方下部の三角形だけを肌（顔の窓）に分類する
// ---------------------------------------------------------------------
function carvedHead(R) {
  const ball = new THREE.IcosahedronGeometry(R, 1); // 非インデックス・80三角形
  const pos = ball.getAttribute('position');
  const hairTris = [];
  const skinTris = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const cz = (a.z + b.z + c.z) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    // 顔の窓: 前方(z)・下寄り(y)・中央(x)。広げすぎると側面まで肌になる
    const isFace = cz > R * 0.5 && Math.abs(cx) < R * 0.56 && cy < R * 0.56 && cy > -R * 0.74;
    (isFace ? skinTris : hairTris).push(i);
  }
  const build = (indices) => {
    const arr = new Float32Array(indices.length * 9);
    let k = 0;
    for (const i of indices) {
      for (let j = 0; j < 3; j++) {
        arr[k++] = pos.getX(i + j);
        arr[k++] = pos.getY(i + j);
        arr[k++] = pos.getZ(i + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  return { hair: build(hairTris), skin: build(skinTris) };
}

// ---------------------------------------------------------------------
// 顔テクスチャ（窓のサイズに合わせて、目は窓の上端寄りに置く）
// ---------------------------------------------------------------------
function makeFaceTexture(o, expression = 'default') {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const cx = S / 2;
  const ey = S * (o.eyeY ?? 0.6); // 前髪の毛先より必ず下（参考: 目は毛先の下に離れて見える）
  const dx = S * (o.eyeDX ?? 0.21);
  const w = S * (o.eyeW ?? 0.125);
  const h = S * (o.eyeH ?? 0.26);
  const ink = '#191219';

  c.fillStyle = 'rgba(255,138,150,0.4)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * (dx + S * 0.1), ey + S * 0.1, S * 0.055, S * 0.032, 0, 0, Math.PI * 2);
    c.fill();
  }

  const closed = expression === 'closed' || expression === 'happy';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * dx;
    if (closed) {
      c.strokeStyle = ink;
      c.lineWidth = S * 0.03;
      c.beginPath();
      c.moveTo(ex - w * 0.5, ey + h * 0.05);
      c.lineTo(ex, ey - h * 0.15);
      c.lineTo(ex + w * 0.5, ey + h * 0.05);
      c.stroke();
      continue;
    }
    // 縦長の黒い矩形＋下部に色（参考モデルの目の構造そのまま）
    const g = c.createLinearGradient(0, ey - h / 2, 0, ey + h / 2);
    g.addColorStop(0, '#141014');
    g.addColorStop(0.55, '#191219');
    g.addColorStop(0.56, o.eyeColor || '#8f2f38');
    g.addColorStop(1, o.eyeColor2 || '#d8737d');
    c.fillStyle = g;
    if (o.eyeType === 'round') {
      c.beginPath();
      c.ellipse(ex, ey, w * 0.52, h * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    } else if (o.eyeType === 'diamond') {
      c.beginPath();
      c.moveTo(ex, ey - h / 2);
      c.lineTo(ex + w / 2, ey);
      c.lineTo(ex, ey + h / 2);
      c.lineTo(ex - w / 2, ey);
      c.closePath();
      c.fill();
    } else {
      c.fillRect(ex - w / 2, ey - h / 2, w, h);
    }
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(ex - w * 0.3, ey - h * 0.36, w * 0.2, h * 0.13);
  }

  c.fillStyle = '#dd5f69';
  if (expression === 'happy') {
    c.beginPath();
    c.moveTo(cx - S * 0.03, ey + S * 0.15);
    c.lineTo(cx + S * 0.03, ey + S * 0.15);
    c.lineTo(cx, ey + S * 0.19);
    c.closePath();
    c.fill();
  } else {
    c.fillRect(cx - S * 0.015, ey + S * 0.155, S * 0.03, S * 0.017);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// ---------------------------------------------------------------------
// 前髪（顔の窓の上端から垂れる大きな三角。目の間に落ちる）
// ---------------------------------------------------------------------
function bangs(R, opts = {}) {
  // 参考モデルの前髪は「大きな三角」が目の高さまで垂れ、その間から目が覗く。
  // 小さくすると生え際の点にしか見えず台無しになる（v2aで確認）
  // 参考(shinonome接写)の要点: 毛先は「目の上」で止まり、目は毛先の下に離れて見える。
  // v2dは房が長すぎて目を覆った。毛先の最下端 > 目の上端 を必ず守る。
  const defs = [
    { x: 0, len: 0.56, w: 0.34 },
    { x: -0.5, len: 0.5, w: 0.34 },
    { x: 0.5, len: 0.5, w: 0.34 },
    { x: -0.88, len: 0.4, w: 0.3 },
    { x: 0.88, len: 0.4, w: 0.3 },
  ];
  const parts = [];
  for (const d of defs) {
    parts.push(
      place(wedge(R * d.w, R * d.len, R * 0.24), [d.x * R, R * 0.66 - R * d.len * 0.5, R * 1.0 - Math.abs(d.x) * R * 0.2], [Math.PI, 0, 0], [1, 1, 0.4]),
    );
  }
  return parts;
}

// ---------------------------------------------------------------------
// 髪型（ベースのボールに足す差分だけを定義する）
// ---------------------------------------------------------------------
const HAIR_EXTRA = {
  short(R) {
    // 襟足を少しだけ
    return [place(wedge(R * 0.4, R * 0.7, R * 0.3), [0, -R * 0.55, -R * 0.72], [Math.PI, 0, 0], [1, 1, 0.6])];
  },
  bob(R) {
    const parts = [];
    // 顔の横に垂れる大きめの房（頬を挟む）
    for (const sx of [-1, 1]) {
      parts.push(place(wedge(R * 0.42, R * 1.15, R * 0.4), [sx * R * 0.78, -R * 0.42, R * 0.3], [Math.PI, 0, sx * 0.06], [1, 1, 0.62]));
    }
    parts.push(place(wedge(R * 0.5, R * 0.9, R * 0.4), [0, -R * 0.6, -R * 0.66], [Math.PI, 0, 0], [1, 1, 0.7]));
    return parts;
  },
  long(R) {
    const parts = HAIR_EXTRA.bob(R);
    // 背中に流れる大きな塊（1つの角錐台で表現）
    parts.push(place(frustum(R * 0.62, R * 0.22, R * 2.1, 5), [0, -R * 1.15, -R * 0.52], [0.06, Math.PI / 5, 0], [1, 1, 0.55]));
    return parts;
  },
  twin(R) {
    const parts = HAIR_EXTRA.short(R);
    for (const sx of [-1, 1]) {
      // 高い位置から外へ跳ねて下に落ちるツインテール
      parts.push(place(box(R * 0.26, R * 0.2, R * 0.26), [sx * R * 0.8, R * 0.52, -R * 0.12]));
      parts.push(place(frustum(R * 0.3, R * 0.08, R * 1.6, 4), [sx * R * 1.05, -R * 0.3, -R * 0.18], [0.08, Math.PI / 4, sx * 0.42], [1, 1, 0.62]));
    }
    return parts;
  },
  spiky(R) {
    // 頭頂〜後ろ寄りに上向きのトゲを並べる。前に出すと前髪と重なって崩れる(v2eで確認)
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI + (i + 0.5) * ((Math.PI * 2) / 5);
      const len = 0.55 + (i % 2) * 0.25;
      parts.push(
        place(
          wedge(R * 0.34, R * len, R * 0.3),
          [Math.sin(a) * R * 0.4, R * (0.74 + len * 0.4), Math.cos(a) * R * 0.3 - R * 0.42],
          [-0.24, a, -0.3 * Math.sin(a)],
          [1, 1, 0.5],
        ),
      );
    }
    return parts;
  },
  ponytail(R) {
    const parts = HAIR_EXTRA.short(R);
    parts.push(place(box(R * 0.24, R * 0.2, R * 0.24), [0, R * 0.5, -R * 0.88]));
    parts.push(place(frustum(R * 0.34, R * 0.08, R * 1.9, 4), [0, -R * 0.35, -R * 1.12], [0.34, Math.PI / 4, 0], [1, 1, 0.66]));
    return parts;
  },
  bun(R) {
    const parts = HAIR_EXTRA.bob(R);
    for (const sx of [-1, 1]) {
      parts.push(place(new THREE.IcosahedronGeometry(R * 0.3, 0), [sx * R * 0.6, R * 0.86, -R * 0.2]));
    }
    return parts;
  },
  hime(R) {
    const parts = HAIR_EXTRA.long(R);
    for (const sx of [-1, 1]) {
      // 顔の横の直線的な束（姫カット）
      parts.push(place(box(R * 0.24, R * 1.3, R * 0.26), [sx * R * 0.84, -R * 0.5, R * 0.4]));
    }
    return parts;
  },
};

// 動物耳（参考モデルの定番。オンオフできる差分）
function animalEars(R) {
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(place(wedge(R * 0.34, R * 0.6, R * 0.22), [sx * R * 0.52, R * 0.95, -R * 0.05], [0, 0, sx * -0.25], [1, 1, 0.55]));
  }
  return parts;
}

// ---------------------------------------------------------------------
// 服（体は小さい。参考モデル: 体全体で全身の約60%、幅は頭より狭い）
// ---------------------------------------------------------------------
const OUTFIT_BUILDERS = {
  dress(B) {
    return { cloth: [place(frustum(B.r * 0.8, B.r * 1.35, B.h, 7), [0, B.y, 0])], hem: B.r * 1.35 };
  },
  hoodie(B) {
    return {
      cloth: [
        place(frustum(B.r * 0.95, B.r * 1.05, B.h, 8), [0, B.y, 0]),
        place(box(B.r * 1.1, B.h * 0.16, B.r * 1.5), [0, B.y + B.h * 0.42, -B.r * 0.3]),
      ],
      hem: B.r * 1.05,
    };
  },
  coat(B) {
    return {
      cloth: [place(frustum(B.r * 0.85, B.r * 1.2, B.h * 1.28, 8), [0, B.y - B.h * 0.12, 0])],
      hem: B.r * 1.2,
    };
  },
  tee(B) {
    return { cloth: [place(frustum(B.r * 0.9, B.r * 0.95, B.h * 0.72, 8), [0, B.y + B.h * 0.14, 0])], hem: B.r * 0.95 };
  },
};

// ---------------------------------------------------------------------
// 案の定義
// ---------------------------------------------------------------------
export const LP_VARIANTS = {
  v01: { name: '01 ボブ×ワンピ', hair: 'bob', outfit: 'dress', eyeType: 'rect', ears: false },
  v02: { name: '02 ショート×パーカー', hair: 'short', outfit: 'hoodie', eyeType: 'rect', ears: false },
  v03: { name: '03 ツイン×ワンピ', hair: 'twin', outfit: 'dress', eyeType: 'round', ears: false },
  v04: { name: '04 ロング×コート', hair: 'long', outfit: 'coat', eyeType: 'rect', ears: false },
  v05: { name: '05 尖髪×Tシャツ', hair: 'spiky', outfit: 'tee', eyeType: 'diamond', ears: false },
  v06: { name: '06 ポニー×パーカー', hair: 'ponytail', outfit: 'hoodie', eyeType: 'rect', ears: false },
  v07: { name: '07 お団子×ワンピ', hair: 'bun', outfit: 'dress', eyeType: 'round', ears: false },
  v08: { name: '08 姫カット×コート', hair: 'hime', outfit: 'coat', eyeType: 'rect', ears: false },
  v09: { name: '09 けもみみ×ワンピ', hair: 'short', outfit: 'dress', eyeType: 'rect', ears: true },
  v10: { name: '10 けもみみ×パーカー', hair: 'bob', outfit: 'hoodie', eyeType: 'round', ears: true },
  v11: { name: '11 ツイン×パーカー', hair: 'twin', outfit: 'hoodie', eyeType: 'rect', ears: false },
  v12: { name: '12 尖髪×コート', hair: 'spiky', outfit: 'coat', eyeType: 'rect', ears: false },
};

// ---------------------------------------------------------------------
// 生成本体
// ---------------------------------------------------------------------
export function createLowPoly(variantId, config = {}) {
  const V = LP_VARIANTS[variantId] || LP_VARIANTS.v01;
  const {
    bodyColor = '#ffdbac',
    hairColor = '#3a2a1e',
    shirtColor = '#f2f2f4',
    bottomColor = '#2f3646',
    accentColor = '#ff7a52',
  } = config;

  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);

  // ---- 比率（参考実測は2.4頭身。要望によりさらに頭を大きく＝2頭身寄りへ） ----
  const H = 1.21;
  const R = 0.29; // 頭の球半径（頭+髪で全身の約48%）
  const bodyTop = H - R * 2.08; // 頭の下端
  const headCY = bodyTop + R * 0.92; // 球の中心（少し埋めて首をなくす）

  const skin = [];
  const hair = [];
  const cloth = [];
  const dark = [];
  const acc = [];

  // ---- 体 ----
  const B = { r: 0.16, h: bodyTop * 0.62, y: bodyTop * 0.66 };
  const fit = OUTFIT_BUILDERS[V.outfit](B);
  cloth.push(...fit.cloth);

  // 腕（肩から生やした先細りの小さな腕。体に密着させて浮かせない）
  for (const sx of [-1, 1]) {
    const shoulderY = B.y + B.h * 0.34;
    cloth.push(
      place(frustum(0.052, 0.018, B.h * 0.62, 5), [sx * (B.r * 0.98), shoulderY - B.h * 0.3, 0.01], [0, 0, sx * 0.3]),
    );
  }

  // 脚（先細り。参考モデルはほぼ足先が点になる）
  for (const sx of [-1, 1]) {
    dark.push(place(frustum(0.05, 0.022, bodyTop * 0.42, 5), [sx * 0.062, bodyTop * 0.21, 0]));
    dark.push(place(box(0.075, 0.045, 0.11), [sx * 0.062, 0.024, 0.015]));
  }

  // ---- 頭（丸いボールを髪と顔の窓に切り分け） ----
  const head = carvedHead(R);
  const hg = head.hair;
  hg.translate(0, headCY, 0);
  hair.push(hg);
  const sg = head.skin;
  sg.translate(0, headCY, 0);
  skin.push(sg);

  // 前髪
  for (const g of bangs(R)) {
    g.translate(0, headCY, 0);
    hair.push(g);
  }
  // 髪型差分
  for (const g of HAIR_EXTRA[V.hair](R)) {
    g.translate(0, headCY, 0);
    hair.push(g);
  }
  if (V.ears) {
    for (const g of animalEars(R)) {
      g.translate(0, headCY, 0);
      hair.push(g);
    }
  }

  // ---- 統合 ----
  function normalize(g) {
    const src = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', src.getAttribute('position').clone());
    return out;
  }

  const groups = [
    { geos: skin, color: bodyColor },
    { geos: hair, color: hairColor },
    { geos: cloth, color: shirtColor },
    { geos: dark, color: bottomColor },
    { geos: acc, color: accentColor },
  ];

  let triCount = 0;
  for (const grp of groups) {
    if (!grp.geos.length) continue;
    const mat = flat(grp.color);
    const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    const normalized = grp.geos.map(normalize);
    const merged = mergeGeometries(normalized, false) || null;
    const geosToAdd = merged ? [merged] : normalized;
    for (const g of geosToAdd) {
      g.computeVertexNormals();
      triCount += g.attributes.position.count / 3;
      upper.add(new THREE.Mesh(g, mat));
      const o = new THREE.Mesh(g, outlineMat);
      o.scale.setScalar(1.03);
      upper.add(o);
    }
  }

  // ---- 顔（窓の上に貼る） ----
  const faceOpts = { eyeType: V.eyeType };
  const faces = {
    default: makeFaceTexture(faceOpts, 'default'),
    happy: makeFaceTexture(faceOpts, 'happy'),
    closed: makeFaceTexture(faceOpts, 'closed'),
  };
  const faceMat = new THREE.MeshBasicMaterial({ map: faces.default, transparent: true, depthWrite: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.3, R * 1.34), faceMat);
  // ボールの面より前・前髪より後ろ（前髪が目の間に落ちて見える順序）
  face.position.set(0, headCY - R * 0.06, R * 0.98);
  face.renderOrder = 3;
  upper.add(face);

  // ---- 接地 ----
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(upper);
  upper.position.y = -box3.min.y;
  const baseY = upper.position.y;

  root.userData.triangles = Math.round(triCount);

  // ---- アニメーション ----
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
      upper.position.y = baseY + Math.abs(Math.sin(t * 8)) * 0.02;
      upper.rotation.z = Math.sin(t * 8) * 0.03;
    } else {
      upper.position.y = baseY;
      upper.rotation.z = Math.sin(t * 1.5) * 0.012;
    }
  };

  return root;
}
