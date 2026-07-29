import * as THREE from 'three';
import { AVATAR_PARTS, randomConfig, createAvatar } from './avatar.js';

const HAIR_LABELS = {
  long: 'ロング',
  short: 'ショート',
  twin: 'ツインテール',
  bun: 'お団子',
  pony: 'ポニーテール',
  hat: 'ぼうし',
};

const OUTFIT_LABELS = {
  long: 'ロング',
  middle: 'ミドル',
  short: 'ショート',
};

const ACCESSORY_LABELS = {
  none: 'なし',
  kemo: 'けもみみ',
  ahoge: 'アホ毛',
};

const STYLE_ID = 'join-screen-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#join-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 30%, rgba(20, 10, 40, 0.55), rgba(4, 4, 12, 0.88) 70%);
  backdrop-filter: blur(4px);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif;
}

.join-panel {
  width: min(760px, 92vw);
  max-height: 92vh;
  overflow-y: auto;
  background: linear-gradient(160deg, rgba(12, 12, 28, 0.92), rgba(18, 8, 30, 0.92));
  border: 1px solid rgba(0, 255, 234, 0.35);
  border-radius: 18px;
  padding: 28px 32px 32px;
  box-shadow: 0 0 40px rgba(0, 255, 234, 0.15), 0 0 90px rgba(255, 0, 229, 0.08), inset 0 0 60px rgba(0, 255, 234, 0.04);
}

.join-title {
  margin: 0;
  text-align: center;
  font-size: 34px;
  letter-spacing: 6px;
  font-weight: 800;
  background: linear-gradient(90deg, #00ffea, #ff00e5);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 24px rgba(0, 255, 234, 0.35);
}

.join-subtitle {
  margin: 6px 0 22px;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(220, 235, 255, 0.6);
}

.join-body {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
}

.join-preview {
  flex: 0 0 auto;
  width: 300px;
  height: 300px;
  border-radius: 14px;
  background: radial-gradient(circle at 50% 30%, rgba(0, 255, 234, 0.12), rgba(6, 6, 16, 0.6) 75%);
  border: 1px solid rgba(0, 255, 234, 0.25);
  overflow: hidden;
  position: relative;
}

.join-preview canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.join-customize {
  flex: 1 1 320px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.customize-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.customize-label {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(0, 255, 234, 0.85);
  text-transform: uppercase;
}

.hairstyle-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hair-btn {
  padding: 7px 14px;
  font-size: 13px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.06);
  color: #eaf6ff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.hair-btn:hover {
  border-color: rgba(0, 255, 234, 0.6);
}

.hair-btn.selected {
  background: linear-gradient(90deg, rgba(0, 255, 234, 0.25), rgba(255, 0, 229, 0.2));
  border-color: #00ffea;
  color: #ffffff;
  box-shadow: 0 0 12px rgba(0, 255, 234, 0.4);
}

.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  cursor: pointer;
  box-sizing: border-box;
  transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.swatch:hover {
  transform: scale(1.1);
}

.swatch.selected {
  border-color: #ffffff;
  box-shadow: 0 0 0 2px rgba(0, 255, 234, 0.7), 0 0 12px rgba(0, 255, 234, 0.6);
  transform: scale(1.12);
}

#name-input {
  padding: 10px 12px;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid rgba(0, 255, 234, 0.35);
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
  outline: none;
}

#name-input:focus {
  border-color: #00ffea;
  box-shadow: 0 0 10px rgba(0, 255, 234, 0.4);
}

#name-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.join-btn-row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.join-btn {
  margin-top: 0;
  flex: 1 1 auto;
  padding: 14px 20px;
  font-size: 17px;
  font-weight: bold;
  letter-spacing: 4px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: #06060f;
  background: linear-gradient(90deg, #00ffea, #ff00e5);
  box-shadow: 0 0 18px rgba(0, 255, 234, 0.55), 0 0 34px rgba(255, 0, 229, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.join-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 26px rgba(0, 255, 234, 0.75), 0 0 46px rgba(255, 0, 229, 0.5);
}

.join-btn:active {
  transform: translateY(0);
}

.cancel-btn {
  flex: 0 0 auto;
  padding: 14px 20px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  cursor: pointer;
  color: rgba(230, 240, 255, 0.85);
  background: rgba(255, 255, 255, 0.08);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.45);
}

