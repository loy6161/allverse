// スクリーン映像のコントロールバー
//
// スクリーンは3D空間の奥（アバターの後ろ）にあるため直接クリックできない。
// そこで再生/一時停止・ミュート・音量をこのバーから操作する。

const STYLE_ID = 'vc-playerctl-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vc-pc-bar {
      position: fixed;
      top: 148px;
      right: 16px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      background: rgba(10, 10, 30, 0.6);
      border: 1px solid rgba(255, 176, 92, 0.35);
      border-radius: 10px;
      backdrop-filter: blur(6px);
      font-family: inherit;
    }
    .vc-pc-btn {
      width: 30px;
      height: 30px;
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
    .vc-pc-btn:hover {
      background: rgba(255, 176, 92, 0.25);
      box-shadow: 0 0 8px rgba(255, 176, 92, 0.4);
    }
    .vc-pc-vol {
      width: 84px;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }
    .vc-pc-vol::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ffb066;
      box-shadow: 0 0 6px rgba(255, 176, 102, 0.8);
      cursor: pointer;
    }
    .vc-pc-vol::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border: none;
      border-radius: 50%;
      background: #ffb066;
      box-shadow: 0 0 6px rgba(255, 176, 102, 0.8);
      cursor: pointer;
    }
    .vc-pc-label {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      min-width: 26px;
      text-align: right;
    }

    @media (max-width: 640px) {
      .vc-pc-bar { top: 148px; right: 12px; padding: 6px 9px; gap: 6px; }
      .vc-pc-vol { width: 60px; }
    }
  `;
  document.head.appendChild(style);
}

// player: { play, pause, mute, unMute, setVolume }
export function initPlayerControls({ player }) {
  injectStyle();

  const bar = document.createElement('div');
  bar.className = 'vc-pc-bar';

  const playBtn = document.createElement('button');
  playBtn.className = 'vc-pc-btn';
  playBtn.type = 'button';
  playBtn.textContent = '⏸';
  playBtn.title = '再生 / 一時停止';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'vc-pc-btn';
  muteBtn.type = 'button';
  muteBtn.textContent = '🔊';
  muteBtn.title = 'ミュート切替';

  const vol = document.createElement('input');
  vol.className = 'vc-pc-vol';
  vol.type = 'range';
  vol.min = '0';
  vol.max = '100';
  vol.value = '70';
  vol.title = '音量';

  const label = document.createElement('span');
  label.className = 'vc-pc-label';
  label.textContent = '70';

  bar.append(playBtn, muteBtn, vol, label);
  document.body.appendChild(bar);

  let playing = true;
  let muted = false;
  let lastVolume = 70;

  // 初期音量を反映（プレイヤー準備前でも、後続の操作で確実に効く）
  player.setVolume(lastVolume);

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
    lastVolume = Number(vol.value);
    label.textContent = String(lastVolume);
    player.setVolume(lastVolume);
    // 音量を動かしたらミュートは自然に解除する
    if (muted && lastVolume > 0) {
      muted = false;
      muteBtn.textContent = '🔊';
      player.unMute();
    }
  });

  return {
    element: bar,
    setVisible(v) {
      bar.style.display = v ? 'flex' : 'none';
    },
  };
}
