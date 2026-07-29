// ローポリアバターのOBJ生成器（パーツ分割版）
//
// 参考モデル分析（docs/AVATAR_REFERENCE_ANALYSIS.md）の結論を実装する:
//   - 髪は「1枚の連続メッシュ」。生え際のM字・毛先の尖りは面の折り込みで作る
//   - 顔は下前方の窓。目は低く左右に離す（上=黒/下=色/白ハイライトの3層)
//   - 毛先（前髪の房・裾のギザギザ）はすべて設計された頂点
//
// 髪型・服装・アクセサリーを自由に組み合わせるため、パーツ単位でOBJを出す。
// Web側（avatar_glb.js）が body + hair + acc を実行時に合成する。
//
// 座標系: OBJ標準 (Y=上, キャラは +Z を向く)。単位 m。身長 ≈ 1.21m
// 使い方: node tools/gen_avatar_obj.mjs <part>
//   part: hair_long | hair_short | hair_twin | hair_bun | hair_pony
//       | body_long | body_middle | body_short
//       | acc_kemo | acc_ahoge

const PART = process.argv[2] || 'hair_long';

const HEAD_C = 0.86; // 頭の球の中心高さ
const N = 20; // 髪ドームの角度分割（18°刻み）

const verts = [];
const parts = {};

function V(x, y, z) {
  verts.push([x, y, z]);
  return verts.length;
}
function F(part, ...idx) {
  if (!parts[part]) parts[part] = [];
  parts[part].push(idx);
}
const rad = (d) => (d * Math.PI) / 180;

// 汎用: 先の尖った3角錐（腕・脚・毛束・耳）
function cone3(part, base, tip, r, roll = 0) {
  const [bx, by, bz] = base;
  const [tx, ty, tz] = tip;
  const ax = tx - bx, ay = ty - by, az = tz - bz;
  const len = Math.hypot(ax, ay, az);
  const ux = ax / len, uy = ay / len, uz = az / len;
  let px = -uy, py = ux, pz = 0;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
  const b = [];
  for (let i = 0; i < 3; i++) {
    const a = rad(i * 120 + roll);
    b.push(V(bx + r * (px * Math.cos(a) + qx * Math.sin(a)), by + r * (py * Math.cos(a) + qy * Math.sin(a)), bz + r * (pz * Math.cos(a) + qz * Math.sin(a))));
  }
  const t = V(tx, ty, tz);
  for (let i = 0; i < 3; i++) F(part, b[i], b[(i + 1) % 3], t);
  F(part, b[2], b[1], b[0]);
}

// 汎用: 低解像度の球（お団子・結び目）
function ball(part, cx, cy, cz, r, seg = 7, rings = 5) {
  const top = V(cx, cy + r, cz);
  const bot = V(cx, cy - r, cz);
  const rs = [];
  for (let k = 1; k < rings; k++) {
    const phi = (k / rings) * Math.PI;
    const y = cy + r * Math.cos(phi);
    const rr = r * Math.sin(phi);
    rs.push(Array.from({ length: seg }, (_, i) => {
      const a = rad(i * (360 / seg));
      return V(cx + rr * Math.sin(a), y, cz + rr * Math.cos(a));
    }));
  }
  for (let j = 0; j < seg; j++) {
    F(part, top, rs[0][j], rs[0][(j + 1) % seg]);
    F(part, bot, rs[rings - 2][(j + 1) % seg], rs[rings - 2][j]);
  }
  for (let k = 0; k < rings - 2; k++) {
    for (let j = 0; j < seg; j++) {
      const a1 = rs[k][j], a2 = rs[k][(j + 1) % seg];
      const b1 = rs[k + 1][j], b2 = rs[k + 1][(j + 1) % seg];
      F(part, a1, b1, b2);
      F(part, a1, b2, a2);
    }
  }
}

