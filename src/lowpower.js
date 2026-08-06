// ============================================================
// 軽量モード（2026-08-06追加）
//
// loyさん「ハードウェア アクセラレーションONにはしないよ。
//          VRやってるときにGPUはVRに回すためにそうしてる」
//
// つまり**この会場はCPUで描かれる前提**で成立させる必要がある。
// GPUのときと効き方が違い、効く順に:
//   1. 塗る画素の数（いちばん効く）
//   2. 影（実質もう1回描くのと同じ）
//   3. ライトの数（1画素あたりの計算量に直結する）
// 描画コールの数は（GPUのときほど）効かないので、アバターのメッシュ統合は後回しにした。
//
// 実測（1493x861・NPC29体・同じ画面）: GPUあり 2.83ms / loyさんの環境 42.8ms ＝ 約15倍。
//
// ⚠ この3つを別々のスイッチにしない。loyさんの選択（2026-08-06）は
//   「軽量モード（まとめて1つ）」。迷わず押せることを優先する。
// ============================================================

const STORE_KEY = 'vc-lowpower';

/** 軽量モードのときの描画の細かさ。1.0の70%＝塗る画素はおよそ半分になる */
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
 * @param {boolean} p.baseShadow ふだん影を出しているか（スマホは元から出していない）
 * @param {() => void} [p.onResize] 描画の細かさが変わったときに大きさを配り直す相手
 */
export function createLowPower({
  renderer, scene, world, basePixelRatio, baseShadow, onResize,
}) {
  let on = false;

  function apply() {
    // 1. 塗る画素を減らす。canvas の見た目の大きさは変えないので、
    //    小さく描いたものをブラウザが引き伸ばす（少しぼやける代わりに速い）
    renderer.setPixelRatio(on ? basePixelRatio * LOW_SCALE : basePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 2. 影を切る。
    //    ⚠ three は影の有無で**シェーダーを作り直す**必要がある。
    //      needsUpdate を立てないと、切り替えた瞬間に真っ黒になったり影が残ったりする
    const wantShadow = baseShadow && !on;
    if (renderer.shadowMap.enabled !== wantShadow) {
      renderer.shadowMap.enabled = wantShadow;
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }

    // 3. ライトを減らす（会場が持っている判断に任せる）
    if (world && world.setLowPower) world.setLowPower(on);

    if (onResize) onResize();
  }

  return {
    setEnabled(v) {
      on = Boolean(v);
      apply();
    },
    isEnabled: () => on,
    /** いまの描画の細かさ（fps表示の解像度欄が拾う） */
    scale: () => (on ? LOW_SCALE : 1),
  };
}
