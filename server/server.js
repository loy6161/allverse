// ============================================================
// VERSE CITY Web — リアルタイム同期サーバー
// 仕様: docs/PROTOCOL.md（通信）/ docs/PRESENCE_SPEC.md §2.2（presence.json）
// 依存: ws / @libsql/client / google-auth-library
//
// 2026-07-29 構造変更: 「イベント ＞ ルーム」の二層になった。
//   イベント … 動画と再生位置の持ち主。管理者が作る。常設の main は消えない
//   ルーム   … イベント内の分割（定員30人）。同じイベントなら全ルームが同じ動画・同じ再生位置
// ============================================================

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';

import {
  initStore,
  isPersistent,
  getStoreStatus,
  loadEvents,
  saveEvent,
  updateEventVideo,
  deleteEvent,
  loadProfile,
  saveProfile,
  loadBlocks,
  saveBlock,
  deleteBlock,
  loadBans,
  saveBan,
  deleteBan,
} from './store.js';
import {
  verifyIdToken,
  roleForEmail,
  defaultRole,
  isGlobalRole,
  canControlVideo,
  canInteract,
  isLoginEnabled,
  getClientId,
} from './auth.js';

// 静的ファイル配信のルート（= クライアント一式があるプロジェクト直下）
const CLIENT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

// ------------------------------------------------------------
// 定数（仕様値）
// ------------------------------------------------------------
const PORT = process.env.PORT || 5179;
const WS_PATH = '/ws';

// 1ルームの定員はイベントごとに持つ（DEFAULT_CAPACITY / MIN_CAPACITY / MAX_CAPACITY を参照）
const RATE_LIMIT_PER_SEC = 20;    // 1クライアントが1秒に送れる最大メッセージ数
const MAX_NAME_LEN = 12;          // n の最大文字数
const MAX_TXT_LEN = 200;          // chat.txt の最大文字数
const MAX_COORD_ABS = 100;        // 座標の絶対値上限（これを超える/非数は破棄）

// エモートの既定リスト（docs/PROTOCOL.md と一致させること。ここにないidは破棄）
const EMOTE_IDS = new Set(['wave', 'clap', 'jump', 'dance', 'heart', 'penlight']);
const EMOTE_MIN_INTERVAL_MS = 500; // 1クライアントあたりのエモート最小間隔（連打防止）

// スクリーン
const DEFAULT_VIDEO_ID = 'unrobrGhlv0';       // 常設イベントの初期動画
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;    // YouTube動画IDの形式

// イベント
//
// 2026-07-30 変更: 「常設イベント(main)を必ず作る」のをやめた。
// 常設だと管理人の意思と関係なく常に入れてしまい、調整中でも人が入ってくる。
// いまは「管理人がイベントを立てている間だけ会場が開く」。
// パブリックで立てて閉じなければ、結果としてそれが常設になる（loyさん設計 2026-07-30）。
const MAX_EVENTS = 20;
const MAX_EVENT_NAME_LEN = 24;
const EVENT_ID_RE = /^[a-z0-9_-]{1,24}$/;
const MAX_EVENT_CODE_LEN = 24;                // 合言葉の最大文字数
const DEFAULT_CAPACITY = 30;                  // 1ルームの既定キャパ
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 60;                      // presence.json の web[] 上限に合わせる

// ゲスト（未ログイン）の固定アバター。見た目は後で確定させる（2026-07-29 時点の暫定）
const GUEST_AV = { h: 'short', o: 'middle', ac: 'none', hc: 12, sc: 12, bc: 0, ec: 0, pl: 9 };

// 開発用の権限指定を許すか。Render上では常に無効（RENDER環境変数が必ず立つため）。
// ローカルでのみ有効で、管理者/VIP/ゲストの挙動を実際に動かして確かめるために使う。
const DEV_ROLES = new Set(['admin', 'vip', 'user', 'guest']);
const ALLOW_DEV_ROLE = !process.env.RENDER;

// 迷惑行為への対処（2026-07-30追加）
const MAX_BLOCKS = 200;           // 1人が持てるブロックの上限
const MAX_BAN_REASON_LEN = 60;    // BAN理由の最大文字数

// PRESENCE_SPEC §2.2 向けの出力上限
const PRESENCE_MAX_WEB = 60;      // web[] の最大人数
const PRESENCE_CHAT_WINDOW_MS = 30 * 1000; // c を付与する直近発言の有効期間
const PRESENCE_CHAT_TXT_MAX = 40; // c[0] の最大文字数（30KB制約対応）

// 「直近チャット」フィールド(c)は実装済みだが、運用判断が済むまで既定は無効。
const ENABLE_CHAT_FIELD = false;

// ------------------------------------------------------------
// サーバー状態
// ------------------------------------------------------------
// events: Map<eventId, Event>
//   Event = { id, name, videoId, playback:{playing,pos,at},
//             requireLogin, entryCode, capacity, vrcBridge, createdAt }
//     requireLogin … ゲスト（未ログイン）を弾く
//     entryCode    … '' ならパブリック。文字列なら入場に合言葉が要る
//                    ⚠ この値はクライアントへ送らない（見られたら意味がない）。管理人にだけ返す
//     capacity     … 1ルームの定員。あとから変更できるが、いま入っている人数より下げられない
//     vrcBridge    … presence.json（VRChat連携）に出すイベントか。ONにできるのは1つだけ
const events = new Map();

// rooms: Map<roomKey, Map<clientId, ClientState>>   roomKey = `${eventId}#${roomNumber}`
const rooms = new Map();

let nextClientSeq = 1; // "c1", "c2", ... を払い出す連番
let nextGuestSeq = 1; // 「ゲスト001」の連番
const startedAt = Date.now();

// BANされたメールアドレス。入場のたびにDBを叩かないようメモリに載せておく。
// bans: Map<email, {email,name,byName,reason,createdAt}>
const bans = new Map();

/**
 * ブロックの相手を指す文字列。
 * ログイン済みは `e:メール`（次回入場しても同じ人）、
 * ゲストは `g:接続id`（ゲストは次に来たら別人なので、その場限りで十分）。
 */
function blockKeyOf(client) {
  return client.email ? `e:${client.email}` : `g:${client.id}`;
}

/**
 * 2人の間にブロックがあるか。
 * どちらか一方がブロックしていれば、両方から見えなくする（相互不可視）。
 * 片方向にすると、ブロックした相手にこちらの発言が届き続けるので、
 * 嫌がらせへの対処にならない。
 */
function isBlockedBetween(a, b) {
  if (!a || !b) return false;
  return a.blocks.has(blockKeyOf(b)) || b.blocks.has(blockKeyOf(a));
}

