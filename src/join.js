import * as THREE from 'three';
import { AVATAR_PARTS, randomConfig, createAvatar } from './avatar.js';
import { guestLookFor } from './guestlook.js';
import { getVisitorId } from './visitorid.js';
import { avToConfig } from './net.js';
import { normalizeHair } from './hair.js';
import { STREAK_COUNTS, STREAK_POSITIONS, STREAK_WIDTHS } from './hairfx.js';
import { fetchConfig, getConfig, renderLoginButton, getIdToken, isSignedIn } from './login.js';
import { APP_NAME, APP_TAGLINE } from './brand.js';
import { loadLocalPrefs, saveLocalPrefs, fetchServerPrefs, shouldUseServerPrefs } from './prefs.js';
import { UPDATES } from './updates.js';
import {
  parseAccessories,
  formatAccessories,
  toggleAccessory,
  MAX_ACCESSORIES,
  STAFF_ONLY_ACCESSORIES,
} from './accessory.js';

// 入場画面の「📢 お知らせ」欄に出す件数。多すぎると縦に伸びすぎるため5件に絞る
const UPDATES_DISPLAY_COUNT = 5;

// 髪は「長さ・髪型（結い方）・前髪」の3つを選んで組み合わせる（2026-08-06・loyさん指示）
const HAIR_LENGTH_LABELS = {
  long: 'ロング',
  bob: 'ボブ',
  short: 'ショート',
};

const HAIR_LABELS = {
  none: 'そのまま',
  twin: 'ツインテール',
  bun: 'お団子',
  pony: 'ポニーテール',
};

const BANGS_LABELS = {
  std: '標準',
  patsun: 'ぱっつん',
  partr: '右分け',
  partl: '左分け',
};

const OUTFIT_LABELS = {
  long: 'ロング',
  middle: 'ミドル',
  short: 'ショート',
};

const HEIGHT_LABELS = {
  small: 'SMALL',
  mid: 'MID',
  big: 'BIG',
};

// 利き手（2026-08-04追加）。片手のエモートと持ち物がどちらの手になるか
const HAND_LABELS = {
  right: '右利き',
  left: '左利き',
};

