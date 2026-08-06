import { GUEST_HAIR } from './guestlook.js';

// ------------------------------------------------------------------
// 髪の3分割（2026-08-06・loyさん指示「髪の長さ・髪型・前髪の3つの組み合わせ」）
//
// それまでは髪型が1つのidだった（'twin' が「ボブ＋ツインテール」を指す等）。
// 3つに分けたことで 3×4×4=48通りになったが、**古いidも受け取れないといけない**:
//   ・端末に保存された前回の姿（localStorage）
//   ・サーバーに保存されたプロフィール
//   ・VRChat側（PRESENCE_SPEC.md 付録A。向こうは今も1つのidで持っている）
//
// そこで、
//   古いid → 3つ  … LEGACY_HAIR（読むとき）
//   3つ → 古いid  … legacyHairId（送るとき。av.h に載せて互換を保つ）
// の両方向をここ1か所に置く。**変換をあちこちに散らさない。**
// ------------------------------------------------------------------

// ⚠ 一覧はここが原本。avatar.js の AVATAR_PARTS はここを読む。
//   （逆にすると three を読み込めないサーバー側のテストから触れなくなる）
/** 髪の長さ */
export const HAIR_LENGTHS = ['long', 'bob', 'short'];
/** 髪型（結い方）。'none' は結わない */
export const HAIR_ARRANGES = ['none', 'twin', 'bun', 'pony'];
/** 前髪。std=中央V字（従来） */
export const BANGS = ['std', 'patsun', 'partr', 'partl'];

/** 古い髪型id → { hairLength, hairStyle, bangs } */
export const LEGACY_HAIR = {
  long: { hairLength: 'long', hairStyle: 'none', bangs: 'std' },
  bob: { hairLength: 'bob', hairStyle: 'none', bangs: 'std' },
  short: { hairLength: 'short', hairStyle: 'none', bangs: 'std' },
  twin: { hairLength: 'bob', hairStyle: 'twin', bangs: 'std' },
  bun: { hairLength: 'bob', hairStyle: 'bun', bangs: 'std' },
  pony: { hairLength: 'bob', hairStyle: 'pony', bangs: 'std' },
  patsun: { hairLength: 'bob', hairStyle: 'none', bangs: 'patsun' },
  partr: { hairLength: 'bob', hairStyle: 'none', bangs: 'partr' },
  partl: { hairLength: 'bob', hairStyle: 'none', bangs: 'partl' },
};

export const DEFAULT_HAIR = { hairLength: 'long', hairStyle: 'none', bangs: 'std' };

/**
 * どんな形で来ても { hairLength, hairStyle, bangs } に揃える。
 * ・3つが入っていればそれを使う（知らない値は既定に倒す）
 * ・入っていなければ古い hairStyle（'twin' 等）から読み替える
 * ・ゲストの「髪なし」はそのまま通す（hairLength = 'none'）
 * @param {object} config
 */
export function normalizeHair(config) {
  const c = config || {};
  // ゲスト（髪なし）。古い形は hairStyle に、新しい形は hairLength に入る
  if (c.hairLength === GUEST_HAIR || (c.hairLength == null && c.hairStyle === GUEST_HAIR)) {
    return { hairLength: GUEST_HAIR, hairStyle: 'none', bangs: 'std' };
  }
  // 古い保存データ: hairLength を持たず、hairStyle に古いidが入っている
  if (c.hairLength == null && LEGACY_HAIR[c.hairStyle]) {
    return { ...LEGACY_HAIR[c.hairStyle] };
  }
  return {
    hairLength: HAIR_LENGTHS.includes(c.hairLength) ? c.hairLength : DEFAULT_HAIR.hairLength,
    hairStyle: HAIR_ARRANGES.includes(c.hairStyle) ? c.hairStyle : DEFAULT_HAIR.hairStyle,
    bangs: BANGS.includes(c.bangs) ? c.bangs : DEFAULT_HAIR.bangs,
  };
}

/**
 * 3つ → 古い髪型id。VRChat側と古いクライアントのために av.h へ載せる。
 * 完全には表せないので**いちばん近いもの**を返す:
 *   結い方があればそれ（twin/bun/pony）→ 次に前髪（patsun/partr/partl）→ 最後に長さ
 * @param {{hairLength:string, hairStyle:string, bangs:string}} h
 */
export function legacyHairId(h) {
  if (h.hairLength === GUEST_HAIR) return GUEST_HAIR;
  if (h.hairStyle && h.hairStyle !== 'none') return h.hairStyle;
  if (h.bangs && h.bangs !== 'std') return h.bangs;
  return h.hairLength;
}
