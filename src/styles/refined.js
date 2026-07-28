import * as THREE from 'three';

// =====================================================================
// 「refined」案 — VRChatローポリ系（参考画像に寄せた版）
//
// 参考画像から読み取った要素:
//   - 面がはっきり見えるカクカクのローポリ（スムーズシェーディングにしない）
//   - 太い黒のアウトライン
//   - 目は「黒い四角」。虹彩やまつげは描かない。下に赤みのグラデ
//   - 大きめの頭 ＋ 3〜3.5頭身、手足は細い
//   - ゆったりしたトップス（お尻が隠れる丈）＋ ごついブーツ
//   - 頭のてっぺんにアホ毛、髪は三角の房でギザギザ
// =====================================================================

export const STYLE_INFO = {
  id: 'refined',
  name: '改訂案（ローポリ系）',
  desc: 'カクカクのローポリ＋太い黒線＋四角い目。VRChatのローポリアバター路線',
};

const TARGET_HEIGHT = 1.45;
const OUTLINE_COLOR = 0x141018;

// アウトライン用（共有）
const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });

// ローポリらしく見せるため、陰影は2段でフラットシェーディング
function flat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

// メッシュ＋アウトラインをまとめて作る
function outlined(geo, mat, thickness = 1.055) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  g.add(mesh);
  const o = new THREE.Mesh(geo, outlineMat);
  o.scale.setScalar(thickness);
  g.add(o);
  g.userData.mesh = mesh;
  return g;
}

// ---- 顔テクスチャ：黒い四角の目＋小さな口 ----
// 参考画像では目は顔のかなり下寄りにある（おでこが広い）。
// ここを中央にすると途端に「大人っぽく・怖く」なるので低めに置く。
const FACE_EYE_Y = 0.62;

