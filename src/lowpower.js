// ============================================================
// 軽量モード（2026-08-06追加）
//
// loyさん「ハードウェア アクセラレーションONにはしないよ。
//          VRやってるときにGPUはVRに回すためにそうしてる」
//
// つまり**この会場はCPUで描かれる前提**で成立させる必要がある。
// GPUのときと効き方が違い、効く順に:
//   1. 塗る画素の数（いちばん効く）
//   2. ライトの数（1画素あたりの計算量に直結する）
//   ※ 影は元から出していないので落としようがない（main.js 参照）
// 描画コールの数は（GPUのときほど）効かないので、アバターのメッシュ統合は後回しにした。
//
// 実測（1493x861・NPC29体・同じ画面）: GPUあり 2.83ms / loyさんの環境 42.8ms ＝ 約15倍。
//
// ⚠ この3つを別々のスイッチにしない。loyさんの選択（2026-08-06）は
//   「軽量モード（まとめて1つ）」。迷わず押せることを優先する。
// ============================================================

const STORE_KEY = 'vc-lowpower';

/**
 * 内訳を測るための切り分け（2026-08-06追加・URLに付けるだけ。UIには出さない）。
 *
 * loyさん「影は影響してなかったってことは、照明1つと画質での軽量だったわけで、
 *          画質がどこまで影響してるかによるよね。照明だけの負荷だったのか。」
 *
 * ⚠ こちらの機械（GPUあり）では**内訳を測れない**。3840x2160 まで上げても
 *   2.5ms前後で頭打ちになり、解像度もライトも差が誤差に埋もれた。
 *   CPUで描いているloyさんの環境で測るしかないので、URLで片方だけ効かせられるようにする。
 *
 *   ?low=scale … 画質だけ7割に落とす（照明はそのまま）
 *   ?low=light … 照明だけ1つ消す（画質はそのまま）
 *   ?low=both  … 両方（⚙設定のONと同じ）
 *
 * 指定があるときは⚙設定より優先し、保存もしない（測り終えたらURLを外すだけで元に戻る）。
 */
function urlOverride() {
  try {
    const q = new URLSearchParams(location.search).get('low');
    if (q === 'scale' || q === 'light' || q === 'both') return q;
  } catch {
    /* URLが読めない環境でも普通に動かす */
  }
  return null;
}

/** 軽量モードのときの描画の細かさ。1.0の70%＝塗る画素はおよそ半分になる。
 *  実測（loyさんの環境・NPC29体）: 1384x861 で 24fps → 968x602 で 43fps */
const LOW_SCALE = 0.7;

/** 軽量モードにするか。既定はOFF（見た目を落とすので、本人が選んだときだけ） */
export function getLowPower() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLowPowerPref(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}

/**
 * 軽量モードの中身を作る。
 *
 * @param {object} p
 * @param {import('three').WebGLRenderer} p.renderer
 * @param {import('three').Scene} p.scene
 * @param {object} p.world 会場（setLowPower を持っていれば呼ぶ）
 * @param {number} p.basePixelRatio ふだんの描画の細かさ
 * @param {() => void} [p.onResize] 描画の細かさが変わったときに大きさを配り直す相手
 */
export function createLowPower({ renderer, world, basePixelRatio, onResize }) {
  const override = urlOverride();
  let on = false;

  /** いま画質を落とすか（URL指定があればそちらが勝つ） */
  const wantScale = () => (override ? override === 'scale' || override === 'both' : on);
  /** いま照明を減らすか（同上） */
  const wantLight = () => (override ? override === 'light' || override === 'both' : on);

  function apply() {
    // 1. 塗る画素を減らす。canvas の見た目の大きさは変えないので、
    //    小さく描いたものをブラウザが引き伸ばす（少しぼやける代わりに速い）
    renderer.setPixelRatio(wantScale() ? basePixelRatio * LOW_SCALE : basePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 2. ライトを減らす（会場が持っている判断に任せる）
    //    ※ 影の切り替えはここに無い。会場では最初から影を出していないため（main.js 参照）
    if (world && world.setLowPower) world.setLowPower(wantLight());

    if (onResize) onResize();
  }

  return {
    setEnabled(v) {
      on = Boolean(v);
      apply();
    },
    isEnabled: () => on,
    /** いまの描画の細かさ（fps表示の解像度欄が拾う） */
    scale: () => (wantScale() ? LOW_SCALE : 1),
    /** 測定用の指定が効いているか。fps表示に出して、見間違いを防ぐ */
    override: () => override,
  };
}
