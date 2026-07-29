// ローポリアバター「ボブ」のOBJ生成器
//
// 参考モデル分析（docs/AVATAR_REFERENCE_ANALYSIS.md）の結論を実装する:
//   - 髪は「1枚の連続メッシュ」。生え際のM字・毛先の尖りは面の折り込みで作る
//   - 顔は下前方の窓。目は低く左右に離す
//   - 毛先（前髪の房・裾のギザギザ）はすべて設計された頂点
//
// 座標系: OBJ標準 (Y=上, キャラは +Z を向く)。単位 m。身長 ≈ 1.21m
// 出力: 標準出力にOBJテキスト（グループごとに o 名前 を分ける）
//
// 使い方: node tools/gen_avatar_obj.mjs > assets/avatars/src/bob.obj

const HEAD_C = 0.86; // 頭の球の中心高さ
const N = 20; // 髪ドームの角度分割（18°刻み）

const verts = [];
const parts = {}; // name -> face index list

function V(x, y, z) {
  verts.push([x, y, z]);
  return verts.length; // OBJは1始まり
}
function F(part, ...idx) {
  if (!parts[part]) parts[part] = [];
  parts[part].push(idx);
}
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------
// 髪ドーム（1枚メッシュ）
//   リング定義: [中心からのyオフセット, 半径]
//   窓: 前方 -36°..+36°（列 18,19,0,1）を R2 以下で開ける
// ---------------------------------------------------------------
const RINGS = [
  [0.245, 0.175], // R1
  [0.135, 0.268], // R2 ← 生え際（この下の前方が顔の窓）
  [0.02, 0.302], // R3
  [-0.13, 0.295], // R4
  [-0.26, 0.262], // R5
  [-0.36, 0.238], // R6 裾
];
const WINDOW_COLS = new Set([18, 19, 0, 1]);
const HAIRLINE_RING = 1; // R2

const pole = V(0, HEAD_C + 0.3, 0);
const ringIdx = RINGS.map(([y, r]) =>
  Array.from({ length: N }, (_, i) => {
    const a = rad(i * (360 / N));
    return V(r * Math.sin(a), HEAD_C + y, r * Math.cos(a));
  }),
);

// 頭頂の扇
for (let j = 0; j < N; j++) {
  F('hair', pole, ringIdx[0][j], ringIdx[0][(j + 1) % N]);
}
// リング間の帯（窓の列は生え際リングより下を開ける）
for (let b = 0; b < RINGS.length - 1; b++) {
  for (let j = 0; j < N; j++) {
    if (b >= HAIRLINE_RING && WINDOW_COLS.has(j)) continue;
    const a1 = ringIdx[b][j];
    const a2 = ringIdx[b][(j + 1) % N];
    const b1 = ringIdx[b + 1][j];
    const b2 = ringIdx[b + 1][(j + 1) % N];
    F('hair', a1, b1, b2);
    F('hair', a1, b2, a2);
  }
}
// 裾のギザギザ（窓の外の列すべて。各辺の中点角に尖った毛先）
const [hemY, hemR] = RINGS[RINGS.length - 1];
for (let j = 0; j < N; j++) {
  if (WINDOW_COLS.has(j)) continue;
  const aMid = rad((j + 0.5) * (360 / N));
  const tip = V(hemR * 0.97 * Math.sin(aMid), HEAD_C + hemY - 0.075, hemR * 0.97 * Math.cos(aMid));
  F('hair', ringIdx[RINGS.length - 1][j], tip, ringIdx[RINGS.length - 1][(j + 1) % N]);
}
// 前髪の房（生え際リングから窓の上に折り込む。中央V + 左右）
const hl = ringIdx[HAIRLINE_RING]; // R2
const bangTip = (angDeg, yOff, out) => {
  // 房の先端: その高さのドーム面より少し外
  const rr = 0.297;
  const a = rad(angDeg);
  return V(rr * Math.sin(a) * 0.9, HEAD_C + yOff, rr * Math.cos(a) + out);
};
const tCenter = bangTip(0, -0.13, 0.03);
F('hair', hl[19], tCenter, hl[1]); // 中央V（-18°..+18°）
const tL = bangTip(-29, -0.075, 0.022);
F('hair', hl[18], tL, hl[19]);
const tR = bangTip(29, -0.075, 0.022);
F('hair', hl[1], tR, hl[2]);
// 窓の縦縁を塞ぐ房（列2 / 列18 の内側の壁を毛先で覆う）
for (const [c0, c1, sgn] of [[2, 3, 1], [18, 17, -1]]) {
  const top = ringIdx[HAIRLINE_RING][c0];
  const lockTip = V(0.21 * sgn, HEAD_C - 0.24, 0.21);
  F('hair', top, lockTip, ringIdx[2][c0]);
  F('hair', ringIdx[2][c0], lockTip, ringIdx[3][c0]);
}