// ---------------------------------------------------------------
// 髪ドーム（共通）: hemRings = 使うリング数（bobは6、ショート系は5）
// ---------------------------------------------------------------
const RINGS_ALL = [
  [0.245, 0.175], // R1
  [0.135, 0.268], // R2 ← 生え際
  [0.02, 0.302], // R3
  [-0.13, 0.295], // R4
  [-0.26, 0.262], // R5
  [-0.36, 0.238], // R6 裾（bob）
];
const WINDOW_COLS = new Set([18, 19, 0, 1]);
const HAIRLINE_RING = 1;

function hairDome({ rings = RINGS_ALL, hemDrop = 0.075, lockTipY = -0.24 }) {
  const pole = V(0, HEAD_C + 0.3, 0);
  const ringIdx = rings.map(([y, r]) =>
    Array.from({ length: N }, (_, i) => {
      const a = rad(i * (360 / N));
      return V(r * Math.sin(a), HEAD_C + y, r * Math.cos(a));
    }),
  );
  for (let j = 0; j < N; j++) F('hair', pole, ringIdx[0][j], ringIdx[0][(j + 1) % N]);
  for (let b = 0; b < rings.length - 1; b++) {
    for (let j = 0; j < N; j++) {
      if (b >= HAIRLINE_RING && WINDOW_COLS.has(j)) continue;
      const a1 = ringIdx[b][j], a2 = ringIdx[b][(j + 1) % N];
      const b1 = ringIdx[b + 1][j], b2 = ringIdx[b + 1][(j + 1) % N];
      F('hair', a1, b1, b2);
      F('hair', a1, b2, a2);
    }
  }
  const [hemY, hemR] = rings[rings.length - 1];
  for (let j = 0; j < N; j++) {
    if (WINDOW_COLS.has(j)) continue;
    const aMid = rad((j + 0.5) * (360 / N));
    const tip = V(hemR * 0.97 * Math.sin(aMid), HEAD_C + hemY - hemDrop, hemR * 0.97 * Math.cos(aMid));
    F('hair', ringIdx[rings.length - 1][j], tip, ringIdx[rings.length - 1][(j + 1) % N]);
  }
  // 前髪の房（中央V + 左右）
  const hl = ringIdx[HAIRLINE_RING];
  const bangTip = (angDeg, yOff, out) => {
    const rr = 0.297;
    const a = rad(angDeg);
    return V(rr * Math.sin(a) * 0.9, HEAD_C + yOff, rr * Math.cos(a) + out);
  };
  const tCenter = bangTip(0, -0.13, 0.03);
  F('hair', hl[19], tCenter, hl[1]);
  const tL = bangTip(-29, -0.075, 0.022);
  F('hair', hl[18], tL, hl[19]);
  const tR = bangTip(29, -0.075, 0.022);
  F('hair', hl[1], tR, hl[2]);
  // 窓の縦縁の毛束
  for (const [c0, sgn] of [[2, 1], [18, -1]]) {
    const top = ringIdx[HAIRLINE_RING][c0];
    const lockTip = V(0.21 * sgn, HEAD_C + lockTipY, 0.21);
    F('hair', top, lockTip, ringIdx[2][c0]);
    F('hair', ringIdx[2][c0], lockTip, ringIdx[Math.min(3, rings.length - 1)][c0]);
  }
  return ringIdx;
}

// ロングの後ろ髪（背中に流れるケープ・裾ギザギザ）
function backCape() {
  const CN = 8; // 118°..242° を8点で（前から見え過ぎない幅に）
  const capeRings = [
    [0.5, 0.29],
    [0.34, 0.26],
    [0.2, 0.22],
  ];
  const idx = capeRings.map(([y, r]) =>
    Array.from({ length: CN }, (_, i) => {
      const a = rad(118 + i * (124 / (CN - 1)));
      return V(r * Math.sin(a), y, r * Math.cos(a));
    }),
  );
  for (let k = 0; k < capeRings.length - 1; k++) {
    for (let j = 0; j < CN - 1; j++) {
      const a1 = idx[k][j], a2 = idx[k][j + 1];
      const b1 = idx[k + 1][j], b2 = idx[k + 1][j + 1];
      F('hair', a1, b1, b2);
      F('hair', a1, b2, a2);
    }
  }
  const [hy, hr] = capeRings[capeRings.length - 1];
  for (let j = 0; j < CN - 1; j++) {
    const aMid = rad(118 + (j + 0.5) * (124 / (CN - 1)));
    const tip = V(hr * 0.98 * Math.sin(aMid), hy - 0.06, hr * 0.98 * Math.cos(aMid));
    F('hair', idx[capeRings.length - 1][j], tip, idx[capeRings.length - 1][j + 1]);
  }
}

