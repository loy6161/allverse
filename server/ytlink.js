// ============================================================
// YouTubeのチャンネルと、ブラウザ会場にいる本人を結びつける（2026-08-03追加）
//
// なぜ「合言葉」方式なのか（経緯は docs/WHY.md §29）:
//   本人確認の正攻法は Google の OAuth で YouTube の権限をもらうことだが、
//   それには Google の審査が要り、審査前は100人までという上限もかかる。
//   イベントのたびに人が入れ替わる会場には向かない。
//   代わりに「会場で出した合言葉を、YouTubeのチャットに打ってもらう」。
//   そのチャンネルから合言葉が出てきた＝そのチャンネルの持ち主は
//   いまこの会場にいる本人、と判断できる。審査も上限も要らない。
//
// 結びつけの鍵（linkKey）は client.visitor をそのまま使う。
//   ログイン済み … `u:<メールのハッシュ>` ／ ゲスト … `g:<ブラウザ保存の匿名ID>`
//   **メールアドレスそのものは持たない**（イベント記録と同じ方針）。
// ============================================================

import { saveYtLink, loadYtLinks, deleteYtLinksFor } from './store.js';

/** 合言葉の有効期間。長すぎると他人が拾って打てるので短くする */
const CODE_TTL_MS = 10 * 60_000;

/** 合言葉に使う文字。見間違えるもの（0/O・1/I/l）を外してある */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;

/** 合言葉の頭。チャットの中から見つけやすく、普通の会話と衝突しないようにする */
const CODE_PREFIX = 'AV-';

/** 合言葉の形。チャット本文から抜き出すのに使う */
const CODE_RE = new RegExp(`${CODE_PREFIX}[${CODE_CHARS}]{${CODE_LEN}}`, 'i');

/** channelId -> linkKey（保存済みの結びつき。起動時にDBから読む） */
const links = new Map();

/** 合言葉 -> { linkKey, expiresAt }（発行中で、まだ打たれていないもの） */
const pending = new Map();

/** 起動時にDBから読み込む。DBが無い（メモリ運用）ときは空のまま動く */
export async function initYtLinks() {
  const rows = await loadYtLinks();
  links.clear();
  for (const r of rows) links.set(r.channelId, r.linkKey);
  return links.size;
}

/** いま何件結びついているか（管理者向けの状態表示用） */
export function ytLinkCount() {
  return links.size;
}

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `${CODE_PREFIX}${s}`;
}

/** 期限切れの合言葉を捨てる。発行のたびに呼ぶので専用のタイマーは要らない */
function sweep(now = Date.now()) {
  for (const [code, v] of pending) {
    if (v.expiresAt <= now) pending.delete(code);
  }
}

/**
 * 合言葉を発行する。
 * 同じ人が何度も押したときは、前のものを捨ててから出す
 * （古い合言葉が生きていると、どちらを打てばいいのか分からなくなる）。
 * @returns {{code: string, expiresAt: number}}
 */
export function issueCode(linkKey) {
  const now = Date.now();
  sweep(now);
  for (const [code, v] of pending) {
    if (v.linkKey === linkKey) pending.delete(code);
  }
  let code = randomCode();
  // 万一かぶったら引き直す（31^4 = 約92万通りなので実際にはほぼ起きない）
  let guard = 0;
  while (pending.has(code) && guard++ < 10) code = randomCode();
  const expiresAt = now + CODE_TTL_MS;
  pending.set(code, { linkKey, expiresAt });
  return { code, expiresAt };
}

/** 発行済みの合言葉を取り消す（画面を閉じたときなど） */
export function cancelCodesFor(linkKey) {
  for (const [code, v] of pending) {
    if (v.linkKey === linkKey) pending.delete(code);
  }
}

/**
 * YouTubeの発言1件を受けて、結びつきを判定する。
 *
 * @param {{channelId:string, name:string, text:string}} msg
 * @returns {{linkKey:string, justLinked:boolean}|null}
 *   結びついている人のもの（または今まさに結びついた）なら linkKey を返す。
 *   関係ない人の発言なら null（＝吹き出しは出さない）。
 */
export function matchMessage(msg) {
  if (!msg || !msg.channelId) return null;

  // 既に結びついている人か
  const known = links.get(msg.channelId);
  if (known) return { linkKey: known, justLinked: false };

  // 合言葉が含まれているか
  const hit = CODE_RE.exec(msg.text || '');
  if (!hit) return null;
  const code = hit[0].toUpperCase();
  const p = pending.get(code);
  if (!p) return null;
  if (p.expiresAt <= Date.now()) {
    pending.delete(code);
    return null;
  }

  // 結びついた。合言葉は使い捨て（同じ合言葉を他人が打っても効かないように）
  pending.delete(code);
  links.set(msg.channelId, p.linkKey);
  // 保存は待たない。失敗しても今の会は動き、次回また合言葉を打てばよい
  saveYtLink({
    channelId: msg.channelId,
    linkKey: p.linkKey,
    ytName: msg.name || '',
    createdAt: Date.now(),
  }).catch(() => {});

  return { linkKey: p.linkKey, justLinked: true };
}

/** その人の結びつきを解除する（本人が「連携をやめる」を押したとき） */
export async function unlink(linkKey) {
  let n = 0;
  for (const [channelId, key] of links) {
    if (key === linkKey) {
      links.delete(channelId);
      n++;
    }
  }
  cancelCodesFor(linkKey);
  if (n) await deleteYtLinksFor(linkKey).catch(() => {});
  return n;
}

/** その人が既に結びついているか（画面に「連携済み」と出すため） */
export function isLinked(linkKey) {
  for (const key of links.values()) {
    if (key === linkKey) return true;
  }
  return false;
}
