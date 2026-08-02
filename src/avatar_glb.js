import * as THREE from 'three';
import { GUEST_HAIR } from './guestlook.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTextSprite } from './avatar.js';
import { playClap } from './sfx.js';
import { bubbleMs } from './bubbletime.js';

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
export const GLB_STYLES = ['long', 'bob', 'short', 'twin', 'bun', 'pony'];
// ※ ゲスト専用の「髪なし」は選択肢に入れない（選べてしまうと見分けにならない）
export const GLB_OUTFITS = ['middle', 'long', 'short'];
export const GLB_ACCESSORIES = ['none', 'kemo', 'ahoge'];

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
  const acc = GLB_ACCESSORIES.includes(config.accessory) ? config.accessory : 'none';
  const keys = [`body_${outfit}`];
  // ゲストは髪なし（2026-08-02）。アクセの 'none' と同じで、単に足さないだけ。
  // 新しい3Dアセットが要らないうえ、シルエットで一目でゲストと分かる
  if (config.hairStyle !== GUEST_HAIR) {
    const hair = GLB_STYLES.includes(config.hairStyle) ? config.hairStyle : GLB_STYLES[0];
    keys.push(`hair_${hair}`);
  }
  if (acc !== 'none') keys.push(`acc_${acc}`);
  return keys;
}

export function preloadAvatars() {
  for (const o of GLB_OUTFITS) loadPart(`body_${o}`);
  for (const h of GLB_STYLES) loadPart(`hair_${h}`);
  loadPart('acc_kemo');
  loadPart('acc_ahoge');
}

// メッシュを「回転の支点」付きのグループで包む（腕=付け根、脚=腰）
function wrapWithPivot(mesh, pivot) {
  const g = new THREE.Group();
  g.position.copy(pivot);
  mesh.position.sub(pivot);
  g.add(mesh);
  return g;
}

// フラット寄りの質感（ユーザー指定 2026-07-29: 影なしのフラットな方がかわいい）。
// エミッシブを高めにして、会場の照明で暗く沈まないようにする
function toon(color, emissiveScale = 0.42) {
  const mat = new THREE.MeshToonMaterial({ color });
  mat.emissive = new THREE.Color(color).multiplyScalar(emissiveScale);
  mat.side = THREE.DoubleSide; // 髪は開いたシェルなので両面必須
  return mat;
}