// ---------------------------------------------------------------
// 頭（肌の球）
// ---------------------------------------------------------------
function headSkin() {
  ball('skin', 0, HEAD_C, 0, 0.272, 14, 9);
}

// ---------------------------------------------------------------
// 顔（目3層・チーク・口）
// ---------------------------------------------------------------
const HEAD_R = 0.272;
function faceQuad(part, cx, cyOff, w, h, zoff = 0.006) {
  const cz = Math.sqrt(Math.max(0.001, HEAD_R * HEAD_R - cx * cx - cyOff * cyOff)) + zoff;
  const y = HEAD_C + cyOff;
  const p1 = V(cx - w / 2, y - h / 2, cz);
  const p2 = V(cx + w / 2, y - h / 2, cz);
  const p3 = V(cx + w / 2, y + h / 2, cz);
  const p4 = V(cx - w / 2, y + h / 2, cz);
  F(part, p1, p2, p3);
  F(part, p1, p3, p4);
}
function face() {
  for (const sx of [-1, 1]) {
    faceQuad('eye', sx * 0.105, -0.071, 0.041, 0.047);
    faceQuad('eyec', sx * 0.105, -0.109, 0.041, 0.029, 0.0065);
    faceQuad('eyew', sx * 0.105 - 0.011, -0.058, 0.008, 0.011, 0.0075);
  }
  faceQuad('cheek', -0.134, -0.148, 0.046, 0.018);
  faceQuad('cheek', 0.134, -0.148, 0.046, 0.018);
  faceQuad('cheek', 0, -0.185, 0.018, 0.007);
}

// ---------------------------------------------------------------
// 服
// ---------------------------------------------------------------
function skirtBody(ringsDef, hemDrop) {
  const DN = 10;
  const dTop = V(0, ringsDef[0][0], 0);
  const dRings = ringsDef.map(([y, r]) =>
    Array.from({ length: DN }, (_, i) => {
      const a = rad(i * (360 / DN));
      return V(r * Math.sin(a), y, r * Math.cos(a));
    }),
  );
  for (let j = 0; j < DN; j++) F('cloth', dTop, dRings[0][j], dRings[0][(j + 1) % DN]);
  for (let k = 0; k < ringsDef.length - 1; k++) {
    for (let j = 0; j < DN; j++) {
      const a1 = dRings[k][j], a2 = dRings[k][(j + 1) % DN];
      const b1 = dRings[k + 1][j], b2 = dRings[k + 1][(j + 1) % DN];
      F('cloth', a1, b1, b2);
      F('cloth', a1, b2, a2);
    }
  }
  const [hy, hr] = ringsDef[ringsDef.length - 1];
  for (let j = 0; j < DN; j++) {
    const aMid = rad((j + 0.5) * (360 / DN));
    const tip = V(hr * Math.sin(aMid), hy - hemDrop, hr * Math.cos(aMid));
    F('cloth', dRings[ringsDef.length - 1][j], tip, dRings[ringsDef.length - 1][(j + 1) % DN]);
  }
}
const OUTFITS = {
  dress() {
    skirtBody([[0.645, 0.1], [0.56, 0.148], [0.42, 0.178], [0.24, 0.212]], 0.032);
    legs(0.21);
  },
  tunic() {
    skirtBody([[0.645, 0.1], [0.56, 0.14], [0.44, 0.155], [0.34, 0.16]], 0.025);
    legs(0.32);
  },
  coat() {
    skirtBody([[0.645, 0.1], [0.56, 0.148], [0.38, 0.185], [0.17, 0.215]], 0.028);
    legs(0.16);
  },
};
// 腕・脚はアニメーション（歩行・エモート）で回すため別オブジェクトにする
function legs(topY) {
  cone3('legL', [-0.06, topY, 0], [-0.062, 0.0, 0.012], 0.036);
  cone3('legR', [0.06, topY, 0], [0.062, 0.0, 0.012], 0.036);
}
function arms() {
  cone3('armL', [-0.115, 0.575, 0.02], [-0.265, 0.375, 0.05], 0.036);
  cone3('armR', [0.115, 0.575, 0.02], [0.265, 0.375, 0.05], 0.036);
}
function ahoge() {
  cone3('hair', [0.005, 1.145, 0.01], [0.05, 1.31, 0.06], 0.02);
}

