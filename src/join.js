import * as THREE from 'three';
import { AVATAR_PARTS, randomConfig, createAvatar } from './avatar.js';
import { fetchConfig, getConfig, renderLoginButton, getIdToken, isSignedIn } from './login.js';
import { APP_NAME, APP_TAGLINE } from './brand.js';
import { loadLocalPrefs, saveLocalPrefs, fetchServerPrefs } from './prefs.js';

const HAIR_LABELS = {
  long: 'ロング',
  bob: 'ボブ',
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

.login-area {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.login-note {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(220, 235, 255, 0.65);
}

.login-note.signed {
  color: rgba(120, 255, 220, 0.9);
}

.hair-btn.locked {
  opacity: 0.45;
  cursor: not-allowed;
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

/* 名前はサーバーが決めるので、入力欄ではなく表示欄として見せる */
#name-input[readonly] {
  cursor: default;
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(234, 246, 255, 0.9);
}

.name-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(220, 235, 255, 0.5);
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
  onSubmit,
  onCancel,
  showPlace = false, // ログイン・イベント・ルームの選択を出すか（入場画面のみ）
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
          <div class="customize-row" id="login-row" style="display:none">
            <div class="customize-label">ログイン</div>
            <div class="login-area">
              <div id="login-button"></div>
              <div class="login-note" id="login-note"></div>
            </div>
          </div>
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
            <div class="customize-label">ペンライトの色</div>
            <div class="swatch-row" id="penlightcolor-swatches"></div>
          </div>
          <div class="customize-row">
            <div class="customize-label">なまえ</div>
            <input type="text" id="name-input" readonly tabindex="-1" placeholder="ゲスト（自動で番号がつきます）" autocomplete="off" />
            <div class="name-note" id="name-note">ログインすると、Googleアカウントの名前で表示されます</div>
          </div>
          <div class="join-btn-row">
            <button type="button" id="join-btn" class="join-btn">${buttonLabel}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const nameInput = document.getElementById('name-input');
  const nameNote = document.getElementById('name-note');

  /**
   * 表示名を見せる。名前を決めるのはサーバーなので、ここは確認用の表示でしかない。
   * @param {string} resolved ログイン済みならGoogleの表示名。未ログインなら空
   */
  function showResolvedName(resolved) {
    if (resolved) {
      nameInput.value = resolved;
      if (nameNote) nameNote.textContent = 'Googleアカウントの名前で表示されます（変更できません）';
    } else {
      nameInput.value = '';
      if (nameNote) {
        nameNote.textContent = 'ログインすると、Googleアカウントの名前で表示されます';
      }
    }
  }
  showResolvedName(initialName || '');

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
  if (!AVATAR_PARTS.penlightColors.includes(config.penlightColor)) {
    config.penlightColor = AVATAR_PARTS.penlightColors[9]; // 既定は水色
  }

  // ---- プレビュー用の小さな3Dシーン ----
  const previewCanvas = document.getElementById('avatar-preview-canvas');
  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  previewCamera.position.set(0, 1.0, 3.0);
  previewCamera.lookAt(0, 0.8, 0);

  const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  previewRenderer.setSize(300, 300, false);

  // 明るくフラットに見せる（暗い色付きライトだと造形が沈む）
  const ambient = new THREE.AmbientLight(0xffffff, 1.35);
  const keyLight = new THREE.DirectionalLight(0xfff2e0, 0.9);
  keyLight.position.set(1.5, 3, 4);
  const rimLight = new THREE.DirectionalLight(0xaad4ff, 0.35);
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
  // 保存済み設定を読み込んだあとに選択状態を貼り直すため、行と項目を覚えておく
  const selectableRows = [];

  function buildButtonRow(containerId, values, labels, configKey) {
    const el = document.getElementById(containerId);
    selectableRows.push({ containerId, configKey, itemClass: 'hair-btn' });
    values.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = value;
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
    selectableRows.push({ containerId, configKey, itemClass: 'swatch' });
    colors.forEach((color) => {
      const sw = document.createElement('div');
      sw.dataset.value = color;
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
  /** config が外から書き換わったとき（保存済み設定の復元）に選択表示を合わせる */
  function refreshSelections() {
    for (const row of selectableRows) {
      const el = document.getElementById(row.containerId);
      if (!el) continue;
      el.querySelectorAll('.' + row.itemClass).forEach((item) => {
        item.classList.toggle('selected', item.dataset.value === config[row.configKey]);
      });
    }
  }

  buildSwatchRow('bodycolor-swatches', AVATAR_PARTS.bodyColors, 'bodyColor');
  buildSwatchRow('haircolor-swatches', AVATAR_PARTS.hairColors, 'hairColor');
  buildSwatchRow('eyecolor-swatches', AVATAR_PARTS.eyeColors, 'eyeColor');
  buildSwatchRow('shirtcolor-swatches', AVATAR_PARTS.shirtColors, 'shirtColor');
  buildSwatchRow('penlightcolor-swatches', AVATAR_PARTS.penlightColors, 'penlightColor');

  // ---- ログイン（入場画面のときだけ出す。イベント/ルームの選択は次の画面 placepick.js） ----
  // ログインしていないゲストは見た目を変えられないので、選択UIを触れなくする
  function applyGuestLock() {
    const cfg = getConfig();
    const locked = Boolean(cfg && cfg.login) && !isSignedIn();
    const rows = ['hairstyle-buttons', 'outfit-buttons', 'accessory-buttons'];
    for (const id of rows) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.querySelectorAll('.hair-btn').forEach((b) => b.classList.toggle('locked', locked));
      el.style.pointerEvents = locked ? 'none' : '';
    }
    const swatchRows = [
      'bodycolor-swatches',
      'haircolor-swatches',
      'eyecolor-swatches',
      'shirtcolor-swatches',
      'penlightcolor-swatches',
    ];
    for (const id of swatchRows) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.opacity = locked ? '0.45' : '';
      el.style.pointerEvents = locked ? 'none' : '';
    }
  }

  async function setupLogin() {
    if (!showPlace) return;
    const cfg = await fetchConfig();
    if (cfg.login) {
      const row = document.getElementById('login-row');
      const note = document.getElementById('login-note');
      if (row) row.style.display = '';
      if (note) note.textContent = 'ログインしなくても入れます（見た目の変更・コメント・エモートはログインが必要）';
      await renderLoginButton(document.getElementById('login-button'), async (p) => {
        if (note) {
          note.textContent = p ? `${p.name || p.email} としてログイン中` : 'ログインしていません';
          note.classList.toggle('signed', Boolean(p));
        }
        applyGuestLock();

        // ログインしたら、サーバーに保存してある前回の姿を取りに行く。
        // 別の端末でも同じ姿で入れるようにするため（ブラウザ保存では端末をまたげない）
        if (!p) return;
        const server = await fetchServerPrefs(getIdToken());
        if (!server) return;
        if (server.config) {
          Object.assign(config, server.config);
          rebuildPreviewAvatar();
          refreshSelections();
        }
        // 名前はGoogleアカウントの表示名で固定（サーバーが確定させる）。
        // ここでは「入場したらこう表示される」ことを見せているだけ
        showResolvedName(server.googleName || server.name || '');
      });
      applyGuestLock();
    }
  }
  setupLogin();

  // ---- 決定ボタン ----
  const joinBtn = document.getElementById('join-btn');

  function handleSubmit() {
    // 名前は入場時にサーバーが確定させる（ログイン名 or ゲスト連番）。
    // ここで渡すのは表示用の控えで、サーバーはこれを採用しない
    const name = nameInput.value.trim();

    // 次回そのまま入れるように見た目をブラウザへ保存する
    saveLocalPrefs({ config });

    closeScreen();
    onSubmit({
      name,
      config: { ...config },
      idToken: getIdToken(),
    });
  }

  joinBtn.addEventListener('click', handleSubmit);

  if (showCancel && cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeScreen();
      if (onCancel) onCancel();
    });
  }
}

