import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =====================================================================
// ローポリ・アバター生成器（参考モデルの構造分析にもとづく作り直し）
//
// 参考モデルの計測結果（docs/AVATAR_REFERENCE_ANALYSIS.md）:
//   - 全身が1メッシュ、三角形は約300枚、テクスチャは256pxを1枚
//   - 髪は「細かい房の集合」ではなく **大きな三角の塊が数枚**
//   - 頭は角ばった多面体
// これまでの「球や円柱を数十個並べる」方式を捨て、
//   角ばった塊を少数で構成し、マテリアルごとに1メッシュへ統合する。
// =====================================================================

const OUTLINE = 0x14101a;

// ---------------------------------------------------------------------
// ジオメトリの部品（すべて角ばった低分割）
// ---------------------------------------------------------------------

// 三角柱（髪の房・スカートの切れ込みなど、平たい塊に使う）
function wedge(w, h, d) {
  const g = new THREE.CylinderGeometry(w, w * 0.06, h, 3, 1);
  g.scale(1, 1, d / w);
  return g;
}

// 角ばった球（頭）
function polyBall(r, detail = 0) {
  return new THREE.IcosahedronGeometry(r, detail);
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

// 角錐台（スカート・胴体）
function frustum(rTop, rBottom, h, sides = 7) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1);
}

function place(geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  // mergeGeometries は「インデックスの有無」が混ざると失敗して null を返す。
  // IcosahedronGeometry は非インデックス、Cylinder/Box はインデックス付きなので、
  // ここで必ず非インデックスに揃えておく（これを忘れて頭と髪が消えた）
  const src = geo.index ? geo.toNonIndexed() : geo;
  const g = src.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  return g;
}

