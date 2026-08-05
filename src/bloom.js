// ============================================================
// ブルーム（明るいところがにじむポストプロセス・2026-08-04追加）
//
// loyさん「VRはワールドにブルームかかってるけど、ブラウザでもそういう
//          ポストプロセスのようなことはできるの？」
//
// ⚠ ここを three の EffectComposer で組まない理由（実測したうえでの判断）
//   この会場のキャンバスは **透過（alpha:true）** で、スクリーン面には
//   「色を書かず深度だけ書く」穴が開いている（screen.js）。その穴から背後の
//   YouTube の iframe が見える。
//   EffectComposer + UnrealBloomPass + OutputPass を素直に通すと、最後の合成で
//   アルファが 1 で塗り潰され、**透明な画素が 14.9% → 0% になって穴が塞がった**
//   （＝映像が消える）。なので合成だけは自前で書き、
//       出力 = vec4(元の色 + にじみ, **元のアルファ**)
//   にしてある。にじみにも元のアルファを掛けて、穴の上へ光が漏れないようにしている。
//
// 手順（1フレームぶん）
//   1. 会場を画面ではなく baseRT へ描く（MSAA付きなのでギザギザは出ない）
//   2. 明るいところだけ抜き出す（しきい値。アバターはアルファの目印で外す）… 1/4
//   3. 横→縦の順にぼかす（1往復）… 1/4と1/8の解像度
//   4. 画面へ合成する（上の式）
//
// 負荷は「会場を描く回数」は増えない（描き先が変わるだけ）。増えるのは型紙と
// 小さな四角を数枚描くぶん。実測 +1.7ms（20人・568x872。2.19 → 3.87ms）。
// ============================================================

import * as THREE from 'three';
import { NO_BLOOM_ALPHA } from './layers.js';

// ⚠ 色の空間について（ここを間違えると画面が真っ暗になる。実際になった）
//   three r160 は「画面へ描くとき」だけ sRGB へ変換し、**描き先が
//   レンダーターゲットのときは常にリニアのまま**書き込む
//   （renderTarget.texture.colorSpace は無視される）。
//   最初 baseRT に SRGBColorSpace を立てて済ませたつもりでいたら、
//   平均の明るさが 0.103 → 0.022 まで落ちた（＝リニアのまま画面に出た）。
//   なので **最後の合成でこちらが sRGB に変換する**。しきい値もリニアで見る。

// ⚠ 効き具合は**絵を並べて決めた**（2026-08-04）。
//   最初の設定（0.45 / 0.2 / 0.85）は画面の平均が +3% しか変わらず、
//   loyさん「ブルームは何がひかってる？なってるかわからんぞ」。
//   3案を同じ構図で撮って比べた実測:
//     0.45 / 0.85 … 平均 0.168 → 0.173（+3%）  ほぼ分からない
//     **0.30 / 1.60 … 平均 0.168 → 0.209（+24%）** 採用。ネオンと床のロゴが光る
//     0.20 / 2.40 … 平均 0.168 → 0.244（+45%）  にじみ過ぎて文字が潰れる

/** 明るさのしきい値。これより暗いところは光らない（トーンマッピング前のリニア値） */
const THRESHOLD = 0.3;
/** しきい値のなだらかさ。0だと境目がくっきり出て輪郭が汚くなる */
const KNEE = 0.25;
/** にじみの強さ */
const STRENGTH = 1.6;

/**
 * 目印のアルファかどうかを見る幅。
 * 16bit浮動小数と拡大縮小の誤差があるので、ぴったり比較はできない。
 * 0.99 の前後だけを拾い、ふつうの不透明(1.0)と穴(0.0)には掛からない幅にしてある。
 */
const NO_BLOOM_MIN = NO_BLOOM_ALPHA - 0.004;
const NO_BLOOM_MAX = NO_BLOOM_ALPHA + 0.004;

/** シェーダーの頭に定数を差し込む（GLSLには定数を共有する仕組みが無いので文字で入れる） */
const GLSL_CONSTS = `
const float NO_BLOOM_MIN = ${NO_BLOOM_MIN};
const float NO_BLOOM_MAX = ${NO_BLOOM_MAX};
`;

