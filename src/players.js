// players.js
// 会場の観客（NPC）
//
// 空席を埋めて会場が寂しく見えないようにするための「背景の観客」。
// 実在の人と取り違えないよう、次の3点を守っている:
//   1. 名前の頭に「NPC:」を付け、ネームプレートの色も変える
//   2. 発言は頭上の吹き出しだけ。チャット欄には流さない（返事をしても無視されるため）
//   3. 人数表示には数えない（数えるのは実在の人だけ）

import { createAvatar, randomConfig } from './avatar.js';

// NPCの名前。
//
// ⚠️ 実在の人（レギュラーメンバー・出演者・関係者）に似た名前は絶対に使わない。
// 誰かの名前に見えると、本人が来ていると誤解されたり、なりきりだと思われたりする。
// 以前ここに人名っぽい愛称を並べていて、実際にメンバーの名前と重なっていた（2026-07-30 指摘）。
//
// そこで「人名として使われない語（食べ物・道具）だけを使う」という決まりにした。
// 人名の形をしていなければ、名前が偶然かぶることも、似ていると感じられることもない。
// 名前を足すときもこの決まりを守ること。人名・愛称・キャラクター名は入れない。
const NPC_NAMES = [
  'とまと',
  'ぐんじょう',
  'ぱせり',
  'みかん箱',
  'こんぺいとう',
  'もぶ太郎',
  'こんぶ',
  'たいやき',
  'ゆのみ',
  'ようかん',
  'ばけつ',
  'ぷりん',
  'あんみつ',
  'すだち',
  'わさび',
];

const CHAT_LINES = [
  '今日のライブ楽しみ！',
  'そのアバターかわいい',
  'ステージ前行こうぜ',
  'clubVERSEひさびさ',
  'ここ夜景きれいだよね',
  'このステージ好きすぎる',
  'そろそろ始まるかな',
  '今日は人多いね',
  'アバター着替えてきた',
  '踊りに来ました！',
  'スクショ撮っとこ',
  'この曲好き〜',
  'また会えて嬉しい！',
  '新しいエモート覚えた',
  '誰かフレンドなってー',
  '( 厂˙ω˙ )厂うぇーい',
];

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

function createNpc(name, bounds) {
  // 「NPC:」を付け、ネームプレートの色も変えて、実在の人と見分けがつくようにする
  const avatar = createAvatar({ ...randomConfig(), name: `NPC:${name}`, badge: 'npc' });

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
      // 発言は頭の上の吹き出しだけにする。チャット欄には流さない。
      // （チャット欄に出すと会話に見えて、返事をしても無視されることになるため）
      const line = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
      if (avatar.userData.say) avatar.userData.say(line);
      npc.chatTimer = randRange(15, 40);
      npc.greeted = true;
    }
  }

  npc.update = update;
  return npc;
}

export function initSimPlayers(scene, { count = 0, bounds }) {
  const npcs = [];
  let namesVisible = true;
  let created = 0; // 名前の重複を避けるための通し番号

  function addOne() {
    // 用意した名前を使い切ったら「観客12」のように連番で補う
    const name = created < NPC_NAMES.length ? NPC_NAMES[created] : `観客${created + 1}`;
    created += 1;
    const npc = createNpc(name, bounds);
    if (!namesVisible && npc.group.userData.setNameVisible) npc.group.userData.setNameVisible(false);
    scene.add(npc.group);
    npcs.push(npc);
  }

  function removeOne() {
    const npc = npcs.pop();
    if (!npc) return;
    scene.remove(npc.group);
    // 後始末はアバター固有のものだけにする。
    // ジオメトリはGLBのテンプレートを全アバターで共有しているので、
    // ここで dispose すると他のアバターの描画まで壊してしまう。
    npc.group.traverse((o) => {
      if (o.isSprite && o.userData.dispose) {
        o.userData.dispose(); // ネームプレートのテクスチャは1体につき1枚
        return;
      }
      if (o.isMesh && o.material && !Array.isArray(o.material)) o.material.dispose();
    });
    created = Math.max(0, created - 1);
  }

  /** 人数を指定の数に合わせる（負荷テスト用に増減できる） */
  function setCount(n) {
    const target = Math.max(0, Math.min(200, Math.floor(Number(n) || 0)));
    while (npcs.length < target) addOne();
    while (npcs.length > target) removeOne();
    return npcs.length;
  }

  setCount(count);

  function update(dt) {
    for (const npc of npcs) {
      npc.update(dt);
    }
  }

  return {
    update,
    setCount,
    count: () => npcs.length,
    // UI非表示のときはNPCの名前・吹き出しも消す
    setNamesVisible(v) {
      namesVisible = Boolean(v);
      for (const npc of npcs) {
        if (npc.group.userData.setNameVisible) npc.group.userData.setNameVisible(namesVisible);
      }
    },
  };
}
