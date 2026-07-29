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
import {
  initCrossPost,
  isCrossPostConfigured,
  getCrossPostStatus,
  buildAuthUrl,
  handleAuthCallback,
  disconnect as ytDisconnect,
  setEnabled as ytSetEnabled,
  isEnabled as ytIsEnabled,
  enqueue as ytEnqueue,
} from './youtube.js';

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
//   Event = { id, name, videoId, playback:{playing,pos,at}, requireLogin, permanent, createdAt }
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
    cap: MAX_PER_ROOM, // クライアントは「定員 − 実在人数」ぶんをNPCで埋める
    screen: ev.videoId,
    playback: currentPlayback(ev.id),
    events: buildEventList(),
    persistent: isPersistent(),
    blocked: blockedListFor(client), // 「ブロック中の人」を画面から解除できるようにする
    stream: ytIsEnabled(), // 配信のコメント欄への転送がONかどうか（📺ボタンの出し分け）
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
 * sc（scope）: 'local' … ワールド内だけ（既定）／'stream' … YouTubeの配信チャットにも流す
 *
 * 既定を local にしているのは、配信に出た発言は**取り消せない**から。
 * 不可逆な方をうっかり既定にしない。
 */
function handleChat(client, msg) {
  if (!client.joined) return;
  if (!canInteract(client.role)) {
    send(client.ws, { t: 'denied', reason: 'guest-no-chat' });
    return;
  }

  const txt = clampString(msg.txt, MAX_TXT_LEN);
  if (!txt) return;

  let scope = msg.sc === 'stream' ? 'stream' : 'local';
  // 管理者が転送をONにしていなければ、ワールド内だけの発言に落とす
  if (scope === 'stream' && !ytIsEnabled()) {
    scope = 'local';
    send(client.ws, { t: 'denied', reason: 'stream-off' });
  }

  client.lastChat = { txt, ts: Date.now() };

  // 発信者自身にも返す（クライアント側で自分のidなら無視する仕様）
  broadcastFrom(client, { t: 'chat', id: client.id, n: client.n, txt, sc: scope }, false);

  if (scope === 'stream') relayToStream(client, txt);
}

/**
 * 配信のチャット欄へ送る。
 * 送れなかったときは必ず本人に理由を返す。黙って捨てると
 * 「配信に出たつもり」で会話が進んでしまうため。
 */
function relayToStream(client, txt) {
  const ev = events.get(client.eventId);
  const videoId = ev ? ev.videoId : '';
  const res = ytEnqueue({
    name: client.n,
    txt,
    videoId,
    onResult: ({ kind, detail }) => {
      if (kind === 'sent') return;
      const why =
        kind === 'quota'
          ? '今日の配信への送信上限に達しました。以降はワールド内だけの発言になります'
          : kind === 'not-live'
            ? '配信中ではないため、コメント欄には送れませんでした'
            : `配信への送信に失敗しました（${detail}）`;
      send(client.ws, { t: 'stream-result', ok: false, why });
    },
  });
  if (!res.queued) {
    const why =
      res.why === 'quota'
        ? '今日の配信への送信上限に達しました'
        : res.why === 'no-video'
          ? 'このイベントに動画が設定されていません'
          : '配信への転送はいまOFFです';
    send(client.ws, { t: 'stream-result', ok: false, why });
  }
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
    cap: MAX_PER_ROOM,
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

/** 今つないでいる全員へ配る（配信転送のON/OFFのように、全体に関わる知らせだけに使う） */
function broadcastAll(obj) {
  for (const members of rooms.values()) {
    for (const client of members.values()) send(client.ws, obj);
  }
}

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
    youtube: getCrossPostStatus(),
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
 * 管理者かどうかをHTTPで確かめる。WebSocketと違い、こちらは毎回IDトークンで判定する。
 * クロスポストの認可は「配信者アカウントの権限を預かる」操作なので、管理者だけに許す。
 */
async function requireAdmin(req) {
  const body = await readJsonBody(req);
  const info = body && body.idt ? await verifyIdToken(body.idt) : null;
  // ログイン未設定のローカル開発では、そもそも権限の仕組みが動いていないので通す
  if (!isLoginEnabled()) return { ok: true, body, email: '' };
  if (!info || roleForEmail(info.email) !== 'admin') return { ok: false, body, email: '' };
  return { ok: true, body, email: info.email };
}

/** YouTubeクロスポストのHTTP窓口 */
async function handleYouTubeApi(req, res, url) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  // 認可からの戻り。Googleがブラウザをここへ返してくるのでGET
  if (req.method === 'GET' && url === '/api/yt/callback') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const result = await handleAuthCallback(req, q.get('code') || '', q.get('state') || '');
    const msg = result.ok
      ? `YouTubeに接続しました（チャンネル: ${result.channel || '取得できませんでした'}）。このタブは閉じて大丈夫です。`
      : `接続できませんでした: ${result.error}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>ALLVERSE</title>` +
        `<body style="background:#0b0c18;color:#eaf6ff;font-family:sans-serif;padding:40px;line-height:1.8">` +
        `<h1 style="font-size:18px">${result.ok ? '✅' : '⚠️'} ${msg}</h1></body>`,
    );
    return;
  }

  if (req.method !== 'POST') {
    reply(405, { ok: false, error: 'method' });
    return;
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) {
    reply(403, { ok: false, error: 'admin-only' });
    return;
  }

  if (url === '/api/yt/status') {
    reply(200, { ok: true, ...getCrossPostStatus(), persistent: isPersistent() });
    return;
  }

  if (url === '/api/yt/auth') {
    if (!isCrossPostConfigured()) {
      reply(400, { ok: false, error: 'GOOGLE_CLIENT_SECRET が設定されていません' });
      return;
    }
    reply(200, { ok: true, url: buildAuthUrl(req) });
    return;
  }

  if (url === '/api/yt/enable') {
    const on = ytSetEnabled(auth.body && auth.body.on);
    // 全員の📺ボタンを出し入れする。ONになったことは全参加者に伝わるべき情報
    broadcastAll({ t: 'stream-state', on });
    reply(200, { ok: true, enabled: on });
    return;
  }

  if (url === '/api/yt/disconnect') {
    await ytDisconnect();
    reply(200, { ok: true });
    return;
  }

  reply(404, { ok: false, error: 'not-found' });
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

  if (url.startsWith('/api/yt/')) {
    await handleYouTubeApi(req, res, url);
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
  ensureMainEvent();

  // 保存済みイベントを復元（常設は上書きしない）
  for (const row of await loadEvents()) {
    if (row.id === MAIN_EVENT_ID) continue;
    events.set(row.id, makeEvent(row));
  }

  // BANはメモリに載せておく。入場のたびにDBを叩かずに済ませるため
  for (const b of await loadBans()) bans.set(b.email, b);

  await initCrossPost();

  httpServer.listen(PORT, () => {
    console.log(`[VERSE CITY Web Server] listening on port ${PORT} (ws path: ${WS_PATH})`);
    console.log(`  ログイン: ${isLoginEnabled() ? '有効' : '無効（GOOGLE_CLIENT_ID 未設定）'}`);
    console.log(`  イベント永続化: ${isPersistent() ? '有効（Turso）' : '無効（メモリのみ）'}`);
    console.log(`  イベント数: ${events.size} ／ BAN: ${bans.size}件`);
  });
}

boot();