export function createGlbAvatar(config) {
  const {
    bodyColor = '#ffdbac',
    hairColor = '#3a2a1e',
    shirtColor = '#f2f2f4',
    eyeColor = '',
    penlightColor = '',
    name = '',
    badge = '', // '' | 'admin' | 'vip' | 'npc' … ネームプレートの見た目を変える
  } = config || {};

  const root = new THREE.Group();
  root.name = 'avatar';
  const body = new THREE.Group(); // 上下バウンド・傾き用
  root.add(body);

  // ---- 色の決定 ----
  const bottomColor = new THREE.Color(shirtColor).multiplyScalar(0.3);
  // 目の色: 指定があればそれを使い、なければ髪色から導出（旧config互換）
  const eyeIrisColor = eyeColor
    ? new THREE.Color(eyeColor)
    : new THREE.Color(hairColor).lerp(new THREE.Color('#93242e'), 0.55);
  // ペンライトの色は本人が選んだ色。未指定の設定（古いクライアント等）では服の色から作る。
  // 光って見せたいので、選んだ色を少し白に寄せて明るくする
  const accentColorForPenlight = new THREE.Color(penlightColor || shirtColor).lerp(
    new THREE.Color('#ffffff'),
    0.3,
  );
  const MAT_BUILDERS = {
    MatHair: () => toon(hairColor),
    MatSkin: () => toon(bodyColor),
    MatCloth: () => toon(shirtColor),
    MatDark: () => toon(bottomColor, 0.35),
    MatEye: () => toon('#191219', 0.3),
    MatEyeC: () => toon(eyeIrisColor, 0.45),
    MatEyeGlint: () => new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    MatCheek: () => toon('#ff96a0', 0.5),
  };

  // ---- 可動パーツ参照（読み込み後に埋まる） ----
  let armL = null;
  let armR = null;
  let legL = null;
  let legR = null;
  let eyeGroup = null;
  let loaded = false;

  Promise.all(partsFor(config || {}).map(loadPart)).then((templates) => {
    const meshes = [];
    for (const template of templates) {
      const inst = template.clone(true);
      inst.updateMatrixWorld(true);
      inst.traverse((o) => {
        if (o.isMesh) meshes.push(o);
      });
    }

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
      if (oname === 'eye' || oname === 'eyec' || oname === 'eyew') {
        eyeMeshes.push(mesh);
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
    if (penlight || !armR) return;
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

    // 手の位置と腕の向き（GLB由来の実寸から求める）
    const hand = new THREE.Vector3(0.075, -0.235, 0.015);
    const dir = new THREE.Vector3(0.15, -0.2, 0.03).normalize();
    stick.position.copy(hand);
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    stick.visible = false;
    armR.add(stick);
    penlight = stick;
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
      ttl: 1.9 + Math.random() * 0.7,
      vy: 0.5 + Math.random() * 0.3,
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
      h.sprite.position.y += h.vy * dt;
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
  const EMOTE_DURATIONS = { wave: 2.5, clap: 2.5, jump: 2.0, dance: 4.0, heart: 3.0, penlight: 4.0, hop: 0.72 };
  // 他人のジャンプを再現するための値（controls.js と同じ）
  const HOP_V0 = 5.0;
  const HOP_G = 14.0;
  let emoteId = null;
  let emoteT = 0;
  let lastBeat = -1; // 拍手音を1打につき1回だけ鳴らすための直前の拍番号
  let heartCount = 0; // これまでに出したハートの数
  const ease = (t, dur, edge) => Math.min(1, Math.min(t, dur - t) / edge);

  function resetPose() {
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    for (const p of [armL, armR, legL, legR]) {
      if (p) {
        p.rotation.set(0, 0, 0);
        if (p.userData.basePos) p.position.copy(p.userData.basePos);
      }
    }
    if (penlight) penlight.visible = false;
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
  function playEmote(id) {
    if (!EMOTE_DURATIONS[id]) return;
    resetPose();
    emoteId = id;
    emoteT = 0;
    lastBeat = -1;
    if (id === 'penlight') {
      ensurePenlight();
      if (penlight) penlight.visible = true;
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
        aimArm(armR, 1, [0.82 + swing * 0.3, 0.6, 0.38], env);
        pushArmOut(armR, 1, env);
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
        root.scale.set(1 - stretch * 0.05, 1 + stretch * 0.08, 1 - stretch * 0.05);
        if (armL) armL.rotation.x = stretch * 0.7;
        if (armR) armR.rotation.x = stretch * 0.7;
        break;
      }
      case 'jump': {
        const period = dur / 3;
        const phase = (t % period) / period;
        const h = Math.sin(Math.PI * phase);
        body.position.y = h * 0.3;
        root.scale.set(1 + (0.3 - h) * 0.08, 1 + (h - 0.3) * 0.12, 1 + (0.3 - h) * 0.08);
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
        // ライブの客席の振り方。腕を高く上げ、肩からゆっくり大きく左右に振る。
        // 速く小刻みに振ると何をしているか読めないので、拍に乗る速さにする。
        const env = ease(t, dur, 0.3);
        const swing = Math.sin(t * 4.0);
        // 腕を高く上げ、拍に乗せて大きく左右に振る（内側に入れると頭の裏に回る）
        aimArm(armR, 1, [0.66 + swing * 0.4, 0.88, 0.3], env);
        // 体を軽く沈めて拍を取る
        body.position.y = -Math.abs(Math.cos(t * 4.0)) * 0.02 * env;
        body.rotation.z = -swing * 0.055 * env;
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
      if (emoteT >= dur) {
        resetPose();
        emoteId = null;
      } else {
        applyEmote(emoteId, emoteT, dur);
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
