import * as THREE from 'three';

// ------------------------------------------------------------------
// 案2: マネキン（6頭身・身長1.65m前後）
// 顔を描かないスタイライズ。無機質でおしゃれ、シルエットと質感で見せる。
// 球・カプセル・回転体を滑らかに繋いだ彫刻的なフォルムに、
// 発光するライン/リングを1〜2本入れてネオンの会場に映えるようにする。
// 輪郭線・トゥーン階調は使わず、光沢のあるマテリアルで質感を出す。
// ------------------------------------------------------------------

export const STYLE_INFO = {
  id: 'mannequin',
  name: 'マネキン',
  desc: '顔のない彫刻的なネオンボディ',
};

// ---- サイズ定数（身長1.65m前後・約6頭身） ---------------------------
// 頭頂までの計算目安（全て絶対Y、原点=足元）:
//   LEG_LEN(0.78)=HIP_Y → 胴上端 abs 1.28 → 首上端 abs 1.38
//   → 頭中心 abs 約1.51 → 頭頂 abs 約1.66（+ヘッドピースで前後）
const HEAD_R = 0.115;
const HEAD_SCALE_Y = 1.3;
const HEAD_SCALE_XZ = 0.9;
const NECK_R = 0.045;
const NECK_H = 0.12;
const NECK_OVERLAP = 0.02;
const HEAD_OVERLAP = 0.02;

const LEG_LEN = 0.78;
const LEG_R_TOP = 0.075;
const LEG_R_BOTTOM = 0.055;
const FOOT_R = 0.065;
const HIP_Y = LEG_LEN; // upperGroupの基準高さ

const TORSO_TOP_Y = 0.5; // upperGroup基準（胴体Latheの上端＝首の付け根）
const SHOULDER_Y = 0.44; // upperGroup基準（肩幅ピーク＝腕の付け根）
const SHOULDER_X = 0.135 + 0.02;

const ARM_LEN = 0.6;
const ARM_R_TOP = 0.048;
const ARM_R_BOTTOM = 0.034;
const HAND_R = 0.042;

const LEG_X = 0.09;

// ---- 光沢マテリアル（トゥーンではなく標準PBR。輪郭線なし） ----
function bodyMat(color, metalness = 0.45, roughness = 0.32) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

// 足裏・接地パーツ（ニュートラル色。ユーザー色に依存しないので共有できる）
const FOOT_MAT = new THREE.MeshStandardMaterial({ color: '#1c1c22', metalness: 0.5, roughness: 0.25 });

// ---- 共有ジオメトリ（色を持たないので全アバターで使い回せる） ----
const HEAD_GEO = new THREE.SphereGeometry(HEAD_R, 16, 12);
const NECK_GEO = new THREE.CylinderGeometry(NECK_R, NECK_R * 1.1, NECK_H, 10, 1, true);
const LEG_GEO = new THREE.CylinderGeometry(LEG_R_TOP, LEG_R_BOTTOM, LEG_LEN, 12, 1, true);
const ARM_GEO = new THREE.CylinderGeometry(ARM_R_TOP, ARM_R_BOTTOM, ARM_LEN, 10, 1, true);
const FOOT_GEO = new THREE.SphereGeometry(FOOT_R, 8, 6);
const HAND_GEO = new THREE.SphereGeometry(HAND_R, 8, 6);