/**
 * 表示名はサーバーが決める（クライアントの申告は使わない）。
 *
 * 2026-07-29 確定: ログイン済みはGoogleアカウントの表示名で固定する。
 * この名前はYouTubeのコメントに出る名前と同じなので、コミュニティ内では既に公開名であり、
 * かつ本人以外は名乗れなくなる（なりすまし防止）。
 * 未ログインは「ゲスト+連番」をこちらで割り当てる。連番なので他人と被らず、詐称もできない。
 */
function resolveDisplayName(email, googleName) {
  if (!email) {
    const n = String(nextGuestSeq++).padStart(3, '0');
    return `ゲスト${n}`;
  }
  // Googleの表示名が取れないときはメールのローカル部で代替する
  const base = (googleName || '').trim() || String(email).split('@')[0];
  return clampString(base, MAX_NAME_LEN, 'メンバー');
}

/**
 * クライアント1人分の状態
 * @typedef {Object} ClientState
 * @property {string} id
 * @property {import('ws').WebSocket} ws
 * @property {string|null} eventId
 * @property {number|null} room
 * @property {boolean} joined
 * @property {string} role   'admin' | 'vip' | 'user' | 'guest'
 * @property {string} email
 * @property {string} n
 * @property {Object} av
 * @property {number} x
 * @property {number} z
 * @property {number} r
 * @property {boolean} m
 * @property {{txt:string, ts:number}|null} lastChat
 * @property {number[]} msgTimes
 */

// ------------------------------------------------------------
// イベント
// ------------------------------------------------------------

function makeEvent({
  id,
  name,
  videoId,
  requireLogin = false,
  entryCode = '',
  capacity = DEFAULT_CAPACITY,
  vrcBridge = false,
  createdAt = Date.now(),
}) {
  return {
    id,
    name,
    videoId,
    requireLogin,
    entryCode,
    capacity: clampCapacity(capacity),
    vrcBridge,
    createdAt,
    playback: { playing: true, pos: 0, at: Date.now(), live: false },
  };
}

/** キャパを許容範囲へ収める */
function clampCapacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CAPACITY;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.trunc(n)));
}

/** そのイベントで一番人が多いルームの人数（キャパを下げられる下限になる） */
function maxRoomOccupancy(eventId) {
  let n = 0;
  for (const [key, members] of rooms) {
    if (keyEventId(key) === eventId) n = Math.max(n, members.size);
  }
  return n;
}

/** VRChatへ出すイベント（vrcBridge が立っているもの）。無ければ null */
function bridgedEvent() {
  for (const ev of events.values()) if (ev.vrcBridge) return ev;
  return null;
}

/** vrcBridge は1つだけ。指定のイベント以外を落とす */
function makeBridgeExclusive(keepId) {
  for (const ev of events.values()) {
    if (ev.id !== keepId && ev.vrcBridge) ev.vrcBridge = false;
  }
}

/**
 * 現在の再生位置を求める（pos は at 時点の位置なので、再生中なら経過分を足す）
 *
 * ライブ配信のときは **pos を返さない**。
 * ライブの「再生位置」は配信の時刻そのもので、こちらが持っている経過秒とは無関係。
 * それを渡すと受け取った側が視聴可能範囲の外へシークして配信が止まる
 * （2026-07-30 の「生配信が途中で止まる」不具合の原因）。
 * クライアント側にもガードはあるが、古い版が繋いでも壊れないよう元から渡さない。
 */
function currentPlayback(eventId) {
  const ev = events.get(eventId);
  if (!ev) return { st: 'play' };
  const pb = ev.playback;
  if (pb.live) return { st: pb.playing ? 'play' : 'pause' };
  const elapsed = pb.playing ? (Date.now() - pb.at) / 1000 : 0;
  return { st: pb.playing ? 'play' : 'pause', pos: Math.max(0, pb.pos + elapsed) };
}

/** クライアントに渡すイベント情報（内部の at などは出さない） */
function toEventInfo(ev) {
  return {
    id: ev.id,
    name: ev.name,
    v: ev.videoId,
    requireLogin: ev.requireLogin,
    // 合言葉そのものは出さない。「要るかどうか」だけ伝える
    hasCode: Boolean(ev.entryCode),
    cap: ev.capacity,
    vrc: ev.vrcBridge,
    count: countInEvent(ev.id),
  };
}

/** 管理人向け。合言葉の中身も返す（人に伝えるために必要） */
function toEventInfoAdmin(ev) {
  return { ...toEventInfo(ev), code: ev.entryCode };
}

function countInEvent(eventId) {
  let n = 0;
  for (const [key, members] of rooms) {
    if (keyEventId(key) === eventId) n += members.size;
  }
  return n;
}

/**
 * イベント一覧＋各ルームの人数（入場画面とルーム移動で使う）
 *
 * forAdmin=true のときだけ合言葉の中身を含める。
 * 管理人の設定画面に現在の合言葉を出すために要る（見えないまま保存すると
 * 空欄で上書きされて合言葉が消えてしまう）。それ以外へは絶対に渡さない。
 */
function buildEventList(forAdmin = false) {
  return Array.from(events.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((ev) => ({
      ...(forAdmin ? toEventInfoAdmin(ev) : toEventInfo(ev)),
      rooms: buildRoomList(ev.id),
    }));
}

/** そのイベントのルーム一覧。空きのある最小番号を必ず1つは含める */
function buildRoomList(eventId) {
  const list = [];
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    list.push({ room: keyRoomNumber(key), count: members.size, full: members.size >= capacityOf(eventId) });
  }
  list.sort((a, b) => a.room - b.room);
  const next = assignRoom(eventId);
  if (!list.some((r) => r.room === next)) list.push({ room: next, count: 0, full: false });
  return list;
}

// ------------------------------------------------------------
// ルームキーのユーティリティ
// ------------------------------------------------------------
function roomKey(eventId, roomNumber) {
  return `${eventId}#${roomNumber}`;
}
function keyEventId(key) {
  return key.slice(0, key.lastIndexOf('#'));
}
function keyRoomNumber(key) {
  return Number(key.slice(key.lastIndexOf('#') + 1));
}

/** そのイベントの定員（イベントが消えていれば既定値） */
function capacityOf(eventId) {
  const ev = events.get(eventId);
  return ev ? ev.capacity : DEFAULT_CAPACITY;
}

/** 指定ルームが定員未満か */
function roomHasSpace(eventId, roomNumber) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return true;
  return room.size < capacityOf(eventId);
}

/** そのイベントで「空きのある最小番号ルーム」 */
function assignRoom(eventId) {
  let n = 1;
  for (;;) {
    if (roomHasSpace(eventId, n)) return n;
    n += 1;
  }
}

