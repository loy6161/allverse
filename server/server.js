// ============================================================
// VERSE CITY Web — リアルタイム同期サーバー
// 仕様: docs/PROTOCOL.md（通信）/ docs/PRESENCE_SPEC.md §2.2（presence.json）
// 依存: ws のみ。それ以外は Node.js 標準ライブラリのみで完結させる。
// ============================================================

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

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

// スクリーン（ルーム共有状態）
const DEFAULT_VIDEO_ID = 'unrobrGhlv0';       // 誰も変更していないルームの初期動画
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;    // YouTube動画IDの形式

// PRESENCE_SPEC §2.2 向けの出力上限
const PRESENCE_MAX_WEB = 60;      // web[] の最大人数
const PRESENCE_MAX_YT = 100;      // yt[] の最大人数（現段階では常に空配列なので未使用）
const PRESENCE_CHAT_WINDOW_MS = 30 * 1000; // c を付与する直近発言の有効期間
const PRESENCE_CHAT_TXT_MAX = 40; // c[0] の最大文字数（30KB制約対応）

// 「直近チャット」フィールド(c)は実装済みだが、運用判断が済むまで既定は無効。
// true にすればそのまま動く。
const ENABLE_CHAT_FIELD = false;

// ------------------------------------------------------------
// サーバー状態
// ------------------------------------------------------------
// rooms: Map<roomNumber, Map<clientId, ClientState>>
const rooms = new Map();

// roomScreens: Map<roomNumber, videoId> ルームごとの共有スクリーン状態
const roomScreens = new Map();

// roomPlayback: Map<roomNumber, {playing, pos, at}> ルームごとの再生状態
// pos = at の時点の再生位置(秒)。現在位置は playing なら経過時間を足して求める
const roomPlayback = new Map();

function currentPlayback(roomNumber) {
  const pb = roomPlayback.get(roomNumber);
  if (!pb) return { st: 'play', pos: 0 };
  const elapsed = pb.playing ? (Date.now() - pb.at) / 1000 : 0;
  return { st: pb.playing ? 'play' : 'pause', pos: Math.max(0, pb.pos + elapsed) };
}

let nextClientSeq = 1; // "c1", "c2", ... を払い出す連番
const startedAt = Date.now();

/**
 * クライアント1人分の状態
 * @typedef {Object} ClientState
 * @property {string} id
 * @property {import('ws').WebSocket} ws
 * @property {number|null} room
 * @property {boolean} joined
 * @property {string} n
 * @property {Object} av
 * @property {number} x
 * @property {number} z
 * @property {number} r
 * @property {boolean} m
 * @property {{txt:string, ts:number}|null} lastChat
 * @property {number[]} msgTimes  レート制限用の直近送信タイムスタンプ
 */

// ------------------------------------------------------------
// ユーティリティ
// ------------------------------------------------------------

/** 文字列を強制トリム（サロゲートペア考慮せず単純な文字数カット。仕様上は簡易実装で十分） */
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

/** 指定ルームの空き（定員未満）かどうか */
function roomHasSpace(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room) return true;
  return room.size < MAX_PER_ROOM;
}

/** 「空きのある最小番号ルーム」を探して番号を返す（#1から順に走査） */
function assignRoom() {
  let roomNumber = 1;
  // 既存ルームの中で最小の空きを探す
  for (;;) {
    if (roomHasSpace(roomNumber)) return roomNumber;
    roomNumber += 1;
  }
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
function broadcastToRoom(roomNumber, obj, excludeId = null) {
  const room = rooms.get(roomNumber);
  if (!room) return;
  for (const client of room.values()) {
    if (excludeId && client.id === excludeId) continue;
    send(client.ws, obj);
  }
}

/** 同室に人数変化を通知 */
function broadcastCount(roomNumber) {
  const room = rooms.get(roomNumber);
  if (!room) return;
  broadcastToRoom(roomNumber, { t: 'count', c: room.size });
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
  };
}

// ------------------------------------------------------------
// メッセージハンドラ（種別ごと）
// ------------------------------------------------------------

/** join: 入場処理 */
function handleJoin(client, msg) {
  // 既にjoin済みなら二重join扱い(無視)。念のため。
  if (client.joined) return;

  client.n = clampString(msg.n, MAX_NAME_LEN, '名無し');
  client.av = sanitizeAv(msg.av);
  client.x = 0;
  client.z = 0;
  client.r = 0;
  client.m = false;

  const roomNumber = assignRoom();
  let room = rooms.get(roomNumber);
  if (!room) {
    room = new Map();
    rooms.set(roomNumber, room);
  }

  // welcomeに載せる「既存メンバー」は自分を追加する前に集める
  const peers = Array.from(room.values()).map(toPeerInfo);

  room.set(client.id, client);
  client.room = roomNumber;
  client.joined = true;

  send(client.ws, {
    t: 'welcome',
    id: client.id,
    room: roomNumber,
    peers,
    count: room.size,
    screen: roomScreens.get(roomNumber) || DEFAULT_VIDEO_ID, // 途中入場でも今の動画に追従できる
    playback: currentPlayback(roomNumber), // 再生位置・再生中かどうかも揃える
  });

  // 他の同室メンバーへ参加通知
  broadcastToRoom(roomNumber, { t: 'peer-join', p: toPeerInfo(client) }, client.id);
  broadcastCount(roomNumber);
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

  broadcastToRoom(
    client.room,
    { t: 'pos', id: client.id, x, z, r, m },
    client.id, // 自分には送らない
  );
}

