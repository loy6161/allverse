// ============================================================
// エモートバーの好み（並び順・出し方）を端末に覚える（2026-08-03追加）
//
// loyさんの要望:
//   > エモートはページ切り替えじゃなくて2段にもできるようにしたいね。選べる方がいい。
//   > で、エモートの配置はドラッグで入れ替え出来たらいいね。
//
// なぜ端末ごとに持つのか:
//   画面の広さも、よく使うエモートも人によって違う。
//   会場ぜんぶで揃える種類の設定ではないと判断した（吹き出しの時間と同じ考え方）。
// ============================================================

const LAYOUT_KEY = 'vc.emoteLayout';
const ORDER_KEY = 'vc.emoteOrder';

/** 'page' … 6個ずつ1段で、0キーで切り替え ／ 'rows' … 12個を2段で全部出す */
export const LAYOUTS = ['page', 'rows'];
export const DEFAULT_LAYOUT = 'page';

export function getEmoteLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return LAYOUTS.includes(v) ? v : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function setEmoteLayout(v) {
  const val = LAYOUTS.includes(v) ? v : DEFAULT_LAYOUT;
  try {
    localStorage.setItem(LAYOUT_KEY, val);
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return val;
}

/**
 * 並び順を読む。
 * @param {string[]} defaults 既定の並び（全12種のid）
 * @returns {string[]} 保存された並び。壊れていたら既定
 */
export function getEmoteOrder(defaults) {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...defaults];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [...defaults];
    // 保存後にエモートが増減している可能性がある。
    // 「保存にあって今も存在するもの」→「保存に無い新しいもの」の順に整える。
    // ⚠ ここを雑にすると、追加したエモートが二度と出てこなくなる
    const known = new Set(defaults);
    const kept = arr.filter((id) => known.has(id));
    const seen = new Set(kept);
    const added = defaults.filter((id) => !seen.has(id));
    const merged = [...kept, ...added];
    return merged.length === defaults.length ? merged : [...defaults];
  } catch {
    return [...defaults];
  }
}

export function setEmoteOrder(order) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* noop */
  }
  return order;
}

export function resetEmoteOrder() {
  try {
    localStorage.removeItem(ORDER_KEY);
  } catch {
    /* noop */
  }
}