/**
 * 入れるルームがあるか。
 * ルーム番号は無限に増やせる作りなので実際には必ず空きがあるが、
 * 「キャパ0のイベント」など将来の設定ミスで無限ループしないよう上限で打ち切る
 */
function assignableRoom(eventId) {
  if (capacityOf(eventId) < 1) return 0;
  const n = assignRoom(eventId);
  return n <= 999 ? n : 0;
}

// ------------------------------------------------------------
// ユーティリティ
// ------------------------------------------------------------

/** 文字列を強制トリム */
function clampString(value, maxLen, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLen);
}

/** 数値検証: 非数・±100超は無効(null)を返す */
function validCoord(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_COORD_ABS) return null;
  return value;
}

/** av はそのまま中継する想定だが、最低限オブジェクトであることだけ担保する */
function sanitizeAv(av) {
  if (av && typeof av === 'object' && !Array.isArray(av)) return av;
  return {};
}

/** JSON文字列として安全にwsへ送信する（送信失敗は無視） */
function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    // 送信エラーは無視（切断処理はcloseイベント側で行う）
  }
}

/**
 * 同室の全員（フィルタ可）にブロードキャスト。
 * from を渡すと、その人とブロック関係にある相手には届かない。
 */
function broadcastToRoom(eventId, roomNumber, obj, excludeId = null, from = null) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return;
  for (const client of room.values()) {
    if (excludeId && client.id === excludeId) continue;
    if (from && isBlockedBetween(from, client)) continue;
    send(client.ws, obj);
  }
}

/** 同じイベントの全ルームへブロードキャスト（管理者・VIPの姿と発言はこちらを使う） */
function broadcastToEvent(eventId, obj, excludeId = null, from = null) {
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    for (const client of members.values()) {
      if (excludeId && client.id === excludeId) continue;
      if (from && isBlockedBetween(from, client)) continue;
      send(client.ws, obj);
    }
  }
}

/**
 * そのクライアントの発信をどこまで届けるか。
 * 管理者・VIPはイベント全体、それ以外は自室のみ。
 * どちらの場合も、ブロック関係にある相手には届かない。
 */
function broadcastFrom(client, obj, excludeSelf = true) {
  const exclude = excludeSelf ? client.id : null;
  if (isGlobalRole(client.role)) {
    broadcastToEvent(client.eventId, obj, exclude, client);
  } else {
    broadcastToRoom(client.eventId, client.room, obj, exclude, client);
  }
}

/** 同室に人数変化を通知 */
function broadcastCount(eventId, roomNumber) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return;
  broadcastToRoom(eventId, roomNumber, { t: 'count', c: room.size });
}

/** peer-join/welcome用に「相手から見えるべき情報」だけを抜き出す */
function toPeerInfo(client) {
  return {
    id: client.id,
    n: client.n,
    av: client.av,
    x: client.x,
    z: client.z,
    r: client.r,
    role: client.role,
  };
}

/**
 * 自分から見えるべき相手の一覧。
 * 自室の全員＋（同じイベントの他ルームにいる）管理者・VIP。
 */
function visiblePeersFor(client) {
  const out = [];
  const myKey = roomKey(client.eventId, client.room);
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    const sameRoom = key === myKey;
    for (const other of members.values()) {
      if (other.id === client.id) continue;
      if (isBlockedBetween(client, other)) continue; // ブロック相手は最初から居ないものとして扱う
      if (sameRoom || isGlobalRole(other.role)) out.push(toPeerInfo(other));
    }
  }
  return out;
}

// ------------------------------------------------------------
// メッセージハンドラ（種別ごと）
// ------------------------------------------------------------

/** join: 入場処理。idt があればGoogleのIDトークンとして検証して権限を決める */
async function handleJoin(client, msg) {
  if (client.joined) return; // 二重join無視

  // ---- 認証（任意）----
  let role = defaultRole();
  let email = '';
  let googleName = '';
  if (msg.idt) {
    const info = await verifyIdToken(msg.idt);
    if (info) {
      email = info.email;
      googleName = info.name || '';
      role = roleForEmail(email);
    }
  }
  // 開発用の権限指定。Render上では絶対に効かない（RENDER環境変数で封じる）。
  // VIP・ゲストの挙動や、設定の保存/復元をローカルで試すためのもの。
  if (ALLOW_DEV_ROLE && typeof msg.devRole === 'string' && DEV_ROLES.has(msg.devRole)) {
    role = msg.devRole;
    if (typeof msg.devEmail === 'string' && msg.devEmail) {
      email = clampString(msg.devEmail, 120).toLowerCase();
      googleName = clampString(msg.devName, MAX_NAME_LEN);
    }
  }
  client.role = role;
  client.email = email;

  // BANされた人は入れない。名前を割り当てる前に弾く
  if (email && bans.has(email)) {
    const ban = bans.get(email);
    send(client.ws, { t: 'denied', reason: 'banned', by: ban.byName, why: ban.reason });
    return;
  }

  // ブロックしている相手をメモリに載せ直す（別の端末から入っても効くように）
  client.blocks = new Set();
  client.blockNames = new Map();
  if (email) {
    for (const b of await loadBlocks(email)) {
      client.blocks.add(`e:${b.email}`);
      client.blockNames.set(`e:${b.email}`, b.name);
    }
  }

  // ---- イベントの決定 ----
  // 常設イベントは廃止したので、フォールバック先が無い。
  // 管理人が何も立てていなければ会場は閉まっている（2026-07-30）
  if (events.size === 0) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }
  const ev = typeof msg.ev === 'string' ? events.get(msg.ev) : null;
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }

  // ログイン必須イベントにゲストは入れない
  if (ev.requireLogin && role === 'guest') {
    send(client.ws, { t: 'denied', reason: 'login-required', ev: ev.id });
    return;
  }

  // 合言葉。照合はサーバーだけで行う（クライアントには正解を渡していない）
  if (ev.entryCode && clampString(msg.code, MAX_EVENT_CODE_LEN) !== ev.entryCode) {
    send(client.ws, { t: 'denied', reason: 'bad-code', ev: ev.id });
    return;
  }

  // 満室なら入れない（キャパはイベントごと）
  if (!assignableRoom(ev.id)) {
    send(client.ws, { t: 'denied', reason: 'event-full', ev: ev.id });
    return;
  }

  // ---- ルームの決定（指定があり空いていればそこ、無ければ自動割当）----
  const wantRoom = Number.isInteger(msg.rm) && msg.rm >= 1 && msg.rm <= 999 ? msg.rm : null;
  const roomNumber = wantRoom && roomHasSpace(ev.id, wantRoom) ? wantRoom : assignRoom(ev.id);

  // 名前はサーバーが決める。msg.n は受け取らない（他人の名前を名乗れないようにするため）
  client.n = resolveDisplayName(email, googleName);
  // ゲストは見た目を固定（自由度を下げる方針。2026-07-29 確定）
  client.av = role === 'guest' ? { ...GUEST_AV } : sanitizeAv(msg.av);
  client.x = 0;
  client.z = 0;
  client.r = 0;
  client.m = false;
  client.eventId = ev.id;
  client.room = roomNumber;

  const key = roomKey(ev.id, roomNumber);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }

  client.joined = true;
  const peers = visiblePeersFor(client); // 自分を入れる前に集める
  room.set(client.id, client);

  send(client.ws, {
    t: 'welcome',
    id: client.id,
    // 名前はサーバーが決めるので、確定した表示名を本人にも返す
    n: client.n,
    role: client.role,
    // 動画を操作できるかはサーバーが唯一の判断元（ログイン未設定の間は全員 true）
    canControl: canControlVideo(client.role),
    canInteract: canInteract(client.role),
    ev: ev.id,
    event: toEventInfo(ev),
    room: roomNumber,
    peers,
    count: room.size,
    cap: ev.capacity, // クライアントは「定員 − 実在人数」ぶんをNPCで埋める
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
    events: buildEventList(canControlVideo(role)),
    persistent: isPersistent(),
    blocked: blockedListFor(client), // 「ブロック中の人」を画面から解除できるようにする
  });

  // 管理者・VIPはイベント全体に、一般は自室にだけ現れる
  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, roomNumber);

  // 次回そのまま入れるように、ログイン済みなら名前と姿を覚えておく
  if (client.email) await saveProfile(client.email, client.n, client.av);
}

