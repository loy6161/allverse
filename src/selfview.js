// ============================================================
// 自分のアバターの小窓（2026-08-04追加）
//
// loyさんの要望:
//   > VRCのデスクトップモードで、正面から見たアバターが常時画面済に表示できるやつあるじゃん？
//   > あんなやつつけれる？各自でON/OFF。
//   > 1人称やスクリーン全画面にしてても自分の動きがわかるから応援しやすくて良いかなって。
//   > エモートがわかればいいと思うから名前と吹き出しはいらないかな。
//   > 位置むずかしいね。結構レイアウトびっちりだよね。ドラッグで位置を移動できるようにするのは必要だね。
//
// ★ 作りの要点: **自分のアバターだけ**を、同じcanvasの一角にもう1回描く。
//
//   会場ごと描き直すと、clubVERSE は6万三角形あるので**描画が丸ごと2倍**になる。
//   アバターだけなら数千ポリゴンで、実質ただ同然。
//   three.js の layers を使い、専用カメラには**レイヤー1だけ**を見せている。
//
// ⚠ 名前と吹き出しは映さない（loyさん指示）。小窓が文字で埋まると、
//   肝心の「自分がどう動いているか」が見えなくなる。
// ⚠ 一人称・シアター表示のときも出したままにする。**そこが本来の使いどころ**
//   （自分のアバターが画面に居ないときこそ、動きを確認したい）。
// ============================================================

import * as THREE from 'three';
import { makeFloating, isFloatEnabled } from './floatwin.js';

const STYLE_ID = 'vc-selfview-style';
const STORE_KEY = 'vc-selfview-on';

/** 専用カメラが見るレイヤー。会場（レイヤー0）は映らない */
const LAYER = 1;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-selfview {
  position: fixed;
  left: 16px;
  /* ⚠ チャットの上に置く。210px だとチャットの帯と重なっていた
     （loyさん 2026-08-04「初期位置がチャットとかぶってるからもう少し上だね」）。
     チャットは高さ約320px＋下16pxなので、その上に余白を取ってここに置く */
  bottom: 372px;
  width: 200px;
  height: 200px;
  z-index: 12;
  border: 1px solid rgba(0,255,234,0.35);
  border-radius: 10px;
  box-shadow: 0 0 18px rgba(0,0,0,0.45);
  /* 中身は3Dのcanvasが背後で描くので、ここは透明のままにする。
     背景を付けるとアバターを覆い隠してしまう（canvasはこの要素より奥にある） */
  background: transparent;
  pointer-events: none;
}
/* 掴む帯と右下のつまみは触れるようにする（枠の中身はクリックを通してワールドを操作できる）。
   ⚠ つまみを入れ忘れると**大きさを変えられない**（2026-08-04 loyさん指摘） */