const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 明るいところだけ残す。アルファは元のまま持ち越す（穴を光らせないため） */
const BRIGHT_FRAG = `
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  // しきい値のまわりをなめらかにする（くっきり切ると輪郭が出る）
  float w = smoothstep(uThreshold - uKnee, uThreshold + uKnee, l);
  // ★ アバターの上では光らせない。
  //   アバターは服の色を emissive にも入れているので、外さないと
  //   **本人だけが電球のように光る**（loyさん「ブルームはアバターがヒカルだけ？」）。
  //   目印はアルファ（avatar_glb.js が 0.99 で描いている）。
  //   もう一度描いて型紙を作る方式は人数ぶん重くなったのでやめた（layers.js 参照）
  if (c.a > NO_BLOOM_MIN && c.a < NO_BLOOM_MAX) w = 0.0;
  gl_FragColor = vec4(c.rgb * w * c.a, c.a);
}
`;

/**
 * 横か縦のどちらかにぼかす（uDir で切り替える）。
 *
 * ⚠ 9点で読んでいたのを**5点**にした（2026-08-04）。
 *   画素の中間を読むと、拡大縮小の仕組みが勝手に2点を混ぜてくれるので、
 *   5回の読み取りで9点ぶんと同じ形のぼけになる。読み取り回数は約半分。
 *   loyさんの実測でブルームが +36ms（描画がもう1回ぶん）だったので、
 *   ぼかしの読み取り回数を削るのが一番効いた。
 */
const BLUR_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 sum = texture2D(tSrc, vUv) * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture2D(tSrc, vUv + o1) + texture2D(tSrc, vUv - o1)) * 0.3162162162;
  sum += (texture2D(tSrc, vUv + o2) + texture2D(tSrc, vUv - o2)) * 0.0702702703;
  gl_FragColor = sum;
}
`;

/**
 * 画面への合成。
 * ★ここが肝：アルファは **元の絵のもの** をそのまま出す。
 *   にじみにも元のアルファを掛けるので、スクリーンの穴の上に光が乗らない。
 */
const COMPOSITE_FRAG = `
uniform sampler2D tBase;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform float uStrength;
uniform float uExposure;
varying vec2 vUv;
/** リニア → sRGB。three が画面へ描くときにやっている変換と同じ式 */
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, step(c, vec3(0.0031308)));
}
/**
 * ACES。three の ACESFilmicToneMapping と同じ式をそのまま持ってきている。
 * ⚠ three は**描き先がレンダーターゲットのときトーンマッピングを掛けない**ので、
 *   ここで自分で掛ける。忘れると画面全体が明るく浅くなる
 *   （実測: にじみ0でも平均 0.176 → 0.199 になった）
 */
