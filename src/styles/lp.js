import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

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
    // 顔の窓: 前方(z)・下寄り(y)・中央(x)。
    // v3で前髪が一枚の塊になったので窓は小さくてよい。広げると斜めから頭頂・こめかみの肌が
    // 見えて「はげ」になる（v3で発生）。上限は前髪のM字の内側に収める
    const isFace = cz > R * 0.55 && Math.abs(cx) < R * 0.5 && cy < R * 0.3 && cy > -R * 0.74;
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
  // 参考画像の一貫性: 目は「低く・左右に離して」。中央Vの両脇の窪みに置く
  const ey = S * (o.eyeY ?? 0.62);
  const dx = S * (o.eyeDX ?? 0.28);
  const w = S * (o.eyeW ?? 0.115);
  const h = S * (o.eyeH ?? 0.23);
  const ink = '#191219';

  c.fillStyle = 'rgba(255,138,150,0.4)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * (dx + S * 0.04), ey + S * 0.11, S * 0.05, S * 0.028, 0, 0, Math.PI * 2);
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
// 前髪（v3: 一枚の塊。参考画像の「M字の生え際」を1ポリゴンで作る）
//   - 隙間のある房の集合(v2)は正解ではなかった。かわいいローポリの一貫性:
//     サイドが低く下がり、中央にVが1本、目の間まで降りる。目はその両脇の窪みに置く
// ---------------------------------------------------------------------
function bangs(R) {
  // 前面図の輪郭（単位: R）。右→上→左→下の反時計回り
  const pts = [
    [0.95, 0.2],
    [0.8, 0.55],
    [0.4, 0.8],
    [0, 0.88],
    [-0.4, 0.8],
    [-0.8, 0.55],
    [-0.95, 0.2],
    [-0.68, -0.5], // 左サイドの毛先（頬の横まで下がる）
    [-0.42, 0.38], // 左の窪み（この下に目）
    [0, -0.24], // 中央のVの毛先（目の間の高さ）
    [0.42, 0.38],
    [0.68, -0.5],
  ];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * R, y * R)));
  let g = new THREE.ShapeGeometry(shape).toNonIndexed();
  // 大きな三角形のままだと面の中央が球にめり込む（弦のたわみ）ので、2回細分化してから球面に沿わせる
  for (let s = 0; s < 2; s++) g = subdivide4(g);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / R;
    const y = pos.getY(i) / R;
    pos.setZ(i, R * Math.sqrt(Math.max(0.02, 1.15 - x * x - y * y)));
  }
  return [g];
}

// 非インデックス形状の各三角形を4分割する（中点分割）
function subdivide4(g) {
  const p = g.getAttribute('position');
  const out = [];
  const v = (i) => [p.getX(i), p.getY(i), p.getZ(i)];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  for (let i = 0; i < p.count; i += 3) {
    const a = v(i);
    const b = v(i + 1);
    const c = v(i + 2);
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const arr = new Float32Array(out.length * 3);
  out.forEach((pt, i) => arr.set(pt, i * 3));
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return ng;
}

// アホ毛（頭頂の1本。参考画像の定番シルエット）
function ahoge(R) {
  return [place(wedge(R * 0.18, R * 0.55, R * 0.16), [R * 0.04, R * 1.16, R * 0.08], [0.3, 0, -0.25], [1, 1, 0.5])];
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
    // 参考画像の方針: 正面から読める大きな塊。結び目＋太い房が外に跳ねて先端は点
    const parts = HAIR_EXTRA.short(R);
    for (const sx of [-1, 1]) {
      // 結び目のすぐ下からまっすぐ落として、先端だけ少し外へ（交差させない）
      parts.push(place(new THREE.IcosahedronGeometry(R * 0.22, 0), [sx * R * 0.8, R * 0.52, -R * 0.15]));
      parts.push(place(frustum(R * 0.26, R * 0.03, R * 1.45, 5), [sx * R * 0.98, -R * 0.25, -R * 0.22], [0.1, 0, sx * 0.15], [1, 1, 0.75]));
    }
    return parts;
  },
  spiky(R) {
    // 太いトゲ3本だけを頭頂の後ろ寄りに、後ろへ流す（本数を増やすと正面がゴチャつく）
    const parts = [];
    const defs = [
      { x: 0, z: -0.5, len: 1.0, tx: -0.7, tz: 0 },
      { x: 0.55, z: -0.32, len: 0.85, tx: -0.55, tz: -0.5 },
      { x: -0.55, z: -0.32, len: 0.85, tx: -0.55, tz: 0.5 },
    ];
    for (const d of defs) {
      parts.push(
        place(wedge(R * 0.5, R * d.len, R * 0.4), [d.x * R, R * 0.84, d.z * R], [d.tx, 0, d.tz], [1, 1, 0.55]),
      );
    }
    return parts;
  },
  ponytail(R) {
    // 結び目＋太い一本を背に流す。先端は点
    const parts = HAIR_EXTRA.short(R);
    parts.push(place(new THREE.IcosahedronGeometry(R * 0.24, 0), [0, R * 0.6, -R * 0.84]));
    parts.push(place(frustum(R * 0.38, R * 0.05, R * 2.0, 5), [0, -R * 0.42, -R * 1.02], [0.32, 0, 0], [1, 1, 0.7]));
    return parts;
  },
  bun(R) {
    // 参考画像(緑の子)のクマ耳型お団子: 大きく・上外側・正面から見える
    const parts = HAIR_EXTRA.short(R);
    for (const sx of [-1, 1]) {
      parts.push(
        place(new THREE.IcosahedronGeometry(R * 0.42, 0), [sx * R * 0.66, R * 0.8, -R * 0.06], [0, sx * 0.4, 0], [1, 0.92, 0.85]),
      );
    }
    return parts;
  },
  hime(R) {
    const parts = HAIR_EXTRA.long(R);
    for (const sx of [-1, 1]) {
      // 顔の横の直線的な束（姫カット）。頭に寄せて浮かせない
      parts.push(place(box(R * 0.26, R * 1.25, R * 0.32), [sx * R * 0.78, -R * 0.45, R * 0.3], [0, sx * 0.12, 0]));
    }
    return parts;
  },
};