function makeFaceTexture(expression = 'default') {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);

  const cx = S / 2;
  const eyeY = S * FACE_EYE_Y;
  // 大きく・離して配置すると幼い印象になり可愛くなる
  const eyeDX = S * 0.19;
  const eyeW = S * 0.125;
  const eyeH = S * 0.2;

  // 頬の赤み
  c.fillStyle = 'rgba(255,140,150,0.35)';
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + sx * S * 0.245, eyeY + S * 0.055, S * 0.05, S * 0.03, 0, 0, Math.PI * 2);
    c.fill();
  }

  const closed = expression === 'closed' || expression === 'happy';

  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeDX;
    if (closed) {
      // 「へ」の字の閉じ目（にっこり）
      c.strokeStyle = '#171017';
      c.lineWidth = S * 0.03;
      c.lineCap = 'butt';
      c.beginPath();
      c.moveTo(ex - eyeW * 0.7, eyeY + eyeH * 0.1);
      c.lineTo(ex, eyeY - eyeH * 0.22);
      c.lineTo(ex + eyeW * 0.7, eyeY + eyeH * 0.1);
      c.stroke();
      continue;
    }
    // 黒い縦長の四角（下側に赤みのグラデーション）
    const g = c.createLinearGradient(0, eyeY - eyeH / 2, 0, eyeY + eyeH / 2);
    g.addColorStop(0, '#151016');
    g.addColorStop(0.62, '#171017');
    g.addColorStop(0.63, '#8f2f38');
    g.addColorStop(1, '#c9505a');
    c.fillStyle = g;
    c.fillRect(ex - eyeW / 2, eyeY - eyeH / 2, eyeW, eyeH);
    // 白のハイライトを1本だけ
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(ex - eyeW / 2 + eyeW * 0.12, eyeY - eyeH / 2 + eyeH * 0.1, eyeW * 0.2, eyeH * 0.16);
  }

  // 口
  c.fillStyle = '#e0606a';
  if (expression === 'happy') {
    c.beginPath();
    c.moveTo(cx - S * 0.032, eyeY + S * 0.1);
    c.lineTo(cx + S * 0.032, eyeY + S * 0.1);
    c.lineTo(cx, eyeY + S * 0.145);
    c.closePath();
    c.fill();
  } else if (expression === 'smile') {
    c.strokeStyle = '#e0606a';
    c.lineWidth = S * 0.016;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(cx, eyeY + S * 0.095, S * 0.028, Math.PI * 0.12, Math.PI * 0.88);
    c.stroke();
  } else {
    c.fillRect(cx - S * 0.018, eyeY + S * 0.098, S * 0.036, S * 0.02);
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

export function createStyleAvatar(config = {}) {
  const {
    bodyColor = '#ffdbac',
    hairStyle = 'short',
    hairColor = '#4a2c17',
    shirtColor = '#3b82f6',
  } = config;

  const skinMat = flat(bodyColor);
  const hairMat = flat(hairColor);
  const topMat = flat(shirtColor);
  const legMat = flat(new THREE.Color(shirtColor).multiplyScalar(0.32).getHex());
  const bootMat = flat(0x2b2733);
  const bootSoleMat = flat(new THREE.Color(shirtColor).lerp(new THREE.Color(0xffffff), 0.35).getHex());

  const root = new THREE.Group();
  const upper = new THREE.Group();
  root.add(upper);

  const R = 1; // 頭の半径を1として組む

  // ---------- 脚（細い）＋ ごついブーツ ----------
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.26, 1.5, 0);
    upper.add(hip);

    const leg = outlined(new THREE.CylinderGeometry(0.17, 0.15, 1.0, 7), legMat, 1.09);
    leg.position.y = -0.5;
    hip.add(leg);

    // ブーツ（角ばった塊）
    const boot = outlined(new THREE.BoxGeometry(0.42, 0.42, 0.6), bootMat, 1.07);
    boot.position.set(0, -1.12, 0.08);
    hip.add(boot);

    const sole = outlined(new THREE.BoxGeometry(0.46, 0.1, 0.64), bootSoleMat, 1.06);
    sole.position.set(0, -1.32, 0.08);
    hip.add(sole);

    legs.push(hip);
  }

  // ---------- トップス（お尻が隠れるゆったり丈） ----------
  // 下に向かって広がるシルエットにするとローポリ系の"服感"が出る
  const topGeo = new THREE.CylinderGeometry(0.52, 0.76, 1.5, 9, 1);
  const top = outlined(topGeo, topMat, 1.05);
  top.position.y = 2.35;
  upper.add(top);

  // 裾の縁（内側の影）
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.08, 9), flat(new THREE.Color(shirtColor).multiplyScalar(0.7).getHex()));
  hem.position.y = 1.63;
  upper.add(hem);

  // ---------- 腕（細い・袖から手が少し出る） ----------
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.6, 2.9, 0);
    upper.add(shoulder);

    const sleeve = outlined(new THREE.CylinderGeometry(0.22, 0.19, 0.95, 7), topMat, 1.07);
    sleeve.position.y = -0.5;
    shoulder.add(sleeve);

    const hand = outlined(new THREE.BoxGeometry(0.24, 0.28, 0.2), skinMat, 1.09);
    hand.position.y = -1.06;
    shoulder.add(hand);

    shoulder.rotation.z = sx * 0.12;
    arms.push(shoulder);
  }

  // ---------- 頭（多面体・カクカク） ----------
  const headGroup = new THREE.Group();
  headGroup.position.y = 3.72;
  upper.add(headGroup);

  // 分割数を落として面を見せる
  // 面の少ない多面体にして、参考画像のようなカクカク感を出す
  const headGeo = new THREE.SphereGeometry(R, 8, 6);
  const head = outlined(headGeo, skinMat, 1.045);
  head.scale.set(1.0, 0.98, 0.9);
  headGroup.add(head);

  // 顔（頭の丸みに沿った殻）
  const FACE_PHI = Math.PI * 0.8;
  const FACE_THETA_START = Math.PI * 0.24;
  const FACE_THETA_LEN = Math.PI * 0.56;
  const faceMat = new THREE.MeshBasicMaterial({
    map: FACE_TEXTURES.default,
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(
      R * 1.01,
      24,
      18,
      Math.PI / 2 - FACE_PHI / 2,
      FACE_PHI,
      FACE_THETA_START,
      FACE_THETA_LEN,
    ),
    faceMat,
  );
  face.scale.set(1.0, 0.98, 0.9);
  face.renderOrder = 3;
  headGroup.add(face);

  const eyeLocalY = Math.cos(FACE_THETA_START + FACE_THETA_LEN * FACE_EYE_Y) * R;

  // ---------- 髪 ----------
  const hairGroup = new THREE.Group();
  headGroup.add(hairGroup);

  // 頭頂のキャップ（面を見せるため分割少なめ）。目より下には来ない
  const capBottom = eyeLocalY + R * 0.3;
  const capTheta = Math.acos(Math.min(0.97, Math.max(-0.97, capBottom / (R * 1.08))));
  const cap = outlined(
    new THREE.SphereGeometry(R * 1.08, 10, 6, 0, Math.PI * 2, 0, capTheta),
    hairMat,
    1.035,
  );
  cap.scale.set(1.0, 1.02, 0.98);
  hairGroup.add(cap);

  // 後頭部
  const back = outlined(new THREE.SphereGeometry(R * 1.06, 9, 6), hairMat, 1.04);
  back.scale.set(1.0, 1.0, 0.62);
  back.position.z = -R * 0.42;
  hairGroup.add(back);

  // アホ毛（参考画像に必ずある要素）。細すぎるとアンテナに見えるので幅を持たせる
  const ahoge = outlined(new THREE.ConeGeometry(R * 0.34, R * 1.0, 3), hairMat, 1.07);
  ahoge.position.set(-R * 0.08, R * 1.32, -R * 0.02);
  ahoge.rotation.z = 0.26;
  ahoge.scale.set(1, 1, 0.26); // 前後に薄い板状にして「毛の束」に見せる
  hairGroup.add(ahoge);

  // 前髪：細い房を並べると「柵」に見えてしまうので、まず前面を覆う"塊"を作る。
  // 塊の下端（＝生え際）は目より上に固定する。
  const fringeTheta = Math.acos(Math.min(0.97, Math.max(-0.97, capBottom / (R * 1.1))));
  const bangMass = outlined(
    new THREE.SphereGeometry(R * 1.1, 9, 5, Math.PI / 2 - Math.PI * 0.46, Math.PI * 0.92, 0, fringeTheta),
    hairMat,
    1.035,
  );
  bangMass.scale.set(1.0, 1.02, 1.0);
  hairGroup.add(bangMass);

  // 塊の下端から、幅のある三角の毛先を数枚ぶら下げる（ギザギザのシルエット）
  for (let i = -2; i <= 2; i++) {
    const wide = i === 0 ? 0.32 : 0.28;
    const len = i % 2 === 0 ? 0.52 : 0.36;
    const tip = outlined(new THREE.ConeGeometry(R * wide, R * len, 3), hairMat, 1.05);
    // 毛先の下端が capBottom - len/2（＝目より上）に来るよう配置
    tip.position.set(i * R * 0.32, capBottom + R * len * 0.5, R * 0.7 - Math.abs(i) * R * 0.16);
    tip.rotation.x = Math.PI;
    tip.scale.set(1, 1, 0.32);
    hairGroup.add(tip);
  }

  // 横の房：頬にぴったり沿わせて顔を囲む（肌の見える面積を小さくすると可愛くなる）
  for (const sx of [-1, 1]) {
    const side = outlined(new THREE.ConeGeometry(R * 0.34, R * 1.45, 3), hairMat, 1.05);
    side.position.set(sx * R * 0.7, -R * 0.34, R * 0.3);
    side.rotation.x = Math.PI;
    side.rotation.z = sx * 0.02;
    side.scale.set(0.62, 1, 0.62);
    hairGroup.add(side);
  }

  // 髪のハイライト帯（2トーンにすると一気に"作られた感"が出る）
  const hiColor = new THREE.Color(hairColor).lerp(new THREE.Color(0xffffff), 0.42).getHex();
  const highlight = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.09, R * 1.09, R * 0.13, 8, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    flat(hiColor),
  );
  highlight.position.y = R * 0.5;
  highlight.renderOrder = 1;
  hairGroup.add(highlight);

  if (hairStyle === 'long') {
    const long = outlined(new THREE.CylinderGeometry(R * 0.7, R * 0.5, R * 1.9, 7), hairMat, 1.05);
    long.position.set(0, -R * 1.0, -R * 0.45);
    long.scale.set(1, 1, 0.55);
    hairGroup.add(long);
  } else if (hairStyle === 'twin') {
    for (const sx of [-1, 1]) {
      const t = new THREE.Group();
      t.position.set(sx * R * 0.85, R * 0.45, -R * 0.12);
      t.rotation.z = sx * 0.6;
      hairGroup.add(t);
      const tie = outlined(new THREE.BoxGeometry(R * 0.3, R * 0.22, R * 0.3), flat(0xf2f2f2), 1.1);
      t.add(tie);
      const tail = outlined(new THREE.ConeGeometry(R * 0.32, R * 1.5, 5), hairMat, 1.05);
      tail.position.y = -R * 0.78;
      tail.rotation.x = Math.PI;
      tail.rotation.y = Math.PI / 5;
      t.add(tail);
    }
  } else if (hairStyle === 'hat') {
    const brim = outlined(new THREE.CylinderGeometry(R * 1.5, R * 1.5, R * 0.08, 9), flat(0x2b2733), 1.04);
    brim.position.y = R * 0.62;
    hairGroup.add(brim);
    const crown = outlined(new THREE.CylinderGeometry(R * 0.8, R * 0.92, R * 0.65, 9), flat(0x2b2733), 1.05);
    crown.position.y = R * 0.95;
    hairGroup.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.94, R * 0.94, R * 0.14, 9), topMat);
    band.position.y = R * 0.7;
    hairGroup.add(band);
  }

  // ---------- ヘッドホン（参考画像の定番アクセサリ） ----------
  const hp = new THREE.Group();
  headGroup.add(hp);
  const band = outlined(new THREE.TorusGeometry(R * 1.02, R * 0.075, 4, 10, Math.PI), flat(0x2b2733), 1.07);
  band.rotation.y = Math.PI / 2;
  hp.add(band);
  for (const sx of [-1, 1]) {
    const cup = outlined(new THREE.CylinderGeometry(R * 0.3, R * 0.3, R * 0.22, 7), flat(0x2b2733), 1.07);
    cup.position.set(sx * R * 1.0, R * 0.02, 0);
    cup.rotation.z = Math.PI / 2;
    hp.add(cup);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.2, R * 0.26, 7), topMat);
    pad.position.set(sx * R * 1.06, R * 0.02, 0);
    pad.rotation.z = Math.PI / 2;
    hp.add(pad);
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
  const baseY = -box.min.y * s;
  upper.position.y = baseY;

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
      const w = t * 8;
      arms[0].rotation.x = Math.sin(w) * 0.55;
      arms[1].rotation.x = -Math.sin(w) * 0.55;
      legs[0].rotation.x = -Math.sin(w) * 0.5;
      legs[1].rotation.x = Math.sin(w) * 0.5;
      upper.position.y = baseY + Math.abs(Math.sin(w)) * 0.025;
      headGroup.rotation.z = Math.sin(w) * 0.04;
    } else {
      const b = Math.sin(t * 1.6);
      arms[0].rotation.x = b * 0.05;
      arms[1].rotation.x = -b * 0.05;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;
      upper.position.y = baseY;
      headGroup.position.y = headBaseY + b * 0.012;
      headGroup.rotation.z = Math.sin(t * 0.55) * 0.025;
    }
  };

  return root;
}