/** chat: チャット中継 */
function handleChat(client, msg) {
  if (!client.joined) return;

  const txt = clampString(msg.txt, MAX_TXT_LEN);
  if (!txt) return; // 空文字は無視

  client.lastChat = { txt, ts: Date.now() };

  // 発信者自身にも返す（クライアント側で自分のidなら無視する仕様）
  broadcastToRoom(client.room, { t: 'chat', id: client.id, n: client.n, txt });
}

/** update: アバター/名前の再カスタム */
function handleUpdate(client, msg) {
  if (!client.joined) return;

  client.n = clampString(msg.n, MAX_NAME_LEN, client.n);
  client.av = sanitizeAv(msg.av);

  broadcastToRoom(
    client.room,
    { t: 'peer-update', id: client.id, n: client.n, av: client.av },
    client.id,
  );
}

/** emote: エモート中継（既定リスト以外は破棄・連打は間引く） */
function handleEmote(client, msg) {
  if (!client.joined) return;
  if (typeof msg.e !== 'string' || !EMOTE_IDS.has(msg.e)) return;

  const now = Date.now();
  if (client.lastEmoteAt && now - client.lastEmoteAt < EMOTE_MIN_INTERVAL_MS) return;
  client.lastEmoteAt = now;

  broadcastToRoom(
    client.room,
    { t: 'emote', id: client.id, e: msg.e },
    client.id, // 自分の分はローカルで即再生済み
  );
}

/** screen: ルーム共有のスクリーン動画を変更 */
function handleScreen(client, msg) {
  if (!client.joined) return;
  if (typeof msg.v !== 'string' || !VIDEO_ID_RE.test(msg.v)) return;

  roomScreens.set(client.room, msg.v);
  // 動画が変わったら再生状態は先頭・再生中に戻す
  roomPlayback.set(client.room, { playing: true, pos: 0, at: Date.now() });

  // 発信者にも返す（「変更されました」の表示と再生開始を全員同じ経路で行う）
  broadcastToRoom(client.room, { t: 'screen', v: msg.v, by: client.n });
}

/** playback: 再生/一時停止/シークをルーム全員へ揃える */
function handlePlayback(client, msg) {
  if (!client.joined) return;
  if (msg.st !== 'play' && msg.st !== 'pause') return;
  const pos = typeof msg.pos === 'number' && Number.isFinite(msg.pos) ? Math.max(0, msg.pos) : 0;
  if (pos > 24 * 3600) return; // 異常値は破棄

  roomPlayback.set(client.room, { playing: msg.st === 'play', pos, at: Date.now() });

  broadcastToRoom(
    client.room,
    { t: 'playback', id: client.id, st: msg.st, pos },
    client.id, // 発信者は自分で操作済み
  );
}

const HANDLERS = {
  join: handleJoin,
  pos: handlePos,
  chat: handleChat,
  update: handleUpdate,
  emote: handleEmote,
  screen: handleScreen,
  playback: handlePlayback,
};

/** 切断時処理: ルームから外し、peer-leave/countを通知 */
function handleDisconnect(client) {
  if (!client.joined || client.room === null) return;

  const roomNumber = client.room;
  const room = rooms.get(roomNumber);
  if (room) {
    room.delete(client.id);
    broadcastToRoom(roomNumber, { t: 'peer-leave', id: client.id });
    if (room.size === 0) {
      rooms.delete(roomNumber); // 空ルームは破棄（番号の穴あきはassignRoomが埋める）
      roomScreens.delete(roomNumber); // スクリーン状態も初期化
      roomPlayback.delete(roomNumber);
    } else {
      broadcastCount(roomNumber);
    }
  }
  client.joined = false;
  client.room = null;
}

/** レート制限チェック: 直近1秒間の送信回数が上限を超えていないか */
function isRateLimited(client) {
  const now = Date.now();
  // 直近1秒より古い記録は捨てる
  client.msgTimes = client.msgTimes.filter((t) => now - t < 1000);
  client.msgTimes.push(now);
  return client.msgTimes.length > RATE_LIMIT_PER_SEC;
}

// ------------------------------------------------------------
// HTTP: ステータスJSON / presence.json
// ------------------------------------------------------------

function buildStatusJson() {
  const roomList = Array.from(rooms.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([room, members]) => ({ room, count: members.size }));

  return {
    ok: true,
    rooms: roomList,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  };
}

function buildPresenceJson() {
  const nowMs = Date.now();
  const web = [];

  const sortedRoomNumbers = Array.from(rooms.keys()).sort((a, b) => a - b);
  outer: for (const roomNumber of sortedRoomNumbers) {
    const room = rooms.get(roomNumber);
    for (const client of room.values()) {
      if (web.length >= PRESENCE_MAX_WEB) break outer;

      const entry = {
        rm: roomNumber,
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

const httpServer = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && url === '/api/status') {
    const body = JSON.stringify(buildStatusJson());
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
// WebSocketサーバー（/ws のみ受け付け。それ以外のパスへのupgradeは拒否）
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
// タブが強制終了した・回線が切れた等で切断イベントが届かないと、
// 存在しない人が会場に残り続ける（人数表示やpresence.jsonが狂う）。
// 定期的にpingを送り、応答が無い接続を掃除する。
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
    room: null,
    joined: false,
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
    // 毎秒20メッセージ超は破棄（構文解析より先にレート制限を切る）
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

    handler(client, msg);
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

httpServer.listen(PORT, () => {
  console.log(`[VERSE CITY Web Server] listening on port ${PORT} (ws path: ${WS_PATH})`);
});