// 動物耳（参考モデルの定番。オンオフできる差分）
function animalEars(R) {
  // 太い三角をしっかり立てる（細いトゲだと貧相に見える）
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(place(wedge(R * 0.46, R * 0.62, R * 0.3), [sx * R * 0.5, R * 1.0, -R * 0.05], [0, 0, sx * -0.3], [1, 1, 0.6]));
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
  v02: { name: '02 ショート×パーカー', hair: 'short', outfit: 'hoodie', eyeType: 'rect', ears: false, ahoge: true },
  v03: { name: '03 ツイン×ワンピ', hair: 'twin', outfit: 'dress', eyeType: 'round', ears: false },
  v04: { name: '04 ロング×コート', hair: 'long', outfit: 'coat', eyeType: 'rect', ears: false },
  v05: { name: '05 尖髪×Tシャツ', hair: 'spiky', outfit: 'tee', eyeType: 'diamond', ears: false },
  v06: { name: '06 ポニー×パーカー', hair: 'ponytail', outfit: 'hoodie', eyeType: 'rect', ears: false },
  v07: { name: '07 お団子×ワンピ', hair: 'bun', outfit: 'dress', eyeType: 'round', ears: false, ahoge: true },
  v08: { name: '08 姫カット×コート', hair: 'hime', outfit: 'coat', eyeType: 'rect', ears: false },
  v09: { name: '09 けもみみ×ワンピ', hair: 'short', outfit: 'dress', eyeType: 'rect', ears: true, ahoge: true },
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

  // 腕（参考画像: 先の尖った単純なくさび。手は作らない）
  for (const sx of [-1, 1]) {
    const shoulderY = B.y + B.h * 0.34;
    cloth.push(
      place(frustum(0.052, 0.008, B.h * 0.62, 4), [sx * (B.r * 0.98), shoulderY - B.h * 0.3, 0.01], [0, 0, sx * 0.35]),
    );
  }

  // 脚（参考画像: 足先は点。足パーツは作らない）
  for (const sx of [-1, 1]) {
    dark.push(place(frustum(0.05, 0.01, bodyTop * 0.48, 4), [sx * 0.062, bodyTop * 0.26, 0]));
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
  if (V.ahoge) {
    for (const g of ahoge(R)) {
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
    // 肌はスムーズシェーディング。面ごとの陰影ノイズが「顔のバランスが悪い」原因の一つだった
    { geos: skin, color: bodyColor, smooth: true },
    { geos: hair, color: hairColor },
    { geos: cloth, color: shirtColor },
    { geos: dark, color: bottomColor },
    { geos: acc, color: accentColor },
  ];

  let triCount = 0;
  for (const grp of groups) {
    if (!grp.geos.length) continue;
    const mat = grp.smooth ? new THREE.MeshLambertMaterial({ color: grp.color }) : flat(grp.color);
    const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    const normalized = grp.geos.map(normalize);
    let merged = mergeGeometries(normalized, false) || null;
    if (merged && grp.smooth) merged = mergeVertices(merged, 1e-4);
    const geosToAdd = merged ? [merged] : normalized;
    for (const g of geosToAdd) {
      g.computeVertexNormals();
      triCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
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
