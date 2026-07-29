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
import { WebSocketServer } from 'ws';

import {
  initStore,
  isPersistent,
  getStoreStatus,
  loadEvents,
  saveEvent,
  updateEventVideo,
  deleteEvent,
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

const MAX_PER_ROOM = 30;          // 1ルームの定員
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
const MAIN_EVENT_ID = 'main';                 // 常設イベント（削除不可・必ず存在する）
const MAIN_EVENT_NAME = 'VERSE CITY';
const MAX_EVENTS = 20;
const MAX_EVENT_NAME_LEN = 24;
const EVENT_ID_RE = /^[a-z0-9_-]{1,24}$/;

// ゲスト（未ログイン）の固定アバター。見た目は後で確定させる（2026-07-29 時点の暫定）
const GUEST_AV = { h: 'short', o: 'middle', ac: 'none', hc: 12, sc: 12, bc: 0, ec: 0, pl: 9 };

// 開発用の権限指定を許すか。Render上では常に無効（RENDER環境変数が必ず立つため）。
// ローカルでのみ有効で、管理者/VIP/ゲストの挙動を実際に動かして確かめるために使う。
const DEV_ROLES = new Set(['admin', 'vip', 'user', 'guest']);
const ALLOW_DEV_ROLE = !process.env.RENDER;

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
//   Event = { id, name, videoId, playback:{playing,pos,at}, requireLogin, permanent, createdAt }
const events = new Map();

// rooms: Map<roomKey, Map<clientId, ClientState>>   roomKey = `${eventId}#${roomNumber}`
const rooms = new Map();

let nextClientSeq = 1; // "c1", "c2", ... を払い出す連番
const startedAt = Date.now();

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

function makeEvent({ id, name, videoId, requireLogin = false, permanent = false, createdAt = Date.now() }) {
  return {
    id,
    name,
    videoId,
    requireLogin,
    permanent,
    createdAt,
    playback: { playing: true, pos: 0, at: Date.now() },
  };
}

/** 常設イベントを必ず1つ用意する（Tursoが無くても・落ちていても存在する） */
function ensureMainEvent() {
  if (!events.has(MAIN_EVENT_ID)) {
    events.set(
      MAIN_EVENT_ID,
      makeEvent({ id: MAIN_EVENT_ID, name: MAIN_EVENT_NAME, videoId: DEFAULT_VIDEO_ID, permanent: true }),
    );
  }
}

/** 現在の再生位置を求める（pos は at 時点の位置なので、再生中なら経過分を足す） */
function currentPlayback(eventId) {
  const ev = events.get(eventId);
  if (!ev) return { st: 'play', pos: 0 };
  const pb = ev.playback;
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
    permanent: ev.permanent,
    count: countInEvent(ev.id),
  };
}

function countInEvent(eventId) {
  let n = 0;
  for (const [key, members] of rooms) {
    if (keyEventId(key) === eventId) n += members.size;
  }
  return n;
}

/** イベント一覧＋各ルームの人数（入場画面とルーム移動で使う） */
function buildEventList() {
  return Array.from(events.values())
    .sort((a, b) => (a.permanent === b.permanent ? a.createdAt - b.createdAt : a.permanent ? -1 : 1))
    .map((ev) => ({ ...toEventInfo(ev), rooms: buildRoomList(ev.id) }));
}

/** そのイベントのルーム一覧。空きのある最小番号を必ず1つは含める */
function buildRoomList(eventId) {
  const list = [];
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    list.push({ room: keyRoomNumber(key), count: members.size, full: members.size >= MAX_PER_ROOM });
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

/** 指定ルームが定員未満か */
function roomHasSpace(eventId, roomNumber) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return true;
  return room.size < MAX_PER_ROOM;
}