// 胴体：くびれのある滑らかな彫刻的シルエット（Latheで回転生成）
const TORSO_GEO = new THREE.LatheGeometry(
  [
    [0.1, 0.0], // 腰
    [0.085, 0.18], // ウエスト（最も細い）
    [0.1, 0.32], // 胸まわり
    [0.135, SHOULDER_Y], // 肩幅ピーク
    [0.09, TORSO_TOP_Y], // 首の付け根
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  16
);

// ---- 発光アクセント（ネオン会場に映えるライン/リング） ----
const WAIST_GLOW_GEO = new THREE.TorusGeometry(0.088, 0.007, 6, 24);
const HEAD_HALO_GEO = new THREE.TorusGeometry(HEAD_R * 1.35, 0.006, 6, 24);

// ---- ヘッドピース用の共有ジオメトリ（4種を造形的に作り分け） ----
const HEADPIECE_DOME_GEO = new THREE.SphereGeometry(HEAD_R * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
const HEADPIECE_PLATE_GEO = new THREE.BoxGeometry(HEAD_R * 0.55, HEAD_R * 1.7, HEAD_R * 0.05);
const HEADPIECE_FIN_GEO = new THREE.BoxGeometry(HEAD_R * 0.06, HEAD_R * 1.15, HEAD_R * 0.42);
const HEADPIECE_RING_GEO = new THREE.TorusGeometry(HEAD_R * 1.12, HEAD_R * 0.09, 8, 20);

function buildHeadpiece(style, hairColor) {
  const group = new THREE.Group();
  const mat = bodyMat(hairColor, 0.55, 0.28);

  if (style === 'long') {
    // 背面に伸びる板：髪というより造形的なヘッドピース
    const plate = new THREE.Mesh(HEADPIECE_PLATE_GEO, mat);
    plate.position.set(0, -HEAD_R * 0.1, -HEAD_R * 0.95);
    plate.rotation.x = 0.18;
    group.add(plate);
  } else if (style === 'twin') {
    // 左右のフィン
    [-1, 1].forEach((side) => {
      const fin = new THREE.Mesh(HEADPIECE_FIN_GEO, mat);
      fin.position.set(side * HEAD_R * 1.05, HEAD_R * 0.05, 0);
      fin.rotation.z = side * 0.3;
      group.add(fin);
    });
  } else if (style === 'hat') {
    // リング状の輪（頭上に浮かせる）
    const ring = new THREE.Mesh(HEADPIECE_RING_GEO, mat);
    ring.position.set(0, HEAD_R * 1.15, 0);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  } else {
    // 'short'（既定）：なめらかな半球
    const dome = new THREE.Mesh(HEADPIECE_DOME_GEO, mat);
    dome.position.set(0, HEAD_R * 0.06, 0);
    group.add(dome);
  }

  return group;
}

// ------------------------------------------------------------------
// アバター本体
// ------------------------------------------------------------------
export function createStyleAvatar(config) {
  const {
    bodyColor = '#d8dce2',
    hairStyle = 'short',
    hairColor = '#2a2a32',
    shirtColor = '#00ffea',
  } = config || {};

  const root = new THREE.Group();
  root.name = 'mannequin_avatar';

  const bodySkin = bodyMat(bodyColor, 0.4, 0.35); // 四肢・頭：体そのものの色
  const shirtSkin = bodyMat(shirtColor, 0.45, 0.3); // 胴：shirtColorで塗り分け

  // 発光アクセントの色：shirtColorを明るく振ったネオン色（常時自己発光＝MeshBasicMaterial）
  const glowColor = new THREE.Color(shirtColor).lerp(new THREE.Color('#ffffff'), 0.35);
  const glowMat = new THREE.MeshBasicMaterial({ color: glowColor, toneMapped: false });

  // ---- 脚（すらりと長いテーパー円柱。指の表現はなし） ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG_X, HIP_Y, 0);

    const mesh = new THREE.Mesh(LEG_GEO, bodySkin);
    mesh.position.y = -(LEG_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const foot = new THREE.Mesh(FOOT_GEO, FOOT_MAT);
    foot.position.set(0, -LEG_LEN + FOOT_R * 0.25, FOOT_R * 0.35);
    foot.scale.set(1, 0.45, 1.6);
    foot.castShadow = true;
    pivot.add(foot);

    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ---- 上半身（胴・腕・首・頭） ----
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, HIP_Y, 0);
  root.add(upperGroup);

  const torso = new THREE.Mesh(TORSO_GEO, shirtSkin);
  torso.castShadow = true;
  upperGroup.add(torso);

  // 発光リング1：ウエスト（体の色分けの継ぎ目に添えるネオンライン）
  const waistGlow = new THREE.Mesh(WAIST_GLOW_GEO, glowMat);
  waistGlow.position.y = 0.18;
  waistGlow.rotation.x = Math.PI / 2;
  upperGroup.add(waistGlow);

  const neck = new THREE.Mesh(NECK_GEO, bodySkin);
  neck.position.y = TORSO_TOP_Y - NECK_OVERLAP + NECK_H / 2;
  neck.castShadow = true;
  upperGroup.add(neck);

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    pivot.rotation.z = side * 0.09; // すらりと自然に下ろした休止ポーズ

    const mesh = new THREE.Mesh(ARM_GEO, bodySkin);
    mesh.position.y = -(ARM_LEN / 2);
    mesh.castShadow = true;
    pivot.add(mesh);

    const hand = new THREE.Mesh(HAND_GEO, bodySkin);
    hand.position.y = -ARM_LEN;
    hand.scale.set(0.9, 1.3, 0.9);
    hand.castShadow = true;
    pivot.add(hand);

    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  upperGroup.add(armL, armR);

  // ---- 頭（卵型・目鼻なし） ----
  const headY = TORSO_TOP_Y - NECK_OVERLAP + NECK_H - HEAD_OVERLAP + HEAD_R * HEAD_SCALE_Y;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperGroup.add(headGroup);

  const head = new THREE.Mesh(HEAD_GEO, bodySkin);
  head.scale.set(HEAD_SCALE_XZ, HEAD_SCALE_Y, HEAD_SCALE_XZ);
  head.castShadow = true;
  headGroup.add(head);

  // 発光リング2：頭部の傾いたハロー（ネオンの会場に映える差し色）
  const headHalo = new THREE.Mesh(HEAD_HALO_GEO, glowMat);
  headHalo.rotation.x = Math.PI / 2.4;
  headHalo.rotation.z = 0.15;
  headGroup.add(headHalo);

  // ヘッドピース（「髪」ではなく造形的な装飾として4種を作り分け）
  const headpiece = buildHeadpiece(hairStyle, hairColor);
  headGroup.add(headpiece);

  // 比較用の静止アバターなのでアニメーションは持たないが、フックだけ生やしておく
  root.userData.update = (_dt) => {};

  return root;
}
