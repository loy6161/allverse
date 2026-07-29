import * as THREE from 'three';
import { createWorld } from './world.js';
import { createAvatar } from './avatar.js';
import { preloadAvatars } from './avatar_glb.js';
import { initJoinScreen, openCustomizer } from './join.js';
import { initMobile } from './mobile.js';
import { initChat } from './chat.js';
import { initSimPlayers } from './players.js';
import { initControls } from './controls.js';
import { initLiveScreen } from './screen.js';
import { initNet } from './net.js';
import { initRemotePlayers } from './remote.js';
import { initEmoteBar } from './emotebar.js';
import { initScreenUI } from './screenui.js';
import { initViewMode } from './viewmode.js';
import { initPlayerControls } from './playerctl.js';

preloadAvatars(); // GLBアバターを先読み（入場前にロードを済ませる）

const canvas = document.getElementById('scene');
// alpha:true = キャンバスを透過可能にする。スクリーン面に開けた「穴」から
// 背後のYouTube iframeを見せ、手前のアバターはキャンバス側に描くため（screen.js参照）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// タッチ端末（スマホ想定）では負荷軽減のため影を無効化
const IS_TOUCH =
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || location.search.includes('mobile=1');
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 6, 14);
camera.lookAt(0, 1, 0);

// タッチ端末は負荷を抑えた構成でワールドを作る（反射・粒子数など）
const world = createWorld(scene, { lowSpec: IS_TOUCH });

// 背景色はキャンバスではなくページ側で持つ（キャンバスを透過させるため）。
// 見た目は変わらないが、スクリーン面の穴から背後のiframeが見えるようになる。
const skyColor = scene.background && scene.background.isColor ? scene.background : null;
if (skyColor) {
  document.body.style.background = `#${skyColor.getHexString()}`;
  scene.background = null;
}

const liveScreen = initLiveScreen(camera, scene);

let player = null;
let controls = null;
let chat = null;
let sim = null;
let net = null;
let remote = null;
let myId = null;
let demoMode = false;
let screenUI = null;

// 現在のプレイヤー情報（再カスタムで書き換わる）
const session = { name: '', config: null };

const hud = document.getElementById('hud');
const chatRoot = document.getElementById('chat-root');
const playerCountEl = document.getElementById('player-count');
const roomNameEl = document.getElementById('room-name');
const avatarBtn = document.getElementById('avatar-btn');

// ?npc=1 でNPC（賑やかし）をネットワークモードでも追加できる
const WANT_NPC = new URLSearchParams(location.search).get('npc') === '1';

function updateCount(serverCount) {
  const npc = sim ? sim.players.length : 0;
  const others = remote ? remote.count() : 0;
  const total = serverCount != null ? serverCount + npc : 1 + others + npc;
  playerCountEl.textContent = `${total} 人`;
}

// サーバーに繋がらない/切断されたときは従来のNPCデモに切り替える
function startDemoMode() {
  if (demoMode) return;
  demoMode = true;
  if (remote) remote.clear();
  if (!sim) {
    sim = initSimPlayers(scene, {
      count: 7,
      bounds: world.bounds,
      onChat: (n, t) => chat.addMessage(n, t),
    });
  }
  chat.addMessage('', 'オフラインデモモード（同期サーバー未接続）', { system: true });
  updateCount(null);
}