vec3 acesFilmic(vec3 color) {
  const mat3 inMat = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 outMat = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
  );
  color *= uExposure / 0.6;
  color = inMat * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = outMat * (a / b);
  return clamp(color, 0.0, 1.0);
}
void main() {
  vec4 base = texture2D(tBase, vUv);
  // アバターの目印（0.99）は画面に出す前に 1 へ戻す。
  // そのまま出すと、その画素だけ 1% 透けてページの背景が混ざる
  float outA = (base.a > NO_BLOOM_MIN && base.a < NO_BLOOM_MAX) ? 1.0 : base.a;
  vec3 glow = texture2D(tBloom1, vUv).rgb * 0.6 + texture2D(tBloom2, vUv).rgb * 0.4;
  // ★ 半透明の画素は色にアルファが掛かった状態で入っている（描くときの混ぜ方の都合）。
  //   割り戻してから sRGB にして、最後にまた掛ける。
  //   これを飛ばすと、**空が見えている所（半透明）だけ暗く濁る**
  //   （実測: 白い壁ぬけの画素が 94,101,141 → 34,40,47 になった）
  float a = max(base.a, 0.0001);
  vec3 straight = base.a > 0.0001 ? base.rgb / a : vec3(0.0);
  // にじみを足してから ACES → sRGB の順（本来の絵作りと同じ順番）
  vec3 lit = toSRGB(acesFilmic(straight + glow * uStrength));
  gl_FragColor = vec4(lit * outA, outA);
}
`;

/**
 * 描き先を1枚作る。
 * @param {number} samples MSAAの枚数（0でオフ）
 * @param {boolean} depth 深度バッファを持つか。
 *   ⚠ 会場を描く先には**必ず要る**。samples の有無で決めていたら、
 *     MSAAを切るスマホで深度が無くなり、奥のものが手前に出る絵になっていた
 */
function makeRT(w, h, samples, depth, hdr = true) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: depth,
    stencilBuffer: false,
    samples,
  });
  // ⚠ colorSpace は立てない。r160 のレンダーターゲットは常にリニアで書かれるので、
  //   ここで sRGB を名乗らせると **サンプルした値の解釈だけがズレる**。
  //   変換は最後の合成シェーダーが1回だけ行う（上の注意書き参照）
  return rt;
}

/**
 * ブルームを作る。
 *
 * ⚠ 会場を描く先の**形式は「速さ」で決めている**（2026-08-04・loyさんの実測を受けて）。
 *   loyさんの環境ではブルームONで 22fps → 16fps（+16ms）。こちらの機械では
 *   誤差に埋もれて再現しなかったので、**帯域が効く条件（2560x1440）で個別に測った**:
 *     画面へ直接                     2.36ms
 *     16bit浮動小数・MSAA4（旧）     3.97ms  ← 1画素32バイト
 *     8bit・MSAA4                    3.26ms  ← 16バイト
 *     8bit・MSAA2（採用）            ほぼ同じ ← 8バイト
 *     8bit・MSAA0                    3.23ms  ← 4バイト
 *   16bit浮動小数にしていたのは「明るすぎる部分が頭打ちにならないように」だが、
 *   **4種類の絵を比べても平均の明るさは 0.1364〜0.1369 で差が出なかった**
 *   （この会場には1.0を大きく超える明るさが無い）。見た目が同じなら軽い方を採る。
 *   MSAAを0にせず2にしているのは、会場に細い柱が多く、動くとちらつくため。
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {{samples?:number, hdr?:boolean}} [opt]
 *   samples … MSAAの枚数。0でオフ（スマホ想定）
 *   hdr … 明るさを1.0より上まで保つか。既定は false（上の実測のとおり見た目が同じで軽い）
 */
export function createBloom(renderer, { samples = 2, hdr = false } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  let w = Math.round(size.x * dpr);
  let h = Math.round(size.y * dpr);

  // 会場そのものを描く先。ここだけMSAA付き（キャンバスの antialias は
  // 描き先を変えると効かなくなるので、こちらで持つ）
  const baseRT = makeRT(w, h, samples, true, hdr);
  // にじみ用。**1/4 と 1/8**（2026-08-04に 1/2・1/4 から下げた）。
  // にじみは元々ぼやけた絵なので、解像度を半分にしても見た目はほぼ変わらないが、
  // 塗る画素の数は 1/4 になる。ping-pong に2枚ずつ要る
  const rtA = makeRT(Math.round(w / 4), Math.round(h / 4), 0, false);
  const rtB = makeRT(Math.round(w / 4), Math.round(h / 4), 0, false);
  const rtC = makeRT(Math.round(w / 8), Math.round(h / 8), 0, false);
  const rtD = makeRT(Math.round(w / 8), Math.round(h / 8), 0, false);

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.Camera();
  const quadMesh = new THREE.Mesh(quadGeo, null);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uThreshold: { value: THRESHOLD },
      uKnee: { value: KNEE },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: GLSL_CONSTS + BRIGHT_FRAG,
    depthTest: false,
    depthWrite: false,
    // ⚠ 混ぜない（そのまま書く）。混ぜる設定のままだと、書いた色にもう一度
    //   アルファが掛かって**半透明の所が二重に薄くなる**。四角が画面全体を
    //   覆うので、消してから描く必要もない
    blending: THREE.NoBlending,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null },
      tBloom1: { value: null },
      tBloom2: { value: null },
      uStrength: { value: STRENGTH },
      uExposure: { value: 1 },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: GLSL_CONSTS + COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  /** 四角を1枚描く。target が null なら画面へ */
  function draw(mat, target) {
    quadMesh.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  /**
   * src を横→縦の順にぼかして dst へ。tmp は同じ大きさの作業用。
   *
   * ⚠ 往復の回数はそのまま値段になる（1往復＝2枚塗る）。
   *   5点読み取りに変えてぼけの幅が広がったので、**1往復で足りる**ようになった。
   *   絵で確かめてから減らしている（ブロック状に見えないこと）。
   */
  function blurInto(src, tmp, dst, passes = 1) {
    const iw = dst.width;
    const ih = dst.height;
    let from = src;
    for (let i = 0; i < passes; i++) {
      const step = i + 1; // 2往復目は倍の幅で広げる
      blurMat.uniforms.tSrc.value = from.texture;
      blurMat.uniforms.uDir.value.set(step / iw, 0);
      draw(blurMat, tmp);
      blurMat.uniforms.tSrc.value = tmp.texture;
      blurMat.uniforms.uDir.value.set(0, step / ih);
      draw(blurMat, dst);
      from = dst;
    }
  }

  return {
    /**
     * 本編を描く（renderer.render(scene, camera) の代わり）。
     * このあとに小窓（selfview）を描いても大丈夫なように、最後は必ず画面へ戻す。
     */
    render(scene, camera) {
      const oldAutoClear = renderer.autoClear;

      // 1. 会場を baseRT へ。透明のままにしたいので clearAlpha は 0
      renderer.setRenderTarget(baseRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.autoClear = false;

      // 2. 明るいところを抜く（1/4の解像度）。アバターはアルファの目印で外れる
      brightMat.uniforms.tSrc.value = baseRT.texture;
      draw(brightMat, rtA);

      // 3. ぼかす。1/4と1/8の2段を混ぜると、近くの光も遠くの光も出る
      blurInto(rtA, rtB, rtA);
      blurInto(rtA, rtD, rtC);

      // 4. 画面へ合成（アルファは元のまま＝穴が残る）
      renderer.autoClear = true;
      // 露出は明るさ5段階で変わる（world_club.js）。毎フレーム今の値を渡す
      compMat.uniforms.uExposure.value = renderer.toneMappingExposure;
      compMat.uniforms.tBase.value = baseRT.texture;
      compMat.uniforms.tBloom1.value = rtA.texture;
      compMat.uniforms.tBloom2.value = rtC.texture;
      draw(compMat, null);

      renderer.autoClear = oldAutoClear;
      renderer.setRenderTarget(null);
    },
    /** 効き具合の調整（見た目を詰めるときに window.__vc.bloom から触る） */
    setParams({ threshold, knee, strength } = {}) {
      if (typeof threshold === 'number') brightMat.uniforms.uThreshold.value = threshold;
      if (typeof knee === 'number') brightMat.uniforms.uKnee.value = knee;
      if (typeof strength === 'number') compMat.uniforms.uStrength.value = strength;
      return {
        threshold: brightMat.uniforms.uThreshold.value,
        knee: brightMat.uniforms.uKnee.value,
        strength: compMat.uniforms.uStrength.value,
      };
    },
    setSize(width, height) {
      const p = renderer.getPixelRatio();
      w = Math.round(width * p);
      h = Math.round(height * p);
      const h4 = Math.max(1, Math.round(w / 4));
      const v4 = Math.max(1, Math.round(h / 4));
      const h8 = Math.max(1, Math.round(w / 8));
      const v8 = Math.max(1, Math.round(h / 8));
      baseRT.setSize(w, h);
      rtA.setSize(h4, v4);
      rtB.setSize(h4, v4);
      rtC.setSize(h8, v8);
      rtD.setSize(h8, v8);
    },
    dispose() {
      for (const rt of [baseRT, rtA, rtB, rtC, rtD]) rt.dispose();
      quadGeo.dispose();
      brightMat.dispose();
      blurMat.dispose();
      compMat.dispose();
    },
  };
}
