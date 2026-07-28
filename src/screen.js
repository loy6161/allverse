import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// デモ用の埋め込み動画ID（24時間ライブ配信・埋め込み許可されているもの）
// 本番ではイベント配信のIDに差し替える（将来はサーバーから配信IDを受け取る）
const VIDEO_ID = 'unrobrGhlv0'; // clubVERSE関連動画（loyさん指定）
// 本番はイベントのYouTube生配信のIDに差し替える。ライブでも仕組みは同一

// ステージのLEDスクリーン位置に合わせたYouTube埋め込みレイヤー（CSS3D方式）
// - 入場前: 空（背後のWebGL製「VERSE CITY」スクリーンが見える）
// - play() 呼び出しで iframe を生成して再生開始（入場ボタンのクリックが
//   ユーザー操作になるので、音声つき自動再生が許可されやすい）
export function initLiveScreen(camera) {
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  const layer = cssRenderer.domElement;
  layer.style.position = 'fixed';
  layer.style.inset = '0';
  layer.style.zIndex = '5'; // WebGLキャンバスより上、HUD/チャット(z=10+)より下
  layer.style.pointerEvents = 'none';
  document.body.appendChild(layer);

  const cssScene = new THREE.Scene();

  // WebGLスクリーン（14x7、world座標(0, 5.4, -19.05)）と同じ場所・サイズ
  const PX_W = 1120;
  const PX_H = 560;
  const holder = document.createElement('div');
  holder.style.width = `${PX_W}px`;
  holder.style.height = `${PX_H}px`;
  holder.style.background = 'transparent';
  holder.style.pointerEvents = 'none';

  const cssObj = new CSS3DObject(holder);
  cssObj.position.set(0, 5.4, -18.95);
  cssObj.scale.setScalar(14 / PX_W);
  cssScene.add(cssObj);

  let started = false;
  let currentVideoId = VIDEO_ID;
  let iframe = null;

  function mountIframe(videoId) {
    if (iframe) holder.removeChild(iframe);
    iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    holder.appendChild(iframe);
  }

  // 入場ボタンのクリック（ユーザー操作）を起点に再生開始する
  function play(videoId) {
    if (videoId) currentVideoId = videoId;
    if (started) return;
    started = true;
    holder.style.background = '#000';
    holder.style.pointerEvents = 'auto'; // プレイヤー操作（一時停止・音量等）を可能に
    mountIframe(currentVideoId);
  }

  // 会場の共有スクリーンを別の動画に差し替える（サーバー経由で全員に届く）
  function setVideo(videoId) {
    if (!videoId || videoId === currentVideoId) return;
    currentVideoId = videoId;
    if (started) mountIframe(currentVideoId);
  }

  function getVideo() {
    return currentVideoId;
  }

  function update() {
    cssRenderer.render(cssScene, camera);
  }

  window.addEventListener('resize', () => {
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { play, setVideo, getVideo, update };
}
