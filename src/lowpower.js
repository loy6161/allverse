// ============================================================
// 軽くするための設定（2026-08-06追加）
//
// loyさん「ハードウェア アクセラレーションONにはしないよ。
//          VRやってるときにGPUはVRに回すためにそうしてる」
//
// つまり**この会場はCPUで描かれる前提**で成立させる必要がある。
// GPUのときと効き方が違い、効く順に:
//   1. 塗る画素の数（いちばん効くはず）
//   2. ライトの数（1画素あたりの計算量に直結する）
//   ※ 影は元から出していないので落としようがない（main.js 参照）
// 描画コールの数は（GPUのときほど）効かないので、アバターのメッシュ統合は後回しにした。
//
// 実測（1493x861・NPC29体・同じ画面）: GPUあり 2.83ms / loyさんの環境 42.8ms ＝ 約15倍。
//
// ⚠ **1つのスイッチにまとめない**（2026-08-06 方針変更）。
//   最初は「軽量モード」1つにまとめ、内訳を測るためにURL（?low=scale）を足したが、
//   loyさん「出来てないと思う。?low=scaleでぼやけてない。
//            それより普通に設定でそれぞれON/OFFつけた方が早くね？」。
//   そのとおりで、設定から個別に切れば**ページを開き直さずにfpsの差が見える**。
//   URLの仕組みは役目が無くなったので消した。
// ============================================================

const SCALE_KEY = 'vc-lowscale';
const LIGHT_KEY = 'vc-lowlight';

/** 画質を下げるときの細かさ。0.7＝塗る画素はおよそ半分になる。
 *  実測（loyさんの環境・NPC29体）: 1384x861 で 24fps → 968x602 で 43fps
 *  （このときは照明を減らすのと同時だったので、内訳は未確定） */
const LOW_SCALE = 0.7;

function read(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}

/** 画質を下げるか。既定はOFF（ぼやけるので、本人が選んだときだけ） */
export const getRenderScaleLow = () => read(SCALE_KEY);
export const setRenderScaleLow = (on) => write(SCALE_KEY, on);

/** 照明を1つ減らすか。既定はOFF */
export const getLightCut = () => read(LIGHT_KEY);
export const setLightCut = (on) => write(LIGHT_KEY, on);

/**
 * 軽くする設定の実体。
 *
 * @param {object} p
 * @param {import('three').WebGLRenderer} p.renderer
 * @param {object} p.world 会場（setLowPower を持っていれば呼ぶ）
 * @param {number} p.basePixelRatio ふだんの描画の細かさ
 * @param {() => void} [p.onResize] 描画の細かさが変わったときに大きさを配り直す相手
 */
export function createLowPower({ renderer, world, basePixelRatio, onResize }) {
  let scaleLow = getRenderScaleLow();
  let lightCut = getLightCut();

  function applyScale() {
    // canvas の見た目の大きさは変えないので、小さく描いたものをブラウザが引き伸ばす
    //（少しぼやける代わりに速い）
    renderer.setPixelRatio(scaleLow ? basePixelRatio * LOW_SCALE : basePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (onResize) onResize();
  }

  function applyLight() {
    if (world && world.setLowPower) world.setLowPower(lightCut);
  }

  applyScale();
  applyLight();

  return {
    setRenderScaleLow(v) {
      scaleLow = Boolean(v);
      applyScale();
    },
    setLightCut(v) {
      lightCut = Boolean(v);
      applyLight();
    },
    /** いまの描画の細かさ（1 か 0.7） */
    scale: () => (scaleLow ? LOW_SCALE : 1),
  };
}
