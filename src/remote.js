import * as THREE from 'three';
import { createAvatar } from './avatar.js';
import { avToConfig } from './net.js';

// ------------------------------------------------------------------
// リモートプレイヤー（他ブラウザユーザー）の3D表示管理
// ------------------------------------------------------------------

const LERP_SPEED = 8; // pos += (target - pos) * min(1, dt * LERP_SPEED)
const MOVE_EPS = 0.05; // これ以上目標と離れていれば歩行アニメ扱い

function shortestAngleDelta(target, current) {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return d;
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    // THREE.Sprite のジオメトリはモジュール内で共有される静的インスタンスなので破棄しない
    if (child.geometry && !child.isSprite) {
      child.geometry.dispose();
    }
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    mats.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
  });
}

export function initRemotePlayers(scene) {
  const peers = new Map(); // id -> { root, name, av, target:{x,z,r}, moving }

  function addPeer(p) {
    if (!p || !p.id) return;
    if (peers.has(p.id)) return; // 二重追加防止

    const config = avToConfig(p.av);
    const root = createAvatar({ ...config, name: p.n });
    root.position.set(p.x || 0, 0, p.z || 0);
    root.rotation.y = THREE.MathUtils.degToRad(p.r || 0);
    if (!namesVisible && root.userData.setNameVisible) root.userData.setNameVisible(false);
    scene.add(root);

    peers.set(p.id, {
      root,
      name: p.n,
      av: p.av,
      target: { x: p.x || 0, z: p.z || 0, r: p.r || 0 },
      moving: false,
    });
  }

  function movePeer(msg) {
    if (!msg || !msg.id) return;
    const peer = peers.get(msg.id);
    if (!peer) return;
    peer.target.x = msg.x;
    peer.target.z = msg.z;
    peer.target.r = msg.r;
    peer.moving = !!msg.m;
  }

  function updatePeer(msg) {
    if (!msg || !msg.id) return;
    const peer = peers.get(msg.id);
    if (!peer) return;

    const pos = peer.root.position.clone();
    const rotY = peer.root.rotation.y;

    scene.remove(peer.root);
    disposeObject3D(peer.root);

    const config = avToConfig(msg.av);
    const newRoot = createAvatar({ ...config, name: msg.n });
    newRoot.position.copy(pos);
    newRoot.rotation.y = rotY;
    scene.add(newRoot);

    peer.root = newRoot;
    peer.name = msg.n;
    peer.av = msg.av;
  }

  function removePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    scene.remove(peer.root);
    disposeObject3D(peer.root);
    peers.delete(id);
  }

  function say(id, txt) {
    const peer = peers.get(id);
    if (!peer) return;
    if (peer.root.userData.say) peer.root.userData.say(txt);
  }

  function emote(id, emoteId) {
    const peer = peers.get(id);
    if (!peer) return;
    if (peer.root.userData.playEmote) peer.root.userData.playEmote(emoteId);
  }

  function count() {
    return peers.size;
  }

  function update(dt) {
    const factor = Math.min(1, dt * LERP_SPEED);
    peers.forEach((peer) => {
      const root = peer.root;
      const target = peer.target;

      root.position.x += (target.x - root.position.x) * factor;
      root.position.z += (target.z - root.position.z) * factor;

      const targetRad = THREE.MathUtils.degToRad(target.r);
      const d = shortestAngleDelta(targetRad, root.rotation.y);
      root.rotation.y += d * factor;

      const dist = Math.hypot(target.x - root.position.x, target.z - root.position.z);
      const moving = peer.moving || dist > MOVE_EPS;
      if (root.userData.setMoving) root.userData.setMoving(moving);
      if (root.userData.update) root.userData.update(dt);
    });
  }

  function clear() {
    peers.forEach((peer) => {
      scene.remove(peer.root);
      disposeObject3D(peer.root);
    });
    peers.clear();
  }

  // UI非表示のときは他プレイヤーの名前・吹き出しも消す。
  // 後から入ってきた人にも効くよう、状態を覚えて addPeer 時に適用する
  let namesVisible = true;
  function setNamesVisible(v) {
    namesVisible = Boolean(v);
    peers.forEach((peer) => {
      if (peer.root.userData.setNameVisible) peer.root.userData.setNameVisible(namesVisible);
    });
  }
  function isNamesVisible() {
    return namesVisible;
  }

  return {
    addPeer,
    movePeer,
    updatePeer,
    removePeer,
    say,
    emote,
    count,
    update,
    clear,
    setNamesVisible,
    isNamesVisible,
  };
}
