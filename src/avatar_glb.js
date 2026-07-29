import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTextSprite } from './avatar.js';

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
export const GLB_OUTFITS = ['middle', 'long', 'short'];
export const GLB_ACCESSORIES = ['none', 'kemo', 'ahoge'];

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
  const hair = GLB_STYLES.includes(config.hairStyle) ? config.hairStyle : GLB_STYLES[0];
  const outfit = GLB_OUTFITS.includes(config.outfit) ? config.outfit : GLB_OUTFITS[0];
  const acc = GLB_ACCESSORIES.includes(config.accessory) ? config.accessory : 'none';
  const keys = [`body_${outfit}`, `hair_${hair}`];
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
    name = '',
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
  if (name) {
    const nameSprite = createTextSprite(name, {
      fontSize: 26,
      textColor: '#eafcff',
      bgColor: 'rgba(6, 8, 20, 0.6)',
      borderColor: 'rgba(0, 255, 234, 0.55)',
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
    body.add(speechSprite);
    speechTimer = setTimeout(clearSpeech, 4000);
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

  // ---- エモート（旧avatar.jsと同じid・尺） ----
  const EMOTE_DURATIONS = { wave: 2.5, clap: 2.5, jump: 2.0, dance: 4.0, heart: 3.0, penlight: 4.0 };
  let emoteId = null;
  let emoteT = 0;
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
  function playEmote(id) {
    if (!EMOTE_DURATIONS[id]) return;
    resetPose();
    emoteId = id;
    emoteT = 0;
  }
  function applyEmote(id, t, dur) {
    switch (id) {
      case 'wave': {
        // 頭が大きい（半径0.3）ので真横に上げると髪に埋まる。前方斜め上で振る
        const env = ease(t, dur, 0.3);
        if (armR) {
          armR.rotation.x = -1.15 * env;
          armR.rotation.z = -(0.7 * env + Math.sin(t * 9) * 0.45 * env);
          pushArmOut(armR, 1, env);
        }
        body.rotation.z = Math.sin(t * 9) * 0.03 * env;
        break;
      }
      case 'clap': {
        // 顔の前で手を合わせる
        const env = ease(t, dur, 0.25);
        const beat = Math.sin(t * 13) * 0.25 * env;
        if (armL) {
          armL.rotation.x = -1.25 * env;
          armL.rotation.z = 0.45 * env + beat;
          pushArmOut(armL, -1, env);
        }
        if (armR) {
          armR.rotation.x = -1.25 * env;
          armR.rotation.z = -0.45 * env - beat;
          pushArmOut(armR, 1, env);
        }
        body.position.y = Math.sin(t * 6.5) * 0.02 * env;
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
        // 両腕を顔の前に上げてハートの形に寄せる
        const env = ease(t, dur, 0.35);
        const pulse = Math.sin(t * 2.5) * 0.05 * env;
        if (armL) {
          armL.rotation.x = -1.45 * env;
          armL.rotation.z = (0.65 + pulse) * env;
          pushArmOut(armL, -1, env);
        }
        if (armR) {
          armR.rotation.x = -1.45 * env;
          armR.rotation.z = -(0.65 + pulse) * env;
          pushArmOut(armR, 1, env);
        }
        body.rotation.x = 0.08 * env;
        break;
      }
      case 'penlight': {
        const env = ease(t, dur, 0.3);
        if (armR) {
          armR.rotation.x = -1.0 * env;
          armR.rotation.z = -(0.6 * env + Math.sin(t * 10) * 0.5 * env);
          pushArmOut(armR, 1, env);
        }
        body.rotation.z = Math.sin(t * 10) * 0.02 * env;
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

  return root;
}
