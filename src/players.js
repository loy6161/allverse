// players.js
// VERSE CITY 疑似マルチプレイ（NPC）
// NPCアバターを歩き回らせ、ランダムにチャット発言させる。

import { createAvatar, randomConfig } from './avatar.js';

const NPC_NAMES = [
  'ミク姉',
  'ねおん',
  'カズヤ',
  'ぽんず',
  'ルカ',
  'そら',
  'ハチ',
  'ゆきの',
  'れお',
  'あおい',
  'ノクス',
  'ぴよ田',
  'つむぎ',
  'ジン',
  'こはく',
];

const CHAT_LINES = [
  '今日のライブ楽しみ！',
  'VERSE COIN貯まってきた',
  'そのアバターかわいい',
  'ステージ前行こうぜ',
  'clubVERSEひさびさ',
  '音圧やばくない？',
  '新しいエリアできたらしいよ',
  'ここ夜景きれいだよね',
  '誰かボイス聞こえる？',
  'DJ変わった気がする',
  'VERSE COINでアバター買った',
  'このステージ好きすぎる',
  '前回のイベント神だった',
  'そろそろ始まるかな',
  '今日は人多いね',
  'アバター着替えてきた',
  '踊りに来ました！',
  'スクショ撮っとこ',
  'この曲好き〜',
  'また会えて嬉しい！',
  '新しいエモート覚えた',
  'そこ光ってて綺麗',
  'そろそろ配信も始まるかな',
  '今日はどのエリア回る？',
  '誰かフレンドなってー',
];

function pickUniqueNames(count) {
  const pool = [...NPC_NAMES];
  const picked = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  // count が名前数を超えたら連番で補う
  for (let i = n; i < count; i++) {
    picked.push(`ゲスト${i + 1}`);
  }
  return picked;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickTarget(bounds) {
  const { minX, maxX, minZ, maxZ } = bounds;
  // ステージ前(z=-15付近)に集まりやすいよう重み付け
  if (Math.random() < 0.55) {
    const stageZ = -15;
    const zSpread = Math.min(8, (maxZ - minZ) * 0.3);
    const z = Math.min(maxZ, Math.max(minZ, stageZ + randRange(-zSpread, zSpread)));
    const xSpread = (maxX - minX) * 0.35;
    const cx = (minX + maxX) / 2;
    const x = Math.min(maxX, Math.max(minX, cx + randRange(-xSpread, xSpread)));
    return { x, z };
  }
  return { x: randRange(minX, maxX), z: randRange(minZ, maxZ) };
}

function createNpc(name, bounds, onChat) {
  const avatar = createAvatar({ ...randomConfig(), name });

  const startTarget = pickTarget(bounds);
  avatar.position.set(startTarget.x, 0, startTarget.z);

  const npc = {
    group: avatar,
    state: 'idle', // 'idle' | 'walk'
    idleTimer: randRange(3, 8),
    target: { x: avatar.position.x, z: avatar.position.z },
    speed: randRange(1.5, 2.5),
    chatTimer: randRange(2, 5), // 入場直後の挨拶までの短いタイマー
    greeted: false,
  };

  function enterIdle() {
    npc.state = 'idle';
    npc.idleTimer = randRange(3, 8);
    if (avatar.userData.setMoving) avatar.userData.setMoving(false);
  }

  function enterWalk() {
    npc.state = 'walk';
    npc.target = pickTarget(bounds);
    npc.speed = randRange(1.5, 2.5);
    if (avatar.userData.setMoving) avatar.userData.setMoving(true);
  }

  npc.enterIdle = enterIdle;
  npc.enterWalk = enterWalk;

  function update(dt) {
    if (npc.state === 'idle') {
      npc.idleTimer -= dt;
      if (npc.idleTimer <= 0) {
        enterWalk();
      }
    } else {
      const dx = npc.target.x - avatar.position.x;
      const dz = npc.target.z - avatar.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.15) {
        avatar.position.x = npc.target.x;
        avatar.position.z = npc.target.z;
        enterIdle();
      } else {
        const step = Math.min(dist, npc.speed * dt);
        avatar.position.x += (dx / dist) * step;
        avatar.position.z += (dz / dist) * step;

        const targetAngle = Math.atan2(dx, dz);
        let angleDiff = targetAngle - avatar.rotation.y;
        // -PI..PI に正規化して最短回転
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
        const turnSpeed = 6;
        avatar.rotation.y += angleDiff * Math.min(1, turnSpeed * dt);
      }
    }

    if (avatar.userData.update) avatar.userData.update(dt);

    // 雑談
    npc.chatTimer -= dt;
    if (npc.chatTimer <= 0) {
      const line = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
      onChat(name, line);
      if (avatar.userData.say) avatar.userData.say(line);
      npc.chatTimer = randRange(15, 40);
      npc.greeted = true;
    }
  }

  npc.update = update;
  return npc;
}

export function initSimPlayers(scene, { count, bounds, onChat }) {
  const names = pickUniqueNames(count);
  const npcs = names.map((name) => createNpc(name, bounds, onChat));

  npcs.forEach((npc) => scene.add(npc.group));

  function update(dt) {
    for (const npc of npcs) {
      npc.update(dt);
    }
  }

  return {
    update,
    players: npcs.map((npc) => npc.group),
  };
}