/** そのイベントで「空きのある最小番号ルーム」 */
function assignRoom(eventId) {
  let n = 1;
  for (;;) {
    if (roomHasSpace(eventId, n)) return n;
    n += 1;
  }
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

/** 同室の全員（フィルタ可）にブロードキャスト */
function broadcastToRoom(eventId, roomNumber, obj, excludeId = null) {
  const room = rooms.get(roomKey(eventId, roomNumber));
  if (!room) return;
  for (const client of room.values()) {
    if (excludeId && client.id === excludeId) continue;
    send(client.ws, obj);
  }
}

/** 同じイベントの全ルームへブロードキャスト（管理者・VIPの姿と発言はこちらを使う） */
function broadcastToEvent(eventId, obj, excludeId = null) {
  for (const [key, members] of rooms) {
    if (keyEventId(key) !== eventId) continue;
    for (const client of members.values()) {
      if (excludeId && client.id === excludeId) continue;
      send(client.ws, obj);
    }
  }
}

/**
 * そのクライアントの発信をどこまで届けるか。
 * 管理者・VIPはイベント全体、それ以外は自室のみ。
 */
function broadcastFrom(client, obj, excludeSelf = true) {
  const exclude = excludeSelf ? client.id : null;
  if (isGlobalRole(client.role)) {
    broadcastToEvent(client.eventId, obj, exclude);
  } else {
    broadcastToRoom(client.eventId, client.room, obj, exclude);
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
  if (msg.idt) {
    const info = await verifyIdToken(msg.idt);
    if (info) {
      email = info.email;
      role = roleForEmail(email);
    }
  }
  // 開発用の権限指定。Render上では絶対に効かない（RENDER環境変数で封じる）うえ、
  // OAuthを設定した時点でも無効になる。VIP・ゲストの挙動をローカルで試すためのもの。
  if (ALLOW_DEV_ROLE && typeof msg.devRole === 'string' && DEV_ROLES.has(msg.devRole)) {
    role = msg.devRole;
  }
  client.role = role;
  client.email = email;

  // ---- イベントの決定 ----
  ensureMainEvent();
  const wantEvent = typeof msg.ev === 'string' && events.has(msg.ev) ? msg.ev : MAIN_EVENT_ID;
  const ev = events.get(wantEvent);

  // ログイン必須イベントにゲストは入れない
  if (ev.requireLogin && role === 'guest') {
    send(client.ws, { t: 'denied', reason: 'login-required', ev: ev.id });
    return;
  }

  // ---- ルームの決定（指定があり空いていればそこ、無ければ自動割当）----
  const wantRoom = Number.isInteger(msg.rm) && msg.rm >= 1 && msg.rm <= 999 ? msg.rm : null;
  const roomNumber = wantRoom && roomHasSpace(ev.id, wantRoom) ? wantRoom : assignRoom(ev.id);

  client.n = clampString(msg.n, MAX_NAME_LEN, '名無し');
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
    role: client.role,
    // 動画を操作できるかはサーバーが唯一の判断元（ログイン未設定の間は全員 true）
    canControl: canControlVideo(client.role),
    canInteract: canInteract(client.role),
    ev: ev.id,
    event: toEventInfo(ev),
    room: roomNumber,
    peers,
    count: room.size,
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
    events: buildEventList(),
    persistent: isPersistent(),
  });

  // 管理者・VIPはイベント全体に、一般は自室にだけ現れる
  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, roomNumber);
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

/** update: アバター/名前の再カスタム */
function handleUpdate(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-avatar' });
    return;
  }

  client.n = clampString(msg.n, MAX_NAME_LEN, client.n);
  client.av = sanitizeAv(msg.av);

  broadcastFrom(client, { t: 'peer-update', id: client.id, n: client.n, av: client.av });
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
  broadcastToEvent(client.eventId, { t: 'events', events: buildEventList() });
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
  ev.playback = { playing: msg.st === 'play', pos, at: Date.now() };

  broadcastToEvent(client.eventId, { t: 'playback', id: client.id, st: msg.st, pos }, client.id);
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

  const name = clampString(msg.name, MAX_EVENT_NAME_LEN).trim();
  if (!name) return;
  const videoId = typeof msg.v === 'string' && VIDEO_ID_RE.test(msg.v) ? msg.v : DEFAULT_VIDEO_ID;

  // idは名前から作らず衝突しない連番にする（日本語名でも安全）
  let id = `ev${Date.now().toString(36)}`;
  if (!EVENT_ID_RE.test(id)) id = `ev${events.size + 1}`;

  const ev = makeEvent({ id, name, videoId, requireLogin: Boolean(msg.requireLogin) });
  events.set(id, ev);
  await saveEvent(ev);

  send(client.ws, { t: 'event-created', ev: toEventInfo(ev) });
  broadcastAllEvents();
}

