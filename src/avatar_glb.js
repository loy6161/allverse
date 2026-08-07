import * as THREE from 'three';
import { NO_BLOOM_ALPHA } from './layers.js';
import { GUEST_HAIR } from './guestlook.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTextSprite } from './avatar.js';
import { playClap } from './sfx.js';
import { bubbleMs } from './bubbletime.js';
import { parseAccessories, STAFF_ONLY_ACCESSORIES } from './accessory.js';
import { normalizeHair } from './hair.js';
import { streakShape } from './hairfx.js';

// ------------------------------------------------------------------
// GLBアバター（Blender製・設計メッシュ版）
//
// tools/gen_avatar_obj.mjs → Blender → assets/avatars/lp_<style>.glb の
// パイプラインで作ったアバターを読み込み、旧 createAvatar と同じ契約
// （userData.update / setMoving / say / playEmote）で返す。
//
// 色はマテリアル名で塗り分ける（GLB内の名前は固定）:
//   MatHair=髪 / MatSkin=肌 / MatCloth=服 / MatDark=脚(タイツ)
//   MatEye=目(黒) / MatEyeC=瞳の色 / MatEyeGlint=ハイライト / MatCheek=チーク
// ------------------------------------------------------------------

// パーツ合成方式: body_<服装> + hair_<髪型> + acc_<アクセ> を実行時に組む
// 髪は「長さ×前髪」を焼いた1枚（hair_<長さ>_<前髪>）に、
// 結い方の房（hairx_<髪型>）を重ねて作る。詳しくは hair.js と tools/gen_avatar_obj.mjs
export const GLB_LENGTHS = ['long', 'bob', 'short'];
export const GLB_BANGS = ['std', 'patsun', 'partr', 'partl'];
export const GLB_ARRANGE = ['twin', 'bun', 'pony']; // 'none' は房を足さない
// ※ ゲスト専用の「髪なし」は選択肢に入れない（選べてしまうと見分けにならない）
export const GLB_OUTFITS = ['middle', 'long', 'short'];
export const GLB_ACCESSORIES = [
  'none', 'kemo', 'ahoge',
  // 2026-08-03 追加（loyさん指示）
  'tail', 'wing', 'halo', 'ribbon', 'sunglasses', 'glasses',
];

/**
 * 身長（2026-08-03追加）。3Dパーツは増やさず、アバター全体の拡大率で表す。
 * ⚠ 目の高さ（一人称）とネームプレートの高さもこの倍率で動くので、
 *   ここだけで完結する（各所に散らさない）
 */
export const GLB_HEIGHTS = { small: 0.88, mid: 1.0, big: 1.13 };

// ネームプレートの見た目。ひと目で「誰が運営で、誰がNPCか」が分かるようにする。
// 色だけだと色覚の差で伝わらないことがあるので、必ず記号もセットで付ける。
const NAME_STYLES = {
  default: {
    prefix: '',
    textColor: '#eafcff',
    bgColor: 'rgba(6, 8, 20, 0.6)',
    borderColor: 'rgba(0, 255, 234, 0.55)',
  },
  admin: {
    prefix: '👑 ', // 管理者
    textColor: '#fff6d5',
    bgColor: 'rgba(38, 26, 4, 0.72)',
    borderColor: 'rgba(255, 209, 71, 0.95)',
  },
  vip: {
    prefix: '⭐ ', // 全ルームに現れるメンバー
    textColor: '#ffe9fb',
    bgColor: 'rgba(34, 6, 30, 0.7)',
    borderColor: 'rgba(255, 0, 229, 0.85)',
  },
  npc: {
    prefix: '', // 名前側に「NPC:」が入るので記号は付けない
    textColor: 'rgba(214, 224, 236, 0.85)',
    bgColor: 'rgba(10, 12, 18, 0.45)',
    borderColor: 'rgba(150, 165, 185, 0.45)', // 実在の人より一段地味にして背景側に見せる
  },
};

const loader = new GLTFLoader();
const templateCache = new Map(); // file key -> Promise<THREE.Group>

function loadPart(key) {
  if (!templateCache.has(key)) {
    templateCache.set(
      key,
      loader.loadAsync(`assets/avatars/${key}.glb`).then((gltf) => gltf.scene),
    );
  }
  return templateCache.get(key);
}

function partsFor(config) {
  const outfit = GLB_OUTFITS.includes(config.outfit) ? config.outfit : GLB_OUTFITS[0];
  const keys = [`body_${outfit}`];
  // ゲストは髪なし（2026-08-02）。アクセの 'none' と同じで、単に足さないだけ。
  // 新しい3Dアセットが要らないうえ、シルエットで一目でゲストと分かる
  const hair = normalizeHair(config);
  if (hair.hairLength !== GUEST_HAIR) {
    keys.push(`hair_${hair.hairLength}_${hair.bangs}`);
    // 結い方（ツインテール・お団子・ポニー）は房だけの別パーツ。
    // 選んだときだけ描画が1回増える
    if (GLB_ARRANGE.includes(hair.hairStyle)) keys.push(`hairx_${hair.hairStyle}`);
  }
  // アクセサリーは複数付けられる（2026-08-04）。"wing+halo" のように来る。
  // 判定は accessory.js に集約してある（サーバーと同じものを読む）
  for (const acc of parseAccessories(config.accessory)) {
    // ⚠ 前髪メッシュは3Dパーツを持たない（髪の材質に描く）。読みに行くと404になる
    if (acc === 'mesh') continue;
    keys.push(`acc_${acc}`);
  }
  return keys;
}

export function preloadAvatars() {
  for (const o of GLB_OUTFITS) loadPart(`body_${o}`);
  for (const len of GLB_LENGTHS) for (const b of GLB_BANGS) loadPart(`hair_${len}_${b}`);
  for (const a of GLB_ARRANGE) loadPart(`hairx_${a}`);
  for (const a of GLB_ACCESSORIES) {
    if (a === 'none' || a === 'mesh') continue; // mesh は3Dパーツを持たない
    loadPart(`acc_${a}`);
  }
}

// メッシュを「回転の支点」付きのグループで包む（腕=付け根、脚=腰）
function wrapWithPivot(mesh, pivot) {
  const g = new THREE.Group();
  g.position.copy(pivot);
  mesh.position.sub(pivot);
  g.add(mesh);
  return g;
}

/**
 * 「この画素はアバター」という目印をアルファに入れる（2026-08-04追加）。
 *
 * ブルームを掛けない場所を bloom.js に伝えるため。**描画を増やさずに**伝えたい
 * （型紙をもう1枚描く方式は人数ぶん重くなった。layers.js の説明を参照）。
 *
 * ⚠ three は「不透明な材質」と判断すると**アルファを強制的に1にする**。
 *   その判断（OPAQUE）は `transparent === false かつ blending === NormalBlending`。
 *   なので混ぜ方を「そのまま置き換える（src×1 + dst×0）」に変える。
 *   計算結果は混ぜないのと同じなので**見た目は変わらない**が、
 *   OPAQUE 扱いから外れるので 0.99 が保たれる。
 *   transparent は false のままなので、描く順番も深度の書き込みも今までどおり。
 */
function tagNoBloom(mat) {
  mat.opacity = NO_BLOOM_ALPHA;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.ZeroFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.ZeroFactor;
  return mat;
}