// ---------------------------------------------------------------
// 頭（肌の球・顔の窓から見える部分）
// ---------------------------------------------------------------
const HN = 14;
const HRINGS = 9;
const HEAD_R = 0.272;
const hPoleT = V(0, HEAD_C + HEAD_R, 0);
const hPoleB = V(0, HEAD_C - HEAD_R, 0);
const hRings = [];
for (let k = 1; k < HRINGS; k++) {
  const phi = (k / HRINGS) * Math.PI;
  const y = HEAD_C + HEAD_R * Math.cos(phi);
  const r = HEAD_R * Math.sin(phi);
  hRings.push(Array.from({ length: HN }, (_, i) => {
    const a = rad(i * (360 / HN));
    return V(r * Math.sin(a), y, r * Math.cos(a));
  }));
}
for (let j = 0; j < HN; j++) {
  F('skin', hPoleT, hRings[0][j], hRings[0][(j + 1) % HN]);
  F('skin', hPoleB, hRings[HRINGS - 2][(j + 1) % HN], hRings[HRINGS - 2][j]);
}
for (let k = 0; k < HRINGS - 2; k++) {
  for (let j = 0; j < HN; j++) {
    const a1 = hRings[k][j];
    const a2 = hRings[k][(j + 1) % HN];
    const b1 = hRings[k + 1][j];
    const b2 = hRings[k + 1][(j + 1) % HN];
    F('skin', a1, b1, b2);
    F('skin', a1, b2, a2);
  }
}

// ---------------------------------------------------------------
// 目・チーク（顔面に貼る薄い四角。表情はWeb側で差し替え予定の仮）
// ---------------------------------------------------------------
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
// 目: 参考モデルの構造（上6割=黒 / 下4割=赤系 / 白ハイライト）
for (const sx of [-1, 1]) {
  faceQuad('eye', sx * 0.105, -0.071, 0.041, 0.047);
  faceQuad('eyec', sx * 0.105, -0.109, 0.041, 0.029, 0.0065);
  faceQuad('eyew', sx * 0.105 - 0.011, -0.058, 0.008, 0.011, 0.0075);
}
faceQuad('cheek', -0.134, -0.148, 0.046, 0.018);
faceQuad('cheek', 0.134, -0.148, 0.046, 0.018);
faceQuad('cheek', 0, -0.185, 0.018, 0.007); // 口（小さく）

// ---------------------------------------------------------------
// ワンピース（Aライン・裾ギザギザ・上端は頭の中に隠す）
// ---------------------------------------------------------------
const DRESS_RINGS = [
  [0.645, 0.1],
  [0.56, 0.148],
  [0.42, 0.178],
  [0.24, 0.212],
];
const DN = 10;
const dTop = V(0, 0.645, 0);
const dRings = DRESS_RINGS.map(([y, r]) =>
  Array.from({ length: DN }, (_, i) => {
    const a = rad(i * (360 / DN));
    return V(r * Math.sin(a), y, r * Math.cos(a));
  }),
);
for (let j = 0; j < DN; j++) {
  F('cloth', dTop, dRings[0][j], dRings[0][(j + 1) % DN]);
}
for (let k = 0; k < DRESS_RINGS.length - 1; k++) {
  for (let j = 0; j < DN; j++) {
    const a1 = dRings[k][j];
    const a2 = dRings[k][(j + 1) % DN];
    const b1 = dRings[k + 1][j];
    const b2 = dRings[k + 1][(j + 1) % DN];
    F('cloth', a1, b1, b2);
    F('cloth', a1, b2, a2);
  }
}
const [dHemY, dHemR] = DRESS_RINGS[DRESS_RINGS.length - 1];
for (let j = 0; j < DN; j++) {
  const aMid = rad((j + 0.5) * (360 / DN));
  const tip = V(dHemR * 1.0 * Math.sin(aMid), dHemY - 0.032, dHemR * 1.0 * Math.cos(aMid));
  F('cloth', dRings[DRESS_RINGS.length - 1][j], tip, dRings[DRESS_RINGS.length - 1][(j + 1) % DN]);
}

// ---------------------------------------------------------------
// 腕（先の尖った3角錐・肌色）と脚（先細・暗色）
// ---------------------------------------------------------------
function cone3(part, base, tip, r) {
  const [bx, by, bz] = base;
  const [tx, ty, tz] = tip;
  // 軸に垂直な基底
  const ax = tx - bx, ay = ty - by, az = tz - bz;
  const len = Math.hypot(ax, ay, az);
  const ux = ax / len, uy = ay / len, uz = az / len;
  let px = -uy, py = ux, pz = 0;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
  const b = [];
  for (let i = 0; i < 3; i++) {
    const a = rad(i * 120);
    b.push(V(bx + r * (px * Math.cos(a) + qx * Math.sin(a)), by + r * (py * Math.cos(a) + qy * Math.sin(a)), bz + r * (pz * Math.cos(a) + qz * Math.sin(a))));
  }
  const t = V(tx, ty, tz);
  for (let i = 0; i < 3; i++) F(part, b[i], b[(i + 1) % 3], t);
  F(part, b[2], b[1], b[0]);
}
cone3('skin', [-0.115, 0.575, 0.02], [-0.265, 0.375, 0.05], 0.036);
cone3('skin', [0.115, 0.575, 0.02], [0.265, 0.375, 0.05], 0.036);
cone3('dark', [-0.06, 0.21, 0], [-0.062, 0.0, 0.012], 0.036);
cone3('dark', [0.06, 0.21, 0], [0.062, 0.0, 0.012], 0.036);

// アホ毛（先の尖った1本・すこし曲げ）
cone3('hair', [0.005, 1.145, 0.01], [0.05, 1.31, 0.06], 0.02);

// ---------------------------------------------------------------
// 出力
// ---------------------------------------------------------------
let out = '# VERSE CITY lowpoly avatar (bob) generated\n';
for (const [x, y, z] of verts) out += `v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}\n`;
for (const [name, faces] of Object.entries(parts)) {
  out += `o ${name}\n`;
  for (const f of faces) out += `f ${f.join(' ')}\n`;
}
process.stdout.write(out);
console.error(`verts=${verts.length} tris=${Object.values(parts).reduce((s, f) => s + f.length, 0)}`);