.vc-selfview .vc-float-head,
.vc-selfview .vc-float-resize { pointer-events: auto; }
.vc-selfview.vc-hidden { display: none; }
/* UI非表示（Hキー）に追従する */
body.vc-ui-hidden .vc-selfview { display: none; }
@media (max-width: 640px) {
  /* スマホは画面が狭く、動かせない（floatwinが無効）ので小さめに置く */
  .vc-selfview { width: 120px; height: 120px; left: 10px; bottom: 150px; }
}
`;
  document.head.appendChild(style);
}

/**
 * 小窓を出すか。**既定はON**（loyさん 2026-08-04「デフォルトで出してていいよ」）。
 * ⚠ 「まだ一度も選んでいない」と「OFFを選んだ」を区別する必要がある。
 *   `=== '1'` だけで見ると、OFFにしたのに次回また出てくる。
 */
function loadOn() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === null) return true; // 一度も触っていない → 既定ON
    return v === '1';
  } catch {
    return true;
  }
}

function saveOn(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
}

/** いま小窓を出す設定か（設定画面から読む） */
export function getSelfView() {
  return loadOn();
}

/** 小窓の出し入れを保存する（設定画面から書く） */
export function setSelfView(on) {
  saveOn(Boolean(on));
  return Boolean(on);
}

// ---- 床の反射（2026-08-04追加）----
//
// ⚠ 会場をもう1回描くので**負荷が上がる**。端末の性能に左右されるので、
//   会場全体の設定ではなく**自分の画面だけの設定**にしてある。
//   ⚙設定→表示設定は「自分の画面だけに効く設定」を置く場所（displaysettings.js の方針）。
const REFLECT_KEY = 'vc-reflection';

/**
 * 床の反射を出す設定か。**既定はON**（2026-08-04 loyさん指示「既定ONにして」）。
 *
 * ⚠ 「一度も選んでいない」と「OFFを選んだ」を区別すること。
 *   `=== '1'` だけで見ると、OFFにしたのに次回また出てくる（小窓で踏んだのと同じ穴）。
 */
export function getReflection() {
  try {
    const v = localStorage.getItem(REFLECT_KEY);
    if (v === null) return true; // 一度も触っていない → 既定ON
    return v === '1';
  } catch {
    return true;
  }
}

export function setReflectionPref(on) {
  try {
    localStorage.setItem(REFLECT_KEY, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}

// ---- ブルーム（2026-08-04追加）----
//
// loyさん「VRはワールドにブルームかかってるけど、ブラウザでもそういう
//          ポストプロセスのようなことはできるの？」
// VR側の見た目に寄せるものなので**既定はON**。反射と同じく端末ごとの設定。
const BLOOM_KEY = 'vc-bloom';

/** 明るいところをにじませるか。既定ON。「一度も選んでいない」とOFFを区別する */
export function getBloom() {
  try {
    const v = localStorage.getItem(BLOOM_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function setBloomPref(on) {
  try {
    localStorage.setItem(BLOOM_KEY, on ? '1' : '0');
  } catch {
    /* 保存できなくてもその場では効く */
  }
  return Boolean(on);
}

/**
 * 自分のアバターの小窓を作る。
 *
 * @param {object} p
 * @param {() => THREE.Object3D|null} p.getPlayer いまの自分のアバター（着替えで差し替わる）
 * @returns {{setEnabled:(on:boolean)=>void, isEnabled:()=>boolean, render:(renderer:THREE.WebGLRenderer, scene:THREE.Scene)=>void, reset:()=>void}}
 */
export function initSelfView({ getPlayer }) {
  injectStyle();

  const el = document.createElement('div');
  el.className = 'vc-selfview vc-hidden';
  document.body.appendChild(el);

  // 掴んで動かす・大きさを変える（チャットと同じ仕組み）。
  // loyさん「位置むずかしいね。結構レイアウトびっちりだよね。ドラッグで位置を移動できるようにするのは必要」
  if (isFloatEnabled()) {
    makeFloating(el, { key: 'selfview', title: '自分の姿', minW: 120, minH: 120 });
  }

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.layers.set(LAYER); // 会場は映さない。アバターだけ

  // 小窓専用の明かり。会場の明るさに左右されず、いつでも顔が見えるようにする。
  // ⚠ カメラの子にすることで、アバターを回り込んでも常に正面から当たる
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 1.2, 1.4);
  key.layers.set(LAYER);
  camera.add(key);
  const fill = new THREE.AmbientLight(0x9fb4d8, 1.6);
  fill.layers.set(LAYER);
  camera.add(fill);

  let enabled = loadOn();
  el.classList.toggle('vc-hidden', !enabled);

  /** 名前・吹き出しを一時的に外すために覚えておく入れ物 */
  const hidden = [];

  /**
   * アバターの部品を小窓にも映るようにする。
   *
   * ⚠ **毎フレームやる**。エモートで出る粒（星・花火・ハート）は後から足されるので、
   *   一度きりの設定だと小窓に映らない。ノード数は数十なので負荷は無視できる。
   * ⚠ 名前と吹き出しは `userData.uiSprite` が立っているので外す（loyさん指示）。
   */
  function syncLayers(player) {
    player.traverse((o) => {
      if (o.userData && o.userData.uiSprite) o.layers.disable(LAYER);
      else o.layers.enable(LAYER);
    });
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    saveOn(enabled);
    el.classList.toggle('vc-hidden', !enabled);
  }

  /**
   * 小窓を描く。**メインの描画のあとに呼ぶこと**。
   * 呼び出し側の renderer の状態（autoClear・scissor・viewport）は元に戻す。
   */
  function render(renderer, scene) {
    if (!enabled) return;
    const player = getPlayer ? getPlayer() : null;
    if (!player) return;
    if (el.classList.contains('vc-hidden')) return;
    // ⚠ **畳んだら描かない**。畳むと枠は帯だけの高さになるが、
    //   その帯の下にアバターが小さく描き残る（2026-08-04 loyさん「たたんでも小さく残ってる」）
    if (el.classList.contains('vc-float-folded')) return;

    // ⚠ 描くのは**帯の下だけ**。枠全体に描くと、不透明な帯の裏に頭が隠れ、
    //   そのぶん下がはみ出す（loyさん「ちょっと枠からはみ出してるね」）
    const rect = el.getBoundingClientRect();
    const head = el.querySelector('.vc-float-head');
    const headH = head ? head.getBoundingClientRect().height : 0;
    const top = rect.top + headH;
    const height = rect.height - headH;
    if (rect.width < 8 || height < 8) return;

    syncLayers(player);

    // ★ 一人称のときは本体が丸ごと隠れている（controls.js が `avatar.visible = false` にする）。
    //   そのままだと小窓にも映らないが、**一人称こそ自分の姿を見たい場面**なので、
    //   小窓を描くあいだだけ出す（loyさん 2026-08-04「1人称視点にすると消えちゃう」）。
    const wasHidden = player.visible === false;
    if (wasHidden) player.visible = true;

    // 名前と吹き出しは `uiSprite` で除外しているが、
    // 吹き出しは発言のたびに作り直されるため、取りこぼし対策で描画中だけ隠す
    hidden.length = 0;
    player.traverse((o) => {
      if (o.userData && o.userData.uiSprite && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });

    // アバターの正面へカメラを置く。アバターの向き（rotation.y）の**前方**に立つ。
    //
    // ⚠ **全身が入る距離**にすること。エモートは腕や脚の動きなので、
    //   顔に寄せると何をしているか分からない（loyさん「エモートがわかればいい」）。
    //   画角30度・この距離だと縦に約2.0m写る。いちばん背の高い設定(BIG≒1.36m)でも
    //   足元から頭上まで収まり、**エモートで腕を上げても・ジャンプで浮いても切れない**。
    //   ⚠ 3.0mだと余白が足りずはみ出した（2026-08-04 loyさん指摘）。詰めすぎない。
    const yaw = player.rotation.y;
    const dist = 3.7;
    const eyeY = 0.95;
    const lookY = 0.68; // 体の中心よりわずかに上。腕を上げるエモートのぶんを見込む
    camera.position.set(
      player.position.x + Math.sin(yaw) * dist,
      player.position.y + eyeY,
      player.position.z + Math.cos(yaw) * dist,
    );
    camera.lookAt(player.position.x, player.position.y + lookY, player.position.z);
    camera.aspect = rect.width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    // 画面座標 → WebGLの座標（下が0）へ
    const dpr = renderer.getPixelRatio();
    const h = renderer.domElement.clientHeight;
    const x = Math.round(rect.left);
    const y = Math.round(h - (top + height));
    const w = Math.round(rect.width);
    const hh = Math.round(height);

    const prevAutoClear = renderer.autoClear;
    const prevScissorTest = renderer.getScissorTest();
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, hh);
    renderer.setViewport(x, y, w, hh);
    // 小窓の中だけを暗く塗る。ここを飛ばすと会場の絵の上にアバターが重なって見づらい
    renderer.setClearColor(0x0a0d18, 0.82);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    // 元に戻す（戻し忘れると次のフレームの本編が小窓の大きさで描かれる）
    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth, h);
    renderer.setScissor(0, 0, renderer.domElement.clientWidth, h);
    renderer.setClearColor(prevClear, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    void dpr; // setViewport はCSSピクセルで受けるので画素比の換算は要らない

    for (const o of hidden) o.visible = true;
    hidden.length = 0;
    // 一人称のために隠されていたなら、隠したまま戻す（本編に自分が映り込まないように）
    if (wasHidden) player.visible = false;
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
    render,
    element: el,
  };
}
