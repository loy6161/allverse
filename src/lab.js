// アバター デザイン比較ページ（avatar-lab.html）のロジック
//
// 複数のデザイン案を並べて、同じ条件で見比べるためのもの。
// 各案は src/styles/*.js に STYLE_INFO と createStyleAvatar(config) を持つ。
// 現行実装（src/avatar.js）も同じ枠で1枚目に並べる。

import * as THREE from 'three';
import { AVATAR_PARTS, randomConfig } from './avatar.js';

// 比較する案の一覧。読み込みに失敗した案はカードにエラーを表示して他は続行する
const STYLE_MODULES = [
  { path: './avatar.js', current: true },
  { path: './styles/anime_tall.js' },
  { path: './styles/simple_lowpoly.js' },
  { path: './styles/mini_deform.js' },
  { path: './styles/mannequin.js' },
];

const grid = document.getElementById('grid');
const cards = [];
let spinning = true;
let config = { ...randomConfig(), hairStyle: 'short' };

const BG = {
  venue: { color: 0x080b16, ambient: 0x44557a, ambientI: 0.9, key: 0xffd9ac, keyI: 1.0, rim: 0x7c4dff },
  plain: { color: 0x2a3042, ambient: 0xffffff, ambientI: 1.3, key: 0xffffff, keyI: 1.4, rim: 0xaaccff },
};
let bgMode = 'venue';

function makeCard(info, errorMsg) {
  const card = document.createElement('div');
  card.className = 'card' + (errorMsg ? ' err' : '');

  const canvas = document.createElement('canvas');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = info.name;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = info.badge || '案';

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = info.desc;

  const meta = document.createElement('div');
  meta.className = 'meta';

  card.append(canvas, badge, name, desc, meta);
  if (errorMsg) {
    const e = document.createElement('div');
    e.className = 'err-msg';
    e.textContent = '読み込み失敗: ' + errorMsg;
    card.appendChild(e);
  }
  grid.appendChild(card);
  return { card, canvas, meta };
}

function setupScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  const ambient = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(2, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-3, 2, -3);
  scene.add(rim);

  // 足元の丸い影っぽい板（浮いて見えないように）
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.002;
  scene.add(disc);

  return { renderer, scene, camera, ambient, key, rim };
}

function applyBackground(ctx) {
  const b = BG[bgMode];
  ctx.scene.background = new THREE.Color(b.color);
  ctx.ambient.color.setHex(b.ambient);
  ctx.ambient.intensity = b.ambientI;
  ctx.key.color.setHex(b.key);
  ctx.key.intensity = b.keyI;
  ctx.rim.color.setHex(b.rim);
}

function frameAvatar(ctx, avatar) {
  // 身長に合わせてカメラ距離を決め、どの案も同じ大きさに見えるようにする
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  avatar.updateMatrixWorld(true);
  avatar.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!bb) return;
    for (const c of [
      [bb.min.x, bb.min.y, bb.min.z],
      [bb.max.x, bb.max.y, bb.max.z],
      [bb.min.x, bb.max.y, bb.max.z],
      [bb.max.x, bb.min.y, bb.min.z],
    ]) {
      v.set(c[0], c[1], c[2]).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  const height = Math.max(0.5, box.max.y - box.min.y);
  const center = (box.max.y + box.min.y) / 2;
  const dist = height * 2.5;
  ctx.camera.position.set(0, center, dist);
  ctx.camera.lookAt(0, center, 0);
  return { height, box };
}

function countStats(avatar) {
  let meshes = 0;
  let tris = 0;
  avatar.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    const g = o.geometry;
    tris += g.index ? g.index.count / 3 : (g.attributes?.position?.count || 0) / 3;
  });
  return { meshes, tris: Math.round(tris) };
}