/** pos: 位置更新の中継 */
function handlePos(client, msg) {
  if (!client.joined) return;

  const x = validCoord(msg.x);
  const z = validCoord(msg.z);
  if (x === null || z === null) return; // 非数・範囲外は破棄

  const r = typeof msg.r === 'number' && Number.isFinite(msg.r) ? Math.trunc(msg.r) : 0;
  const m = Boolean(msg.m);

  client.x = x;
  client.z = z;
  client.r = r;
  client.m = m;

  broadcastFrom(client, { t: 'pos', id: client.id, x, z, r, m });
}

/**
 * chat: チャット中継
 * sc（scope）: 'local' … ワールド内だけ（既定）／'stream' … 配信にも流す想定の発言
 * ※ YouTubeへの送信そのものは未実装。ここではscopeを保持して中継するだけ。
 */
function handleChat(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-chat' });
    return;
  }

  const txt = clampString(msg.txt, MAX_TXT_LEN);
  if (!txt) return;

  // 配信送信は管理者のみ（誤爆すると配信のコメント欄から消せないため既定は local）
  let scope = msg.sc === 'stream' ? 'stream' : 'local';
  if (scope === 'stream' && !canControlVideo(client.role)) scope = 'local';

  client.lastChat = { txt, ts: Date.now() };

  // 発信者自身にも返す（クライアント側で自分のidなら無視する仕様）
  broadcastFrom(client, { t: 'chat', id: client.id, n: client.n, txt, sc: scope }, false);
}

/** update: アバターの再カスタム（名前は変えられない） */
async function handleUpdate(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-avatar' });
    return;
  }

  // 名前は入場時にサーバーが確定させたものを使い続ける。msg.n は無視する
  client.av = sanitizeAv(msg.av);

  broadcastFrom(client, { t: 'peer-update', id: client.id, n: client.n, av: client.av, role: client.role });

  // 変更後の姿を次回に持ち越す
  if (client.email) await saveProfile(client.email, client.n, client.av);
}

/** emote: エモート中継（既定リスト以外は破棄・連打は間引く） */
function handleEmote(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-emote' });
    return;
  }
  if (typeof msg.e !== 'string' || !EMOTE_IDS.has(msg.e)) return;

  const now = Date.now();
  if (client.lastEmoteAt && now - client.lastEmoteAt < EMOTE_MIN_INTERVAL_MS) return;
  client.lastEmoteAt = now;

  broadcastFrom(client, { t: 'emote', id: client.id, e: msg.e });
}

/** screen: イベントの動画を変更（管理者のみ）。同じイベントの全ルームに反映される */
async function handleScreen(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  if (typeof msg.v !== 'string' || !VIDEO_ID_RE.test(msg.v)) return;

  const ev = events.get(client.eventId);
  if (!ev) return;

  ev.videoId = msg.v;
  ev.playback = { playing: true, pos: 0, at: Date.now() }; // 動画が変われば先頭から

  broadcastToEvent(client.eventId, { t: 'screen', v: msg.v, by: client.n });
  broadcastToEvent(client.eventId, { t: 'events', events: buildEventList(false) });
  await updateEventVideo(ev.id, msg.v);
}

/** playback: 再生/一時停止/シーク（管理者のみ）。同じイベントの全ルームで揃える */
function handlePlayback(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  if (msg.st !== 'play' && msg.st !== 'pause') return;
  const pos = typeof msg.pos === 'number' && Number.isFinite(msg.pos) ? Math.max(0, msg.pos) : 0;
  if (pos > 24 * 3600) return; // 異常値は破棄

  const ev = events.get(client.eventId);
  if (!ev) return;
  // ライブ配信なら位置は保存しない（上の currentPlayback のコメント参照）
  const live = msg.live === true;
  ev.playback = { playing: msg.st === 'play', pos: live ? 0 : pos, at: Date.now(), live };

  const out = { t: 'playback', id: client.id, st: msg.st };
  if (!live) out.pos = pos;
  broadcastToEvent(client.eventId, out, client.id);
}

/** event-create: イベント作成（管理者のみ） */
async function handleEventCreate(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  if (events.size >= MAX_EVENTS) {
    send(client.ws, { t: 'denied', reason: 'too-many-events' });
    return;
  }

  const ev = await createEventFrom(msg);
  if (!ev) return;
  send(client.ws, { t: 'event-created', ev: toEventInfoAdmin(ev) });
  broadcastAllEvents();
}

/**
 * イベントを1つ作る。WS（入場後の🚪パネル）とHTTP（入場画面）の両方から使う。
 * 入場画面から作れないと、イベント0件のとき「入れないから作れない」で詰むため
 * 入口を2つ用意している（2026-07-30）。
 */