initJoinScreen(({ name, config }) => {
  // 入場ボタンのクリック（ユーザー操作）を起点にライブ再生を開始する
  liveScreen.play();

  session.name = name;
  session.config = { ...config };

  player = createAvatar({ ...config, name });
  player.position.copy(world.spawnPoint);
  scene.add(player);

  controls = initControls(camera, player, renderer.domElement, {
    bounds: world.bounds,
    // 自分は物理でジャンプするが、他の人の画面ではジャンプのモーションとして見せる
    onJump: () => {
      if (net && !demoMode) net.sendEmote('jump');
    },
  });

  chat = initChat({
    onSend: (text) => {
      chat.addMessage(session.name, text, { self: true });
      if (player.userData.say) player.userData.say(text);
      if (net && !demoMode) net.sendChat(text);
    },
  });

  // リアルタイム同期へ接続（失敗時は onDisconnect → NPCデモにフォールバック）
  remote = initRemotePlayers(scene);
  net = initNet({
    name,
    config,
    handlers: {
      onWelcome: ({ id, room, peers, count, screen, playback }) => {
        myId = id;
        roomNameEl.textContent = `VERSE CITY #${room}`;
        peers.forEach((p) => remote.addPeer(p));
        updateCount(count);
        // 途中入場でも、その部屋で今流れている動画と再生位置に合わせる
        if (screen) {
          liveScreen.setVideo(screen);
          if (screenUI) screenUI.setCurrent(screen);
        }
        if (playback) liveScreen.player.applySync(playback);
      },
      onPeerJoin: (p) => {
        remote.addPeer(p);
        chat.addMessage('', `${p.n} が入場しました`, { system: true });
      },
      onPeerMove: (m) => remote.movePeer(m),
      onPeerUpdate: (m) => remote.updatePeer(m),
      onPeerLeave: (id) => remote.removePeer(id),
      onChat: (m) => {
        if (m.id === myId) return; // 自分の発言はローカルで表示済み
        chat.addMessage(m.n, m.txt);
        remote.say(m.id, m.txt);
      },
      onCount: (c) => updateCount(c),
      onPeerEmote: (m) => remote.emote(m.id, m.e),
      onScreen: ({ v, by }) => {
        liveScreen.setVideo(v);
        if (screenUI) screenUI.setCurrent(v);
        chat.addMessage('', `${by} がスクリーンを変更しました`, { system: true });
      },
      // 他の人の再生/一時停止/シークを自分の映像にも反映する
      onPlayback: (pb) => liveScreen.player.applySync(pb),
      onDisconnect: () => startDemoMode(),
    },
  });

  if (WANT_NPC) {
    sim = initSimPlayers(scene, {
      count: 7,
      bounds: world.bounds,
      onChat: (n, t) => chat.addMessage(n, t),
    });
  }

  updateCount(null);
  hud.classList.remove('hidden');
  chatRoot.classList.remove('hidden');
  avatarBtn.classList.remove('hidden');

  // エモートバー（自分の分はローカルで即再生し、サーバーへも通知）
  initEmoteBar({
    onEmote: (id) => {
      if (player.userData.playEmote) player.userData.playEmote(id);
      if (net && !demoMode) net.sendEmote(id);
    },
  });

  // 右下の動画パネル（再生・音量・シーク）。シアター表示と動画変更のボタンもここに入れる
  const videoPanel = initPlayerControls({
    player: liveScreen.player,
    // 再生/一時停止/シークは会場全員で揃える（音量・ミュートは各自の設定なので送らない）
    onAction: (type, pos) => {
      if (net && !demoMode) net.sendPlayback(type === 'pause' ? 'pause' : 'play', pos);
    },
  });

  // スクリーン変更パネル（会場全員のスクリーンが切り替わる共有状態）
  screenUI = initScreenUI({
    slot: videoPanel.slot,
    onChange: (videoId) => {
      if (net && !demoMode) {
        net.sendScreen(videoId); // サーバー経由で全員に反映（自分にも返ってくる）
      } else {
        liveScreen.setVideo(videoId); // オフラインデモ時は自分の画面だけ
        screenUI.setCurrent(videoId);
      }
    },
  });
  screenUI.setCurrent(liveScreen.getVideo());

  // スクリーン全画面（シアター）＝動画パネル内 ／ UI表示切替＝画面右上のアイコン
  initViewMode({ controls, slot: videoPanel.slot });

  // Pキー: スクリーンを一時的に手前に出してYouTubeプレイヤーを直接操作できるようにする
  // （普段は映像がアバターの後ろに来るよう背面に置いているため）
  window.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key.toLowerCase() !== 'p' || e.repeat) return;
    e.preventDefault();
    const on = liveScreen.toggleInteractive();
    chat.addMessage(
      '',
      on ? 'スクリーンを操作モードにしました（もう一度Pで戻す）' : 'スクリーンを通常表示に戻しました',
      { system: true },
    );
  });

  // スマホ対応（タッチ端末 or ?mobile=1 のときだけ有効化される）
  initMobile({ controls, chatRoot });
});

// ---- 入場後のアバター再カスタム ----
avatarBtn.addEventListener('click', () => {
  openCustomizer({
    name: session.name,
    config: session.config,
    onApply: ({ name, config }) => {
      session.name = name;
      session.config = { ...config };

      // 位置と向きを保ったままアバターを作り直す
      const pos = player.position.clone();
      const rotY = player.rotation.y;
      scene.remove(player);
      player = createAvatar({ ...config, name });
      player.position.copy(pos);
      player.rotation.y = rotY;
      scene.add(player);
      controls.setAvatar(player);

      chat.addMessage('', `${name} がアバターを変更しました`, { system: true });
      if (net && !demoMode) net.sendUpdate(name, config);
    },
  });
});

const clock = new THREE.Clock();
const prevPos = new THREE.Vector3();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (world.update) world.update(dt, t);

  if (player) {
    controls.update(dt);
    if (player.userData.update) player.userData.update(dt);
    if (sim) sim.update(dt);
    if (remote) remote.update(dt);

    // 自分の位置をサーバーへ（net.js側で10Hzスロットル＋変化なしスキップ）
    if (net && !demoMode) {
      const moving = prevPos.distanceToSquared(player.position) > 1e-6;
      net.sendPos(
        player.position.x,
        player.position.z,
        Math.round(THREE.MathUtils.radToDeg(player.rotation.y)),
        moving
      );
      prevPos.copy(player.position);
    }
  } else {
    // 入場前はステージ周りをゆっくり旋回するカメラ
    const r = 26;
    camera.position.set(Math.sin(t * 0.12) * r, 9, Math.cos(t * 0.12) * r);
    camera.lookAt(0, 3, 0);
  }

  renderer.render(scene, camera);
  liveScreen.update();
}
loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 開発用の覗き口。見た目の不具合を「パーツを消して切り分ける」ために使う。
// 参照を渡すだけで挙動は変えない。
window.__vc = { scene, camera, renderer, world };
