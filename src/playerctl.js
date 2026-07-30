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
      /* 中身（再生・ミュート・音量・数値・ボタン4つ）に必要な幅は約330px。
         300pxにしていたため右端のボタンがパネルの外へ突き抜けていた（2026-07-30 修正）。
         下の flex-wrap と音量つまみの縮みで、幅が足りなくても切れないようにもしてある */
      width: 360px;
      max-width: calc(100vw - 32px);
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
      /* 入りきらないときは折り返す。ボタンを足しても外へ突き抜けない */
      flex-wrap: wrap;
      row-gap: 8px;
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
    /* 折り返すより先に音量つまみが縮むようにする（1段のまま収まる方が読みやすい） */
    .vc-vp-vol { flex: 1 1 72px; width: auto; min-width: 40px; }
    .vc-vp-vollabel {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
      min-width: 20px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 640px) {
      /* スマホでは画面が狭いので出しっぱなしにしない。
         右上の ⚙ を押したときだけ、操作キーより上に開く（積み方は style.css の変数） */
      .vc-video-panel {
        right: 12px;
        left: 12px;
        bottom: var(--m-panel-bottom);
        width: auto;
        padding: 8px 10px 9px;
      }
      /* 隠すのは vc-mobile（スマホ用UIが動いていて ⚙ が存在する）ときだけ。
         これを付けないと、PCで窓を細くしただけの人が動画操作に触れなくなる */
      body.vc-mobile .vc-video-panel { display: none; }
      body.vc-mobile.vc-m-video-open .vc-video-panel { display: flex; }

      /* 狭い画面では音量つまみをもっと縮めて、1段に収まる余地を広げる */
      .vc-vp-vol { flex: 1 1 40px; min-width: 32px; }
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
// onAction: ユーザーが再生/一時停止/シークを操作したときに呼ばれる ('play'|'pause'|'seek', 位置秒)
//           → 会場の全員に同じ操作を伝えるために使う（音量とミュートは各自の設定なので通知しない）
// onReload: 🔄 を押したとき。映像を読み込み直す（自分の画面だけ・他の人には影響しない）
export function initPlayerControls({ player, onAction, onReload }) {
  const notify = (type, pos) => {
    if (onAction) onAction(type, pos);
  };
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

  // 映像の読み込み直し。ライブが遅れて止まったときの復帰手段（2026-07-31 追加）
  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'vc-vp-btn';
  reloadBtn.type = 'button';
  reloadBtn.textContent = '🔄';
  reloadBtn.title = '映像を読み込み直す（自分の画面だけ）';
  reloadBtn.addEventListener('click', () => {
    if (onReload) onReload();
  });

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

  row.append(playBtn, reloadBtn, muteBtn, vol, volLabel, slot);
  panel.append(seekRow, row);
  document.body.appendChild(panel);

  let playing = true;
  let muted = false;
  let seeking = false;
  let adjustingVolume = false;
  let duration = 0;
  let live = false;
  let canSeek = true;

  player.setVolume(Number(vol.value));

  playBtn.addEventListener('click', () => {
    playing = !playing;
    if (playing) player.play();
    else player.pause();
    playBtn.textContent = playing ? '⏸' : '▶';
    // 会場の全員の再生状態を揃える（現在位置も一緒に送る）
    notify(playing ? 'play' : 'pause', player.getState().currentTime);
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

  // 音量つまみを操作している間は、プレイヤー側からの値でつまみを上書きしない
  vol.addEventListener('pointerdown', () => {
    adjustingVolume = true;
  });
  const endVolume = () => {
    adjustingVolume = false;
  };
  vol.addEventListener('pointerup', endVolume);
  vol.addEventListener('pointercancel', endVolume);

  // シーク操作中は再生位置の自動更新を止める（つまみが飛ばないように）
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  const endSeek = () => {
    if (!seeking) return;
    seeking = false;
    // ライブ配信ではシークしない（配信が止まるため）
    if (duration > 0 && !live && canSeek) {
      const pos = (Number(seek.value) / 1000) * duration;
      player.seekTo(pos);
      notify(playing ? 'play' : 'pause', pos); // 全員を同じ位置へ
    }
  };
  seek.addEventListener('pointerup', endSeek);
  seek.addEventListener('pointercancel', endSeek);
  seek.addEventListener('change', endSeek);

  // 再生状態の反映
  player.onState((s) => {
    duration = s.duration;
    live = s.live;
    canSeek = s.canSeek !== false;

    playing = s.playing;
    playBtn.textContent = playing ? '⏸' : '▶';

    // 動画の差し替え後などに、実際のプレイヤーの状態へ表示を合わせる
    if (typeof s.muted === 'boolean' && s.muted !== muted) {
      muted = s.muted;
      muteBtn.textContent = muted ? '🔇' : '🔊';
    }
    if (!adjustingVolume && typeof s.volume === 'number' && Math.abs(s.volume - Number(vol.value)) > 1) {
      vol.value = String(Math.round(s.volume));
      volLabel.textContent = vol.value;
    }

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
    /**
     * 共有操作（再生/一時停止・シーク）を触れるかどうか。
     * 音量とミュートは各自のローカル設定なので、ここでは制限しない。
     * @param {boolean} v
     */
    setControllable(v) {
      const on = Boolean(v);
      playBtn.style.display = on ? '' : 'none';
      seekRow.style.display = on ? '' : 'none';
      if (!on) {
        // 見るだけの人には「操作は管理者のみ」であることを伝える
        time.title = '再生の操作は管理者のみです';
      } else {
        time.title = '';
      }
    },
  };
}