async function loadStyles() {
  for (const entry of STYLE_MODULES) {
    let mod = null;
    let err = null;
    try {
      mod = await import(entry.path);
    } catch (e) {
      err = e.message;
    }

    const info = entry.current
      ? { name: '現行（ちび体型）', desc: '今このワールドで使われている3.6頭身のアバター', badge: '現行' }
      : mod && mod.STYLE_INFO
        ? { ...mod.STYLE_INFO, badge: '案' }
        : { name: entry.path, desc: '' };

    const ui = makeCard(info, err);
    if (err) continue;

    const create = entry.current ? mod.createAvatar : mod.createStyleAvatar;
    if (typeof create !== 'function') {
      ui.card.classList.add('err');
      ui.meta.textContent = 'createStyleAvatar が見つかりません';
      continue;
    }

    const ctx = setupScene(ui.canvas);
    applyBackground(ctx);

    const holder = new THREE.Group();
    ctx.scene.add(holder);

    const item = { ...ctx, holder, create, ui, avatar: null, yaw: 0, dragging: false, zoom: 1 };
    rebuild(item);
    attachInteraction(item);
    cards.push(item);
  }
}

function rebuild(item) {
  if (item.avatar) {
    item.holder.remove(item.avatar);
    item.avatar.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
      }
    });
  }
  let avatar;
  try {
    avatar = item.create({ ...config, name: '' });
  } catch (e) {
    item.ui.meta.textContent = '生成エラー: ' + e.message;
    return;
  }
  item.holder.add(avatar);
  item.avatar = avatar;
  const { height } = frameAvatar(item, avatar);
  const { meshes, tris } = countStats(avatar);
  item.baseDist = item.camera.position.z;
  item.ui.meta.textContent = `身長 ${height.toFixed(2)}m ／ メッシュ ${meshes} ／ 三角形 ${tris}`;
}

function attachInteraction(item) {
  const el = item.renderer.domElement;
  let lastX = 0;
  el.addEventListener('pointerdown', (e) => {
    item.dragging = true;
    lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!item.dragging) return;
    item.yaw += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
  });
  const end = () => {
    item.dragging = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      item.zoom = THREE.MathUtils.clamp(item.zoom + e.deltaY * 0.001, 0.5, 2.2);
    },
    { passive: false },
  );
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  for (const item of cards) {
    if (!item.avatar) continue;
    if (spinning && !item.dragging) item.yaw += dt * 0.5;
    item.holder.rotation.y = item.yaw;
    if (item.avatar.userData.update) item.avatar.userData.update(dt);

    const w = item.renderer.domElement.clientWidth;
    const h = item.renderer.domElement.clientHeight;
    if (w > 0 && h > 0) {
      const need =
        item.renderer.domElement.width !== Math.floor(w * Math.min(devicePixelRatio, 2)) ||
        item.renderer.domElement.height !== Math.floor(h * Math.min(devicePixelRatio, 2));
      if (need) {
        item.renderer.setSize(w, h, false);
        item.camera.aspect = w / h;
      }
      const target = item.baseDist * item.zoom;
      item.camera.position.z = target;
      item.camera.updateProjectionMatrix();
    }
    item.renderer.render(item.scene, item.camera);
  }
}

document.getElementById('randomize').addEventListener('click', () => {
  const hair = config.hairStyle;
  config = { ...randomConfig(), hairStyle: hair };
  cards.forEach(rebuild);
});

document.getElementById('hair').addEventListener('change', (e) => {
  config = { ...config, hairStyle: e.target.value };
  cards.forEach(rebuild);
});

document.getElementById('bg').addEventListener('change', (e) => {
  bgMode = e.target.value;
  cards.forEach(applyBackground);
});

const spinBtn = document.getElementById('spin');
spinBtn.addEventListener('click', () => {
  spinning = !spinning;
  spinBtn.textContent = spinning ? '⏸ 回転を止める' : '▶ 回転させる';
});

// 髪型セレクトの初期値を config に合わせる
document.getElementById('hair').value = config.hairStyle;
AVATAR_PARTS.hairStyles.forEach(() => {});

await loadStyles();
loop();