// ---------------------------------------------------------------------
// 顔テクスチャ（1枚に目・口・頬をまとめる）
// ---------------------------------------------------------------------
function makeFaceTexture(o, expression = 'default') {
  const S = 256; // 参考モデルに合わせて小さめ
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const cx = S / 2;
  const ey = S * (o.eyeY ?? 0.56);
  const dx = S * (o.eyeDX ?? 0.2);
  const w = S * (o.eyeW ?? 0.13);
  const h = S * (o.eyeH ?? 0.19);
  const ink = '#191219';

  // 頬
  c.fillStyle = 'rgba(255,138,150,0.42)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * (dx + S * 0.085), ey + S * 0.045, S * 0.05, S * 0.028, 0, 0, Math.PI * 2);
    c.fill();
  }

  const closed = expression === 'closed' || expression === 'happy';
  for (const sx of [-1, 1]) {
    const ex = cx + sx * dx;
    if (closed) {
      c.strokeStyle = ink;
      c.lineWidth = S * 0.032;
      c.beginPath();
      c.moveTo(ex - w * 0.5, ey + h * 0.06);
      c.lineTo(ex, ey - h * 0.2);
      c.lineTo(ex + w * 0.5, ey + h * 0.06);
      c.stroke();
      continue;
    }
    const g = c.createLinearGradient(0, ey - h / 2, 0, ey + h / 2);
    g.addColorStop(0, '#151015');
    g.addColorStop(0.58, '#191219');
    g.addColorStop(0.59, o.eyeColor || '#a63a46');
    g.addColorStop(1, o.eyeColor2 || '#d8737d');
    c.fillStyle = g;

    if (o.eyeType === 'diamond') {
      c.beginPath();
      c.moveTo(ex, ey - h / 2);
      c.lineTo(ex + w / 2, ey);
      c.lineTo(ex, ey + h / 2);
      c.lineTo(ex - w / 2, ey);
      c.closePath();
      c.fill();
    } else if (o.eyeType === 'round') {
      c.beginPath();
      c.ellipse(ex, ey, w * 0.52, h * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillRect(ex - w / 2, ey - h / 2, w, h);
    }
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(ex - w * 0.32, ey - h * 0.36, w * 0.2, h * 0.15);
  }

  // 口
  c.fillStyle = '#dd5f69';
  if (expression === 'happy') {
    c.beginPath();
    c.moveTo(cx - S * 0.03, ey + S * 0.1);
    c.lineTo(cx + S * 0.03, ey + S * 0.1);
    c.lineTo(cx, ey + S * 0.145);
    c.closePath();
    c.fill();
  } else {
    c.fillRect(cx - S * 0.016, ey + S * 0.1, S * 0.032, S * 0.018);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// ---------------------------------------------------------------------
// 髪の型（大きな三角の塊で構成する）
// ---------------------------------------------------------------------
// 髪を置いてよい領域のルール（これを破ると顔が隠れて台無しになる）
//   - 顔の前方下部（z > 0.3R かつ y < 0.12R）には何も置かない
//   - 頭頂の塊は「潰した半球を上に持ち上げる」ことで目より下に来ないようにする
const HAIR_BUILDERS = {
  // 頭頂＋後頭部の共通ベース
  base(R, opts = {}) {
    const { crownY = 0.55, crownFlat = 0.52, backDepth = 0.6 } = opts;
    const parts = [];
    // 頭頂（持ち上げた扁平の塊 → 目より下に来ない）
    parts.push(place(polyBall(R * 1.07, 0), [0, R * crownY, -R * 0.03], [0, 0, 0], [1, crownFlat, 1]));
    // 後頭部（前には出さない）
    parts.push(place(polyBall(R * 1.04, 0), [0, R * 0.02, -R * 0.48], [0, 0, 0], [1, 1, backDepth]));
    // もみあげ（顔の横を締める。頬にはかからない）
    for (const sx of [-1, 1]) {
      parts.push(place(wedge(R * 0.32, R * 1.0, R * 0.3), [sx * R * 0.82, -R * 0.2, R * 0.1], [Math.PI, 0, sx * 0.05]));
    }
    return parts;
  },
  // 短め・毛先が跳ねる
  short(R) {
    const parts = HAIR_BUILDERS.base(R);
    // 前髪（目より上で終わる）
    for (let i = -2; i <= 2; i++) {
      parts.push(
        place(wedge(R * 0.3, R * 0.62, R * 0.26), [i * R * 0.3, R * 0.42, R * 0.72 - Math.abs(i) * R * 0.14], [Math.PI, 0, 0]),
      );
    }
    return parts;
  },
  // ボブ（顎まで・横が長い）
  bob(R) {
    const parts = HAIR_BUILDERS.base(R, { backDepth: 0.7 });
    for (let i = -2; i <= 2; i++) {
      parts.push(
        place(wedge(R * 0.3, R * 0.6, R * 0.26), [i * R * 0.3, R * 0.44, R * 0.72 - Math.abs(i) * R * 0.14], [Math.PI, 0, 0]),
      );
    }
    // 横〜後ろに垂らす房（顔の前には出さない）
    for (let i = 0; i < 6; i++) {
      const a = 1.15 + (i / 5) * (Math.PI * 2 - 2.3);
      parts.push(
        place(wedge(R * 0.36, R * 1.5, R * 0.32), [Math.sin(a) * R * 0.85, -R * 0.5, Math.cos(a) * R * 0.85], [Math.PI, a, 0]),
      );
    }
    return parts;
  },
  // ロング
  long(R) {
    const parts = HAIR_BUILDERS.bob(R);
    parts.push(place(frustum(R * 0.78, R * 0.34, R * 2.2, 5), [0, -R * 1.35, -R * 0.5], [0, Math.PI / 5, 0], [1, 1, 0.55]));
    return parts;
  },
  // ツインテール
  twin(R) {
    const parts = HAIR_BUILDERS.short(R);
    for (const sx of [-1, 1]) {
      parts.push(place(box(R * 0.34, R * 0.26, R * 0.34), [sx * R * 0.86, R * 0.5, -R * 0.1]));
      parts.push(
        place(frustum(R * 0.36, R * 0.12, R * 1.7, 4), [sx * R * 1.18, -R * 0.35, -R * 0.15], [0, Math.PI / 4, sx * 0.5], [1, 1, 0.62]),
      );
    }
    return parts;
  },
  // 逆立った尖髪（上向きなので顔にはかからない）
  spiky(R) {
    const parts = HAIR_BUILDERS.base(R, { crownY: 0.5, crownFlat: 0.46 });
    for (let i = 0; i < 7; i++) {
      const a = -1.5 + i * 0.5;
      const len = 0.85 + (i % 3) * 0.35;
      parts.push(
        place(wedge(R * 0.28, R * len, R * 0.28), [Math.sin(a) * R * 0.55, R * (0.85 + len * 0.3), Math.cos(a) * R * 0.55], [0.42 * Math.cos(a), a, -0.4 * Math.sin(a)]),
      );
    }
    return parts;
  },
  // ポニーテール
  ponytail(R) {
    const parts = HAIR_BUILDERS.short(R);
    parts.push(place(box(R * 0.3, R * 0.24, R * 0.3), [0, R * 0.42, -R * 0.95]));
    parts.push(place(frustum(R * 0.4, R * 0.1, R * 2.0, 4), [0, -R * 0.4, -R * 1.25], [0.42, Math.PI / 4, 0], [1, 1, 0.7]));
    return parts;
  },
  // お団子
  bun(R) {
    const parts = HAIR_BUILDERS.bob(R);
    for (const sx of [-1, 1]) {
      parts.push(place(polyBall(R * 0.38, 0), [sx * R * 0.66, R * 0.92, -R * 0.15]));
    }
    return parts;
  },
  // ぱっつん（前髪が重い）
  hime(R) {
    const parts = HAIR_BUILDERS.long(R);
    for (const sx of [-1, 1]) {
      parts.push(place(frustum(R * 0.3, R * 0.22, R * 1.8, 4), [sx * R * 0.8, -R * 0.55, R * 0.35], [0, Math.PI / 4, 0], [0.7, 1, 0.5]));
    }
    return parts;
  },
};

// ---------------------------------------------------------------------
// 服の型
// ---------------------------------------------------------------------
const OUTFIT_BUILDERS = {
  // ワンピース（裾が広がる）
  dress(B) {
    return [place(frustum(B.chest, B.hem, B.len, 7), [0, B.y, 0])];
  },
  // パーカー（真っ直ぐ・少しゆったり）
  hoodie(B) {
    const parts = [place(frustum(B.chest * 1.05, B.hem * 0.82, B.len, 8), [0, B.y, 0])];
    parts.push(place(box(B.chest * 0.5, B.len * 0.1, B.chest * 1.6), [0, B.y - B.len * 0.42, 0]));
    return parts;
  },
  // コート（丈が長い）
  coat(B) {
    return [
      place(frustum(B.chest, B.hem * 0.95, B.len * 1.35, 8), [0, B.y - B.len * 0.15, 0]),
      place(box(B.chest * 1.4, B.len * 0.14, B.chest * 1.5), [0, B.y + B.len * 0.42, 0]),
    ];
  },
  // Tシャツ＋ズボン（裾が短い）
  tee(B) {
    return [place(frustum(B.chest, B.hem * 0.72, B.len * 0.78, 8), [0, B.y + B.len * 0.1, 0])];
  },
};

// ---------------------------------------------------------------------
// 案の定義
// ---------------------------------------------------------------------
export const LP_VARIANTS = {
  v01: { name: '01 ボブ×ワンピ', hair: 'bob', outfit: 'dress', eyeType: 'rect', head: 1.0 },
  v02: { name: '02 ショート×パーカー', hair: 'short', outfit: 'hoodie', eyeType: 'rect', head: 1.0 },
  v03: { name: '03 ツイン×ワンピ', hair: 'twin', outfit: 'dress', eyeType: 'round', head: 1.02 },
  v04: { name: '04 ロング×コート', hair: 'long', outfit: 'coat', eyeType: 'rect', head: 0.98 },
  v05: { name: '05 尖髪×Tシャツ', hair: 'spiky', outfit: 'tee', eyeType: 'diamond', head: 1.0 },
  v06: { name: '06 ポニー×パーカー', hair: 'ponytail', outfit: 'hoodie', eyeType: 'rect', head: 1.0 },
  v07: { name: '07 お団子×ワンピ', hair: 'bun', outfit: 'dress', eyeType: 'round', head: 1.02 },
  v08: { name: '08 姫カット×コート', hair: 'hime', outfit: 'coat', eyeType: 'rect', head: 0.98 },
  v09: { name: '09 ボブ×Tシャツ', hair: 'bob', outfit: 'tee', eyeType: 'diamond', head: 1.0 },
  v10: { name: '10 尖髪×コート', hair: 'spiky', outfit: 'coat', eyeType: 'rect', head: 1.0 },
  v11: { name: '11 ツイン×パーカー', hair: 'twin', outfit: 'hoodie', eyeType: 'rect', head: 1.04 },
  v12: { name: '12 ロング×ワンピ', hair: 'long', outfit: 'dress', eyeType: 'round', head: 1.0 },
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

  const R = 0.3 * V.head; // 頭の半径（参考モデルの比率: 身長1.21で頭が大きい）

  // ---- 収集用 ----
  const skin = [];
  const hair = [];
  const cloth = [];
  const dark = [];
  const acc = [];

  // 脚
  for (const sx of [-1, 1]) {
    dark.push(place(frustum(0.055, 0.045, 0.34, 5), [sx * 0.07, 0.28, 0]));
    dark.push(place(box(0.115, 0.1, 0.17), [sx * 0.07, 0.06, 0.02]));
    acc.push(place(box(0.12, 0.03, 0.18), [sx * 0.07, 0.005, 0.02]));
  }

  // 服
  const B = { chest: 0.16, hem: 0.235, len: 0.4, y: 0.62 };
  for (const g of OUTFIT_BUILDERS[V.outfit](B)) cloth.push(g);

  // 腕（服の外側に出す。内側だと裾に埋もれて見えない）
  for (const sx of [-1, 1]) {
    cloth.push(place(frustum(0.05, 0.042, 0.3, 5), [sx * 0.215, 0.68, 0], [0, 0, sx * 0.1]));
    skin.push(place(box(0.062, 0.075, 0.05), [sx * 0.235, 0.5, 0]));
  }

  // 頭
  const headY = 0.62 + B.len * 0.5 + R * 0.82;
  skin.push(place(polyBall(R, 0), [0, headY, 0], [0, 0, 0], [1, 1.02, 0.94]));

  // 髪
  for (const g of HAIR_BUILDERS[V.hair](R)) {
    g.translate(0, headY, 0);
    hair.push(g);
  }

  // ---- マテリアルごとに1メッシュへ統合 ----
  const groups = [
    { geos: skin, color: bodyColor },
    { geos: hair, color: hairColor },
    { geos: cloth, color: shirtColor },
    { geos: dark, color: bottomColor },
    { geos: acc, color: accentColor },
  ];

  // mergeGeometries は属性の構成が1つでも違うと失敗するので、
  // position/normal/uv だけに揃えてから統合する（groupsも消す）
  function normalize(g) {
    const src = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', src.getAttribute('position').clone());
    const n = src.getAttribute('normal');
    out.setAttribute(
      'normal',
      n ? n.clone() : new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 3), 3),
    );
    const uv = src.getAttribute('uv');
    out.setAttribute(
      'uv',
      uv ? uv.clone() : new THREE.BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2),
    );
    return out;
  }

  let triCount = 0;
  for (const grp of groups) {
    if (!grp.geos.length) continue;
    const mat = new THREE.MeshLambertMaterial({ color: grp.color, flatShading: true });
    const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    const normalized = grp.geos.map(normalize);
    const merged = mergeGeometries(normalized, false);
    if (merged) {
      merged.computeVertexNormals();
      triCount += merged.attributes.position.count / 3;
      upper.add(new THREE.Mesh(merged, mat));
      const o = new THREE.Mesh(merged, outlineMat);
      o.scale.setScalar(1.035);
      upper.add(o);
    } else {
      // 統合できなくても表示は保つ（パーツごとに追加）
      for (const g of normalized) {
        g.computeVertexNormals();
        triCount += g.attributes.position.count / 3;
        upper.add(new THREE.Mesh(g, mat));
        const o = new THREE.Mesh(g, outlineMat);
        o.scale.setScalar(1.035);
        upper.add(o);
      }
    }
  }

  // 顔（頭の前面に貼る板）
  const faceOpts = { eyeType: V.eyeType, eyeY: 0.56, eyeDX: 0.2, eyeW: 0.13, eyeH: 0.19 };
  const faces = {
    default: makeFaceTexture(faceOpts, 'default'),
    happy: makeFaceTexture(faceOpts, 'happy'),
    closed: makeFaceTexture(faceOpts, 'closed'),
  };
  const faceMat = new THREE.MeshBasicMaterial({ map: faces.default, transparent: true, depthWrite: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.5, R * 1.5), faceMat);
  // 髪より確実に前へ出す（頭の表面すれすれだと髪に埋もれる）
  face.position.set(0, headY - R * 0.06, R * 0.97);
  face.renderOrder = 3;
  upper.add(face);

  // 正規化（参考モデルに合わせて身長1.21m）
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(upper);
  const s = 1.21 / Math.max(0.01, box3.max.y - box3.min.y);
  upper.scale.setScalar(s);
  upper.position.y = -box3.min.y * s;
  const baseY = upper.position.y;

  root.userData.triangles = Math.round(triCount);

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
      upper.position.y = baseY + Math.abs(Math.sin(t * 8)) * 0.02;
      upper.rotation.z = Math.sin(t * 8) * 0.03;
    } else {
      upper.position.y = baseY;
      upper.rotation.z = Math.sin(t * 1.5) * 0.012;
    }
  };

  return root;
}
