// ------------------------------------------------------------------
// 髪の飾り（運営専用パラメータ）の一覧。2026-08-07追加。
//
// loyさん方針: 出演者（いま20人・今後増える）の固有性を、**アイテムを増やさず**
// パラメータで出す。3Dパーツを足さないので、何人増えてもアセットは増えない。
//
// ⚠ 一覧はここが原本（three を読み込まないので、サーバー側からも読める）。
//   使えるのは管理者・VIPだけ。落とす処理は staffonly.js。
// ------------------------------------------------------------------

/** 前髪メッシュの本数 */
export const STREAK_COUNTS = [1, 2, 3];

/**
 * 前髪メッシュの位置（本人から見た左右）。
 * 値は髪ジオメトリの**局所座標x**での中心。局所xは左右で、+が本人の左。
 * 既定（2026-08-06にloyさんが選んだ位置）は -0.13。
 */
export const STREAK_POSITIONS = [
  { id: 'outR', label: '右外', x: -0.19 },
  { id: 'r', label: '右', x: -0.13 },
  { id: 'c', label: '中央', x: -0.03 },
  { id: 'l', label: '左', x: 0.13 },
  { id: 'outL', label: '左外', x: 0.19 },
];

/** 前髪メッシュの太さ（局所座標での半分の幅） */
export const STREAK_WIDTHS = [
  { id: 'thin', label: '細', hw: 0.018 },
  { id: 'mid', label: '中', hw: 0.025 },
  { id: 'wide', label: '太', hw: 0.038 },
];

/** 本数が2本以上のときの間隔（局所座標） */
export const STREAK_GAP = 0.055;

/** 既定値（何も選んでいない運営＝2026-08-06の見た目と同じになる） */
export const STREAK_DEFAULT = { count: 1, position: 'r', width: 'mid' };

/**
 * 選んだidから、シェーダーに渡す数値へ変換する。
 * 知らない値は既定に倒す（古い保存データ・細工した通信の両方への備え）。
 */
export function streakShape(cfg) {
  const c = cfg || {};
  const count = STREAK_COUNTS.includes(Number(c.streakCount)) ? Number(c.streakCount) : STREAK_DEFAULT.count;
  const pos = STREAK_POSITIONS.find((p) => p.id === c.streakPosition)
    || STREAK_POSITIONS.find((p) => p.id === STREAK_DEFAULT.position);
  const w = STREAK_WIDTHS.find((p) => p.id === c.streakWidth)
    || STREAK_WIDTHS.find((p) => p.id === STREAK_DEFAULT.width);
  return { count, x: pos.x, hw: w.hw, gap: STREAK_GAP };
}
