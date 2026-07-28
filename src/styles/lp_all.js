// 12案を比較ページに1案ずつ登録するためのラッパー群を動的に作る。
// （lab.js は STYLE_INFO と createStyleAvatar を持つモジュールを読み込む仕様）
import { LP_VARIANTS, createLowPoly } from './lp.js';

export { LP_VARIANTS, createLowPoly };

// 個別モジュールを作らずに済むよう、lab.js 側から直接使えるリストも公開する
export const LP_LIST = Object.entries(LP_VARIANTS).map(([id, v]) => ({
  id,
  name: v.name,
  desc: `髪:${v.hair} / 服:${v.outfit} / 目:${v.eyeType}`,
  create: (config) => createLowPoly(id, config),
}));
