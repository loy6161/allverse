// ============================================================
// ビデオ通話の音声（2026-08-08・loyさん「ビデオ通話は音声は使える？」）
//
// 映像は callview.js が**その場のアバターの顔**を写しているので、
// ここで足すのは**声だけ**。WebRTC でブラウザ同士を直接つなぐ。
//
// ★ なぜサーバーを通さないか
//   ・声をサーバーで中継すると、無料枠の通信量と負荷を音の分だけ食う
//   ・WebRTC なら**繋ぎ役（合図）だけ**サーバーを通り、音は本人同士で流れる
//   合図（offer / answer / ice）は既存の WebSocket に `rtc` として相乗りさせる
//
// ⚠ 制約（正直に書いておく）
//   ・**マイクの許可が要る**。断られたら通話は「映像だけ」で続ける（切らない）
//   ・NATの種類によっては繋がらないことがある。中継サーバー（TURN）を用意すれば
//     ほぼ繋がるが、**無料では置けない**ので今は入れていない（課金の相談が要る）
//   ・使うのは STUN（住所を教えてもらうだけの無料サーバー）まで
// ============================================================

/** 住所を教えてもらうだけの公開サーバー（無料・音声は通らない） */
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * 声のやりとりを1つ作る。
 *
 * @param {{ send:(msg:object)=>void, onState:(state:string)=>void }} opts
 *   send  … 相手へ合図を送る（サーバー経由）
 *   onState … 'asking'(マイク許可待ち) / 'live' / 'nomic' / 'failed' / 'off'
 */
export function createVoice({ send, onState = () => {} }) {
  /** @type {RTCPeerConnection|null} */
  let pc = null;
  /** @type {MediaStream|null} */
  let mic = null;
  /** 相手の声を鳴らす場所 */
  let audioEl = null;
  let peerId = '';
  /** 相手が先に ice を送ってきたときの置き場（offer/answer より先に届くことがある） */
  let pendingIce = [];

  function ensureAudio() {
    if (audioEl) return audioEl;
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    // ⚠ 画面には出さない。見えていても操作するものが無いため
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    return audioEl;
  }

  async function getMic() {
    if (mic) return mic;
    onState('asking');
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      return mic;
    } catch {
      // 断られた／マイクが無い。**通話は切らない**（顔は見えている）
      onState('nomic');
      return null;
    }
  }

  function makePc(id) {
    peerId = id;
    pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ to: peerId, kind: 'ice', data: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      ensureAudio().srcObject = e.streams[0];
      onState('live');
    };
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === 'failed') onState('failed');
    };
    return pc;
  }

  async function addMic() {
    const m = await getMic();
    if (!m || !pc) return;
    for (const track of m.getAudioTracks()) pc.addTrack(track, m);
  }

  return {
    /** 掛けた側。offer を作って送る */
    async call(id) {
      makePc(id);
      await addMic();
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      send({ to: id, kind: 'offer', data: { type: offer.type, sdp: offer.sdp } });
    },

    /** 合図が届いた */
    async onSignal({ from, kind, data }) {
      if (kind === 'offer') {
        makePc(from);
        await pc.setRemoteDescription(data);
        await addMic();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ to: from, kind: 'answer', data: { type: answer.type, sdp: answer.sdp } });
        // 先に届いていた ice を入れる
        for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
        pendingIce = [];
        return;
      }
      if (kind === 'answer') {
        if (!pc) return;
        await pc.setRemoteDescription(data);
        for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
        pendingIce = [];
        return;
      }
      if (kind === 'ice') {
        // ⚠ offer/answer より先に来ることがある。その場合は置いておく
        if (!pc || !pc.remoteDescription) {
          pendingIce.push(data);
          return;
        }
        await pc.addIceCandidate(data).catch(() => {});
      }
    },

    /** 自分の声を止める・出す */
    setMuted(muted) {
      if (!mic) return;
      for (const t of mic.getAudioTracks()) t.enabled = !muted;
    },

    /** 通話が終わった。マイクも必ず離す（ランプが点いたままにしない） */
    stop() {
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      }
      pc = null;
      if (mic) {
        for (const t of mic.getTracks()) t.stop();
      }
      mic = null;
      if (audioEl) audioEl.srcObject = null;
      pendingIce = [];
      peerId = '';
      onState('off');
    },
  };
}