async function createEventFrom(msg) {
  const name = clampString(msg && msg.name, MAX_EVENT_NAME_LEN).trim();
  if (!name) return null;
  const videoId =
    typeof msg.v === 'string' && VIDEO_ID_RE.test(msg.v) ? msg.v : DEFAULT_VIDEO_ID;

  // idは名前から作らず衝突しない連番にする（日本語名でも安全）
  let id = `ev${Date.now().toString(36)}`;
  if (!EVENT_ID_RE.test(id) || events.has(id)) id = `ev${Date.now().toString(36)}${events.size}`;

  const ev = makeEvent({
    id,
    name,
    videoId,
    requireLogin: Boolean(msg.requireLogin),
    entryCode: clampString(msg.code, MAX_EVENT_CODE_LEN).trim(),
    capacity: msg.cap,
    vrcBridge: Boolean(msg.vrc),
  });
  if (ev.vrcBridge) makeBridgeExclusive(ev.id);
  events.set(id, ev);
  await saveEvent(ev);
  return ev;
}

/**
 * event-update: 立てたあとに設定を変える（管理者のみ）
 *
 * 変えると壊れるものだけ拒否する方針（loyさん指示 2026-07-30）。
 * いま拒否しているのは「キャパを現在の在室人数より下げること」だけ。
 * 名前・合言葉・ログイン必須・VRChat連携は、いつ変えても実害がないので通す
 * （合言葉を後から付けても、既に入っている人は追い出さない＝次の入場から効く）。
 */
async function handleEventUpdate(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const ev = events.get(msg && msg.id);
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'no-event' });
    return;
  }

  if (typeof msg.name === 'string') {
    const name = clampString(msg.name, MAX_EVENT_NAME_LEN).trim();
    if (name) ev.name = name;
  }
  if (typeof msg.code === 'string') {
    ev.entryCode = clampString(msg.code, MAX_EVENT_CODE_LEN).trim();
  }
  if (typeof msg.requireLogin === 'boolean') {
    ev.requireLogin = msg.requireLogin;
  }
  if (typeof msg.vrc === 'boolean') {
    ev.vrcBridge = msg.vrc;
    if (ev.vrcBridge) makeBridgeExclusive(ev.id);
  }
  if (msg.cap !== undefined) {
    const want = clampCapacity(msg.cap);
    const floor = maxRoomOccupancy(ev.id);
    if (want < floor) {
      // 減らしすぎ。いま入っている人を弾き出すことになるので拒否する
      send(client.ws, { t: 'denied', reason: 'capacity-too-small', ev: ev.id, min: floor });
      return;
    }
    ev.capacity = want;
  }

  await saveEvent(ev);
  send(client.ws, { t: 'event-updated', ev: toEventInfoAdmin(ev) });
  broadcastAllEvents();
}

/**
 * event-delete: イベントを閉じる（管理者のみ）
 *
 * 2026-07-30 変更: 以前は「人がいる間は消せない」だったが、
 * 「閉じたら何もなくなる」方針に合わせ、中の人を退場させてから消す。
 * ライブの終演と同じ扱い。誤操作が怖いので、確認はクライアント側で取る。
 */
async function handleEventDelete(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const ev = events.get(msg.id);
  if (!ev) {
    send(client.ws, { t: 'denied', reason: 'cannot-delete' });
    return;
  }

  // 中にいる人へ「閉まった」ことを伝えて切る（自分も含む）
  for (const [key, members] of Array.from(rooms)) {
    if (keyEventId(key) !== ev.id) continue;
    for (const c of Array.from(members.values())) {
      send(c.ws, { t: 'closed', ev: ev.id, name: ev.name });
      try {
        c.ws.close();
      } catch (e) {
        // 既に切れていても構わない
      }
    }
    rooms.delete(key);
  }

  events.delete(ev.id);
  await deleteEvent(ev.id);
  broadcastAllEvents();
}

/** move: 別のイベント/ルームへ移動する */
function handleMove(client, msg) {
  if (!client.joined) return;

  const targetEventId = typeof msg.ev === 'string' && events.has(msg.ev) ? msg.ev : client.eventId;
  const ev = events.get(targetEventId);
  if (!ev) return;
  if (ev.requireLogin && client.role === 'guest') {
    send(client.ws, { t: 'denied', reason: 'login-required', ev: ev.id });
    return;
  }

  const wantRoom = Number.isInteger(msg.rm) && msg.rm >= 1 && msg.rm <= 999 ? msg.rm : null;
  const targetRoom = wantRoom && roomHasSpace(ev.id, wantRoom) ? wantRoom : assignRoom(ev.id);
  if (targetEventId === client.eventId && targetRoom === client.room) return; // 同じ場所なら何もしない

  // 元の場所から抜ける
  leaveCurrentRoom(client);

  client.eventId = ev.id;
  client.room = targetRoom;
  client.x = 0;
  client.z = 0;

  const key = roomKey(ev.id, targetRoom);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }
  const peers = visiblePeersFor(client);
  room.set(client.id, client);

  send(client.ws, {
    t: 'moved',
    ev: ev.id,
    event: toEventInfo(ev),
    room: targetRoom,
    peers,
    count: room.size,
    cap: ev.capacity,
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
  });

  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, targetRoom);
  broadcastAllEvents();
}

/** events: 一覧の要求 */
function handleEventsRequest(client) {
  send(client.ws, { t: 'events', events: buildEventList(canControlVideo(client.role)) });
}

// ------------------------------------------------------------
// 迷惑行為への対処（ブロック／キック／BAN）
//
// 3つの強さが違うので、使える人と効き方を分けている:
//   ブロック … 誰でも使える。自分と相手が互いに見えなくなるだけ。相手は入場し続けられる
//   キック   … 管理者・VIP。その場から退出させる。すぐ入り直せる（一時的な冷却用）
//   BAN      … 管理者だけ。Googleアカウント単位で再入場を止める
// ------------------------------------------------------------

/** ブロック相手を画面に出さないための識別子。メールを本人以外に見せないため短いハッシュにする */
function blockToken(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 自分のブロック一覧（UIの「解除」に使う）。メールそのものは返さない */
function blockedListFor(client) {
  const out = [];
  for (const key of client.blocks) {
    out.push({ k: blockToken(key), n: client.blockNames.get(key) || '（名前不明）' });
  }
  return out;
}

/** 同じイベントにいる相手を接続idで探す（キック・BAN・ブロックの対象指定に使う） */
function findPeerInEvent(client, id) {
  if (typeof id !== 'string' || !id) return null;
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    const target = members.get(id);
    if (target) return target;
  }
  return null;
}

/** その相手を自分の画面から消す／相手の画面からも自分を消す */
function hideEachOther(a, b) {
  send(a.ws, { t: 'peer-leave', id: b.id });
  send(b.ws, { t: 'peer-leave', id: a.id });
}

