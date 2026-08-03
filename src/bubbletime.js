// ============================================================
// 吹き出しの表示時間（2026-08-03追加）
//
// loyさんの要望:
//   > 吹き出しに出現時間をもっと長くしないと読めないかも。（設定で時間指定もいいね）
//
// なぜ延ばすか:
//   これまで4秒固定だった。会場を歩きながら読むには短く、
//   とくにYouTube連動では吹き出しが発言の本命の見え方になるため、
//   読み切れないと機能そのものが成立しない。
//
// 保存先はブラウザ（端末ごと）。人によって読む速さが違うので、
// 会場ぜんぶで揃える種類の設定ではないと判断した。
// ============================================================

const KEY = 'vc.bubbleSec';
const CHAT_EMOTE_KEY = 'vc.chatEmote';

/** 既定。4秒だと読み切れないという指摘を受けて延ばした */
export const DEFAULT_BUBBLE_SEC = 8;

/** 選べる値。「ずっと」は会話を追いたいとき用（次の発言で置き換わる） */
export const BUBBLE_CHOICES = [4, 6, 8, 12, 20, 0];

/** 0 は「消さない」を意味する */
export const BUBBLE_FOREVER = 0;

export function getBubbleSec() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_BUBBLE_SEC;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_BUBBLE_SEC;
    return n;
  } catch {
    return DEFAULT_BUBBLE_SEC;
  }
}

export function setBubbleSec(sec) {
  const n = Number(sec);
  const v = Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUBBLE_SEC;
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return v;
}

/** 表示用の名前 */
export function bubbleLabel(sec) {
  return sec === BUBBLE_FOREVER ? '消さない' : `${sec}秒`;
}

/**
 * 実際に使うミリ秒。0（消さない）は「非常に長い」に読み替える。
 * ⚠ 本当に消さないと、古い吹き出しが残り続けて会場が文字だらけになるので、
 *   上限として10分で消す。次の発言が来れば、そのとき置き換わる
 */
export function bubbleMs() {
  const sec = getBubbleSec();
  if (sec === BUBBLE_FOREVER) return 10 * 60 * 1000;
  return sec * 1000;
}

// ============================================================
// YouTubeのコメントで自分のアバターを動かすか（2026-08-03追加）
//
// loyさん「吹き出しと同じようにユーザー設定でいいと思う」。
// 端末に保存し、入場のたびにサーバーへ送り直す（サーバーは覚えない）。
// 既定はON——連携した人にとっては「動くこと」自体が見返りなので、
// わざわざ探して有効にしてもらう形にはしない。
// ============================================================

export function getChatEmote() {
  try {
    return localStorage.getItem(CHAT_EMOTE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setChatEmote(on) {
  try {
    localStorage.setItem(CHAT_EMOTE_KEY, on ? 'on' : 'off');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}