// ---------------------------------------------------------------
// パーツ定義
//   髪: hair_long は「承認済みボブの形」を ロング と呼ぶ（ユーザー指定 2026-07-29）。
//       旧ロング（背中ケープ）は形が悪く廃止。アホ毛・けもみみはアクセサリーへ分離
//   体: 服装（ロング/ミドル/ショート）＋肌・顔・腕・脚。髪型と自由に組み合わせる
// ---------------------------------------------------------------
const BOB_RINGS = RINGS_ALL.slice(0, 5); // R5まで（あご下で切り揃え）＝ボブ
const SHORT_RINGS = RINGS_ALL.slice(0, 4); // R4まで（耳が出る短さ）＝ショート
const bobDome = () => hairDome({ rings: BOB_RINGS, hemDrop: 0.06, lockTipY: -0.2 });
const PARTS = {
  hair_long() {
    hairDome({});
  },
  hair_bob() {
    bobDome();
  },
  hair_short() {
    hairDome({ rings: SHORT_RINGS, hemDrop: 0.05, lockTipY: -0.16 });
  },
  hair_twin() {
    bobDome();
    for (const sx of [-1, 1]) {
      ball('hair', sx * 0.27, 1.0, -0.06, 0.055, 6, 4);
      cone3('hair', [sx * 0.29, 0.98, -0.07], [sx * 0.38, 0.44, -0.05], 0.075);
    }
  },
  hair_bun() {
    bobDome();
    for (const sx of [-1, 1]) {
      ball('hair', sx * 0.185, 1.105, -0.03, 0.115, 7, 5);
    }
  },
  hair_pony() {
    bobDome();
    ball('hair', 0, 0.99, -0.28, 0.07, 6, 4);
    cone3('hair', [0, 0.96, -0.31], [0, 0.38, -0.4], 0.11);
  },
  body_long() {
    headSkin();
    face();
    arms();
    OUTFITS.coat();
  },
  body_middle() {
    headSkin();
    face();
    arms();
    OUTFITS.dress();
  },
  body_short() {
    headSkin();
    face();
    arms();
    OUTFITS.tunic();
  },
  acc_kemo() {
    // 正三角形に近い低めの耳（尖らせすぎると角に見える）
    for (const sx of [-1, 1]) {
      cone3('hair', [sx * 0.135, 1.03, -0.01], [sx * 0.19, 1.16, 0.0], 0.09, 90);
    }
  },
  acc_ahoge() {
    ahoge();
  },
};

if (!PARTS[PART]) {
  console.error(`unknown part: ${PART}. available: ${Object.keys(PARTS).join(', ')}`);
  process.exit(1);
}
PARTS[PART]();

let out = `# VERSE CITY lowpoly avatar part (${PART}) generated\n`;
for (const [x, y, z] of verts) out += `v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}\n`;
for (const [name, faces] of Object.entries(parts)) {
  out += `o ${name}\n`;
  for (const f of faces) out += `f ${f.join(' ')}\n`;
}
process.stdout.write(out);
console.error(`${PART}: verts=${verts.length} tris=${Object.values(parts).reduce((s, f) => s + f.length, 0)}`);
