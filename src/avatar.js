import * as THREE from 'three';
import { createGlbAvatar } from './avatar_glb.js';

// ------------------------------------------------------------------
// プリセット式・デフォルメちびキャラアバター
// 本体はGLB版（avatar_glb.js）。このファイルは部品リスト・テキストスプライト・
// 旧実装（createLegacyAvatar）を持つ
// ------------------------------------------------------------------

// 髪色・服色・目の色の共通14色（ユーザー指定 2026-07-29:
// 黒・茶・明るい茶・黄・オレンジ・赤・ピンク・紫・青・水色・緑・黄緑・グレー・白）
const COLOR14 = [
  '#1a1a1a', '#4a2c17', '#a97a4e', '#ffd400', '#ff8c1a', '#e33b3b', '#ff6fd8',
  '#8a5fff', '#3b82f6', '#4fd8ff', '#22a05a', '#9be34a', '#9aa0ad', '#f5f5f5',
];

export const AVATAR_PARTS = {
  // ⚠ **末尾にだけ足す**こと。途中に入れると番号がずれ、
  //   既に保存されている見た目やVRChat側の解釈が全部狂う。
  //   '#fdf1e6'（白）は 2026-08-03 追加（loyさん指示）
  bodyColors: [
    '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#3a2a1e', '#7fe6ff', '#ff8fe6',
    '#fdf1e6',
  ],
  // GLBアバター（Blender製）のパーツ一覧。wireには文字列がそのまま乗り、
  // 未知のidを受けた側は先頭にフォールバックする（net.js）ので追加は後方互換
  // ※「long」は承認済みボブ形状の名前（旧bobをリネーム。旧ロングは廃止）
  //   「bob」はあご下丈、「short」は耳が出る短さ（2026-07-29 追加）
  // 2026-08-06 追加: ぱっつん（前髪を横一直線に切り揃えた形・loyさん要望）
  hairStyles: ['long', 'bob', 'short', 'twin', 'bun', 'pony', 'patsun'],
  outfits: ['middle', 'long', 'short'],
  // 2026-08-03 追加: しっぽ・羽・天使の輪・リボン・サングラス・メガネ
  accessories: [
    'none', 'kemo', 'ahoge',
    'tail', 'wing', 'halo', 'ribbon', 'sunglasses', 'glasses',
    // 2026-08-06 追加: 前髪メッシュ（管理者・VIPだけが選べる）。
    // ⚠ これだけは**3Dパーツを足さない**。髪の材質に筋を描く（avatar_glb.js の toon 参照）
    'mesh',
  ],
  // 利き手（2026-08-04追加）。片手のエモート（手をふる／ペンライト／コブシ／乾杯）と
  // 持ち物（ペンライト・ジョッキ）がどちらの手になるか。
  // ⚠ 既定は right。VRChat側のプロキシが右手なので、そちらに合わせている
  handedness: ['right', 'left'],
  // 身長（2026-08-03追加）。3Dパーツは増やさず、アバター全体の拡大率で表す。
  // 実寸: small=1.06m / mid=1.21m / big=1.36m 相当
  heights: ['small', 'mid', 'big'],
  hairColors: COLOR14,
  shirtColors: COLOR14,
  eyeColors: COLOR14,
  // ペンライトの色。一度選ぶと変えるまでその色で光る（2026-07-29 追加）
  penlightColors: COLOR14,
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomConfig() {
  return {
    bodyColor: pick(AVATAR_PARTS.bodyColors),
    hairStyle: pick(AVATAR_PARTS.hairStyles),
    outfit: pick(AVATAR_PARTS.outfits),
    accessory: pick(AVATAR_PARTS.accessories),
    hairColor: pick(AVATAR_PARTS.hairColors),
    shirtColor: pick(AVATAR_PARTS.shirtColors),
    eyeColor: pick(AVATAR_PARTS.eyeColors),
    penlightColor: pick(AVATAR_PARTS.penlightColors),
    // 前髪メッシュの色（既定は暗い髪色。アクセサリーを付けたときだけ使う）
    meshColor: AVATAR_PARTS.hairColors[0],
    height: 'mid',
    // ランダムにしない。VRChat側に合わせた既定（右）から始める
    handedness: 'right',
  };
}

// 文字列から決定論的な整数インデックスを作る（configの形は変えず、既存フィールドの
// 値だけから服のバリエーション等を導出するためのハッシュ）
function variantIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

// ------------------------------------------------------------------
// 共有リソース（全アバター共通・色に依存しないもの）
// メッシュ数・GC負荷を抑えるため、形状はモジュール読み込み時に一度だけ生成して使い回す。
// ------------------------------------------------------------------

const HEAD_R = 0.22;
const NECK_R = 0.078;
const NECK_H = 0.1;
const NECK_OVERLAP = 0.02; // 首を胴体にわずかに埋め込み、段差を消す
const HEAD_OVERLAP = 0.035; // 頭を首にわずかに埋め込み、段差を消す
const SHOULDER_Y = 0.42; // 胴体プロファイルの肩幅ピーク＝腕の付け根の高さ
const TORSO_TOP_Y = 0.505; // 胴体プロファイルの上端（襟ぐり／首の付け根）
const ARM_R_TOP = 0.066;
const ARM_R_BOTTOM = 0.048;
const ARM_LEN = 0.34;
const HAND_R = 0.062;
const LEG_R_TOP = 0.1;
const LEG_R_BOTTOM = 0.074;
const LEG_LEN = 0.44;
const FOOT_R = 0.09;
const HIP_Y = 0.5;

/**
 * 目の高さ（アバターの足元からの距離・メートル）。一人称視点でカメラを置く高さ。
 *
 * ⚠️ この値は下の HIP_Y 等（旧プリミティブ版アバターの定数）から計算してはいけない。
 * 実際に表示しているのは GLB版（avatar_glb.js）で、身長 1.16m・目の高さ 0.79m。
 * 旧定数から出した 1.23m を使っていたため、一人称のカメラが頭頂(1.16m)より
 * 上に浮いていた（2026-07-30 実測して修正）。
 *
 * 実測方法: createAvatar でアバターを作り、'eye' メッシュのワールド境界の中心Yを見る。
 * アバターのモデルを差し替えたら測り直すこと。
 */
export const EYE_Y = 0.79;
const SHOULDER_X = 0.185 + ARM_R_TOP * 0.55; // 肩幅ピーク半径 + 腕の食い込み量（隙間を作らない）
const ARM_REST_X = -0.05; // 腕の自然な休止角（わずかに前へ）
const ARM_REST_Z = 0.1; // 腕の自然な休止角（わずかに外へ＝いかり肩を防ぐ）

// ---- トゥーン用グラデーションマップ（2〜3段の階調を手続き生成） ----
function createGradientMap(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT_MAP = createGradientMap(3);

function toonMat(color, emissiveFactor = 0.05) {
  const emissive = new THREE.Color(color).multiplyScalar(emissiveFactor);
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT_MAP, emissive });
}