// フラット寄りの質感（ユーザー指定 2026-07-29: 影なしのフラットな方がかわいい）。
// エミッシブを高めにして、会場の照明で暗く沈まないようにする
function toon(color, emissiveScale = 0.42) {
  const mat = new THREE.MeshToonMaterial({ color });
  mat.emissive = new THREE.Color(color).multiplyScalar(emissiveScale);
  mat.side = THREE.DoubleSide; // 髪は開いたシェルなので両面必須
  return tagNoBloom(mat);
}

/**
 * 前髪メッシュ（2026-08-06追加・loyさん要望「前髪に黒メッシュ」）。
 *
 * ★ 3Dパーツを足さず、**髪の材質に筋を描く**。
 *   髪は低ポリ（369頂点）なので、頂点を塗り分けると角ばる（試して確認済み）。
 *   材質側で「この範囲だけ別の色」にすれば、**髪型6種すべてで一発**で効き、
 *   髪型を足したときも何もしなくてよい。
 *
 * ⚠ 範囲はジオメトリの**局所座標**で指定する。GLBのノードがX+90°回っているので、
 *   局所x=左右／局所y=前後（+が前）／局所z=上下（負が上）。
 *   下の値は画面で詰めたもの（loyさんが「1つめ」を選んだ太さ）。
 */
const MESH_STREAK = {
  frontY: -0.02, // これより前だけ（顔側）
  z: [-0.98, -0.66], // 上下の範囲
};

/**
 * 髪に描く飾りをまとめて材質へ差し込む（2026-08-07に拡張）。
 *
 * 入るのは3つ。どれも**ジオメトリを足さない**ので、何人が使っても描画は増えない。
 *   ・前髪メッシュ … 本数・位置・太さを選べる（運営専用。hairfx.js が一覧の原本）
 *   ・グラデ       … 毛先へ向かって別の色へ移る
 *
 * ⚠ インナーカラーも作ったが**やめた**（2026-08-07）。この髪は閉じた1枚のシェルで、
 *   「内側」に当たる面は外から見えない。見える形にすると裾の外側まで塗ることになり、
 *   結局グラデと同じに見えてしまう（loyさん「そうならグラデーションでいいから要らない」）。
 *
 * ⚠ 範囲はジオメトリの**局所座標**で指定する。GLBのノードがX+90°回っているので、
 *   局所x=左右（+が本人の左）／局所y=前後（+が前）／局所z=上下（負が上）。
 */
