// 画面右下の「動画パネル」
//
// スクリーンは3D空間の奥（アバターの後ろ）にあり直接クリックできないため、
// 映像に関する操作はすべてこのパネルに集約する。
// - 上段: シークバー ＋ 経過/全体の時間（ライブ配信は LIVE 表示）
// - 下段: 再生/一時停止・ミュート・音量、そして他モジュールのボタン置き場（slot）
//   （シアター表示ボタン=viewmode.js、動画URL変更ボタン=screenui.js がここに入る）

const STYLE_ID = 'vc-playerctl-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-video-panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 10;
      width: 300px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 9px 12px 10px;
      background: rgba(10, 10, 30, 0.62);
      border: 1px solid rgba(255, 176, 92, 0.35);
      border-radius: 12px;
      backdrop-filter: blur(8px);
      font-family: inherit;
    }

    .vc-vp-seekrow {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vc-vp-time {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.62);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .vc-vp-live {
      font-size: 10px;
      font-weight: bold;
      color: #ff5f5f;
      letter-spacing: 1px;
      white-space: nowrap;
    }

    .vc-vp-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .vc-vp-slot {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-left: auto;
    }

    .vc-vp-btn {
      width: 30px;
      height: 30px;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #eee;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 176, 92, 0.3);
      border-radius: 7px;
      cursor: pointer;
      padding: 0;
      transition: background 0.15s, box-shadow 0.15s;
    }
    .vc-vp-btn:hover {
      background: rgba(255, 176, 92, 0.25);
      box-shadow: 0 0 8px rgba(255, 176, 92, 0.4);
    }

    /* スライダー（シーク・音量で共通） */
    .vc-vp-range {
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }
    .vc-vp-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ffb066;
      box-shadow: 0 0 6px rgba(255, 176, 102, 0.8);
      cursor: pointer;
    }
    .vc-vp-range::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border: none;
      border-radius: 50%;
      background: #ffb066;
      box-shadow: 0 0 6px rgba(255, 176, 102, 0.8);
      cursor: pointer;
    }
    .vc-vp-range:disabled { opacity: 0.35; cursor: default; }

    .vc-vp-seek { flex: 1 1 auto; }
    .vc-vp-vol { width: 72px; flex: 0 0 auto; }
    .vc-vp-vollabel {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      min-width: 20px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 640px) {
      /* スマホは左下のジョイスティック(高さ約110px)・右下のチャットトグルを避けて上に置く */
      .vc-video-panel {
        right: 12px;
        bottom: 148px;
        width: calc(100vw - 24px);
        max-width: 320px;
        padding: 8px 10px 9px;
      }
      .vc-vp-vol { width: 56px; }
    }
  `;
  document.head.appendChild(style);
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}

// player: screen.js が返す { play, pause, mute, unMute, setVolume, seekTo, onState }
export function initPlayerControls({ player }) {
  injectStyle();

  const panel = document.createElement('div');
  panel.className = 'vc-video-panel';

  // ---- 上段: シークバー＋時間 ----
  const seekRow = document.createElement('div');
  seekRow.className = 'vc-vp-seekrow';

  const seek = document.createElement('input');
  seek.className = 'vc-vp-range vc-vp-seek';
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  seek.title = '再生位置';

  const time = document.createElement('span');
  time.className = 'vc-vp-time';
  time.textContent = '--:-- / --:--';

  seekRow.append(seek, time);

  // ---- 下段: 再生・音量・他モジュールのボタン ----
  const row = document.createElement('div');
  row.className = 'vc-vp-row';

  const playBtn = document.createElement('button');
  playBtn.className = 'vc-vp-btn';
  playBtn.type = 'button';
  playBtn.textContent = '⏸';
  playBtn.title = '再生 / 一時停止';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'vc-vp-btn';
  muteBtn.type = 'button';
  muteBtn.textContent = '🔊';
  muteBtn.title = 'ミュート切替';

  const vol = document.createElement('input');
  vol.className = 'vc-vp-range vc-vp-vol';
  vol.type = 'range';
  vol.min = '0';
  vol.max = '100';
  vol.value = '70';
  vol.title = '音量';

  const volLabel = document.createElement('span');
  volLabel.className = 'vc-vp-vollabel';
  volLabel.textContent = '70';

  // 他モジュール（シアター表示・動画URL変更）のボタンが入る場所
  const slot = document.createElement('div');
  slot.className = 'vc-vp-slot';

  row.append(playBtn, muteBtn, vol, volLabel, slot);
  panel.append(seekRow, row);
  document.body.appendChild(panel);

  let playing = true;
  let muted = false;
  let seeking = false;
  let duration = 0;
  let live = false;

  player.setVolume(Number(vol.value));

  playBtn.addEventListener('click', () => {
    playing = !playing;
    if (playing) player.play();
    else player.pause();
    playBtn.textContent = playing ? '⏸' : '▶';
  });

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    if (muted) player.mute();
    else player.unMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  vol.addEventListener('input', () => {
    const v = Number(vol.value);
    volLabel.textContent = String(v);
    player.setVolume(v);
    if (muted && v > 0) {
      muted = false;
      muteBtn.textContent = '🔊';
      player.unMute();
    }
  });

  // シーク操作中は再生位置の自動更新を止める（つまみが飛ばないように）
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  const endSeek = () => {
    if (!seeking) return;
    seeking = false;
    if (duration > 0 && !live) player.seekTo((Number(seek.value) / 1000) * duration);
  };
  seek.addEventListener('pointerup', endSeek);
  seek.addEventListener('pointercancel', endSeek);
  seek.addEventListener('change', endSeek);

  // 再生状態の反映
  player.onState((s) => {
    duration = s.duration;
    live = s.live;

    playing = s.playing;
    playBtn.textContent = playing ? '⏸' : '▶';

    if (live) {
      seek.disabled = true;
      seek.value = '1000';
      time.className = 'vc-vp-live';
      time.textContent = '● LIVE';
      return;
    }

    seek.disabled = false;
    time.className = 'vc-vp-time';
    time.textContent = `${formatTime(s.currentTime)} / ${formatTime(duration)}`;
    if (!seeking && duration > 0) {
      seek.value = String(Math.round((s.currentTime / duration) * 1000));
    }
  });

  return {
    element: panel,
    slot, // 他モジュールがボタンを追加する場所
    setVisible(v) {
      panel.style.display = v ? 'flex' : 'none';
    },
  };
}