// 靴（全アバター共通のニュートラル色。ユーザー色に依存しないので共有できる）
const SHOE_MAT = new THREE.MeshToonMaterial({ color: '#22222c', gradientMap: GRADIENT_MAP });
// 靴底（ソール）：本体より少し明るいニュートラル色で色分け
const SOLE_MAT = new THREE.MeshToonMaterial({ color: '#34343e', gradientMap: GRADIENT_MAP });

// 輪郭線（反転ハル方式）：常に単色の黒なので全アバターで共有できる
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: '#0c0714', side: THREE.BackSide });

// ---- 共有ジオメトリ（色を持たないので全アバター・全パーツで使い回せる） ----
const HEAD_GEO = new THREE.SphereGeometry(HEAD_R, 14, 10);
const FACE_PLANE_GEO = new THREE.PlaneGeometry(HEAD_R * 1.32, HEAD_R * 1.18);
const NECK_GEO = new THREE.CylinderGeometry(NECK_R, NECK_R * 1.15, NECK_H, 8, 1, true);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, LEG_LEN, 8, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, 8, 1, true);
const FOOT_GEO = new THREE.SphereGeometry(FOOT_R, 6, 5);
const HAND_GEO = new THREE.SphereGeometry(HAND_R, 6, 5);
const THUMB_GEO = new THREE.SphereGeometry(HAND_R * 0.62, 6, 5);
const SOLE_GEO = new THREE.BoxGeometry(FOOT_R * 1.3, FOOT_R * 0.26, FOOT_R * 1.6);
const COLLAR_RING_GEO = new THREE.CylinderGeometry(0.115, 0.1, 0.045, 10, 1, true);
const WAIST_RING_GEO = new THREE.CylinderGeometry(0.165, 0.15, 0.07, 10, 1, true);
const CUFF_RING_GEO = new THREE.CylinderGeometry(ARM_R_BOTTOM * 1.15, ARM_R_BOTTOM * 1.35, 0.045, 10, 1, true);
const PENLIGHT_GEO = new THREE.CapsuleGeometry(0.022, 0.34, 4, 8);