function applyHairFx(mat, { streak, shape, grad }) {
  const uniforms = {
    uStreak: { value: new THREE.Color(streak || '#141414') },
    uOn: { value: streak ? 1 : 0 },
    uC0: { value: shape.x },
    uHW: { value: shape.hw },
    uGap: { value: shape.gap },
    uCount: { value: shape.count },
    uFrontY: { value: MESH_STREAK.frontY },
    uZ: { value: new THREE.Vector2(MESH_STREAK.z[0], MESH_STREAK.z[1]) },
    uGrad: { value: new THREE.Color(grad || '#ffffff') },
    uGradOn: { value: grad ? 1 : 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    // ⚠ GLSLはバッククォートで書くこと。'' の中で改行すると構文エラーになる
    sh.vertexShader = `varying vec3 vLocalPos;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vLocalPos = position;`);
    const decl = `varying vec3 vLocalPos;
uniform vec3 uStreak;
uniform float uOn;
uniform float uC0;
uniform float uHW;
uniform float uGap;
uniform float uCount;
uniform float uFrontY;
uniform vec2 uZ;
uniform vec3 uGrad;
uniform float uGradOn;
// 1本ぶんの帯
float band(float x, float c) {
  return step(c - uHW, x) * step(x, c + uHW);
}
// 本数ぶんの帯を重ねる。中心から左右へ均等に広がるように並べる
float streakMask(vec3 p) {
  float front = step(uFrontY, p.y) * step(uZ.x, p.z) * step(p.z, uZ.y);
  float start = uC0 - uGap * (uCount - 1.0) * 0.5;
  float m = band(p.x, start);
  if (uCount > 1.5) m = max(m, band(p.x, start + uGap));
  if (uCount > 2.5) m = max(m, band(p.x, start + uGap * 2.0));
  return m * front * uOn;
}
// 毛先へ向かう度合い。局所zは**負が上**で、実測した髪の範囲は
// 頭頂 -1.16 → 裾 ロング -0.43 / ボブ -0.54 / ショート -0.68。
// 耳のあたり（-0.95）から下がり始めて、-0.60 で色が乗り切るようにする
float tipAmount(vec3 p) {
  return uGradOn * clamp((p.z + 0.95) / 0.35, 0.0, 1.0);
}
`;
    // 色を差し替える行。diffuse と emissive の**両方**に同じ形を掛ける。
    // 片方だけだと、その部分が元の髪色で浮いて見える
    const mixLines = (target, scale) => `
  DST = mix(DST, uGradSCALE, tipAmount(vLocalPos));
  DST = mix(DST, uStreakSCALE, streakMask(vLocalPos));
`.replace(/DST/g, target).replace(/SCALE/g, scale);
    sh.fragmentShader = decl + sh.fragmentShader
      .replace('#include <color_fragment>',
        '#include <color_fragment>' + mixLines('diffuseColor.rgb', ''))
      .replace('vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive;' + mixLines('totalEmissiveRadiance', ' * 0.42'));
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * リボンの付け方（2026-08-07・loyさん「リボンを左右中で選択。サイズも今が小で大も欲しい」）。
 *
 * ★ GLBは1つのまま。**置き方を変えるだけ**なので、位置と大きさを足しても
 *   アセットも描画コールも増えない。
 *
 * ⚠ メッシュ自身の変形（位置・回転）は GLB のノードが持っていて、しかも X+90°回っている。
 *   だから mesh.position を触るのではなく、**外側にグループを2枚かぶせて**
 *   「結び目を原点に持ってくる → 拡大 → 置きたい場所へ動かす」の順で効かせる。
 */
const RIBBON_ANCHOR = new THREE.Vector3(0.19, 1.13, 0.02); // 結び目の位置（生成器の値）
const RIBBON_SIZES = { sm: 1, lg: 1.5 };

function wrapRibbon(mesh, pos, size) {
  const inner = new THREE.Group();
  inner.position.copy(RIBBON_ANCHOR).negate(); // 結び目を原点へ
  inner.add(mesh);
  const outer = new THREE.Group();
  outer.add(inner);
  const s = RIBBON_SIZES[size] || RIBBON_SIZES.sm;
  outer.scale.setScalar(s);
  if (pos === 'r') {
    // 本人の右。左右を反転して置く（材質は両面描画なので裏返っても見た目は同じ）
    outer.scale.x *= -1;
    outer.position.set(-RIBBON_ANCHOR.x, RIBBON_ANCHOR.y, RIBBON_ANCHOR.z);
  } else if (pos === 'c') {
    // 中央（頭のてっぺん）。少し上げて、頭にめり込まないようにする。
    // ⚠ 羽根は結び目から片側へ伸びる形なので、結び目を x=0 に置くと**見た目は右寄り**になる。
    //   実測した見た目の中心（+0.07）ぶん戻して、正面から見て真ん中に来るようにする
    outer.position.set(-0.07, RIBBON_ANCHOR.y + 0.04, RIBBON_ANCHOR.z - 0.02);
  } else {
    outer.position.copy(RIBBON_ANCHOR);
  }
  return outer;
}

export function createGlbAvatar(config) {
  const {
    bodyColor = '#ffdbac',
    hairColor = '#3a2a1e',
    shirtColor = '#f2f2f4',
    eyeColor = '',
    // 目の色（2026-08-07に4つへ分割・loyさん「分かれてるならそれぞれ選べる方がいい」）。
    //   eyeColor      … 本人の左目・下（従来の「目の色」。互換のため名前を変えない）
    //   eyeTopColor   … 本人の左目・上（従来は黒で固定だった）
    //   eyeColorR / eyeTopColorR … 本人の右目。**VIP・管理者だけ**が左と別の色にできる
    // 左右を分けない人は R 側に同じ色が入る（eyeSplit で切り替える）
    eyeTopColor = '',
    eyeColorR = '',
    eyeTopColorR = '',
    // タイツ（脚）の色。空なら服の色から作る（従来どおり）
    tightsColor = '',
    // リボンの付け方（2026-08-07追加）。位置は本人から見た左右
    ribbonPos = 'l',   // 'l' 左 / 'c' 中央 / 'r' 右
    ribbonSize = 'sm', // 'sm' 小（従来）/ 'lg' 大
    // 髪の飾り（2026-08-07追加・管理者とVIPだけ）。空なら付けない
    hairGradColor = '',   // 毛先へ向かって移る色（グラデ）
    penlightColor = '',
    // 前髪メッシュの色（2026-08-06追加）。髪のカラーパレットから選ぶ
    meshColor = '',
    height = 'mid',
    name = '',
    badge = '', // '' | 'admin' | 'vip' | 'npc' … ネームプレートの見た目を変える
  } = config || {};

  const root = new THREE.Group();
  root.name = 'avatar';
  // 身長（2026-08-03追加）。root ごと拡大縮小するので、
  // 頭の上のネームプレート・吹き出し・持ち物も一緒に付いてくる。
  // ⚠ エモートの中で root.scale を触っている箇所（jump/hop の潰し）があるので、
  //   そこは「身長 × 潰し」になるよう resetPose 側で基準に戻している
  const heightScale = GLB_HEIGHTS[height] || 1;
  root.scale.setScalar(heightScale);
  const body = new THREE.Group(); // 上下バウンド・傾き用
  root.add(body);

  // ---- 色の決定 ----
  // タイツ（脚）の色（2026-08-07・loyさん「服（トップス）と脚のタイツで色分けたい」）。
  // 未指定なら今までどおり**服の色を暗くしたもの**を使う（古い設定でも見た目が変わらない）
  const bottomColor = tightsColor
    ? new THREE.Color(tightsColor)
    : new THREE.Color(shirtColor).multiplyScalar(0.3);
  // 目の色: 指定があればそれを使い、なければ髪色から導出（旧config互換）
  const eyeIrisColor = eyeColor
    ? new THREE.Color(eyeColor)
    : new THREE.Color(hairColor).lerp(new THREE.Color('#93242e'), 0.55);
  // 目の上（旧・固定の黒）。未指定なら従来の色をそのまま使うので、古い設定でも見た目は変わらない
  const EYE_TOP_DEFAULT = '#191219';
  const eyeTop = new THREE.Color(eyeTopColor || EYE_TOP_DEFAULT);
  // 右目。指定が無ければ左と同じ（＝左右を分けていない人）
  const eyeIrisColorR = eyeColorR ? new THREE.Color(eyeColorR) : eyeIrisColor;
  const eyeTopR = new THREE.Color(eyeTopColorR || eyeTopColor || EYE_TOP_DEFAULT);
  // ペンライトの色は本人が選んだ色。未指定の設定（古いクライアント等）では服の色から作る。
  // 光って見せたいので、選んだ色を少し白に寄せて明るくする
  const accentColorForPenlight = new THREE.Color(penlightColor || shirtColor).lerp(
    new THREE.Color('#ffffff'),
    0.3,
  );
  // 前髪メッシュを付けているか（アクセサリーの一つ）
  const hasStreak = parseAccessories((config || {}).accessory).includes('mesh');
  const streakColor = hasStreak ? (meshColor || '#141414') : '';
  // 髪の飾り（2026-08-07追加・運営専用）。形の数値化は hairfx.js が受け持つ
  const streakShapeParams = streakShape(config || {});
  const hasFx = Boolean(streakColor || hairGradColor);

  const MAT_BUILDERS = {
    MatHair: () => {
      const m = toon(hairColor);
      // 何も付けていない人はシェーダーに触らない（余計な再コンパイルを避ける）
      if (!hasFx) return m;
      return applyHairFx(m, {
        streak: streakColor,
        shape: streakShapeParams,
        grad: hairGradColor,
      });
    },
    MatSkin: () => toon(bodyColor),
    MatCloth: () => toon(shirtColor),
    MatDark: () => toon(bottomColor, 0.35),
    MatEye: () => toon(eyeTop, 0.3),
    MatEyeC: () => toon(eyeIrisColor, 0.45),
    // 本人の右目（2026-08-07にグループを分けた）
    MatEyeR: () => toon(eyeTopR, 0.3),
    MatEyeCR: () => toon(eyeIrisColorR, 0.45),
    MatEyeGlint: () => tagNoBloom(new THREE.MeshBasicMaterial({ color: '#ffffff' })),
    MatCheek: () => toon('#ff96a0', 0.5),
    // 2026-08-03追加のアクセサリー用。
    // MatAcc … メガネ・サングラスのフレーム（服の色に引っ張られない固定の黒）
    // MatGlow … 天使の輪・羽（光って見える固定色）
    MatAcc: () => toon('#14141c', 0.15),
    MatGlow: () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
      }),
  };

  // ---- 可動パーツ参照（読み込み後に埋まる） ----
  let armL = null;
  let armR = null;
  let legL = null;
  let legR = null;
  let eyeGroup = null;
  let loaded = false;

  const partKeys = partsFor(config || {});
  Promise.all(partKeys.map(loadPart)).then((templates) => {
    const meshes = [];
    // リボンだけは付け方（位置・大きさ）を変えられるので、どのパーツ由来かを覚えておく
    const ribbonMeshes = [];
    templates.forEach((template, i) => {
      const inst = template.clone(true);
      inst.updateMatrixWorld(true);
      inst.traverse((o) => {
        if (!o.isMesh) return;
        meshes.push(o);
        if (partKeys[i] === 'acc_ribbon') ribbonMeshes.push(o);
      });
    });

    const eyeMeshes = [];
    for (const mesh of meshes) {
      // 影は落とさない・受けない（フラットな見た目＆シャドウマップ負荷の削減）
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const matName = mesh.material?.name || '';
      const builder = MAT_BUILDERS[matName];
      if (builder) mesh.material = builder();

      const oname = mesh.name; // OBJ由来: hair/skin/cloth/armL/armR/legL/legR/eye/eyec/eyew/cheek
      if (oname === 'armL' || oname === 'armR' || oname === 'legL' || oname === 'legR') {
        // 注意: GLBの各ノードは回転(X+90°)を持ちジオメトリ座標系が別物。
        // 支点は必ずワールド座標のボックスから取る（ジオメトリBBは使わない）
        const wb = new THREE.Box3().setFromObject(mesh);
        const pivot = new THREE.Vector3((wb.min.x + wb.max.x) / 2, wb.max.y, (wb.min.z + wb.max.z) / 2);
        const g = wrapWithPivot(mesh, pivot);
        g.userData.basePos = g.position.clone();
        body.add(g);
        if (oname === 'armL') armL = g;
        if (oname === 'armR') armR = g;
        if (oname === 'legL') legL = g;
        if (oname === 'legR') legR = g;
        continue;
      }
      if (oname === 'eye' || oname === 'eyec' || oname === 'eyew'
        || oname === 'eyeR' || oname === 'eyecR') {
        eyeMeshes.push(mesh);
        continue;
      }
      if (ribbonMeshes.includes(mesh)) {
        body.add(wrapRibbon(mesh, ribbonPos, ribbonSize));
        continue;
      }
      body.add(mesh);
    }
    // まばたき: 目の3層をまとめて縦につぶす
    if (eyeMeshes.length) {
      eyeGroup = new THREE.Group();
      const pivot = new THREE.Vector3(0, 0.775, 0.24);
      eyeGroup.position.copy(pivot);
      for (const m of eyeMeshes) {
        m.position.sub(pivot);
        eyeGroup.add(m);
      }
      body.add(eyeGroup);
    }
    loaded = true;
  });

  // ---- ネームプレート ----
  const NAME_Y = 1.44;
  let nameSprite = null;
  let namesVisible = true;
  if (name) {
    const style = NAME_STYLES[badge] || NAME_STYLES.default;
    nameSprite = createTextSprite(style.prefix + name, {
      fontSize: 26,
      textColor: style.textColor,
      bgColor: style.bgColor,
      borderColor: style.borderColor,
      maxTextWidth: 260,
      maxLines: 1,
    });
    nameSprite.position.set(0, NAME_Y, 0);
    // 自分の姿の小窓には映さない目印（2026-08-04追加・selfview.js が見る）。
    // loyさん「エモートがわかればいいと思うから名前と吹き出しはいらないかな」
    nameSprite.userData.uiSprite = true;
    body.add(nameSprite);
  }

  // ---- 吹き出し ----
  let speechSprite = null;
  let speechTimer = null;
  function clearSpeech() {
    if (speechTimer) {
      clearTimeout(speechTimer);
      speechTimer = null;
    }
    if (speechSprite) {
      body.remove(speechSprite);
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
    speechSprite.position.set(0, name ? NAME_Y + 0.4 : NAME_Y, 0);
    // 名前と同じく、自分の姿の小窓には映さない（selfview.js が見る目印）
    speechSprite.userData.uiSprite = true;
    speechSprite.visible = namesVisible;
    body.add(speechSprite);
    // 表示時間は本人の設定に従う（既定8秒）。4秒固定では読み切れなかった
    // （loyさん 2026-08-03「もっと長くしないと読めない」）
    speechTimer = setTimeout(clearSpeech, bubbleMs());
  }

  /** UI非表示（Hキー）に合わせて、名前と吹き出しも消す */
  function setNameVisible(v) {
    namesVisible = Boolean(v);
    if (nameSprite) nameSprite.visible = namesVisible;
    if (speechSprite) speechSprite.visible = namesVisible;
  }

  // ---- アニメーション ----
  let moving = false;
  let walkT = 0;
  let idleT = Math.random() * 10;

  let blinking = false;
  let blinkElapsed = 0;
  let blinkTimer = 1 + Math.random() * 3;
  const BLINK_DURATION = 0.12;
  function updateBlink(dt) {
    if (!eyeGroup) return;
    if (blinking) {
      blinkElapsed += dt;
      if (blinkElapsed >= BLINK_DURATION) {
        blinking = false;
        eyeGroup.scale.y = 1;
        blinkTimer = 2 + Math.random() * 3.5;
      } else {
        eyeGroup.scale.y = 0.08;
      }
    } else {
      blinkTimer -= dt;
      if (blinkTimer <= 0) {
        blinking = true;
        blinkElapsed = 0;
      }
    }
  }

  // ---- 小道具: ペンライト（右手に持たせる） ----
  // 腕は肩を支点にした1本の円錐なので、手の位置＝腕の先端。
  // そこに棒を置き、腕の軸をそのまま延長する向きに合わせると「握っている」ように見える。
  let penlight = null;
  function ensurePenlight() {
    if (penlight || !mainHand().arm) return;
    const stick = new THREE.Group();

    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x2a2a34 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.07, 6), bodyMat);
    grip.position.y = 0.035;
    stick.add(grip);

    const glowMat = new THREE.MeshBasicMaterial({ color: accentColorForPenlight });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.19, 6), glowMat);
    tube.position.y = 0.165;
    stick.add(tube);

    // ふんわりした光（加算合成の板を十字に2枚）
    const auraMat = new THREE.MeshBasicMaterial({
      color: accentColorForPenlight,
      transparent: true,
      opacity: 0.33,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const ry of [0, Math.PI / 2]) {
      const aura = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.3), auraMat);
      aura.position.y = 0.165;
      aura.rotation.y = ry;
      stick.add(aura);
    }

    // 手の位置と腕の向き（GLB由来の実寸から求める）。
    // ⚠ 利き手に持たせる。xの符号は腕に合わせて反転する（2026-08-04）
    const h = mainHand();
    const hand = new THREE.Vector3(0.075 * h.sx, -0.235, 0.015);
    const dir = new THREE.Vector3(0.15 * h.sx, -0.2, 0.03).normalize();
    stick.position.copy(hand);
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    stick.visible = false;
    h.arm.add(stick);
    penlight = stick;
  }

  // ---- 小道具: ビールジョッキ（乾杯エモート用・2026-08-03追加） ----
  // ペンライトと同じで、右手の先に置いて腕の向きに合わせる。
  // 3Dアセットは増やさず、円柱と板だけで作る（遠目ではシルエットで読めれば十分）
  let mug = null;
  function ensureMug() {
    if (mug || !mainHand().arm) return;
    const g = new THREE.Group();
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xf0c24a });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.13, 8), glassMat);
    cup.position.y = 0.075;
    g.add(cup);
    // 泡
    const foam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.058, 0.035, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6e2 }),
    );
    foam.position.y = 0.155;
    g.add(foam);
    // 取っ手
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.042, 0.011, 5, 10, Math.PI * 1.2),
      glassMat,
    );
    handle.position.set(0.062, 0.075, 0);
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = Math.PI / 2;
    g.add(handle);

    // ⚠ ペンライトと同じく利き手に持たせる（2026-08-04）
    const h = mainHand();
    const hand = new THREE.Vector3(0.075 * h.sx, -0.235, 0.015);
    const dir = new THREE.Vector3(0.15 * h.sx, -0.2, 0.03).normalize();
    g.position.copy(hand);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.visible = false;
    h.arm.add(g);
    mug = g;
  }

  // ---- 小道具: ハート（ふわふわ浮かぶ） ----
  const hearts = [];
  let heartTexture = null;
  function makeHeartTexture() {
    if (heartTexture) return heartTexture;
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const c = cv.getContext('2d');
    c.fillStyle = '#ff5b86';
    c.beginPath();
    // ハート形（上の2つの丸＋下のV）
    c.moveTo(S * 0.5, S * 0.82);
    c.bezierCurveTo(S * 0.05, S * 0.5, S * 0.16, S * 0.13, S * 0.5, S * 0.32);
    c.bezierCurveTo(S * 0.84, S * 0.13, S * 0.95, S * 0.5, S * 0.5, S * 0.82);
    c.closePath();
    c.fill();
    heartTexture = new THREE.CanvasTexture(cv);
    heartTexture.colorSpace = THREE.SRGBColorSpace;
    return heartTexture;
  }
  // ---- スペシャルエモート用の絵柄（2026-08-03追加） ----
  //
  // ハートと同じ「Canvasに描いた絵をスプライトで飛ばす」方式にした。
  // Blenderで3Dパーツを作る手もあるが、
  //   ・読み込むファイルが増えて入場が遅くなる
  //   ・遠目では結局シルエットしか見えない
  // ので、軽さと視認性の両方でこちらが有利。色も自由に変えられる。
  const spriteTextures = new Map();
  function makeSpriteTexture(kind) {
    if (spriteTextures.has(kind)) return spriteTextures.get(kind);
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const c = cv.getContext('2d');

    if (kind === 'star') {
      // 五角の星。ライブでよく振られる「星」の見立て
      c.fillStyle = '#ffd84a';
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? S * 0.46 : S * 0.19;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = S / 2 + Math.cos(a) * r;
        const y = S / 2 + Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.fill();
    } else if (kind === 'smile') {
      // ニコニコマーク
      c.fillStyle = '#ffdc3c';
      c.beginPath();
      c.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2a2118';
      c.beginPath();
      c.arc(S * 0.36, S * 0.4, S * 0.07, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(S * 0.64, S * 0.4, S * 0.07, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = S * 0.08;
      c.strokeStyle = '#2a2118';
      c.lineCap = 'round';
      c.beginPath();
      c.arc(S / 2, S * 0.52, S * 0.24, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
    } else if (kind === 'spark') {
      // 花火の粒。中心が白く、外へいくほど色が薄くなる点
      const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,220,120,0.95)');
      g.addColorStop(1, 'rgba(255,120,60,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    spriteTextures.set(kind, tex);
    return tex;
  }

  /**
   * 絵柄を1つ飛ばす（ハートの仕組みを他の絵柄でも使えるようにしたもの）。
   * @param {'star'|'smile'|'spark'} kind
   * @param {object} opt 動きの調整
   */
  function spawnSprite(kind, opt = {}) {
    const mat = new THREE.SpriteMaterial({
      map: makeSpriteTexture(kind),
      transparent: true,
      depthWrite: false,
      opacity: 1,
      blending: kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.01, 0.01, 1);
    const px = opt.x !== undefined ? opt.x : (Math.random() - 0.5) * 0.5;
    const py = opt.y !== undefined ? opt.y : 0.5 + Math.random() * 0.2;
    sp.position.set(px, py, opt.z !== undefined ? opt.z : 0.34);
    sp.renderOrder = 900;
    body.add(sp);
    hearts.push({
      sprite: sp,
      size: opt.size !== undefined ? opt.size : 0.26 + Math.random() * 0.16,
      life: 0,
      ttl: opt.ttl !== undefined ? opt.ttl : 1.9 + Math.random() * 0.7,
      vy: opt.vy !== undefined ? opt.vy : 0.5 + Math.random() * 0.3,
      vx: opt.vx !== undefined ? opt.vx : 0,
      gravity: opt.gravity !== undefined ? opt.gravity : 0,
      sway: opt.sway !== undefined ? opt.sway : (Math.random() - 0.5) * 0.8,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function spawnHeart() {
    const mat = new THREE.SpriteMaterial({
      map: makeHeartTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const sp = new THREE.Sprite(mat);
    // 遠目でも「ハートを出している」と分かるよう大きめに。膨らんでから浮き上がる
    const size = 0.26 + Math.random() * 0.2;
    sp.scale.set(0.01, 0.01, 1);
    // 胸の前あたりから出す。顔にかぶらないよう、少し下・少し左右に散らす
    const side = Math.random() < 0.5 ? -1 : 1;
    sp.position.set(side * (0.12 + Math.random() * 0.3), 0.46 + Math.random() * 0.16, 0.36);
    sp.renderOrder = 900;
    body.add(sp);
    hearts.push({
      sprite: sp,
      size,
      life: 0,
      // 2026-08-03: 「もっと上空まで上がっていっていい（VRCのエモートみたいに）」
      // という指示で、寿命と上昇速度を大きくした。
      // 頭のかなり上（3〜4m）まで昇ってから消える
      ttl: 3.2 + Math.random() * 0.9,
      vy: 1.5 + Math.random() * 0.6,
      sway: (Math.random() - 0.5) * 0.8,
      phase: Math.random() * Math.PI * 2,
    });
  }
  function updateHearts(dt) {
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.life += dt;
      const k = h.life / h.ttl;
      if (k >= 1) {
        body.remove(h.sprite);
        h.sprite.material.dispose();
        hearts.splice(i, 1);
        continue;
      }
      // 花火は横に飛んで落ちるので、横速度と重力も扱えるようにしてある
      if (h.gravity) h.vy -= h.gravity * dt;
      h.sprite.position.y += h.vy * dt;
      h.sprite.position.x += (h.vx || 0) * dt;
      h.sprite.position.x += Math.sin(h.life * 3 + h.phase) * h.sway * dt;
      // 出たては勢いよく膨らみ（少し行き過ぎてから戻る）、最後にふっと消える
      const popT = Math.min(1, k / 0.18);
      const overshoot = 1 + Math.sin(popT * Math.PI) * 0.35;
      const s = h.size * popT * overshoot;
      h.sprite.scale.set(s, s, 1);
      h.sprite.material.opacity = 1 - k * k;
    }
  }
  function clearHearts() {
    for (const h of hearts) {
      body.remove(h.sprite);
      h.sprite.material.dispose();
    }
    hearts.length = 0;
  }

  // ---- エモート ----
  // hop … Spaceキーで実際に跳んだことを他の人へ見せるための1回だけのジャンプ。
  //        エモートバーには出さない（内部専用・2026-08-03追加）。
  //        長さ 0.72秒 は controls.js の物理そのまま（初速5.0 / 重力14.0 → 滞空 10/14秒）。
  //        ここを合わせないと、本人の画面と他人の画面で跳び方が食い違う
  // ⚠ penlight は 2026-08-04 に 0.6秒(1振り) → 1.8秒(3振り) へ変更（loyさん要望）。
  //   1振りぶんの速さは変えていない（0.6秒 × 3）。server/server.js と必ず同じ値にすること
  const EMOTE_DURATIONS = { wave: 2.5, clap: 2.5, jump: 2.0, dance: 4.0, heart: 3.0, penlight: 1.8, hop: 0.72,
    // ---- スペシャルエモート（2ページ目・2026-08-03追加）----
    fist: 1.4,      // コブシを上げる
    smile: 2.2,     // ニコニコマーク
    headbang: 2.0,  // ヘッドバンキング
    star: 2.4,      // 星
    firework: 2.6,  // 花火
    cheers: 2.2,    // 乾杯（ビール）
  };
  // 他人のジャンプを再現するための値（controls.js と同じ）
  // 花火の打ち上げ（2026-08-03）。玉が昇る時間と、開く高さ（アバターの頭上からの距離）
  const LAUNCH_SEC = 0.75;
  const BURST_Y = 3.4;
  /**
   * 連投で「続きとして繋げてよい」エモート（2026-08-03 loyさん指示）。
   *
   * > ハート、星、ニコニコ、花火みたいになにかが出るものは連投だと邪魔くさいから
   * > それ以外はOK
   *
   * 何かを出すもの（heart / star / smile / firework）は入れない。
   * 連投されると画面が埋まってしまうため、最後の1回だけ再生する。
   */
  const REPEATABLE = new Set([
    'wave', 'clap', 'jump', 'dance', 'penlight', 'hop', 'fist', 'headbang', 'cheers',
  ]);
  /** 1回の入力で繰り返せる上限。1人が延々と占有しないための歯止め */
  const MAX_REPEAT = 10;
  /**
   * エモートごとの繰り返し上限（2026-08-04追加）。
   *
   * ペンライトを1回3振り（1.8秒）にしたので、そのまま10回まで繋ぐと
   * **弾幕1回で18秒振り続ける**ことになり長すぎる。
   * 4回（＝12振り・7.2秒）に絞る。変更前が 0.6秒×10＝6秒だったので、体感はほぼ同じ。
   * ⚠ server/server.js の EMOTE_MAX_REPEAT と必ず同じ値にすること
   */
  const EMOTE_MAX_REPEAT = { penlight: 4 };
  const maxRepeatFor = (id) => EMOTE_MAX_REPEAT[id] || MAX_REPEAT;
  /** ペンライト1回ぶんの振り数。EMOTE_DURATIONS.penlight = 0.6 × これ */
  const PENLIGHT_SWINGS = 3;

  const HOP_V0 = 5.0;
  const HOP_G = 14.0;
  let emoteId = null;
  let emoteT = 0;
  /** いまのエモートが終わる時刻（秒）。繰り返しのぶんだけ伸びる */
  let emoteEnd = 0;
  let lastBeat = -1; // 拍手音を1打につき1回だけ鳴らすための直前の拍番号
  let heartCount = 0; // これまでに出したハートの数
  const ease = (t, dur, edge) => Math.min(1, Math.min(t, dur - t) / edge);

  function resetPose() {
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    root.scale.setScalar(heightScale);
    for (const p of [armL, armR, legL, legR]) {
      if (p) {
        p.rotation.set(0, 0, 0);
        if (p.userData.basePos) p.position.copy(p.userData.basePos);
      }
    }
    if (penlight) penlight.visible = false;
    if (mug) mug.visible = false;
    heartCount = 0;
  }
  // 腕が短く頭が大きいので、前挙げ系エモート中は支点ごと少し前・外に出して
  // シルエットから見えるようにする（sx: -1=左腕, 1=右腕）
  function pushArmOut(p, sx, env) {
    if (!p || !p.userData.basePos) return;
    p.position.set(
      p.userData.basePos.x + sx * 0.05 * env,
      p.userData.basePos.y,
      p.userData.basePos.z + 0.09 * env,
    );
  }

  // ---- 腕の向きは「角度」ではなく「手を向けたい方向」で指定する ----
  // 腕は肩を支点にした1本の錐なので、オイラー角で書くと回転の向きを取り違えやすい
  // （実際に左右逆にして腕が体の裏に回る不具合を出した）。
  // 何もしていないときの腕の向きから目標方向へ回す、という書き方にして意図をそのまま残す。
  const ARM_REST_R = new THREE.Vector3(0.075, -0.235, 0.015).normalize(); // 右腕の自然な向き
  const ARM_REST_L = new THREE.Vector3(-0.075, -0.235, 0.015).normalize();
  const _aimTmp = new THREE.Vector3();
  const _aimQuat = new THREE.Quaternion();
  /**
   * 腕をある方向へ向ける。
   * @param {THREE.Object3D} arm armL / armR
   * @param {number} sx -1=左腕 / 1=右腕
   * @param {number[]} dir 向けたい方向（体のローカル座標。x=右, y=上, z=前）
   * @param {number} env 0〜1。0なら自然な姿勢、1なら指定方向へ完全に向く
   */
  function aimArm(arm, sx, dir, env = 1) {
    if (!arm) return;
    const rest = sx > 0 ? ARM_REST_R : ARM_REST_L;
    _aimTmp.set(dir[0], dir[1], dir[2]).normalize();
    _aimQuat.setFromUnitVectors(rest, _aimTmp);
    arm.quaternion.identity().slerp(_aimQuat, Math.max(0, Math.min(1, env)));
  }

  // ---- 利き手（2026-08-04追加）----
  //
  // ★ **GLB内の名前と実体が逆**。`armR` は実際には**アバターの左腕**。
  //   実測（rotation.y=0 のとき armR の中心が x=+0.18、armL が x=-0.18）。
  //   アバターの前方は +z なので、右手は -x 側＝`armL` の方。
  //   そのため片手のエモートが全部**左手**になっていた（loyさん指摘・VRChat側は右手）。
  //
  // ⚠ ここで名前を付け替えず、**「実際の右手／左手」を返す入口**を作って
  //   エモート側はそれだけを使う。GLBの名前を書き換えるとモデル側の
  //   パイプライン（tools/gen_avatar_obj.mjs → Blender）まで直すことになる。
  //
  // side / x成分の符号:
  //   実際の右手(armL) … side=-1、方向のxは反転して渡す
  //   実際の左手(armR) … side=+1、方向のxはそのまま
  const HANDED = config.handedness === 'left' ? 'left' : 'right';
  /** 片手のエモートで使う腕。既定は右利き */
  function mainHand() {
    return HANDED === 'left'
      ? { arm: armR, side: 1, sx: 1 }
      : { arm: armL, side: -1, sx: -1 };
  }
  /** 利き手を、向けたい方向つきで動かす（xの符号は利き手に合わせて反転する） */
  function aimMainHand(dir, env = 1) {
    const h = mainHand();
    aimArm(h.arm, h.side, [dir[0] * h.sx, dir[1], dir[2]], env);
  }
  /** 利き手を体の外側へ開く */
  function pushMainHandOut(env) {
    const h = mainHand();
    pushArmOut(h.arm, h.side, env);
  }
  /**
   * エモートを再生する。
   *
   * @param {string} id エモートid
   * @param {number} [repeat=1] 繰り返す回数（YouTubeの弾幕などでまとめて来たとき）
   *
   * 2026-08-03 追加（loyさん）:
   *   > アニメーション中に次の入力があった場合はアニメーション継続にできる？
   *   > 今って1回1回途切れてるから。
   *   以前は毎回 resetPose() してから0秒目に戻していたので、連投すると
   *   1回ごとに腕が下りて上がる＝途切れて見えていた。
   *   **同じエモートが再生中なら、リセットせずに残り時間を足す**ようにした。
   *   これで「絵文字10個の弾幕＝10回ぶん振り続ける」が成立する。
   *
   * ⚠ 何かが出るもの（ハート・星・ニコニコ・花火）は繰り返さない。
   *   連投されると画面が埋まって邪魔になる（loyさん指示）。
   */
  function playEmote(id, repeat = 1) {
    if (!EMOTE_DURATIONS[id]) return;
    const times = REPEATABLE.has(id)
      ? Math.max(1, Math.min(maxRepeatFor(id), Math.floor(repeat) || 1))
      : 1;

    // 同じものが再生中なら、続きとして時間を足す（ポーズは崩さない）
    if (emoteId === id && REPEATABLE.has(id) && emoteEnd > emoteT) {
      emoteEnd += EMOTE_DURATIONS[id] * times;
      return;
    }

    resetPose();
    emoteId = id;
    emoteT = 0;
    emoteEnd = EMOTE_DURATIONS[id] * times;
    lastBeat = -1;
    if (id === 'penlight') {
      ensurePenlight();
      if (penlight) penlight.visible = true;
    }
    if (id === 'cheers') {
      ensureMug();
      if (mug) mug.visible = true;
    }
  }
  function applyEmote(id, t, dur) {
    switch (id) {
      case 'wave': {
        // 手を振る。腕を高く上げてから、画面の左右方向に大きく倒す。
        // 前後に振ると正面から見て動きがほぼ見えないので、必ず左右に振ること。
        // 振れ幅は必ず体の外側に置く。内側まで振ると腕が頭の裏に回って見えなくなる
        const env = ease(t, dur, 0.3);
        const swing = Math.sin(t * 7.0);
        // 髪の外側まで手を出す。真上に上げると髪に隠れるので斜め45度くらいに開く
        aimMainHand([0.82 + swing * 0.3, 0.6, 0.38], env);
        pushMainHandOut(env);
        // 反対の手は自然に下ろしたまま
        body.rotation.z = -swing * 0.045 * env;
        body.position.y = Math.abs(swing) * 0.008 * env;
        break;
      }
      case 'clap': {
        // 拍手。両手を胸の前・体の中心線近くまで寄せて打ち合わせる。
        // 腕が肩から生えた1本の錐なので手は完全には重ならないが、
        // 「中心へ寄る往復＋打点の音」で拍手として読める。
        const env = ease(t, dur, 0.25);
        const beatPhase = t * 6.0; // 1秒あたり3打
        const open = (Math.sin(beatPhase * Math.PI) + 1) / 2; // 0=合わさる 1=開く
        // 肩幅(0.38m)より腕(0.25m)が短いので、腕を強く内側へ向けないと手は中心に来ない。
        // 外向きのまま開閉させても「肩をすくめている」ようにしか見えなかった。
        const conv = -0.78 + open * 0.6; // 合わさるとき大きく内向き、開くと浅くなる
        aimArm(armL, -1, [-conv, -0.34, 0.6], env);
        aimArm(armR, 1, [conv, -0.34, 0.6], env);
        pushArmOut(armL, -1, env);
        pushArmOut(armR, 1, env);
        body.position.y = -open * 0.012 * env;

        // 手が合わさった瞬間だけ1打鳴らす
        const beatIndex = Math.floor(beatPhase);
        if (beatIndex !== lastBeat && open < 0.25) {
          lastBeat = beatIndex;
          playClap();
        }
        break;
      }
      // Spaceキーで実際に跳んだとき、他の人の画面で同じ弧を描かせる。
      // ⤴️ボタンの jump（2秒で3回跳ねる）とは別物なので、混ぜないこと
      case 'hop': {
        const h = Math.max(0, HOP_V0 * t - 0.5 * HOP_G * t * t);
        body.position.y = h;
        // 踏み切りと着地で潰す。跳んでいる間は少し伸ばす
        const stretch = h / (HOP_V0 * HOP_V0 / (2 * HOP_G)); // 0=地面 1=頂点
        // 身長の倍率に「潰し」を掛け合わせる。
        // 1 を基準にすると、背の高い/低い人がジャンプした瞬間だけ標準の背丈に戻ってしまう
        root.scale.set(
          heightScale * (1 - stretch * 0.05),
          heightScale * (1 + stretch * 0.08),
          heightScale * (1 - stretch * 0.05),
        );
        if (armL) armL.rotation.x = stretch * 0.7;
        if (armR) armR.rotation.x = stretch * 0.7;
        break;
      }
      case 'jump': {
        const period = dur / 3;
        const phase = (t % period) / period;
        const h = Math.sin(Math.PI * phase);
        body.position.y = h * 0.3;
        root.scale.set(
          heightScale * (1 + (0.3 - h) * 0.08),
          heightScale * (1 + (h - 0.3) * 0.12),
          heightScale * (1 + (0.3 - h) * 0.08),
        );
        // 腕は後ろへ流す（万歳は頭に埋まって見えない）
        if (armL) armL.rotation.x = h * 0.7;
        if (armR) armR.rotation.x = h * 0.7;
        break;
      }
      case 'dance': {
        const env = ease(t, dur, 0.3);
        const waist = Math.sin(t * 3.2) * 0.22 * env;
        body.rotation.z = waist;
        body.position.y = Math.abs(Math.sin(t * 6.4)) * 0.035 * env;
        // 腕は前後に大きく振る（横上げは頭に埋まる）
        if (armL) armL.rotation.x = Math.sin(t * 3.2) * 1.1 * env;
        if (armR) armR.rotation.x = -Math.sin(t * 3.2) * 1.1 * env;
        break;
      }
      case 'heart': {
        // ♥マークがふわふわ出る演出が主役。腕は「胸に手を当てる」控えめな添え方にして、
        // ハグに見えないようにする（腕を大きく回すとハグの形になってしまう）
        const env = ease(t, dur, 0.35);
        const breathe = Math.sin(t * 2.6) * 0.05;
        // 胸の前に軽く手を添える（腕を大きく回すとハグの形になってしまう）
        aimArm(armL, -1, [-0.10, -0.52 + breathe, 0.85], env);
        aimArm(armR, 1, [0.10, -0.52 + breathe, 0.85], env);
        body.rotation.x = 0.05 * env;
        body.position.y = Math.sin(t * 2.6) * 0.012 * env;

        // 一定間隔でハートを足す（終わりぎわは出さず、余韻で消えていくようにする）
        const spawnEvery = 0.13;
        const shouldHave = Math.floor(Math.min(t, dur - 0.7) / spawnEvery);
        if (shouldHave > heartCount) {
          heartCount = shouldHave;
          spawnHeart();
        }
        break;
      }
      case 'penlight': {
        // ライブの客席の振り方。腕は**最初から上がっている**状態で、左右に1往復する。
        //
        // 2026-08-03 変更（loyさん）:
        //   > 持ち上げるのをなくして、振るアニメーションだけなら
        //   > 連打すれば振り続けられるからライブっぽくなるんじゃない？
        //   以前は 4秒かけて「下から持ち上げてゆっくり2往復」だったので、
        //   連打しても持ち上げからやり直しになり、振り続けられなかった。
        //
        // 2026-08-04 変更（loyさん）:
        //   > ペンライトのエモートは1振りじゃなくて1回で3振り（ジャンプエモートと同じように）
        //   1回押すと **3往復**（1.8秒）。1往復ぶんの速さは前と同じ 0.6秒のままで、
        //   回数だけ増やしてある（速くすると振りが忙しなくなる）。
        //
        // ⚠ 立ち上がり（ease）を掛けない。掛けると押すたびに腕が下がって上がるので、
        //   連打しても「振り続けている」ようには見えない。
        // ⚠ sin は t=0 と t=dur の両方で 0（＝中央）になるようにしてある。
        //   始まりと終わりの姿勢が同じなので、連打しても繋ぎ目が目立たない。
        //   PENLIGHT_SWINGS が整数である限りこれは保たれる
        const cycle = (t / dur) * Math.PI * 2 * PENLIGHT_SWINGS;
        const swing = Math.sin(cycle);
        aimMainHand([0.66 + swing * 0.4, 0.88, 0.3], 1);
        // 体を軽く沈めて拍を取る（振りの折り返しでいちばん沈む）
        body.position.y = -Math.abs(Math.cos(cycle)) * 0.02;
        body.rotation.z = -swing * 0.055;
        break;
      }
      // ================= スペシャルエモート（2ページ目・2026-08-03追加） =================
      case 'fist': {
        // コブシを上げる。真上へ突き上げて、拍に合わせて2回押し上げる。
        // 腕を体の外側へ開いてから上げないと、頭の裏に回って正面から見えない
        const env = ease(t, dur, 0.18);
        const pump = Math.max(0, Math.sin(t * 7.5)); // 突き上げは「上げて戻す」の片側だけ
        aimMainHand([0.34, 1.0 + pump * 0.22, 0.16], env);
        pushMainHandOut(env);
        body.position.y = pump * 0.045 * env;
        body.rotation.z = -0.03 * env;
        break;
      }
      case 'smile': {
        // ニコニコマークを出す。体は軽く左右に揺れるだけで、主役は出てくるマーク
        const env = ease(t, dur, 0.3);
        body.rotation.z = Math.sin(t * 2.4) * 0.05 * env;
        body.position.y = Math.abs(Math.sin(t * 2.4)) * 0.015 * env;
        // 一定の間隔で出す（毎フレーム出すと画面が埋まる）
        if (Math.floor(t * 3) !== lastBeat) {
          lastBeat = Math.floor(t * 3);
          spawnSprite('smile', { size: 0.3, ttl: 3.0, vy: 1.5, y: 0.62 });
        }
        break;
      }
      case 'headbang': {
        // ヘッドバンキング。首だけ動かす仕組みが無いので、上体を前後に大きく振る。
        // 腕は体の横で軽く畳んで、ノリを出す
        const env = ease(t, dur, 0.15);
        const beat = Math.sin(t * 9.0);
        body.rotation.x = (0.34 + beat * 0.34) * env; // 常に前傾ぎみで、拍で深く振る
        body.position.y = -Math.abs(beat) * 0.05 * env;
        if (armL) armL.rotation.x = (-0.5 - beat * 0.25) * env;
        if (armR) armR.rotation.x = (-0.5 - beat * 0.25) * env;
        break;
      }
      case 'star': {
        // 星。両手を上げて、星をぱらぱら出す
        const env = ease(t, dur, 0.25);
        const sway = Math.sin(t * 3.0);
        aimArm(armL, -1, [-0.5 - sway * 0.2, 0.9, 0.25], env);
        aimArm(armR, 1, [0.5 - sway * 0.2, 0.9, 0.25], env);
        pushArmOut(armL, -1, env);
        pushArmOut(armR, 1, env);
        body.rotation.z = sway * 0.05 * env;
        if (Math.floor(t * 5) !== lastBeat) {
          lastBeat = Math.floor(t * 5);
          spawnSprite('star', {
            size: 0.16 + Math.random() * 0.12,
            ttl: 3.0,
            vy: 1.6 + Math.random() * 0.5,
            y: 0.9 + Math.random() * 0.3,
            x: (Math.random() - 0.5) * 0.8,
          });
        }
        break;
      }
      case 'firework': {
        // 花火。頭上で一度だけ大きく弾けさせ、粒が放物線で散る。
        // 何度も弾けると花火に見えないので、打ち上げ→開く の1回にしている
        const env = ease(t, dur, 0.2);
        aimArm(armL, -1, [-0.45, 0.95, 0.2], env);
        aimArm(armR, 1, [0.45, 0.95, 0.2], env);
        pushArmOut(armL, -1, env);
        pushArmOut(armR, 1, env);
        // 2026-08-03: 「花火は打ち上る感じにして」（loyさん）。
        // その場で弾けるのではなく、①玉が真上へ昇る → ②上空で開く、の2段にした
        if (lastBeat < 0 && t > 0.15) {
          lastBeat = 0; // 打ち上げ済みの印
          // ① 打ち上げの玉。まっすぐ速く昇り、開く高さで消える
          spawnSprite('spark', {
            size: 0.13,
            ttl: LAUNCH_SEC,
            x: 0,
            y: 1.5,
            vy: BURST_Y / LAUNCH_SEC,
            sway: 0,
          });
        }
        if (lastBeat === 0 && t > 0.15 + LAUNCH_SEC) {
          lastBeat = 1; // 開いた印（1回だけ）
          // ② 上空で開く。粒は放物線で散って落ちる
          for (let i = 0; i < 26; i++) {
            const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
            const sp = 1.5 + Math.random() * 0.9;
            spawnSprite('spark', {
              size: 0.18 + Math.random() * 0.12,
              ttl: 1.8 + Math.random() * 0.6,
              x: 0,
              y: 1.5 + BURST_Y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              gravity: 1.6,
              sway: 0,
            });
          }
        }
        break;
      }
      case 'cheers': {
        // 乾杯。ジョッキを持った右手を前へ差し出し、軽く打ち合わせる仕草を2回。
        // 上げっぱなしにせず「合わせて戻す」を繰り返すことで乾杯に見せる
        const env = ease(t, dur, 0.2);
        const toast = Math.max(0, Math.sin(t * 4.2));
        aimMainHand([0.3 + toast * 0.16, 0.42 + toast * 0.3, 0.62], env);
        pushMainHandOut(env * 0.6);
        body.position.y = toast * 0.02 * env;
        body.rotation.z = -toast * 0.04 * env;
        break;
      }
      default:
        break;
    }
  }

  function setMoving(v) {
    const val = !!v;
    if (val && emoteId) {
      resetPose();
      emoteId = null;
    }
    moving = val;
  }

  function update(dt) {
    if (!loaded) return;
    updateBlink(dt);
    // ハートはエモートが終わったあとも浮かび続けて消える
    if (hearts.length) updateHearts(dt);

    if (emoteId) {
      const dur = EMOTE_DURATIONS[emoteId];
      emoteT += dt;
      if (emoteT >= emoteEnd) {
        resetPose();
        emoteId = null;
      } else {
        // 繰り返しているときは、1周ぶんの中の位置に折り返して渡す。
        // こうすると各アニメーションは「1周だけ」を書いたままで繰り返せる。
        // ⚠ 花火のように「1回だけ」の作りをしているものは REPEATABLE に入れていないので、
        //   ここを通っても times=1 のまま＝従来どおり
        const phase = REPEATABLE.has(emoteId) ? emoteT % dur : emoteT;
        applyEmote(emoteId, phase, dur);
        return;
      }
    }

    const easeT = Math.min(1, dt * 8);
    if (moving) {
      walkT += dt * 9;
      const swing = Math.sin(walkT);
      if (legL) legL.rotation.x = swing * 0.5;
      if (legR) legR.rotation.x = -swing * 0.5;
      if (armL) armL.rotation.x = -swing * 0.4;
      if (armR) armR.rotation.x = swing * 0.4;
      body.position.y = Math.abs(Math.sin(walkT)) * 0.04;
      body.rotation.z = Math.sin(walkT) * 0.04;
    } else {
      idleT += dt;
      if (legL) legL.rotation.x += (0 - legL.rotation.x) * easeT;
      if (legR) legR.rotation.x += (0 - legR.rotation.x) * easeT;
      if (armL) armL.rotation.x += (Math.sin(idleT * 1.4) * 0.06 - armL.rotation.x) * easeT;
      if (armR) armR.rotation.x += (Math.sin(idleT * 1.4 + Math.PI) * 0.05 - armR.rotation.x) * easeT;
      body.position.y += (Math.sin(idleT * 1.6) * 0.012 - body.position.y) * easeT;
      body.rotation.z += (Math.sin(idleT * 0.3) * 0.015 - body.rotation.z) * easeT;
    }
  }

  root.userData.update = update;
  root.userData.setMoving = setMoving;
  root.userData.say = say;
  root.userData.playEmote = playEmote;
  root.userData.setNameVisible = setNameVisible;

  return root;
}