@media (max-width: 640px) {
  .join-panel { padding: 20px; }
  .join-preview { width: 100%; height: 240px; }
}
`;
  document.head.appendChild(style);
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function randomGuestName() {
  const n = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `ゲスト${n}`;
}

/**
 * 入場画面 / 再カスタム画面 共通のUI構築処理。
 * #join-screen 内にアバターカスタマイズ＋名前入力＋決定ボタンを構築し、
 * 決定/キャンセル時にプレビュー用WebGLレンダラーを確実に破棄する。
 */
function buildCustomizeScreen({
  title,
  subtitle,
  buttonLabel,
  showCancel,
  initialName,
  initialConfig,
  fallbackName,
  onSubmit,
  onCancel,
}) {
  injectStyle();

  const root = document.getElementById('join-screen');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="join-panel">
      <h1 class="join-title">${title}</h1>
      <p class="join-subtitle">${subtitle}</p>
      <div class="join-body">
        <div class="join-preview">
          <canvas id="avatar-preview-canvas"></canvas>
        </div>
        <div class="join-customize">
          <div class="customize-row">
            <div class="customize-label">髪型</div>
            <div class="hairstyle-buttons" id="hairstyle-buttons"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">服装</div>
            <div class="hairstyle-buttons" id="outfit-buttons"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">アクセサリー</div>
            <div class="hairstyle-buttons" id="accessory-buttons"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">肌色</div>
            <div class="swatch-row" id="bodycolor-swatches"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">髪色</div>
            <div class="swatch-row" id="haircolor-swatches"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">目の色</div>
            <div class="swatch-row" id="eyecolor-swatches"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">服色</div>
            <div class="swatch-row" id="shirtcolor-swatches"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">なまえ</div>
            <input type="text" id="name-input" maxlength="12" placeholder="なまえ" autocomplete="off" />
          </div>
          <div class="join-btn-row">
            <button type="button" id="join-btn" class="join-btn">${buttonLabel}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const nameInput = document.getElementById('name-input');
  if (initialName) {
    nameInput.value = initialName;
  }

  const joinBtnRow = document.querySelector('.join-btn-row');
  let cancelBtn = null;
  if (showCancel) {
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'cancel-btn';
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = 'キャンセル';
    joinBtnRow.appendChild(cancelBtn);
  }

  const config = { ...initialConfig };
  // 旧保存configとの互換: 新フィールドが無ければ既定を補い、廃止した髪型はフォールバック
  if (!AVATAR_PARTS.hairStyles.includes(config.hairStyle)) config.hairStyle = AVATAR_PARTS.hairStyles[0];
  if (!AVATAR_PARTS.outfits.includes(config.outfit)) config.outfit = AVATAR_PARTS.outfits[0];
  if (!AVATAR_PARTS.accessories.includes(config.accessory)) config.accessory = 'none';
  if (!AVATAR_PARTS.hairColors.includes(config.hairColor)) config.hairColor = AVATAR_PARTS.hairColors[1];
  if (!AVATAR_PARTS.shirtColors.includes(config.shirtColor)) config.shirtColor = AVATAR_PARTS.shirtColors[13];
  if (!AVATAR_PARTS.eyeColors.includes(config.eyeColor)) config.eyeColor = AVATAR_PARTS.eyeColors[1];

  // ---- プレビュー用の小さな3Dシーン ----
  const previewCanvas = document.getElementById('avatar-preview-canvas');
  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  previewCamera.position.set(0, 1.0, 3.0);
  previewCamera.lookAt(0, 0.8, 0);

  const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  previewRenderer.setSize(300, 300, false);

  const ambient = new THREE.AmbientLight(0x8899ff, 0.9);
  const keyLight = new THREE.DirectionalLight(0x00ffea, 1.1);
  keyLight.position.set(2, 3, 3);
  const rimLight = new THREE.DirectionalLight(0xff00e5, 0.8);
  rimLight.position.set(-2, 1.5, -2);
  previewScene.add(ambient, keyLight, rimLight);

  let previewAvatar = null;
  function rebuildPreviewAvatar() {
    if (previewAvatar) {
      previewScene.remove(previewAvatar);
      disposeObject3D(previewAvatar);
    }
    previewAvatar = createAvatar({ ...config });
    previewScene.add(previewAvatar);
  }
  rebuildPreviewAvatar();

  let previewRafId = null;
  const previewClock = new THREE.Clock();
  function renderPreviewLoop() {
    previewRafId = requestAnimationFrame(renderPreviewLoop);
    const dt = Math.min(previewClock.getDelta(), 0.1);
    if (previewAvatar) {
      previewAvatar.rotation.y += dt * 0.7;
      if (previewAvatar.userData.update) previewAvatar.userData.update(dt);
    }
    previewRenderer.render(previewScene, previewCamera);
  }
  renderPreviewLoop();

  function cleanupPreview() {
    if (previewRafId !== null) {
      cancelAnimationFrame(previewRafId);
      previewRafId = null;
    }
    if (previewAvatar) {
      disposeObject3D(previewAvatar);
      previewAvatar = null;
    }
    previewRenderer.dispose();
    previewRenderer.forceContextLoss();
  }

  function closeScreen() {
    cleanupPreview();
    root.classList.add('hidden');
  }

  // ---- 選択ボタン行（髪型・服装・アクセサリー共通） ----
  function buildButtonRow(containerId, values, labels, configKey) {
    const el = document.getElementById(containerId);
    values.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hair-btn' + (value === config[configKey] ? ' selected' : '');
      btn.textContent = labels[value] || value;
      btn.addEventListener('click', () => {
        config[configKey] = value;
        el.querySelectorAll('.hair-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        rebuildPreviewAvatar();
      });
      el.appendChild(btn);
    });
  }
  buildButtonRow('hairstyle-buttons', AVATAR_PARTS.hairStyles, HAIR_LABELS, 'hairStyle');
  buildButtonRow('outfit-buttons', AVATAR_PARTS.outfits, OUTFIT_LABELS, 'outfit');
  buildButtonRow('accessory-buttons', AVATAR_PARTS.accessories, ACCESSORY_LABELS, 'accessory');

  // ---- 色スウォッチ ----
  function buildSwatchRow(containerId, colors, configKey) {
    const el = document.getElementById(containerId);
    colors.forEach((color) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (color === config[configKey] ? ' selected' : '');
      sw.style.background = color;
      sw.title = color;
      sw.addEventListener('click', () => {
        config[configKey] = color;
        el.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
        rebuildPreviewAvatar();
      });
      el.appendChild(sw);
    });
  }
  buildSwatchRow('bodycolor-swatches', AVATAR_PARTS.bodyColors, 'bodyColor');
  buildSwatchRow('haircolor-swatches', AVATAR_PARTS.hairColors, 'hairColor');
  buildSwatchRow('eyecolor-swatches', AVATAR_PARTS.eyeColors, 'eyeColor');
  buildSwatchRow('shirtcolor-swatches', AVATAR_PARTS.shirtColors, 'shirtColor');

  // ---- 名前入力 & 決定ボタン ----
  const joinBtn = document.getElementById('join-btn');

  function handleSubmit() {
    const typed = nameInput.value.trim().slice(0, 12);
    const name = typed.length > 0 ? typed : fallbackName();

    closeScreen();
    onSubmit({ name, config: { ...config } });
  }

  joinBtn.addEventListener('click', handleSubmit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });

  if (showCancel && cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeScreen();
      if (onCancel) onCancel();
    });
  }
}

export function initJoinScreen(onJoin) {
  buildCustomizeScreen({
    title: 'VERSE CITY',
    subtitle: 'clubVERSE Web メタバース (モックアップ)',
    buttonLabel: '入場する',
    showCancel: false,
    initialName: '',
    initialConfig: randomConfig(),
    fallbackName: randomGuestName,
    onSubmit: onJoin,
    onCancel: null,
  });
}

/**
 * 入場後の再カスタム画面。#join-screen を使ってアバターの見た目・名前を再選択させる。
 * @param {{ name: string, config: object, onApply: (result: {name: string, config: object}) => void, onCancel?: () => void }} params
 */
export function openCustomizer({ name, config, onApply, onCancel }) {
  buildCustomizeScreen({
    title: 'アバター変更',
    subtitle: 'clubVERSE Web メタバース (モックアップ)',
    buttonLabel: 'この姿に変更',
    showCancel: true,
    initialName: name || '',
    initialConfig: { ...config },
    fallbackName: () => name || randomGuestName(),
    onSubmit: onApply,
    onCancel: onCancel || null,
  });
}
