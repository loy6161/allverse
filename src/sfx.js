// ============================================================
// 効果音（合成）
//
// 音声ファイルは持たず、Web Audio API でその場で作る。
// 読み込み待ちが無く、配信の音を邪魔しない小さな音だけを鳴らす。
//
// ブラウザは「ユーザー操作の前に音を鳴らす」ことを禁じているので、
// AudioContext は最初の再生要求のときに作る（入場ボタンの後になる）。
// ============================================================

let ctx = null;
let master = null;
let enabled = true;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35; // 配信の音を邪魔しない控えめな音量
  master.connect(ctx.destination);
  return ctx;
}

export function setSfxEnabled(v) {
  enabled = Boolean(v);
}

export function isSfxEnabled() {
  return enabled;
}

// 大人数が同時に拍手すると音が割れるので、鳴らす回数を絞る
let lastClapAt = 0;
let clapsInWindow = 0;
let windowStart = 0;
const CLAP_MIN_GAP_MS = 45;
const CLAP_MAX_PER_500MS = 8;

/**
 * 拍手音。短いノイズをバンドパスに通して「パン」という破裂音にする。
 * 1回の呼び出しで1打。エモート側から連続で呼ばれて拍手らしくなる。
 */
export function playClap() {
  if (!enabled) return;
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  const now = performance.now();
  if (now - lastClapAt < CLAP_MIN_GAP_MS) return;
  if (now - windowStart > 500) {
    windowStart = now;
    clapsInWindow = 0;
  }
  if (clapsInWindow >= CLAP_MAX_PER_500MS) return;
  lastClapAt = now;
  clapsInWindow += 1;

  const dur = 0.09;
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(rate * dur));
  const buffer = c.createBuffer(1, len, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // 立ち上がりが鋭く、すぐ消える減衰カーブ（手を打つ音の形）
    const t = i / len;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 5);
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  // 人によって手の大きさが違う感じを出すため、中心周波数を少し散らす
  bp.frequency.value = 1400 + Math.random() * 900;
  bp.Q.value = 0.9;

  const gain = c.createGain();
  gain.gain.value = 0.5 + Math.random() * 0.35;

  src.connect(bp);
  bp.connect(gain);
  gain.connect(master);
  src.start();
  src.stop(c.currentTime + dur + 0.02);
}