// 胴体：くびれ＋なで肩のラウンドシルエット（Latheで回転生成）。
// 肩ピーク(SHOULDER_Y)から襟ぐり(TORSO_TOP_Y)へなだらかに絞ることで、
// 首の付け根との段差・いかり肩を防ぐ。上下は他パーツで隠れるので開放でOK。
const TORSO_GEO = new THREE.LatheGeometry(
  [
    [0.145, 0.0], // 腰の張り（waist ringに隠れる下端）
    [0.122, 0.14], // ウエスト（最も細い）
    [0.152, 0.3], // 胸まわり
    [0.185, SHOULDER_Y], // 肩幅ピーク（腕の付け根の高さ）
    [0.15, 0.47], // なで肩カーブ
    [0.092, TORSO_TOP_Y], // 襟ぐり（首の付け根、NECK_GEOの下端と径を合わせる）
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  10
);

// ---- 髪パーツ用の共有ジオメトリ ----
const HAIR_CAP_GEO = new THREE.SphereGeometry(HEAD_R * 1.08, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.54);
const HAIR_FRINGE_GEO = new THREE.SphereGeometry(HEAD_R * 0.66, 8, 6, 0, Math.PI, 0, Math.PI * 0.62);
const HAIR_LONG_BACK_GEO = new THREE.CylinderGeometry(HEAD_R * 0.98, HEAD_R * 0.55, HEAD_R * 2.3, 8, 1, true);
const HAIR_TWIN_TAIL_GEO = new THREE.CapsuleGeometry(HEAD_R * 0.2, HEAD_R * 1.15, 3, 7);
const HAT_BRIM_GEO = new THREE.CylinderGeometry(HEAD_R * 1.18, HEAD_R * 1.18, HEAD_R * 0.14, 12, 1, false);
const HAT_CONE_GEO = new THREE.ConeGeometry(HEAD_R * 0.82, HEAD_R * 1.7, 12, 1, false);
const HAT_POM_GEO = new THREE.SphereGeometry(HEAD_R * 0.17, 6, 6);
// アニメ調ハイライト帯（天使の輪）。頭と同じ原点を中心にした部分球なので、
// 追加の位置合わせなしにキャップ表面へそのまま乗る。回転だけで毛束の非対称さを出す。
const HAIR_HIGHLIGHT_GEO = new THREE.SphereGeometry(HEAD_R * 1.13, 12, 4, Math.PI * 0.15, Math.PI * 0.7, 0, Math.PI * 0.32);

// ------------------------------------------------------------------
// 顔テクスチャ（CanvasTexture）：目・まつげ・ハイライト・眉・口・頬を描画
// 全アバター共通の絵柄（色ではなく表情そのものなので共有可）。
// 表情は 'default' / 'smile' / 'happy' の3種類。default/smileはまばたきで
// 開閉2枚を差し替え、happyは常に笑顔クローズドの1枚のみ（差し替え不要）。
// ------------------------------------------------------------------

let faceTexturesCache = null;

function drawFace(ctx, size, closed, expression = 'default') {
  ctx.clearRect(0, 0, size, size);
  const leftX = size * 0.335;
  const rightX = size * 0.665;
  const eyeY = size * 0.5;
  const eyeW = size * 0.15;
  const eyeH = size * 0.185;
  const happy = expression === 'happy';
  const smiling = expression === 'smile';

  // 頬（ブラッシュ）
  ctx.save();
  ctx.globalAlpha = happy ? 0.42 : 0.32;
  [leftX - size * 0.02, rightX + size * 0.02].forEach((cx) => {
    const grad = ctx.createRadialGradient(cx, size * 0.66, 1, cx, size * 0.66, size * 0.1);
    grad.addColorStop(0, '#ff8fae');
    grad.addColorStop(1, 'rgba(255,143,174,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, size * 0.66, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // 目
  [leftX, rightX].forEach((ex) => {
    if (happy) {
      // ハート/ダンス用：常ににっこり閉じ目（^‿^）
      ctx.strokeStyle = '#140b12';
      ctx.lineWidth = size * 0.022;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY + eyeH * 0.18, eyeW * 0.58, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      return;
    }

    if (closed) {
      ctx.strokeStyle = '#140b12';
      ctx.lineWidth = size * 0.02;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeW * 0.62, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
      // まつげのはね（根元太め→先細りで強弱をつける）
      ctx.lineWidth = size * 0.026;
      ctx.beginPath();
      ctx.moveTo(ex + eyeW * 0.55, eyeY + eyeH * 0.05);
      ctx.lineTo(ex + eyeW * 0.66, eyeY - eyeH * 0.02);
      ctx.stroke();
      ctx.lineWidth = size * 0.014;
      ctx.beginPath();
      ctx.moveTo(ex + eyeW * 0.66, eyeY - eyeH * 0.02);
      ctx.lineTo(ex + eyeW * 0.75, eyeY - eyeH * 0.12);
      ctx.stroke();
      return;
    }

    // 白目
    ctx.fillStyle = '#fffdfb';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW * 0.5, eyeH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 瞳（グラデーションで奥行きを出す）
    const irisGrad = ctx.createRadialGradient(
      ex - eyeW * 0.05,
      eyeY,
      eyeW * 0.05,
      ex,
      eyeY + eyeH * 0.06,
      eyeW * 0.42
    );
    irisGrad.addColorStop(0, '#3a2f4a');
    irisGrad.addColorStop(1, '#1c1420');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + eyeH * 0.06, eyeW * 0.4, eyeH * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // まぶたの上ライン
    ctx.strokeStyle = '#140b12';
    ctx.lineWidth = size * 0.018;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - eyeH * 0.05, eyeW * 0.52, eyeH * 0.5, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    // まつげのはね（根元太め→先細りで強弱をつける）
    ctx.lineWidth = size * 0.026;
    ctx.beginPath();
    ctx.moveTo(ex + eyeW * 0.48, eyeY - eyeH * 0.3);
    ctx.lineTo(ex + eyeW * 0.6, eyeY - eyeH * 0.41);
    ctx.stroke();
    ctx.lineWidth = size * 0.013;
    ctx.beginPath();
    ctx.moveTo(ex + eyeW * 0.6, eyeY - eyeH * 0.41);
    ctx.lineTo(ex + eyeW * 0.72, eyeY - eyeH * 0.52);
    ctx.stroke();

    // ハイライト2点
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex - eyeW * 0.14, eyeY - eyeH * 0.14, eyeW * 0.14, eyeH * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + eyeW * 0.16, eyeY + eyeH * 0.22, eyeW * 0.07, 0, Math.PI * 2);
    ctx.fill();
  });

  // 眉（やわらかく：太いぼかしストローク＋細い芯の二重描き）
  ctx.lineCap = 'round';
  [leftX, rightX].forEach((ex, i) => {
    const dir = i === 0 ? -1 : 1;
    const liftY = happy ? 1.05 : 0.85;
    const peakY = happy ? 1.25 : 1.05;
    const endY = happy ? 1.02 : 0.82;
    ctx.strokeStyle = 'rgba(42,28,34,0.35)';
    ctx.lineWidth = size * 0.026;
    ctx.beginPath();
    ctx.moveTo(ex - dir * eyeW * 0.05 - eyeW * 0.4, eyeY - eyeH * liftY);
    ctx.quadraticCurveTo(ex, eyeY - eyeH * peakY, ex + eyeW * 0.4, eyeY - eyeH * endY);
    ctx.stroke();
    ctx.strokeStyle = '#2a1c22';
    ctx.lineWidth = size * 0.014;
    ctx.beginPath();
    ctx.moveTo(ex - dir * eyeW * 0.05 - eyeW * 0.4, eyeY - eyeH * liftY);
    ctx.quadraticCurveTo(ex, eyeY - eyeH * peakY, ex + eyeW * 0.4, eyeY - eyeH * endY);
    ctx.stroke();
  });

  // 口：表情ごとに大きさ・開き方を変える
  ctx.lineCap = 'round';
  if (happy) {
    ctx.fillStyle = '#7a3b4a';
    ctx.beginPath();
    ctx.moveTo(size * 0.4, size * 0.72);
    ctx.quadraticCurveTo(size * 0.5, size * 0.85, size * 0.6, size * 0.72);
    ctx.quadraticCurveTo(size * 0.5, size * 0.78, size * 0.4, size * 0.72);
    ctx.fill();
    ctx.strokeStyle = '#4a1f2a';
    ctx.lineWidth = size * 0.012;
    ctx.stroke();
  } else if (smiling) {
    ctx.strokeStyle = '#7a3b4a';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(size * 0.41, size * 0.735);
    ctx.quadraticCurveTo(size * 0.5, size * 0.795, size * 0.59, size * 0.735);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#7a3b4a';
    ctx.lineWidth = size * 0.016;
    ctx.beginPath();
    ctx.moveTo(size * 0.44, size * 0.74);
    ctx.quadraticCurveTo(size * 0.5, size * 0.79, size * 0.56, size * 0.74);
    ctx.stroke();
  }
}

function getFaceTextures() {
  if (faceTexturesCache) return faceTexturesCache;
  const size = 512; // 256→512：描き込み解像度を引き上げ

  function makeTex(closed, expression) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    drawFace(canvas.getContext('2d'), size, closed, expression);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  faceTexturesCache = {
    default: { open: makeTex(false, 'default'), closed: makeTex(true, 'default') },
    smile: { open: makeTex(false, 'smile'), closed: makeTex(true, 'smile') },
    happy: { tex: makeTex(false, 'happy') },
  };
  return faceTexturesCache;
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

export function createTextSprite(text, opts = {}) {
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
// シルエットで魅せる：前髪の房（fringe）を全スタイル共通で使い、
// スタイルごとに後ろ髪・ツインテール・帽子を足す。
// 加えて全スタイル共通でハイライト帯（天使の輪）を1枚重ね、
// アニメ調の質感と毛束の非対称な動きを出す。

function addFringe(group, hairMat) {
  const fringe = new THREE.Mesh(HAIR_FRINGE_GEO, hairMat);
  fringe.position.set(0, HEAD_R * 0.3, HEAD_R * 0.72);
  fringe.rotation.x = -0.4;
  fringe.scale.set(1.3, 0.72, 0.5);
  fringe.castShadow = true;
  group.add(fringe);
}

function addHairHighlight(group, hairColor) {
  const bright = new THREE.Color(hairColor).lerp(new THREE.Color('#ffffff'), 0.6);
  const mat = new THREE.MeshBasicMaterial({
    color: bright,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const band = new THREE.Mesh(HAIR_HIGHLIGHT_GEO, mat);
  // 個体ごとにわずかに回転をずらし、単調な左右対称のハイライトにならないようにする
  band.rotation.y = (Math.random() - 0.5) * 0.5;
  band.rotation.z = (Math.random() - 0.5) * 0.12;
  band.renderOrder = 1;
  group.add(band);
}

function buildHair(style, hairColor) {
  const group = new THREE.Group();
  const mat = toonMat(hairColor, 0.04);

  if (style === 'long') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);

    const back = new THREE.Mesh(HAIR_LONG_BACK_GEO, mat);
    back.position.set(0, -HEAD_R * 0.95, -HEAD_R * 0.42);
    back.rotation.x = 0.12;
    back.castShadow = true;
    group.add(back);
  } else if (style === 'twin') {
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);

    [-1, 1].forEach((side) => {
      const tail = new THREE.Mesh(HAIR_TWIN_TAIL_GEO, mat);
      tail.position.set(side * HEAD_R * 1.05, -HEAD_R * 0.15, -HEAD_R * 0.15);
      tail.rotation.z = side * 0.6;
      tail.rotation.x = 0.25;
      tail.castShadow = true;
      group.add(tail);
    });
  } else if (style === 'hat') {
    addFringe(group, mat);

    const brim = new THREE.Mesh(HAT_BRIM_GEO, mat);
    brim.position.set(0, HEAD_R * 0.5, 0);
    brim.castShadow = true;
    group.add(brim);

    const cone = new THREE.Mesh(HAT_CONE_GEO, mat);
    cone.position.set(0, HEAD_R * 0.5 + HEAD_R * 0.85 + HEAD_R * 0.08, 0);
    cone.castShadow = true;
    group.add(cone);

    const pom = new THREE.Mesh(HAT_POM_GEO, mat);
    pom.position.set(0, HEAD_R * 0.5 + HEAD_R * 1.7 + HEAD_R * 0.15, 0);
    pom.castShadow = true;
    group.add(pom);
  } else {
    // 'short'（既定）：キャップ＋前髪の房でボブ感を出す
    const cap = new THREE.Mesh(HAIR_CAP_GEO, mat);
    cap.castShadow = true;
    group.add(cap);
    addFringe(group, mat);
  }

  addHairHighlight(group, hairColor);

  return group;
}

// ---- アバター本体 -----------------------------------------------------
// 2026-07-29: 本体はBlender製GLBアバター（avatar_glb.js）に切り替えた。
// 旧プリミティブ版は createLegacyAvatar として残す（未使用・比較用）。

export function createAvatar(config) {
  return createGlbAvatar(config);
}

export function createLegacyAvatar(config) {
  const {
    bodyColor = '#ffdbac',
    hairStyle = 'short',
    hairColor = '#1a1a1a',
    shirtColor = '#00ffea',
    name = '',
  } = config || {};

  const root = new THREE.Group();
  root.name = 'avatar';

  const skinMat = toonMat(bodyColor, 0.05);
  const pantsMat = skinMat.clone();
  pantsMat.color.set(bodyColor).multiplyScalar(0.6);
  pantsMat.emissive.set(bodyColor).multiplyScalar(0.03);
  const shirtMat = toonMat(shirtColor, 0.07);
  const trimMat = shirtMat.clone();
  trimMat.color.multiplyScalar(0.55);
  trimMat.emissive.multiplyScalar(0.5);

  // ---- 服のバリエーション（configの形は変えず、既存の色フィールドから決定論的に導出） ----
  const sleeveVariant = variantIndex(shirtColor, 3); // 0:半袖 1:普通 2:長袖ぎみ
  const hemVariant = variantIndex(shirtColor + hairColor, 2); // 0:通常丈 1:長め（チュニック風）
  const accentVariant = variantIndex(shirtColor, 2); // 0:通常トリム 1:明るいワンポイントトリム

  if (accentVariant === 1) {
    trimMat.color.lerp(new THREE.Color('#ffffff'), 0.3);
    trimMat.emissive.lerp(new THREE.Color('#ffffff'), 0.3);
  }

  const SLEEVE_CUFF_Y = [-ARM_LEN * 0.42, -ARM_LEN + 0.11, -ARM_LEN + 0.03][sleeveVariant];
  const SLEEVE_CUFF_SCALE = [1.35, 1.0, 1.05][sleeveVariant];

  // ---- 脚（先細りのテーパー円柱＋足＋ソール） ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.12, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, pantsMat);
    mesh.position.y = -(LEG_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, SHOE_MAT);
    foot.position.y = -LEG_LEN + FOOT_R * 0.25;
    foot.position.z = FOOT_R * 0.25;
    foot.scale.set(1, 0.55, 1.3);
    foot.castShadow = true;
    pivot.add(foot);

    const sole = new THREE.Mesh(SOLE_GEO, SOLE_MAT);
    sole.position.set(0, foot.position.y - FOOT_R * 0.42, foot.position.z + FOOT_R * 0.05);
    sole.castShadow = true;
    pivot.add(sole);

    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身（胴・腕・首・頭）：まとめて上下にバウンドさせる ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  const torso = new THREE.Mesh(TORSO_GEO, shirtMat);
  torso.castShadow = true;
  upperGroup.add(torso);

  const torsoOutline = new THREE.Mesh(TORSO_GEO, OUTLINE_MAT);
  torsoOutline.scale.set(1.06, 1.03, 1.06);
  torso.add(torsoOutline);

  const collarRing = new THREE.Mesh(COLLAR_RING_GEO, trimMat);
  collarRing.position.y = TORSO_TOP_Y - 0.015;
  upperGroup.add(collarRing);

  const waistRing = new THREE.Mesh(WAIST_RING_GEO, trimMat);
  if (hemVariant === 1) {
    // 長め（チュニック風）の裾：位置を下げ、わずかにフレアさせる
    waistRing.position.y = -0.055;
    waistRing.scale.set(1.14, 1.3, 1.14);
  } else {
    waistRing.position.y = 0.02;
  }
  upperGroup.add(waistRing);

  const neck = new THREE.Mesh(NECK_GEO, skinMat);
  neck.position.y = TORSO_TOP_Y - NECK_OVERLAP + NECK_H / 2;
  neck.castShadow = true;
  upperGroup.add(neck);

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    pivot.rotation.z = side * ARM_REST_Z;
    pivot.rotation.x = ARM_REST_X;

    const mesh = new THREE.Mesh(ARM_GEO, skinMat);
    mesh.position.y = -(ARM_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const cuff = new THREE.Mesh(CUFF_RING_GEO, trimMat);
    cuff.position.y = SLEEVE_CUFF_Y;
    cuff.scale.set(SLEEVE_CUFF_SCALE, 1, SLEEVE_CUFF_SCALE);
    pivot.add(cuff);

    const hand = new THREE.Mesh(HAND_GEO, skinMat);
    hand.position.y = -ARM_LEN + HAND_R * 0.2;
    hand.scale.set(1, 0.9, 1.1);
    hand.castShadow = true;
    pivot.add(hand);

    // 親指のふくらみ（ミトン手の内側＝体の中心側に配置）
    const thumb = new THREE.Mesh(THUMB_GEO, skinMat);
    thumb.position.set(-side * HAND_R * 0.7, -ARM_LEN + HAND_R * 0.15, HAND_R * 0.5);
    thumb.scale.set(0.85, 1, 0.85);
    thumb.castShadow = true;
    pivot.add(thumb);

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
  const penlightMesh = new THREE.Mesh(PENLIGHT_GEO, penlightMat);
  const handBottomY = -ARM_LEN;
  penlightMesh.position.set(0, handBottomY - penlightLen / 2 - 0.05, 0);
  penlightMesh.visible = false;
  armR.add(penlightMesh);

  // ---- 頭 ----
  const headY = TORSO_TOP_Y - NECK_OVERLAP + NECK_H - HEAD_OVERLAP + HEAD_R * 0.82;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(HEAD_GEO, skinMat);
  head.scale.set(1, 0.96, 0.94);
  head.castShadow = true;
  headGroup.add(head);

  const headOutline = new THREE.Mesh(HEAD_GEO, OUTLINE_MAT);
  headOutline.scale.set(1.07, 1.07, 1.07);
  head.add(headOutline);

  // 顔（CanvasTextureを前面に貼る。まばたき・表情はテクスチャの差し替えで実現）
  const faceTex = getFaceTextures();
  const faceMat = new THREE.MeshBasicMaterial({
    map: faceTex.default.open,
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(FACE_PLANE_GEO, faceMat);
  face.position.set(0, HEAD_R * 0.02, HEAD_R * 0.93);
  face.renderOrder = 2;
  headGroup.add(face);

  // 髪
  const hair = buildHair(hairStyle, hairColor);
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
    // 表示時間は本人の設定に従う（既定8秒。bubbletime.js）
    speechTimer = setTimeout(() => {
      clearSpeech();
    }, bubbleMs());
  }

  // ---- アニメーション ----
  let moving = false;
  let walkT = 0;
  let idleT = Math.random() * 10;

  // ---- まばたき ----
  let blinking = false;
  let blinkElapsed = 0;
  let blinkTimer = 1 + Math.random() * 3;
  const BLINK_DURATION = 0.12;

  // ---- 表情（エモートに連動） ----
  let expression = 'default'; // 'default' | 'smile' | 'happy'

  function applyFaceTexture() {
    let tex;
    if (expression === 'happy') {
      tex = faceTex.happy.tex;
    } else {
      const set = faceTex[expression] || faceTex.default;
      tex = blinking ? set.closed : set.open;
    }
    if (faceMat.map !== tex) {
      faceMat.map = tex;
      faceMat.needsUpdate = true;
    }
  }

  function setExpression(next) {
    expression = next;
    applyFaceTexture();
  }

  function updateBlink(dt) {
    if (expression === 'happy') {
      // happy表情中はまばたき演出をスキップ（顔テクスチャは1枚固定）
      return;
    }
    if (!blinking) {
      blinkTimer -= dt;
      if (blinkTimer <= 0) {
        blinking = true;
        blinkElapsed = 0;
        applyFaceTexture();
      }
    } else {
      blinkElapsed += dt;
      if (blinkElapsed >= BLINK_DURATION) {
        blinking = false;
        applyFaceTexture();
        blinkTimer = 2.4 + Math.random() * 3.6;
      }
    }
  }

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

  // エモートごとの表情（未指定＝通常はデフォルト表情のまま）
  const EMOTE_EXPRESSION = {
    heart: 'happy',
    dance: 'happy',
    clap: 'smile',
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
    armL.rotation.set(ARM_REST_X, 0, -ARM_REST_Z);
    armR.rotation.set(ARM_REST_X, 0, ARM_REST_Z);
    upperGroup.rotation.set(0, 0, 0);
    upperGroup.position.y = HIP_Y;
    upperGroup.position.x = 0;
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
    setExpression('default');
  }

  function playEmote(id) {
    if (!EMOTE_DURATIONS[id]) return; // 未知のidは無視
    resetEmotePose(); // 再生中の別エモートがあれば即座にリセットして差し替え
    emoteId = id;
    emoteT = 0;
    setExpression(EMOTE_EXPRESSION[id] || 'default');
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
    updateBlink(dt);

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

    const easeT = Math.min(1, dt * 8);

    if (moving) {
      walkT += dt * 9;
      const swing = Math.sin(walkT);
      legL.rotation.x = swing * 0.75;
      legR.rotation.x = -swing * 0.75;
      legL.rotation.z = swing * 0.06;
      legR.rotation.z = -swing * 0.06;
      armL.rotation.x = ARM_REST_X - swing * 0.6;
      armR.rotation.x = ARM_REST_X + swing * 0.6;
      upperGroup.position.y = HIP_Y + Math.abs(Math.sin(walkT)) * 0.05;
      upperGroup.rotation.y = Math.sin(walkT) * 0.09; // 腰のひねり
      upperGroup.position.x += (0 - upperGroup.position.x) * easeT;
      headGroup.rotation.z = Math.sin(walkT) * 0.03;
      headGroup.rotation.x = Math.sin(walkT * 2) * 0.018; // 歩行時のわずかな頭の上下動
    } else {
      idleT += dt;
      legL.rotation.x += (0 - legL.rotation.x) * easeT;
      legR.rotation.x += (0 - legR.rotation.x) * easeT;
      legL.rotation.z += (0 - legL.rotation.z) * easeT;
      legR.rotation.z += (0 - legR.rotation.z) * easeT;
      armR.rotation.x += (ARM_REST_X + Math.sin(idleT * 1.4) * 0.06 - armR.rotation.x) * easeT;
      armL.rotation.x += (ARM_REST_X + Math.sin(idleT * 1.4 + Math.PI) * 0.05 - armL.rotation.x) * easeT;
      upperGroup.position.y += (HIP_Y + Math.sin(idleT * 1.6) * 0.015 - upperGroup.position.y) * easeT;
      upperGroup.position.x += (Math.sin(idleT * 0.45) * 0.012 - upperGroup.position.x) * easeT; // わずかな重心移動
      upperGroup.rotation.y += (0 - upperGroup.rotation.y) * easeT;
      headGroup.rotation.z += (Math.sin(idleT * 0.3) * 0.02 - headGroup.rotation.z) * easeT;
      headGroup.rotation.x += (0 - headGroup.rotation.x) * easeT;
    }
  }

  root.userData.update = update;
  root.userData.setMoving = setMoving;
  root.userData.say = say;
  root.userData.playEmote = playEmote;

  return root;
}