/**
 * 入場画面（1歩目: アバターの見た目）。
 * 決定すると onJoin({name, config, idToken}) が呼ばれる。
 * 場所の選択は placepick.js（2歩目）が担当する。
 * 表示名はサーバーが決めるので、ここでは確認用に見せているだけ。
 * @param {(r:{name:string,config:object,idToken:string}) => void} onJoin
 * @param {{name?:string, config?:object}} [prev] 「← アバター」で戻ってきたときの復元用
 */
export function initJoinScreen(onJoin, prev = {}) {
  // 見た目の優先順位: 「← アバター」で戻ってきた内容 → 前回の保存 → ランダム。
  // 名前はサーバーが決めるので、ここでは空にしておく（ログインすれば自動で入る）
  const saved = loadLocalPrefs();
  buildCustomizeScreen({
    title: APP_NAME,
    subtitle: APP_TAGLINE,
    buttonLabel: '次へ（場所を選ぶ）',
    showCancel: false,
    initialName: '',
    initialConfig: prev.config ? { ...prev.config } : saved && saved.config ? { ...saved.config } : randomConfig(),
    onSubmit: onJoin,
    onCancel: null,
    showPlace: true,
  });
}

/**
 * 入場後の再カスタム画面。#join-screen を使ってアバターの見た目を選び直す。
 * 名前はサーバーが確定させているので、ここでは変更できない。
 * @param {{ name: string, config: object, onApply: (result: {name: string, config: object}) => void, onCancel?: () => void }} params
 */
export function openCustomizer({ name, config, onApply, onCancel }) {
  buildCustomizeScreen({
    title: 'アバター変更',
    subtitle: APP_TAGLINE,
    buttonLabel: 'この姿に変更',
    showCancel: true,
    initialName: name || '',
    initialConfig: { ...config },
    onSubmit: onApply,
    onCancel: onCancel || null,
  });
}
