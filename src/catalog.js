// ============================================================
// 商品カタログ — **モック**（2026-08-07）
//
// ★ itemId の付け方は **VRChat側の規則にそのまま合わせてあります**
//   （`U:\UNITY\WORLD\project\VERSE CITY2025\Docs\ECONOMY_DATA_DESIGN.md`）:
//     ・itemId は2バイトの通し番号。**0は「無効／空」に予約**、実データは1から
//     ・**並べ替え禁止。追加は末尾のみ。** 廃止しても欠番として残す
//   これを守っておけば、あとで台帳を共通化したとき**そのまま繋がります**。
//   逆にここで番号を振り直すと、両世界の持ち物が全部ズレます。
//
// ⚠ 値段・名前・見た目は**保存されない**ので後から自由に変えられます（VRC側と同じ考え方）。
//   変えてはいけないのは **id と並び順だけ**。
//
// ⚠ アイコンの絵文字は**古くからあるものだけ**を使う。新しい絵文字（🪴🪧🛋 など）は
//   Windowsの既定フォントに無く、□ で表示される（2026-08-07 実機のスクショで確認）。
//
// kind: 'wear' … アバターに着けられる（このブラウザで効く）
//       'prop' … 持ち物として持てるが、ブラウザにはまだ実体が無い（家具・飲み物など）
// ============================================================

export const CATEGORIES = [
  { id: 'wear', label: 'アバターの飾り' },
  { id: 'drink', label: 'バー' },
  { id: 'house', label: '家具' },
];

export const CATALOG = [
  // ---- アバターの飾り（ブラウザで実際に着けられる） ----
  { id: 1, name: 'けもみみ', cat: 'wear', kind: 'wear', price: 300, accessory: 'kemo', icon: '🐾' },
  { id: 2, name: 'アホ毛', cat: 'wear', kind: 'wear', price: 200, accessory: 'ahoge', icon: '🌱' },
  { id: 3, name: 'しっぽ', cat: 'wear', kind: 'wear', price: 400, accessory: 'tail', icon: '🦊' },
  { id: 4, name: '羽', cat: 'wear', kind: 'wear', price: 900, accessory: 'wing', icon: '🕊' },
  { id: 5, name: '天使の輪', cat: 'wear', kind: 'wear', price: 800, accessory: 'halo', icon: '😇' },
  { id: 6, name: 'リボン', cat: 'wear', kind: 'wear', price: 350, accessory: 'ribbon', icon: '🎀' },
  { id: 7, name: 'サングラス', cat: 'wear', kind: 'wear', price: 500, accessory: 'sunglasses', icon: '🕶' },
  { id: 8, name: 'メガネ', cat: 'wear', kind: 'wear', price: 450, accessory: 'glasses', icon: '👓' },
  // ---- バー（VRC側にある「ビールを飲む」に当たるもの。ブラウザは持ち物だけ） ----
  { id: 9, name: 'ビール', cat: 'drink', kind: 'prop', price: 120, icon: '🍺' },
  { id: 10, name: 'カクテル', cat: 'drink', kind: 'prop', price: 180, icon: '🍸' },
  { id: 11, name: 'ソフトドリンク', cat: 'drink', kind: 'prop', price: 80, icon: '🥤' },
  // ---- 家具（将来の「部屋を借りて住む」用。ブラウザにはまだ置けない） ----
  { id: 12, name: 'ソファ', cat: 'house', kind: 'prop', price: 2400, icon: '💺' },
  { id: 13, name: '観葉植物', cat: 'house', kind: 'prop', price: 700, icon: '🌿' },
  { id: 14, name: 'ポスター', cat: 'house', kind: 'prop', price: 500, icon: '🖼' },
  { id: 15, name: 'ネオンサイン', cat: 'house', kind: 'prop', price: 3000, icon: '💡' },
];

const BY_ID = new Map(CATALOG.map((it) => [it.id, it]));

export function itemById(id) {
  return BY_ID.get(Number(id)) || null;
}

/**
 * ガチャの中身（2026-08-07・モック）。
 * ⚠ 確率は**画面に必ず出す**方針（docs/SPEC_POINTS.md）。後で揉めないため。
 * ⚠ 本番では**サーバーが引く**。クライアントで引くと当たりを書き換えられる
 */
export const GACHA = {
  price: 200,
  pool: [
    { id: 15, weight: 2 },  // ネオンサイン（当たり）
    { id: 4, weight: 5 },   // 羽
    { id: 5, weight: 8 },   // 天使の輪
    { id: 12, weight: 5 },  // ソファ
    { id: 3, weight: 15 },  // しっぽ
    { id: 6, weight: 15 },  // リボン
    { id: 13, weight: 20 }, // 観葉植物
    { id: 9, weight: 30 },  // ビール（はずれ枠）
  ],
};

/** 重み → パーセント表示（画面に出す用） */
export function gachaOdds() {
  const total = GACHA.pool.reduce((s, e) => s + e.weight, 0);
  return GACHA.pool.map((e) => ({
    item: itemById(e.id),
    percent: +((e.weight / total) * 100).toFixed(1),
  }));
}

/** モックの抽選（本番はサーバー） */
export function drawGacha() {
  const total = GACHA.pool.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of GACHA.pool) {
    r -= e.weight;
    if (r <= 0) return itemById(e.id);
  }
  return itemById(GACHA.pool[GACHA.pool.length - 1].id);
}