const ACCESSORY_LABELS = {
  none: 'なし',
  kemo: 'けもみみ',
  ahoge: 'アホ毛',
  // 2026-08-03 追加
  tail: 'しっぽ',
  wing: '羽',
  halo: '天使の輪',
  ribbon: 'リボン',
  sunglasses: 'サングラス',
  glasses: 'メガネ',
  mesh: '前髪メッシュ',
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
  width: min(860px, 92vw);
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

/* PC（幅広いとき）は左＝プレビュー＋設定、右＝お知らせ・なまえ・次へ の2カラム。
   スマホは下の @media (max-width: 640px) で縦1カラムに戻す */
.join-col {
  min-width: 0;
}

.join-col-left {
  flex: 1 1 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.join-col-right {
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* お知らせ欄。本文より控えめ（小さく・薄く）に見せる */
.join-updates {
  border: 1px solid rgba(0, 255, 234, 0.15);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
}

.updates-title {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(0, 255, 234, 0.8);
}

.updates-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.update-item {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}

.update-date {
  flex: 0 0 auto;
  font-size: 10px;
  color: rgba(220, 235, 255, 0.4);
  font-variant-numeric: tabular-nums;
}

.update-text {
  flex: 1 1 200px;
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(220, 235, 255, 0.55);
  word-break: break-word;
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

/* アクセサリー行の下に出す一言（複数選べることの説明・2026-08-04追加）。
   行は flex なので、幅いっぱいを取らせて改行させる */
.customize-hint {
  flex-basis: 100%;
  font-size: 10px;
  color: rgba(230, 240, 255, 0.55);
  margin-top: 2px;
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

/* ---- プレビューを貼り付ける（2026-08-07・loyさん指示）----
   項目が増えて、下の方を選ぶころにはアバターが画面の外に出ていた。
   スクロールするのは .join-panel なので、その中で sticky にすれば
   どこまで下がってもアバターが見える */
.join-preview {
  position: sticky;
  top: 0;
  z-index: 2;
}

/* プレビューの操作説明。触ると消える（邪魔なので） */
.preview-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 10px;
  color: rgba(220, 235, 255, 0.45);
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.preview-hint.hidden-hint { opacity: 0; }

.join-preview canvas { cursor: grab; touch-action: none; }
.join-preview canvas:active { cursor: grabbing; }

/* ---- 項目のタブ（2026-08-07）---- */
.customize-tabs {
  position: sticky;
  top: 300px; /* プレビューの高さぶん下。プレビューと一緒に貼り付く */
  z-index: 2;
  display: flex;
  gap: 6px;
  padding: 8px 0 10px;
  background: linear-gradient(180deg, rgba(12, 12, 28, 0.96) 70%, rgba(12, 12, 28, 0));
}

.ctab {
  flex: 1 1 0;
  padding: 8px 4px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  color: #eaf6ff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ctab:hover { border-color: rgba(0, 255, 234, 0.6); }

.ctab.selected {
  background: linear-gradient(90deg, rgba(0, 255, 234, 0.25), rgba(255, 0, 229, 0.2));
  border-color: #00ffea;
  box-shadow: 0 0 12px rgba(0, 255, 234, 0.35);
}

/* いま選んでいないタブの項目は隠す */
.customize-row.tab-hidden { display: none !important; }

/* 運営専用の項目につける印 */
.staff-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 9px;
  letter-spacing: 1px;
  color: #ffe9a8;
  background: rgba(255, 209, 71, 0.16);
  border: 1px solid rgba(255, 209, 71, 0.5);
}

@media (max-width: 640px) {
  .join-panel { padding: 20px; }
  /* スマホは今まで通り縦1カラム。お知らせは「なまえ」の上に来る（DOM順のまま） */
  .join-body { flex-direction: column; }
  .join-col-left, .join-col-right { width: 100%; }
  .join-preview { width: 100%; height: 200px; }
  /* スマホでもプレビューは上に貼り付く。タブはその直下 */
  .customize-tabs { top: 200px; }
  .ctab { font-size: 12px; padding: 7px 2px; }
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
 * 「📢 お知らせ」欄のHTMLを組み立てる。新しい順の先頭数件だけを見せる
 * （全部出すと縦に伸びすぎるため）。中身は src/updates.js を編集するだけで反映される
 */
/**
 * HTMLに埋め込む前に記号を無害化する。
 * いまの中身は updates.js の固定文言だけだが、将来ここが外部の文章を
 * 扱うようになったときに壊れないよう、埋め込み側で守っておく。
 */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function renderUpdatesSection() {
  const items = UPDATES.slice(0, UPDATES_DISPLAY_COUNT)
    .map(
      (u) => `
            <li class="update-item">
              <span class="update-date">${escapeHtml(u.date)}</span>
              <span class="update-text">${escapeHtml(u.text)}</span>
            </li>`
    )
    .join('');
  return `
          <div class="join-updates">
            <div class="updates-title">📢 お知らせ</div>
            <ul class="updates-list">${items}
            </ul>
          </div>`;
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

  // お知らせ欄は入場画面（showPlace）だけ出す。再カスタム画面では出さない
  // （ログイン欄と同じ条件分岐。displayを切り替えるのではなくHTML自体を出し分ける）
  const updatesHtml = showPlace ? renderUpdatesSection() : '';

  const root = document.getElementById('join-screen');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="join-panel">
      <h1 class="join-title">${title}</h1>
      <p class="join-subtitle">${subtitle}</p>
      <div class="join-body">
        <div class="join-col join-col-left">
          <div class="join-preview">
            <canvas id="avatar-preview-canvas"></canvas>
            <div class="preview-hint" id="preview-hint">ドラッグで回せます（ダブルクリックで正面）</div>
          </div>
          <!-- 項目が増えたのでタブに分ける（2026-08-07・loyさん指示）。
               縦一列だと、下の項目を選ぶころにはプレビューが画面外に出ていた -->
          <div class="customize-tabs" id="customize-tabs">
            <button type="button" class="ctab selected" data-tab="hair">髪</button>
            <button type="button" class="ctab" data-tab="face">顔</button>
            <button type="button" class="ctab" data-tab="cloth">服</button>
            <button type="button" class="ctab" data-tab="body">体</button>
          </div>
          <div class="join-customize">
            <!-- ===== 髪 ===== -->
            <div class="customize-row" data-tab="hair">
              <div class="customize-label">髪の長さ</div>
              <div class="hairstyle-buttons" id="hairlength-buttons"></div>
            </div>
            <div class="customize-row" data-tab="hair">
              <div class="customize-label">髪型</div>
              <div class="hairstyle-buttons" id="hairstyle-buttons"></div>
            </div>
            <div class="customize-row" data-tab="hair">
              <div class="customize-label">前髪</div>
              <div class="hairstyle-buttons" id="bangs-buttons"></div>
            </div>
            <div class="customize-row" data-tab="hair">
              <div class="customize-label">髪色</div>
              <div class="swatch-row" id="haircolor-swatches"></div>
            </div>
            <div class="customize-row staff-only" data-tab="hair" id="hairgrad-row" style="display:none">
              <div class="customize-label">毛先の色（グラデ）<span class="staff-tag">運営</span></div>
              <div class="swatch-row" id="hairgrad-swatches"></div>
            </div>
            <div class="customize-row staff-only" data-tab="hair" id="hairinner-row" style="display:none">
              <div class="customize-label">インナーカラー<span class="staff-tag">運営</span></div>
              <div class="swatch-row" id="hairinner-swatches"></div>
            </div>
            <div class="customize-row" data-tab="hair" id="meshcolor-row" style="display:none">
              <div class="customize-label">前髪メッシュの色</div>
              <div class="swatch-row" id="meshcolor-swatches"></div>
            </div>
            <div class="customize-row staff-only" data-tab="hair" id="streakcount-row" style="display:none">
              <div class="customize-label">メッシュの本数<span class="staff-tag">運営</span></div>
              <div class="hairstyle-buttons" id="streakcount-buttons"></div>
            </div>
            <div class="customize-row staff-only" data-tab="hair" id="streakpos-row" style="display:none">
              <div class="customize-label">メッシュの位置<span class="staff-tag">運営</span></div>
              <div class="hairstyle-buttons" id="streakpos-buttons"></div>
            </div>
            <div class="customize-row staff-only" data-tab="hair" id="streakwidth-row" style="display:none">
              <div class="customize-label">メッシュの太さ<span class="staff-tag">運営</span></div>
              <div class="hairstyle-buttons" id="streakwidth-buttons"></div>
            </div>

            <!-- ===== 顔 ===== -->
            <div class="customize-row" data-tab="face">
              <div class="customize-label">目・上の色</div>
              <div class="swatch-row" id="eyetopcolor-swatches"></div>
            </div>
            <div class="customize-row" data-tab="face">
              <div class="customize-label">目・下の色</div>
              <div class="swatch-row" id="eyecolor-swatches"></div>
            </div>
            <div class="customize-row staff-only" data-tab="face" id="eyesplit-row" style="display:none">
              <div class="customize-label">左右で分ける<span class="staff-tag">運営</span></div>
              <div class="hairstyle-buttons" id="eyesplit-buttons"></div>
            </div>
            <div class="customize-row staff-only" data-tab="face" id="eyetopcolorr-row" style="display:none">
              <div class="customize-label">右目・上の色<span class="staff-tag">運営</span></div>
              <div class="swatch-row" id="eyetopcolorr-swatches"></div>
            </div>
            <div class="customize-row staff-only" data-tab="face" id="eyecolorr-row" style="display:none">
              <div class="customize-label">右目・下の色<span class="staff-tag">運営</span></div>
              <div class="swatch-row" id="eyecolorr-swatches"></div>
            </div>
            <div class="customize-row" data-tab="face">
              <div class="customize-label">肌色</div>
              <div class="swatch-row" id="bodycolor-swatches"></div>
            </div>

            <!-- ===== 服 ===== -->
            <div class="customize-row" data-tab="cloth">
              <div class="customize-label">服装</div>
              <div class="hairstyle-buttons" id="outfit-buttons"></div>
            </div>
            <div class="customize-row" data-tab="cloth">
              <div class="customize-label">服色</div>
              <div class="swatch-row" id="shirtcolor-swatches"></div>
            </div>
            <div class="customize-row" data-tab="cloth">
              <div class="customize-label">ペンライトの色</div>
              <div class="swatch-row" id="penlightcolor-swatches"></div>
            </div>

            <!-- ===== 体 ===== -->
            <div class="customize-row" data-tab="body">
              <div class="customize-label">アクセサリー</div>
              <div class="hairstyle-buttons" id="accessory-buttons"></div>
            </div>
            <div class="customize-row" data-tab="body">
              <div class="customize-label">身長</div>
              <div class="hairstyle-buttons" id="height-buttons"></div>
            </div>
            <div class="customize-row" data-tab="body">
              <div class="customize-label">利き手</div>
              <div class="hairstyle-buttons" id="hand-buttons"></div>
            </div>
          </div>
        </div>
        <div class="join-col join-col-right">
          ${updatesHtml}
          <div class="customize-row" id="login-row" style="display:none">
            <div class="customize-label">ログイン</div>
            <div class="login-area">
              <div id="login-button"></div>
              <div class="login-note" id="login-note"></div>
            </div>
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
  // 髪は3つ（長さ・髪型・前髪）。古い1つだけの保存データはここで読み替わる
  Object.assign(config, normalizeHair(config));
  // 目の色は2026-08-07に4つへ増えた。古い保存データには上・右目が無いので補う
  // （補わないと、どのスウォッチも選択表示にならない）
  if (!AVATAR_PARTS.eyeColors.includes(config.eyeTopColor)) {
    [config.eyeTopColor] = AVATAR_PARTS.eyeColors; // 既定は黒
  }
  config.eyeSplit = Boolean(config.eyeSplit);
  if (!AVATAR_PARTS.eyeColors.includes(config.eyeColorR)) config.eyeColorR = config.eyeColor;
  if (!AVATAR_PARTS.eyeColors.includes(config.eyeTopColorR)) config.eyeTopColorR = config.eyeTopColor;
  if (!AVATAR_PARTS.outfits.includes(config.outfit)) config.outfit = AVATAR_PARTS.outfits[0];
  // アクセサリーは複数付けになった（"wing+halo"）。ここで正規化すれば、
  // 古い保存データ（1つだけ）も新しいデータも同じ形になる
  config.accessory = formatAccessories(config.accessory);
  // 身長は 2026-08-03 追加。それ以前の保存データには入っていないので既定へ倒す
  if (!AVATAR_PARTS.heights.includes(config.height)) config.height = 'mid';
  // 利き手は 2026-08-04 追加。既定は右（VRChat側のプロキシに合わせている）
  if (!AVATAR_PARTS.handedness.includes(config.handedness)) config.handedness = 'right';
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
  // ゲスト表示に切り替える前の見た目。ログインしたら戻すために控える
  let guestPreviewBackup = null;
  /**
   * いまの権限（2026-08-06追加）。管理者・VIPだけが選べるアクセサリーの出し分けに使う。
   * ログインの返事が来るまでは 'user' 扱い（来た時点で作り直す）。
   * ⚠ 画面の出し分けだけ。実際の可否はサーバーが決める（accessory.js の stripStaffOnly）
   */
  let myRole = knownRole;
  const isStaff = () => myRole === 'admin' || myRole === 'vip';

  // ---- プレビューの向き（2026-08-07・loyさん指示「じぶんでも回せるといい」）----
  // 触るまでは今までどおり自動で回る。一度触ったら止めて、その向きを保つ
  // （前髪や目を見たいのに後ろを向いている、という不便をなくすため）。
  // ダブルクリック（ダブルタップ）で正面に戻す
  let previewAngle = 0;
  let autoSpin = true;

  /**
   * 条件つきの行を出し入れする（2026-08-07）。
   * ・運営専用（.staff-only）… 管理者・VIPのときだけ
   * ・前髪メッシュの色と形 … メッシュを付けているときだけ
   * ・右目の色 … 「左右で分ける」を選んでいるときだけ
   * ⚠ 出し分けは見た目だけ。実際の可否はサーバーが決める（staffonly.js）
   */
  function applyOptionRows() {
    const staff = isStaff();
    document.querySelectorAll('.staff-only').forEach((el) => {
      el.style.display = staff ? '' : 'none';
    });
    // ⚠ 前髪メッシュそのものが運営専用なので、色も形も staff のときだけ。
    //   staff を見ないと、権限が外れた後も設定に残っていたメッシュで行が出てしまう
    const hasMesh = staff && parseAccessories(config.accessory).includes('mesh');
    for (const id of ['meshcolor-row', 'streakcount-row', 'streakpos-row', 'streakwidth-row']) {
      const el = document.getElementById(id);
      if (el) el.style.display = hasMesh ? '' : 'none';
    }
    for (const id of ['eyetopcolorr-row', 'eyecolorr-row']) {
      const el = document.getElementById(id);
      if (el) el.style.display = staff && config.eyeSplit ? '' : 'none';
    }
  }

  // ---- 項目のタブ（2026-08-07・loyさん指示）----
  function applyTab(tab) {
    document.querySelectorAll('.customize-row[data-tab]').forEach((el) => {
      el.classList.toggle('tab-hidden', el.dataset.tab !== tab);
    });
    document.querySelectorAll('.ctab').forEach((b) => {
      b.classList.toggle('selected', b.dataset.tab === tab);
    });
  }
  document.querySelectorAll('.ctab').forEach((b) => {
    b.addEventListener('click', () => applyTab(b.dataset.tab));
  });
  applyTab('hair');

  function rebuildPreviewAvatar() {
    applyOptionRows();
    if (previewAvatar) {
      previewScene.remove(previewAvatar);
      disposeObject3D(previewAvatar);
    }
    previewAvatar = createAvatar({ ...config });
    // 作り直しても向きは引き継ぐ（色を変えるたびに正面へ戻ると選びにくい）
    previewAvatar.rotation.y = previewAngle;
    previewScene.add(previewAvatar);
  }
  rebuildPreviewAvatar();

  let previewRafId = null;
  const previewClock = new THREE.Clock();
  function renderPreviewLoop() {
    previewRafId = requestAnimationFrame(renderPreviewLoop);
    const dt = Math.min(previewClock.getDelta(), 0.1);
    if (previewAvatar) {
      if (autoSpin) previewAngle += dt * 0.7;
      previewAvatar.rotation.y = previewAngle;
      if (previewAvatar.userData.update) previewAvatar.userData.update(dt);
    }
    previewRenderer.render(previewScene, previewCamera);
  }
  renderPreviewLoop();

  // ドラッグで回す。マウスと指を同じ扱いにしたいので pointer イベントを使う
  {
    const hint = document.getElementById('preview-hint');
    let dragging = false;
    let lastX = 0;
    const hideHint = () => { if (hint) hint.classList.add('hidden-hint'); };
    previewCanvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      autoSpin = false; // 触った時点で自動回転をやめる
      hideHint();
      // 指を canvas の外へ動かしても追い続ける。
      // 対応していない場合もあるので、失敗しても止めない
      try { previewCanvas.setPointerCapture(e.pointerId); } catch { /* 無くても回せる */ }
    });
    previewCanvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // 画面の横幅ぶん動かすと約1回転。指でもマウスでも同じ感覚になる
      previewAngle += ((e.clientX - lastX) / previewCanvas.clientWidth) * Math.PI * 2;
      lastX = e.clientX;
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { previewCanvas.releasePointerCapture(e.pointerId); } catch { /* 既に外れている */ }
    };
    previewCanvas.addEventListener('pointerup', endDrag);
    previewCanvas.addEventListener('pointercancel', endDrag);
    // 正面に戻す。自動回転は再開しない（見たい向きで止めたい人が多いはずなので）
    previewCanvas.addEventListener('dblclick', () => {
      previewAngle = 0;
      autoSpin = false;
      hideHint();
    });
  }

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
      btn.className = 'hair-btn' + (String(value) === String(config[configKey] ?? '') ? ' selected' : '');
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
  /**
   * アクセサリーだけ**複数選べる**（2026-08-04・テストユーザー要望）。
   * ほかの行は1つだけなので buildButtonRow を使えない。
   *
   * ⚠「なし」は他と同時に選べない特別扱い。押したら全部外す。
   * ⚠ 上限(3つ)に達しているときに新しく押すと、いちばん古いものが外れる。
   *   押しても何も起きない方が「壊れている」と思われやすい。
   */
  function buildAccessoryRow() {
    const el = document.getElementById('accessory-buttons');
    if (!el) return;
    el.innerHTML = ''; // 権限が分かったあとに作り直せるようにする
    const paint = () => {
      const on = parseAccessories(config.accessory);
      // 条件つきの行（メッシュの色・形）の出し入れは applyOptionRows に集約してある
      applyOptionRows();
      el.querySelectorAll('.hair-btn').forEach((b) => {
        const v = b.dataset.value;
        const sel = v === 'none' ? on.length === 0 : on.includes(v);
        b.classList.toggle('selected', sel);
      });
    };
    for (const value of AVATAR_PARTS.accessories) {
      // ⚠ 管理者・VIP専用のもの（前髪メッシュ）は、権限が無い人には出さない。
      //   隠すだけでは細工で付けられるので、サーバー側でも同じ判定をしている
      if (STAFF_ONLY_ACCESSORIES.has(value) && !isStaff()) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = value;
      btn.className = 'hair-btn';
      btn.textContent = ACCESSORY_LABELS[value] || value;
      btn.addEventListener('click', () => {
        config.accessory = value === 'none' ? 'none' : toggleAccessory(config.accessory, value);
        paint();
        rebuildPreviewAvatar();
      });
      el.appendChild(btn);
    }
    paint();
    const hint = document.createElement('div');
    hint.className = 'customize-hint';
    hint.textContent = `${MAX_ACCESSORIES}つまで同時に付けられます（もう一度押すと外れます）`;
    el.appendChild(hint);
  }

  buildButtonRow('hairlength-buttons', AVATAR_PARTS.hairLengths, HAIR_LENGTH_LABELS, 'hairLength');
  buildButtonRow('hairstyle-buttons', AVATAR_PARTS.hairStyles, HAIR_LABELS, 'hairStyle');
  buildButtonRow('bangs-buttons', AVATAR_PARTS.bangs, BANGS_LABELS, 'bangs');
  buildButtonRow('outfit-buttons', AVATAR_PARTS.outfits, OUTFIT_LABELS, 'outfit');
  buildAccessoryRow();
  buildButtonRow('height-buttons', AVATAR_PARTS.heights, HEIGHT_LABELS, 'height');
  buildButtonRow('hand-buttons', AVATAR_PARTS.handedness, HAND_LABELS, 'handedness');
  // 前髪メッシュの形（運営専用・2026-08-07）。一覧の原本は hairfx.js
  buildButtonRow(
    'streakcount-buttons',
    STREAK_COUNTS,
    Object.fromEntries(STREAK_COUNTS.map((n) => [n, `${n}本`])),
    'streakCount',
  );
  buildButtonRow(
    'streakpos-buttons',
    STREAK_POSITIONS.map((x) => x.id),
    Object.fromEntries(STREAK_POSITIONS.map((x) => [x.id, x.label])),
    'streakPosition',
  );
  buildButtonRow(
    'streakwidth-buttons',
    STREAK_WIDTHS.map((x) => x.id),
    Object.fromEntries(STREAK_WIDTHS.map((x) => [x.id, x.label])),
    'streakWidth',
  );
  // 目を左右で分けるか（運営専用）。分けたときだけ右目の色の行を出す
  buildButtonRow('eyesplit-buttons', [false, true], { false: '同じ', true: '左右で分ける' }, 'eyeSplit');

  // ---- 色スウォッチ ----
  function buildSwatchRow(containerId, colors, configKey, allowNone = false) {
    const el = document.getElementById(containerId);
    if (!el) return;
    selectableRows.push({ containerId, configKey, itemClass: 'swatch' });
    // 「なし」（グラデ・インナーカラー用）。色の丸ではなくボタンで出す
    if (allowNone) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = '';
      btn.className = 'hair-btn' + (config[configKey] ? '' : ' selected');
      btn.textContent = 'なし';
      btn.addEventListener('click', () => {
        config[configKey] = '';
        el.querySelectorAll('.swatch').forEach((x) => x.classList.remove('selected'));
        el.querySelectorAll('.hair-btn').forEach((x) => x.classList.add('selected'));
        rebuildPreviewAvatar();
      });
      el.appendChild(btn);
    }
    colors.forEach((color) => {
      const sw = document.createElement('div');
      sw.dataset.value = color;
      sw.className = 'swatch' + (color === config[configKey] ? ' selected' : '');
      sw.style.background = color;
      sw.title = color;
      sw.addEventListener('click', () => {
        config[configKey] = color;
        el.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
        // 「なし」ボタンがある行では、色を選んだらそちらの選択を外す
        el.querySelectorAll('.hair-btn').forEach((b) => b.classList.remove('selected'));
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
        // ⚠ dataset は必ず文字列になる。本数(数値)や「左右で分ける」(真偽値)を
        //   そのまま === で比べると一致しないので、文字列に揃えて比べる
        item.classList.toggle('selected', item.dataset.value === String(config[row.configKey] ?? ''));
      });
    }
  }

  buildSwatchRow('bodycolor-swatches', AVATAR_PARTS.bodyColors, 'bodyColor');
  buildSwatchRow('haircolor-swatches', AVATAR_PARTS.hairColors, 'hairColor');
  // 前髪メッシュの色。髪と同じパレットから選ぶ（loyさん指定 2026-08-06）
  buildSwatchRow('meshcolor-swatches', AVATAR_PARTS.hairColors, 'meshColor');
  buildSwatchRow('eyecolor-swatches', AVATAR_PARTS.eyeColors, 'eyeColor');
  // 目の色（2026-08-07に4つへ）。上＝いままで黒で固定だったところ
  buildSwatchRow('eyetopcolor-swatches', AVATAR_PARTS.eyeColors, 'eyeTopColor');
  buildSwatchRow('eyecolorr-swatches', AVATAR_PARTS.eyeColors, 'eyeColorR');
  buildSwatchRow('eyetopcolorr-swatches', AVATAR_PARTS.eyeColors, 'eyeTopColorR');
  // 髪の飾り（運営専用）。「なし」を選べるようにするため allowNone を立てる
  buildSwatchRow('hairgrad-swatches', AVATAR_PARTS.hairColors, 'hairGradColor', true);
  buildSwatchRow('hairinner-swatches', AVATAR_PARTS.hairColors, 'hairInnerColor', true);
  buildSwatchRow('shirtcolor-swatches', AVATAR_PARTS.shirtColors, 'shirtColor');
  buildSwatchRow('penlightcolor-swatches', AVATAR_PARTS.penlightColors, 'penlightColor');

  // ---- ログイン（入場画面のときだけ出す。イベント/ルームの選択は次の画面 placepick.js） ----
  // ログインしていないゲストは見た目を変えられないので、選択UIを触れなくする
  function applyGuestLock() {
    const cfg = getConfig();
    const locked = Boolean(cfg && cfg.login) && !isSignedIn();

    // ゲストの姿はサーバーが匿名IDから決める（髪なし＋IDで決まる色）。
    // プレビューにも同じ計算を当てておかないと、入場した瞬間に姿が変わって驚かせる。
    // ログインしたら自分で選んだ姿に戻す（下の restore）
    if (locked) {
      if (!guestPreviewBackup) guestPreviewBackup = { ...config };
      // サーバーは `g:` 付きの匿名IDで計算する。接頭辞を落とすと色が変わるので必ず揃える
      Object.assign(config, avToConfig(guestLookFor(`g:${getVisitorId()}`)));
      rebuildPreviewAvatar();
    } else if (guestPreviewBackup) {
      Object.assign(config, guestPreviewBackup);
      guestPreviewBackup = null;
      rebuildPreviewAvatar();
    }
    const rows = [
      'hairlength-buttons',
      'hairstyle-buttons',
      'bangs-buttons',
      'outfit-buttons',
      'accessory-buttons',
      'height-buttons',
      'hand-buttons',
    ];
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
        // ★★ サーバーの記録を使うのは、**この端末に保存が無いときだけ**。
        //
        //   2026-08-04〜06 に「リセットされた」「違う姿になった」が3回続いた。
        //   間に入れた「保存時刻が新しい方を採る」も効かなかった。理由は単純で、
        //   **サーバー側は入場のたびに保存される**ので、端末の保存（決定を押した時刻）より
        //   必ず数秒新しくなる。つまり時刻で比べる限り**いつでもサーバーが勝つ**＝
        //   サーバーの記録が何かの理由で古い/違うと、毎回それに戻される。
        //
        //   優先順位を「この端末 ＞ サーバー」に固定する。
        //   ・その端末で一度でも入っていれば、**二度と勝手に変わらない**（今回の要求）
        //   ・保存が無い端末（初めての機器・ブラウザ）ではサーバーの記録を使うので、
        //     別端末への引き継ぎも今までどおり効く
        if (server.config && shouldUseServerPrefs(loadLocalPrefs())) {
          Object.assign(config, server.config);
          rebuildPreviewAvatar();
          refreshSelections();
        }
        // 権限が分かったら、管理者・VIP専用のアクセサリーを出し直す
        if (server.role && server.role !== myRole) {
          myRole = server.role;
          knownRole = server.role;
          buildAccessoryRow();
          applyOptionRows();
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

    // 次回そのまま入れるように見た目をブラウザへ保存する。
    //
    // ⚠ ゲスト表示中（ログインしていない間）は、`config` の中身が
    //   **サーバーが匿名IDから決めたゲストの姿**に差し替わっている（applyGuestLock）。
    //   そのまま保存すると、本人が選んだ姿がゲストの姿で上書きされ、
    //   次に来たとき「リセットされた」ように見える。
    //   ログインが間に合わないうちに決定を押すと起きる（2026-08-06 リセット報告の原因候補）。
    //   控えが残っているときは**控えの方**を保存する
    saveLocalPrefs({ config: guestPreviewBackup || config });

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
/**
 * サーバーが認めた権限（入場の返事に入っている）。
 * 入場前の画面ではログインの返事からしか分からないが、
 * 入場後の「アバター変更」はこれを見て管理者・VIP専用の項目を出す。
 * ⚠ 画面の出し分けだけ。実際の可否はサーバーが決める（accessory.js の stripStaffOnly）
 */
let knownRole = 'user';

/** 入場の返事（onWelcome）で分かった権限を覚える。main.js から呼ぶ */
export function setKnownRole(role) {
  if (role) knownRole = role;
}

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