/** event-delete: イベント削除（管理者のみ・常設は消せない・人がいる間は消せない） */
async function handleEventDelete(client, msg) {
  if (!client.joined) return;
  if (!canControlVideo(client.role)) {
    send(client.ws, { t: 'denied', reason: 'admin-only' });
    return;
  }
  const ev = events.get(msg.id);
  if (!ev || ev.permanent) {
    send(client.ws, { t: 'denied', reason: 'cannot-delete' });
    return;
  }
  if (countInEvent(ev.id) > 0) {
    send(client.ws, { t: 'denied', reason: 'event-not-empty' });
    return;
  }

  events.delete(ev.id);
  await deleteEvent(ev.id);
  broadcastAllEvents();
}

/** move: 別のイベント/ルームへ移動する */
function handleMove(client, msg) {
  if (!client.joined) return;

  ensureMainEvent();
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
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
  });

  broadcastFrom(client, { t: 'peer-join', p: toPeerInfo(client) });
  broadcastCount(ev.id, targetRoom);
  broadcastAllEvents();
}

/** events: 一覧の要求 */
function handleEventsRequest(client) {
  send(client.ws, { t: 'events', events: buildEventList() });
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
  'event-delete': handleEventDelete,
  move: handleMove,
  events: handleEventsRequest,
};

/** 全員にイベント一覧を配る（人数が変わったとき・イベントが増減したとき） */
function broadcastAllEvents() {
  const payload = { t: 'events', events: buildEventList() };
  for (const members of rooms.values()) {
    for (const client of members.values()) send(client.ws, payload);
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
    events: buildEventList(),
    persistent: isPersistent(),
    login: isLoginEnabled(),
    // 設定ミスを画面から特定できるようにする（トークンは含めない）
    store: getStoreStatus(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  };
}

/**
 * presence.json（PRESENCE_SPEC v=1 は凍結。フィールドを増やさない）
 *
 * rm はルーム番号なので、イベントをまたぐと番号が衝突して
 * 「別のイベントにいる人が同じ部屋にいる」ように見えてしまう。
 * v=1 のまま正しさを保つため、VRC側へ出すのは常設イベント(main)だけにしている。
 * 特別イベントも流したくなったら、Unity側と v=2 の相談が必要。
 */
function buildPresenceJson() {
  const nowMs = Date.now();
  const web = [];

  const keys = Array.from(rooms.keys())
    .filter((k) => keyEventId(k) === MAIN_EVENT_ID)
    .sort((a, b) => keyRoomNumber(a) - keyRoomNumber(b));

  outer: for (const key of keys) {
    const room = rooms.get(key);
    for (const client of room.values()) {
      if (web.length >= PRESENCE_MAX_WEB) break outer;

      const entry = {
        rm: keyRoomNumber(key),
        n: client.n,
        x: client.x,
        z: client.z,
        r: client.r,
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

  // 入場画面がログインボタンの出し分けとイベント一覧に使う
  if (req.method === 'GET' && url === '/api/config') {
    const body = JSON.stringify({
      ok: true,
      login: isLoginEnabled(),
      clientId: getClientId(),
      persistent: isPersistent(),
      events: buildEventList(),
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
  ensureMainEvent();

  // 保存済みイベントを復元（常設は上書きしない）
  for (const row of await loadEvents()) {
    if (row.id === MAIN_EVENT_ID) continue;
    events.set(row.id, makeEvent(row));
  }

  httpServer.listen(PORT, () => {
    console.log(`[VERSE CITY Web Server] listening on port ${PORT} (ws path: ${WS_PATH})`);
    console.log(`  ログイン: ${isLoginEnabled() ? '有効' : '無効（GOOGLE_CLIENT_ID 未設定）'}`);
    console.log(`  イベント永続化: ${isPersistent() ? '有効（Turso）' : '無効（メモリのみ）'}`);
    console.log(`  イベント数: ${events.size}`);
  });
}

boot();
