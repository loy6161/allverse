// ============================================================
// アクセサリーの複数付け（2026-08-04追加）
//
// テストユーザーの要望（2026-08-03 本番テスト）:
//   > アクセサリーを複数付けたい
//
// ★ データの形は変えない。`av.ac` は文字列のまま、`+` でつないで複数を表す。
//   presence.json の契約（v=1）は凍結されていて、項目を増やすとVRChat側と
//   version を上げる相談が要る。文字列の中身の約束だけで済ませれば、
//   **形は1バイトも変わらない**（申し送り⑧「決定」参照）。
//
//   VRChat側が未対応なら "wing+halo" は知らないidとして none 扱いになるだけで壊れない。
//   1つだけ付けている人は今までどおり "halo" なので、大多数は影響を受けない。
//
// ⚠ サーバーとクライアントの両方から読む。片方だけで判定を書かないこと
//   （エモートの長さが2か所にあって食い違った件と同じ轍を踏まない）。
// ============================================================

/** 付けられるアクセサリー。'none' は「何も付けない」を表す特別な値 */
export const ACCESSORY_IDS = [
  'none', 'kemo', 'ahoge',
  'tail', 'wing', 'halo', 'ribbon', 'sunglasses', 'glasses',
  // 2026-08-06 追加: 前髪メッシュ（管理者・VIPだけが選べる）。
  // ⚠ これだけ**3Dパーツを持たない**。髪の材質に筋を描いて表す（avatar_glb.js）。
  //   3Dパーツを探しに行かないよう、読み込み側で 'mesh' を弾くこと
  'mesh',
];

/** 管理者・VIPだけが選べるアクセサリー（サーバーでも同じ判定を使う） */
export const STAFF_ONLY_ACCESSORIES = new Set(['mesh']);

/**
 * 権限で選べないものを落とす（2026-08-06追加）。
 * ⚠ 画面で隠すだけでは足りない。細工した通信で付けられてしまうので、
 *   サーバーの受け口でも必ずこれを通すこと。
 */
export function stripStaffOnly(raw, role) {
  const ok = role === 'admin' || role === 'vip';
  if (ok) return formatAccessories(raw);
  const kept = parseAccessories(raw).filter((id) => !STAFF_ONLY_ACCESSORIES.has(id));
  return kept.join('+');
}

/** 同時に付けられる数。増やしすぎると誰が誰だか分からなくなるので3つで止める */
export const MAX_ACCESSORIES = 3;

/**
 * 同じ場所に付くもの同士は同時に付けられない。
 *
 * いまのところ顔まわり（メガネとサングラス）だけ。
 * 天使の輪・リボン・けもみみは頭まわりだが、高さも位置も違うので同居できる。
 */
const EXCLUSIVE_GROUPS = [['sunglasses', 'glasses']];

const SEP = '+';

/**
 * 文字列 → idの配列。
 * 未知のid・重複・'none' の混入・同じ場所の重なりを落とし、最大数で切る。
 *
 * @param {string} raw `"halo"` / `"wing+halo"` / `"none"` など
 * @returns {string[]} 付けるidの配列。何も付けないなら空配列
 */
export function parseAccessories(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  const out = [];
  for (const part of raw.split(SEP)) {
    const id = part.trim();
    if (!id || id === 'none') continue;
    if (!ACCESSORY_IDS.includes(id)) continue; // 知らないidは黙って捨てる
    if (out.includes(id)) continue;
    // 同じ場所のものが既にあるなら、先に選ばれている方を優先する
    const clash = EXCLUSIVE_GROUPS.some(
      (g) => g.includes(id) && out.some((o) => g.includes(o)),
    );
    if (clash) continue;
    out.push(id);
    if (out.length >= MAX_ACCESSORIES) break;
  }
  return out;
}

/**
 * idの配列 → 保存・通信で使う文字列。
 * 何も無ければ `'none'`（従来と同じ値。古いデータと混ざっても平気にするため）。
 */
export function formatAccessories(ids) {
  const list = parseAccessories(Array.isArray(ids) ? ids.join(SEP) : ids);
  return list.length ? list.join(SEP) : 'none';
}

/** その id が付いているか（選択UIのチェック状態に使う） */
export function hasAccessory(raw, id) {
  return parseAccessories(raw).includes(id);
}

/**
 * 付ける／外すを切り替えた結果を返す。
 *
 * ⚠ 上限に達しているときに新しいものを足すと、**いちばん古いものが外れる**。
 *   「押したのに何も起きない」より、入れ替わってくれた方が迷わない。
 */
export function toggleAccessory(raw, id) {
  if (id === 'none') return 'none';
  if (!ACCESSORY_IDS.includes(id)) return formatAccessories(parseAccessories(raw));
  const list = parseAccessories(raw);
  if (list.includes(id)) return formatAccessories(list.filter((x) => x !== id));
  // 同じ場所のものが付いていたら、それを外してから付ける
  const group = EXCLUSIVE_GROUPS.find((g) => g.includes(id));
  let next = group ? list.filter((x) => !group.includes(x)) : list.slice();
  next.push(id);
  if (next.length > MAX_ACCESSORIES) next = next.slice(next.length - MAX_ACCESSORIES);
  return formatAccessories(next);
}