/** block: 相手と相互に見えなくする。相手には通知しない（トラブルを増やさないため） */
async function handleBlock(client, msg) {
  if (!client.joined) return;
  const target = findPeerInEvent(client, msg.id);
  if (!target) return;
  if (target.id === client.id) return; // 自分はブロックできない
  if (client.blocks.size >= MAX_BLOCKS) {
    send(client.ws, { t: 'denied', reason: 'too-many-blocks' });
    return;
  }

  const key = blockKeyOf(target);
  client.blocks.add(key);
  client.blockNames.set(key, target.n);
  hideEachOther(client, target);
  send(client.ws, { t: 'blocked', k: blockToken(key), n: target.n });

  // 記録できるのはログイン済み同士だけ。ゲストは次に来たら別人なので残しても意味がない
  if (client.email && target.email) await saveBlock(client.email, target.email, target.n);
}

/** unblock: 解除。姿がすぐ戻るように、同じ場所にいれば入場通知を送り直す */
async function handleUnblock(client, msg) {
  if (!client.joined) return;
  let hit = '';
  for (const key of client.blocks) {
    if (blockToken(key) === msg.k) {
      hit = key;
      break;
    }
  }
  if (!hit) return;

  client.blocks.delete(hit);
  client.blockNames.delete(hit);
  if (client.email && hit.startsWith('e:')) await deleteBlock(client.email, hit.slice(2));

  // 解除した相手が今その場にいるなら、互いの姿を戻す
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== client.eventId) continue;
    for (const other of members.values()) {
      if (other.id === client.id) continue;
      if (blockKeyOf(other) !== hit) continue;
      if (isBlockedBetween(client, other)) continue; // 相手側のブロックが残っていれば戻さない
      send(client.ws, { t: 'peer-join', p: toPeerInfo(other) });
      send(other.ws, { t: 'peer-join', p: toPeerInfo(client) });
    }
  }
  send(client.ws, { t: 'blocked-list', list: blockedListFor(client) });
}

/**
 * kick: その場から退出させる（管理者・VIP）。再入場はできる。
 * 同格以上は蹴れない。VIPが管理者を、管理者が管理者を蹴れると収拾がつかなくなるため。
 */
function handleKick(client, msg) {
  if (!client.joined) return;
  if (!isGlobalRole(client.role)) {
    send(client.ws, { t: 'denied', reason: 'staff-only' });
    return;
  }
  const target = findPeerInEvent(client, msg.id);
  if (!target || target.id === client.id) return;
  if (isGlobalRole(target.role)) {
    send(client.ws, { t: 'denied', reason: 'cannot-kick-staff' });
    return;
  }
  send(target.ws, { t: 'kicked', by: client.n });
  send(client.ws, { t: 'moderated', act: 'kick', n: target.n });
  try {
    target.ws.close();
  } catch {
    // 既に切れている場合は何もしない（closeイベント側で後始末される）
  }
}

