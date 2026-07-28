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
//
// 【前後関係について】
// YouTubeのiframeはWebGLの中に描けないため、素直に重ねるとスクリーンが常に手前になり、
// スクリーンの前に立ったアバターが映像に隠れてしまう。
// そこで iframe を「キャンバスの後ろ」に置き、キャンバス側のスクリーン面を
// 「色を書かず深度だけ書くマテリアル」にして穴を開ける。
// これで映像は穴から見え、手前のアバターはキャンバスに描かれて映像の上に出る。
export function initLiveScreen(camera, scene) {
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  const layer = cssRenderer.domElement;
  layer.style.position = 'fixed';
  layer.style.inset = '0';
  layer.style.zIndex = '1'; // WebGLキャンバス(z=2)より後ろ
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
  let interactive = false;

  // ワールド側のLEDスクリーン面（PlaneGeometry 14x7）を探して、
  // 再生中は「深度だけ書いて色を書かない」マテリアルに差し替える＝穴を開ける。
  // ワールド側はスクリーン位置に複数の面（映像面・発光面など）を重ねているので、
  // 該当する面はすべて対象にしないと、残った面が映像を覆ってしまう。
  const screenMeshes = [];
  const originalMaterials = new Map();
  const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

  function findScreenMeshes() {
    if (!scene || screenMeshes.length) return;
    const wp = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry && o.geometry.parameters;
      if (!p || p.width !== 14 || p.height !== 7) return;
      o.getWorldPosition(wp);
      // スクリーン位置(0, 5.4, -18.95)の近傍にあるものだけを対象にする
      if (Math.abs(wp.x) < 1 && Math.abs(wp.y - 5.4) < 1 && Math.abs(wp.z + 18.95) < 1.5) {
        if (!screenMeshes.includes(o)) screenMeshes.push(o);
      }
    });
  }

  function setOccluder(on) {
    findScreenMeshes();
    for (const mesh of screenMeshes) {
      if (on) {
        if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
        mesh.material = occluderMaterial;
        // three は不透明物をマテリアル単位でまとめてから奥行き順に描くため、
        // 何もしないとスクリーン枠などが穴より先に描かれて塞いでしまう。
        // 最初に描いて深度を書き込むことで、後ろのものを確実に隠す。
        mesh.renderOrder = -1;
      } else if (originalMaterials.has(mesh)) {
        mesh.material = originalMaterials.get(mesh);
        mesh.renderOrder = 0;
      }
    }
  }

  function mountIframe(videoId) {
    if (iframe) holder.removeChild(iframe);
    iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    // enablejsapi=1 と origin 指定で、postMessage による再生・音量操作が有効になる
    const origin = encodeURIComponent(location.origin);
    iframe.src =
      `https://www.youtube.com/embed/${videoId}` +
      `?autoplay=1&mute=0&playsinline=1&rel=0&enablejsapi=1&origin=${origin}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    holder.appendChild(iframe);
    // 読み込み後に listening を送ると、再生位置などが定期的に送られてくる
    iframe.addEventListener('load', () => {
      startListening();
      setTimeout(startListening, 1000); // 取りこぼし対策
    });
  }

  // 入場ボタンのクリック（ユーザー操作）を起点に再生開始する
  function play(videoId) {
    if (videoId) currentVideoId = videoId;
    if (started) return;
    started = true;
    holder.style.background = '#000';
    setOccluder(true); // スクリーン面に穴を開けて、後ろのiframeを見せる
    mountIframe(currentVideoId);
  }

  // プレイヤーを直接操作したいとき（一時停止・音量）だけ、一時的に前面へ出す。
  // 前面にある間はアバターより手前に描かれるので、操作が終わったら戻す。
  function setInteractive(on) {
    interactive = !!on;
    layer.style.zIndex = interactive ? '6' : '1';
    holder.style.pointerEvents = interactive ? 'auto' : 'none';
    return interactive;
  }

  function toggleInteractive() {
    return setInteractive(!interactive);
  }

  // ---- プレイヤー操作（YouTube IFrame API を postMessage で呼ぶ） ----
  // スクリーンは3D空間の奥にあって直接クリックしづらいので、
  // 別UI（playerctl.js）からここを経由して再生・音量を操作する。
  function command(func, args = []) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com',
      );
    } catch (e) {
      // プレイヤー未準備などは無視（次の操作で効く）
    }
  }

  // YouTubeから再生位置・長さ・再生状態を受け取る（listening を送ると定期的に届く）
  const stateListeners = new Set();
  const state = { currentTime: 0, duration: 0, playing: true, live: false };

  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://www.youtube.com') return;
    let data;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch (err) {
      return;
    }
    if (!data || !data.info) return;
    const info = data.info;
    if (typeof info.currentTime === 'number') state.currentTime = info.currentTime;
    if (typeof info.duration === 'number') {
      state.duration = info.duration;
      // ライブ配信は duration が 0 や極端に大きい値になる
      state.live = !info.duration || info.duration > 86400;
    }
    if (typeof info.playerState === 'number') state.playing = info.playerState === 1;
    for (const cb of stateListeners) cb({ ...state });
  });

  function startListening() {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        'https://www.youtube.com',
      );
    } catch (e) {
      // まだ準備できていない場合は次の呼び出しで届く
    }
  }

  const player = {
    play: () => command('playVideo'),
    pause: () => command('pauseVideo'),
    mute: () => command('mute'),
    unMute: () => command('unMute'),
    setVolume: (v) => command('setVolume', [Math.max(0, Math.min(100, Math.round(v)))]),
    seekTo: (sec) => command('seekTo', [Math.max(0, sec), true]),
    onState: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    getState: () => ({ ...state }),
  };

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

  return { play, setVideo, getVideo, update, setInteractive, toggleInteractive, player };
}