/** ban: 再入場を止める（管理者だけ）。Googleアカウント単位なのでゲストにはかけられない */
async function handleBan(client, msg) {
  if (!client.joined) return;
  if (client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const target = findPeerInEvent(client, msg.id);
  if (!target || target.id === client.id) return;
  if (isGlobalRole(target.role)) {
    send(client.ws, { t: 'denied', reason: 'cannot-ban-staff' });
    return;
  }
  if (!target.email) {
    // ゲストは次に来たら別人になるので、BANしても止められない
    send(client.ws, { t: 'denied', reason: 'cannot-ban-guest' });
    return;
  }

  const ban = {
    email: target.email,
    name: target.n,
    byName: client.n,
    reason: clampString(msg.why, MAX_BAN_REASON_LEN),
    createdAt: Date.now(),
  };
  bans.set(ban.email, ban);
  await saveBan(ban);

  send(target.ws, { t: 'banned', by: client.n, why: ban.reason });
  send(client.ws, { t: 'moderated', act: 'ban', n: target.n });
  try {
    target.ws.close();
  } catch {
    // 同上
  }
}

/** unban: 解除（管理者だけ） */
async function handleUnban(client, msg) {
  if (!client.joined || client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const email = typeof msg.email === 'string' ? msg.email.toLowerCase() : '';
  if (!email || !bans.has(email)) return;
  bans.delete(email);
  await deleteBan(email);
  send(client.ws, { t: 'bans', list: [...bans.values()] });
}

/** bans: BAN一覧の要求（管理者だけ） */
function handleBansRequest(client) {
  if (!client.joined || client.role !== 'admin') {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  send(client.ws, { t: 'bans', list: [...bans.values()] });
}

const HANDLERS = {
  join: handleJoin,
  pos: handlePos,
  chat: handleChat,
  update: handleUpdate,
  emote: handleEmote,
  screen: handleScreen,
  playback: handlePlayback,
  'event-create': handleEventCreate,
  'event-update': handleEventUpdate,
  'event-delete': handleEventDelete,
  move: handleMove,
  events: handleEventsRequest,
  block: handleBlock,
  unblock: handleUnblock,
  kick: handleKick,
  ban: handleBan,
  unban: handleUnban,
  bans: handleBansRequest,
};

/** 全員にイベント一覧を配る（人数が変わったとき・イベントが増減したとき） */
function broadcastAllEvents() {
  const forAll = { t: 'events', events: buildEventList(false) };
  const forAdmin = { t: 'events', events: buildEventList(true) };
  for (const members of rooms.values()) {
    for (const client of members.values()) {
      send(client.ws, canControlVideo(client.role) ? forAdmin : forAll);
    }
  }
}

/** 今いるルームから抜ける（切断・移動の共通処理） */
function leaveCurrentRoom(client) {
  if (client.eventId === null || client.room === null) return;
  const key = roomKey(client.eventId, client.room);
  const room = rooms.get(key);
  if (!room) return;

  room.delete(client.id);
  broadcastFrom(client, { t: 'peer-leave', id: client.id });

  if (room.size === 0) {
    rooms.delete(key); // 空ルームは破棄（番号の穴あきは assignRoom が埋める）
  } else {
    broadcastCount(client.eventId, client.room);
  }
}

/** 切断時処理 */
function handleDisconnect(client) {
  if (!client.joined) return;
  leaveCurrentRoom(client);
  client.joined = false;
  client.eventId = null;
  client.room = null;
}

/** レート制限チェック: 直近1秒間の送信回数が上限を超えていないか */
function isRateLimited(client) {
  const now = Date.now();
  client.msgTimes = client.msgTimes.filter((t) => now - t < 1000);
  client.msgTimes.push(now);
  return client.msgTimes.length > RATE_LIMIT_PER_SEC;
}

// ------------------------------------------------------------
// HTTP: ステータスJSON / presence.json / イベント一覧
// ------------------------------------------------------------

function buildStatusJson() {
  const roomList = Array.from(rooms.entries())
    .map(([key, members]) => ({ event: keyEventId(key), room: keyRoomNumber(key), count: members.size }))
    .sort((a, b) => (a.event === b.event ? a.room - b.room : a.event < b.event ? -1 : 1));

  return {
    ok: true,
    rooms: roomList,
    events: buildEventList(false),
    persistent: isPersistent(),
    login: isLoginEnabled(),
    // 設定ミスを画面から特定できるようにする（トークンは含めない）
    store: getStoreStatus(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    // いま動いているのがどのコミットかを外から見られるようにする。
    // 2026-07-30、本番が9コミット前のまま止まっているのに気づけず、
    // 「デプロイしたのに反映されない」の切り分けに時間を取られた。
    // Render が渡す環境変数をそのまま出す（ローカルでは unknown）
    commit: (process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 7),
    branch: process.env.RENDER_GIT_BRANCH || 'unknown',
  };
}

// ------------------------------------------------------------
// ブラウザ座標 → VRChatワールド座標
//
// なぜ必要か: ブラウザ側の会場は VRChat の VERSE CITY2025 から書き出した
// 同じメッシュだが、変換時に「会場の中心を原点へ寄せる」処理を入れたため、
// 座標が VRC 本体とズレている。VRC側の定数で吸収してもらう案もあったが、
// 「あっちは直すの大変」（2026-07-30 loyさん判断）なので、送る直前にこちらで戻す。
//
// 寄せ幅は書き出しログ(offset_applied)に残っており、Unityシーンの実測値とも一致した:
//   会場入口         VRC(-213.90, -61.60) ⇔ ブラウザ(4.90, 10.31)  … 誤差 0.00m
//   ステージ背面ガラス VRC(-213.92, -99.15) ⇔ ブラウザ(4.92, -27.24) … 基準点の違いのみ
//
// X だけ符号が反転するのは、Unity(左手系) から書き出して three.js(右手系) へ
// 取り込んだため。向きも同じ理由で左右が入れ替わる:
//   ブラウザの r は three.js の rotation.y（度）で、向き = (sin r, cos r)。
//   X が反転するので VRC 側の向きは (-sin r, cos r) = 角度 -r になる。
// ------------------------------------------------------------
const VRC_ORIGIN_X = -209.0; // 会場中心のVRCワールド座標X
const VRC_ORIGIN_Z = -71.91; // 会場中心のVRCワールド座標Z

/** ブラウザのx → VRCのX（X軸は反転する） */
function toVrcX(x) {
  return Math.round((-x + VRC_ORIGIN_X) * 10) / 10;
}

/** ブラウザのz → VRCのZ */
function toVrcZ(z) {
  return Math.round((z + VRC_ORIGIN_Z) * 10) / 10;
}

/** ブラウザの向き(度) → VRCの向き(度・0〜359) */
function toVrcRot(r) {
  return ((Math.round(-r) % 360) + 360) % 360;
}

/**
 * presence.json（PRESENCE_SPEC v=1 は凍結。フィールドを増やさない）
 *
 * x/z/r は VRChatワールド座標系で出す（2026-07-30 変更。上の変換を参照）。
 *
 * rm はルーム番号なので、イベントをまたぐと番号が衝突して
 * 「別のイベントにいる人が同じ部屋にいる」ように見えてしまう。
 * v=1 のまま正しさを保つため、VRC側へ出すのは常設イベント(main)だけにしている。
 * 特別イベントも流したくなったら、Unity側と v=2 の相談が必要。
 */
function buildPresenceJson() {
  const nowMs = Date.now();
  const web = [];

  // VRChatの会場は clubVERSE 1つなので、送るイベントも1つに絞る。
  // どれを送るかは管理人が「VRChatに出す」設定で選ぶ（2026-07-30。以前は常設main固定だった）
  const bridged = bridgedEvent();
  const keys = bridged
    ? Array.from(rooms.keys())
        .filter((k) => keyEventId(k) === bridged.id)
        .sort((a, b) => keyRoomNumber(a) - keyRoomNumber(b))
    : [];

  outer: for (const key of keys) {
    const room = rooms.get(key);
    for (const client of room.values()) {
      if (web.length >= PRESENCE_MAX_WEB) break outer;

      const entry = {
        rm: keyRoomNumber(key),
        n: client.n,
        // VRC側がそのまま置ける値にして渡す（変換の理由は上のコメント）
        x: toVrcX(client.x),
        z: toVrcZ(client.z),
        r: toVrcRot(client.r),
        av: client.av,
      };

      if (ENABLE_CHAT_FIELD && client.lastChat && nowMs - client.lastChat.ts <= PRESENCE_CHAT_WINDOW_MS) {
        entry.c = [
          clampString(client.lastChat.txt, PRESENCE_CHAT_TXT_MAX),
          Math.floor(client.lastChat.ts / 1000),
        ];
      }

      web.push(entry);
    }
  }

  return {
    v: 1,
    ts: Math.floor(nowMs / 1000),
    web,
    yt: [], // YouTubeチャット連携は現段階では未実装のため常に空配列
  };
}

// ------------------------------------------------------------
// HTTPサーバー本体
// ------------------------------------------------------------

// 開発用: ブラウザで描いた絵をファイルに保存する（見た目を確認しながら直すため）。
// ALLOW_SHOTS=1、またはローカル起動（Render以外）のループバック接続のみ有効。
const ALLOW_SHOTS = process.env.ALLOW_SHOTS === '1' || !process.env.RENDER;
function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

async function handleShot(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 20 * 1024 * 1024) req.destroy();
  });
  await new Promise((resolve) => req.on('end', resolve));
  try {
    const { name, data } = JSON.parse(body);
    const safeName = String(name || 'shot').replace(/[^A-Za-z0-9_-]/g, '');
    const base64 = String(data).replace(/^data:image\/png;base64,/, '');
    const dir = path.join(CLIENT_ROOT, '_shots');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${safeName}.png`), Buffer.from(base64, 'base64'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, file: `_shots/${safeName}.png` }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

/** リクエストのJSON本文を読む（上限つき） */
async function readJsonBody(req, maxBytes = 64 * 1024) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > maxBytes) req.destroy();
  });
  await new Promise((resolve) => req.on('end', resolve));
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * POST /api/profile — 保存済みの名前とアバターを返す。
 * IDトークンを検証して本人のぶんだけ返すので、他人の設定は取れない。
 */
async function handleProfileRequest(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const body = await readJsonBody(req);
  const info = body && body.idt ? await verifyIdToken(body.idt) : null;
  if (!info) {
    send(401, { ok: false, error: 'not-signed-in' });
    return;
  }

  const saved = await loadProfile(info.email);
  send(200, {
    ok: true,
    name: saved ? saved.name : '',
    av: saved ? saved.av : null,
    // 保存が無いときの初期値として使ってもらう（本名の可能性があるので強制はしない）
    googleName: info.name || '',
    role: roleForEmail(info.email),
  });
}

/**
 * 入場画面から管理人がイベントを立てるためのHTTP口。
 *
 * 入場後の🚪パネルからも作れる（WSの event-create）が、常設イベントを廃止したことで
 * 「イベントが0件だと入場できない → 入場できないと作れない」という詰みが起きる。
 * それを避けるため、WSに繋ぐ前でも作れる入口をここに用意している（2026-07-30）。
 */
async function handleAdminEventCreate(req, res) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const body = await readJsonBody(req);

  // 権限の判定。WS側の join と同じ考え方に揃えている:
  //   ログイン設定済み → Googleのトークンで判定
  //   ログイン未設定（ローカル開発）→ defaultRole。加えて devRole の指定を許す
  // devRole は Render 上では絶対に効かない（RENDER環境変数で封じている）。
  // これが無いと、ログイン未設定の環境でイベントを1つも作れず何もできなくなる
  let role = defaultRole();
  if (body && body.idt) {
    const info = await verifyIdToken(body.idt);
    if (!info) {
      reply(401, { ok: false, error: 'not-signed-in' });
      return;
    }
    role = roleForEmail(info.email);
  } else if (isLoginEnabled()) {
    reply(401, { ok: false, error: 'not-signed-in' });
    return;
  }
  if (ALLOW_DEV_ROLE && body && typeof body.devRole === 'string' && DEV_ROLES.has(body.devRole)) {
    role = body.devRole;
  }
  if (!canControlVideo(role)) {
    reply(403, { ok: false, error: 'admin-only' });
    return;
  }
  if (events.size >= MAX_EVENTS) {
    reply(400, { ok: false, error: 'too-many-events' });
    return;
  }

  const ev = await createEventFrom(body);
  if (!ev) {
    reply(400, { ok: false, error: 'bad-name' });
    return;
  }
  broadcastAllEvents();
  reply(200, { ok: true, ev: toEventInfoAdmin(ev) });
}

const httpServer = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (ALLOW_SHOTS && isLoopback(req) && req.method === 'POST' && url === '/api/_shot') {
    await handleShot(req, res);
    return;
  }

  if (req.method === 'GET' && url === '/api/status') {
    const body = JSON.stringify(buildStatusJson());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  // 入場画面が「前回の名前とアバター」を取りに来る。
  // GETではなくPOSTなのは、IDトークンをURLに載せない（履歴やログに残さない）ため。
  if (req.method === 'POST' && url === '/api/profile') {
    await handleProfileRequest(req, res);
    return;
  }

  // 入場画面から管理人がイベントを立てる（イベント0件のときの唯一の入口）
  if (req.method === 'POST' && url === '/api/admin/event') {
    await handleAdminEventCreate(req, res);
    return;
  }

  // 入場画面がログインボタンの出し分けとイベント一覧に使う
  if (req.method === 'GET' && url === '/api/config') {
    const body = JSON.stringify({
      ok: true,
      login: isLoginEnabled(),
      clientId: getClientId(),
      persistent: isPersistent(),
      events: buildEventList(false),
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && url === '/api/presence.json') {
    const body = JSON.stringify(buildPresenceJson());
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return;
  }

  // ---- 静的ファイル配信（クライアント一式。1サービスでデプロイできるようにする） ----
  if (req.method === 'GET') {
    // パストラバーサル防止＋サーバーコードは配信しない
    const safePath = path.normalize(url).replace(/^([/\\])+/, '');
    if (safePath.startsWith('..') || safePath.startsWith('server')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    const filePath = path.join(CLIENT_ROOT, safePath === '' ? 'index.html' : safePath);
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
      return;
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

// ------------------------------------------------------------
// WebSocketサーバー（/ws のみ受け付け）
// ------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url !== WS_PATH && !url.startsWith(`${WS_PATH}?`)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// ---- 死活監視 ----
const HEARTBEAT_MS = 30000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, HEARTBEAT_MS).unref?.();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const client = {
    id: `c${nextClientSeq++}`,
    ws,
    eventId: null,
    room: null,
    joined: false,
    role: 'guest',
    email: '',
    n: '',
    av: {},
    x: 0,
    z: 0,
    r: 0,
    m: false,
    lastChat: null,
    msgTimes: [],
    // ブロックしている相手（相互不可視の判定に使う）。入場時にDBから読み直す
    blocks: new Set(),
    blockNames: new Map(), // 解除UIに出す名前。キーはblocks側と同じ
  };

  ws.on('message', (raw) => {
    if (isRateLimited(client)) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // 不正JSONは無視
    }

    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    // join前の他メッセージは無視
    if (!client.joined && msg.t !== 'join') return;

    const handler = HANDLERS[msg.t];
    if (!handler) return; // 想定外のtは無視（切断まではしない）

    // handleJoin/handleScreen は非同期（トークン検証・DB書き込み）
    Promise.resolve(handler(client, msg)).catch(() => {});
  });

  ws.on('close', () => {
    handleDisconnect(client);
  });

  ws.on('error', () => {
    // 個別クライアントのソケットエラーはログのみ（サーバー自体は継続）
  });
});

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------

async function boot() {
  await initStore();

  // 保存済みイベントを復元。何も無ければ会場は閉まったまま（管理人が立てるまで誰も入れない）
  for (const row of await loadEvents()) {
    events.set(row.id, makeEvent(row));
  }
  // 保存内容が壊れていて2つ以上ONでも、VRChatへ出すのは1つに保つ
  const firstBridged = bridgedEvent();
  if (firstBridged) makeBridgeExclusive(firstBridged.id);

  // BANはメモリに載せておく。入場のたびにDBを叩かずに済ませるため
  for (const b of await loadBans()) bans.set(b.email, b);

  httpServer.listen(PORT, () => {
    console.log(`[VERSE CITY Web Server] listening on port ${PORT} (ws path: ${WS_PATH})`);
    console.log(`  ログイン: ${isLoginEnabled() ? '有効' : '無効（GOOGLE_CLIENT_ID 未設定）'}`);
    console.log(`  イベント永続化: ${isPersistent() ? '有効（Turso）' : '無効（メモリのみ）'}`);
    console.log(`  イベント数: ${events.size} ／ BAN: ${bans.size}件`);
  });
}

boot();
