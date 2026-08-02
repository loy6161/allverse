import { AVATAR_PARTS } from './avatar.js';
import { getVisitorId } from './visitorid.js';
import { GUEST_HAIR } from './guestlook.js';

// ------------------------------------------------------------------
// アバターconfig（hex色形式） ⇔ av（プリセット番号形式）の相互変換
// PROTOCOL.md / PRESENCE_SPEC.md 付録A と同一の対応表（avatar.js の AVATAR_PARTS）
//   av.h  = 髪型id（文字列。AVATAR_PARTS.hairStyles の値そのもの）
//   av.hc = 髪色プリセット番号（AVATAR_PARTS.hairColors のindex）
//   av.sc = 服色プリセット番号（AVATAR_PARTS.shirtColors のindex）
//   av.bc = 肌色プリセット番号（AVATAR_PARTS.bodyColors のindex）
// ------------------------------------------------------------------

export function configToAv(config) {
  const cfg = config || {};
  const hc = AVATAR_PARTS.hairColors.indexOf(cfg.hairColor);
  const sc = AVATAR_PARTS.shirtColors.indexOf(cfg.shirtColor);
  const bc = AVATAR_PARTS.bodyColors.indexOf(cfg.bodyColor);
  const ec = AVATAR_PARTS.eyeColors.indexOf(cfg.eyeColor);
  const pl = AVATAR_PARTS.penlightColors.indexOf(cfg.penlightColor);
  const h = AVATAR_PARTS.hairStyles.includes(cfg.hairStyle) ? cfg.hairStyle : AVATAR_PARTS.hairStyles[0];
  const o = AVATAR_PARTS.outfits.includes(cfg.outfit) ? cfg.outfit : AVATAR_PARTS.outfits[0];
  const ac = AVATAR_PARTS.accessories.includes(cfg.accessory) ? cfg.accessory : AVATAR_PARTS.accessories[0];
  return {
    h,
    o,
    ac,
    hc: hc >= 0 ? hc : 0,
    sc: sc >= 0 ? sc : 0,
    bc: bc >= 0 ? bc : 0,
    ec: ec >= 0 ? ec : 0,
    pl: pl >= 0 ? pl : 0,
  };
}

export function avToConfig(av) {
  const a = av || {};
  const bcIdx = Number.isInteger(a.bc) && a.bc >= 0 && a.bc < AVATAR_PARTS.bodyColors.length ? a.bc : 0;
  const hcIdx = Number.isInteger(a.hc) && a.hc >= 0 && a.hc < AVATAR_PARTS.hairColors.length ? a.hc : 0;
  const scIdx = Number.isInteger(a.sc) && a.sc >= 0 && a.sc < AVATAR_PARTS.shirtColors.length ? a.sc : 0;
  const ecIdx = Number.isInteger(a.ec) && a.ec >= 0 && a.ec < AVATAR_PARTS.eyeColors.length ? a.ec : 0;
  const plIdx =
    Number.isInteger(a.pl) && a.pl >= 0 && a.pl < AVATAR_PARTS.penlightColors.length ? a.pl : 0;
  // ゲストの「髪なし」は選択肢に無い値なので、ここで潰さないよう明示的に通す
  const hairStyle =
    a.h === GUEST_HAIR || AVATAR_PARTS.hairStyles.includes(a.h) ? a.h : AVATAR_PARTS.hairStyles[0];
  const outfit = AVATAR_PARTS.outfits.includes(a.o) ? a.o : AVATAR_PARTS.outfits[0];
  const accessory = AVATAR_PARTS.accessories.includes(a.ac) ? a.ac : AVATAR_PARTS.accessories[0];
  return {
    bodyColor: AVATAR_PARTS.bodyColors[bcIdx],
    hairStyle,
    outfit,
    accessory,
    hairColor: AVATAR_PARTS.hairColors[hcIdx],
    shirtColor: AVATAR_PARTS.shirtColors[scIdx],
    eyeColor: AVATAR_PARTS.eyeColors[ecIdx],
    penlightColor: AVATAR_PARTS.penlightColors[plIdx],
  };
}

// ------------------------------------------------------------------
// WebSocket通信
// ------------------------------------------------------------------

const WELCOME_TIMEOUT_MS = 3000;
const POS_INTERVAL_MS = 100; // 最大10Hz

export function initNet({ name, config, handlers, idToken = '', eventId = '', roomNumber = null, entryCode = '' }) {
  const h = handlers || {};
  let ws = null;
  let welcomeTimer = null;
  let disconnectFired = false;
  let joined = false;

  function fireDisconnect() {
    if (disconnectFired) return;
    disconnectFired = true;
    if (h.onDisconnect) h.onDisconnect();
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function clearWelcomeTimer() {
    if (welcomeTimer) {
      clearTimeout(welcomeTimer);
      welcomeTimer = null;
    }
  }

  // 接続先の自動判別:
  // - 開発時（ポート5178の静的サーバーから配信）→ ws://<host>:5179/ws
  // - 本番（同期サーバー自身が静的配信、https含む）→ 同一オリジンの /ws
  const wsUrl =
    location.port === '5178'
      ? `ws://${location.hostname}:5179/ws`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    // WebSocket自体を生成できない環境（不正URL等）→ 失敗扱い
    fireDisconnect();
    ws = null;
  }

  if (ws) {
    ws.addEventListener('open', () => {
      const joinMsg = { t: 'join', n: name, av: configToAv(config) };
      if (idToken) joinMsg.idt = idToken; // Googleログイン済みなら権限判定に使われる
      // イベントの累計人数を数えるための匿名ID（ゲスト用。中身はランダムな数字だけ）。
      // ログイン済みの人はサーバー側でアカウント単位に数えるので、この値は使われない
      const vid = getVisitorId();
      if (vid) joinMsg.vid = vid;
      // 開発用: ?devRole=guest などで権限を試せる。本番サーバーは無視する
      const devRole = new URLSearchParams(location.search).get('devRole');
      if (devRole) joinMsg.devRole = devRole;
      if (eventId) joinMsg.ev = eventId;
      if (Number.isInteger(roomNumber)) joinMsg.rm = roomNumber;
      // 合言葉つきイベント用。照合はサーバーだけが行う
      if (entryCode) joinMsg.code = entryCode;
      send(joinMsg);
      welcomeTimer = setTimeout(() => {
        welcomeTimer = null;
        try {
          ws.close();
        } catch (e) {
          // noop
        }
        fireDisconnect();
      }, WELCOME_TIMEOUT_MS);
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'welcome':
          joined = true;
          clearWelcomeTimer();
          if (h.onWelcome) {
            h.onWelcome({
              id: msg.id,
              name: msg.n, // サーバーが確定させた表示名
              av: msg.av, // サーバーが確定させた見た目（ゲストはこちらが正）
              room: msg.room,
              peers: msg.peers,
              count: msg.count,
              cap: msg.cap,
              screen: msg.screen,
              playback: msg.playback,
              role: msg.role,
              canControl: msg.canControl,
              isAdmin: msg.isAdmin,
              canInteract: msg.canInteract,
              eventId: msg.ev,
              event: msg.event,
              events: msg.events,
              persistent: msg.persistent,
              blocked: msg.blocked,
              // YouTubeの発言を自分のアバターに出せる状態か（2026-08-03追加）
              yt: msg.yt || { on: false, linked: false },
            });
          }
          break;
        case 'moved':
          // 別のイベント/ルームへ移動が完了した（周りの人が総入れ替えになる）
          if (h.onMoved) {
            h.onMoved({
              room: msg.room,
              peers: msg.peers,
              count: msg.count,
              cap: msg.cap,
              screen: msg.screen,
              playback: msg.playback,
              eventId: msg.ev,
              event: msg.event,
            });
          }
          break;
        case 'events':
          if (h.onEvents) h.onEvents(msg.events);
          break;
        case 'event-created':
          if (h.onEventCreated) h.onEventCreated(msg.ev);
          break;
        case 'closed':
          // 管理人がイベントを閉じた。会場ごと無くなるので入場画面に戻す
          if (h.onClosed) h.onClosed({ eventId: msg.ev, name: msg.name });
          break;

        case 'denied':
          if (h.onDenied)
            h.onDenied({
              reason: msg.reason,
              eventId: msg.ev,
              by: msg.by,
              why: msg.why,
              min: msg.min,
              until: msg.until, // キックの締め出しが切れる時刻
            });
          break;
        // ---- 迷惑行為への対処 ----
        case 'blocked':
          if (h.onBlocked) h.onBlocked({ k: msg.k, n: msg.n });
          break;
        case 'blocked-list':
          if (h.onBlockedList) h.onBlockedList(msg.list || []);
          break;
        case 'moderated':
          if (h.onModerated) h.onModerated({ act: msg.act, n: msg.n, mins: msg.mins || 0 });
          break;
        case 'kicked':
          // 退出させられた。closeが続くので、ここでは理由を伝えるだけ
          if (h.onKicked) h.onKicked({ by: msg.by, mins: msg.mins || 0, why: msg.why || '' });
          break;
        case 'banned':
          if (h.onBanned) h.onBanned({ by: msg.by, why: msg.why });
          break;
        case 'bans':
          if (h.onBans) h.onBans(msg.list || []);
          break;
        case 'peer-join':
          if (h.onPeerJoin) h.onPeerJoin(msg.p);
          break;
        case 'pos':
          if (h.onPeerMove) h.onPeerMove(msg);
          break;
        case 'peer-update':
          if (h.onPeerUpdate) h.onPeerUpdate(msg);
          break;
        case 'peer-leave':
          if (h.onPeerLeave) h.onPeerLeave(msg.id);
          break;
        case 'chat':
          if (h.onChat) h.onChat({ id: msg.id, n: msg.n, txt: msg.txt, scope: msg.sc || 'local' });
          break;
        // 合言葉が発行された（YouTubeのチャットに打つと本人と繋がる）
        case 'yt-code':
          if (h.onYtCode) h.onYtCode({ ok: msg.ok, code: msg.code, expiresAt: msg.expiresAt, why: msg.why });
          break;
        // 繋がった／解除された
        case 'yt-linked':
          if (h.onYtLinked) h.onYtLinked({ ok: msg.ok, ytName: msg.ytName || '', removed: msg.removed || 0 });
          break;
        case 'count':
          if (h.onCount) h.onCount(msg.c);
          break;
        case 'emote':
          if (h.onPeerEmote) h.onPeerEmote({ id: msg.id, e: msg.e });
          break;
        case 'screen':
          if (h.onScreen) h.onScreen({ v: msg.v, by: msg.by });
          break;
        case 'playback':
          if (h.onPlayback) h.onPlayback({ st: msg.st, pos: msg.pos });
          break;
        // イベント設定が途中で変わった（定員・チャットの形・運営メッセージ）。
        // 以前は一覧しか配っていなかったので、いま中にいる人へ反映されなかった
        case 'event-changed':
          if (h.onEventChanged) h.onEventChanged(msg.event);
          break;
        // 運営向けの通知（キックがあった等）。管理者にだけ届く
        case 'staff-note':
          if (h.onStaffNote) h.onStaffNote(msg);
          break;
        case 'kicks':
          if (h.onKicks) h.onKicks(msg.list || []);
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      clearWelcomeTimer();
      fireDisconnect();
    });

    ws.addEventListener('error', () => {
      // closeイベントが後続して発火するため、ここでは何もしない（fireDisconnectは1回だけ）
    });
  }

  // ---- 送信（位置は10Hzスロットル＋変化なしなら送らない） ----
  let lastSentPos = null;
  let lastPosSendAt = 0;

  function sendPos(x, z, r, moving) {
    if (!joined) return;
    const qx = Math.round(x * 10) / 10;
    const qz = Math.round(z * 10) / 10;
    const qr = Math.round(r);
    const qm = !!moving;

    if (
      lastSentPos &&
      lastSentPos.x === qx &&
      lastSentPos.z === qz &&
      lastSentPos.r === qr &&
      lastSentPos.m === qm
    ) {
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastPosSendAt < POS_INTERVAL_MS) return;

    lastPosSendAt = now;
    lastSentPos = { x: qx, z: qz, r: qr, m: qm };
    send({ t: 'pos', x: qx, z: qz, r: qr, m: qm });
  }

  // scope: 'local'（ワールド内だけ・既定）/ 'stream'（配信にも流す・管理者のみ）
  function sendChat(txt, scope = 'local') {
    if (!joined) return;
    const s = String(txt == null ? '' : txt).slice(0, 200);
    if (!s) return;
    send({ t: 'chat', txt: s, sc: scope === 'stream' ? 'stream' : 'local' });
  }

  /** 合言葉をくれ、と頼む（YouTubeのチャットに打つと本人と繋がる） */
  function requestYtCode() {
    if (!joined) return;
    send({ t: 'yt-code' });
  }

  /** YouTubeチャンネルとの結びつきを解除する */
  function sendYtUnlink() {
    if (!joined) return;
    send({ t: 'yt-unlink' });
  }

  function sendUpdate(newName, newConfig) {
    if (!joined) return;
    send({ t: 'update', n: newName, av: configToAv(newConfig) });
  }

  function sendEmote(id) {
    if (!joined) return;
    send({ t: 'emote', e: id });
  }

  function sendScreen(videoId) {
    if (!joined) return;
    send({ t: 'screen', v: videoId });
  }

  // live=true のときサーバーは位置を保存・配信しない。
  // ライブ配信の「再生位置」は他の人にとって意味が無く、渡すと配信が止まるため
  function sendPlayback(st, pos, live) {
    if (!joined) return;
    send({ t: 'playback', st, pos: Math.max(0, Number(pos) || 0), live: !!live });
  }

  /**
   * 別のイベント/ルームへ移動する。
   * 合言葉つきの**別イベント**へ移るときは code が要る（サーバーが照合する）。
   * 同じイベント内のルーム移動には要らない。
   */
  function sendMove(targetEventId, targetRoom, code = '') {
    if (!joined) return;
    const m = { t: 'move' };
    if (targetEventId) m.ev = targetEventId;
    if (Number.isInteger(targetRoom)) m.rm = targetRoom;
    if (code) m.code = code;
    send(m);
  }

  function sendEventCreate({ name: evName, videoId, requireLogin, code, cap, vrc, chatMode }) {
    if (!joined) return;
    send({
      t: 'event-create',
      name: evName,
      v: videoId,
      requireLogin: !!requireLogin,
      code: code || '',
      cap,
      vrc: !!vrc,
      chatMode: chatMode === 'youtube' ? 'youtube' : 'local',
    });
  }

  /** 立てたあとに設定を変える。渡した項目だけが変わる */
  function sendEventUpdate(payload) {
    if (!joined) return;
    send({ t: 'event-update', ...payload });
  }

  function sendEventDelete(id) {
    if (!joined) return;
    send({ t: 'event-delete', id });
  }

  function requestEvents() {
    if (!joined) return;
    send({ t: 'events' });
  }

  // ---- 迷惑行為への対処 ----
  function sendBlock(id) {
    if (!joined) return;
    send({ t: 'block', id });
  }

  function sendUnblock(k) {
    if (!joined) return;
    send({ t: 'unblock', k });
  }

  /** mins: 0=すぐ戻れる（従来） / 5・15・60・180=その分だけ再入場を止める */
  function sendKick(id, mins = 0, why = '') {
    if (!joined) return;
    send({ t: 'kick', id, mins, why });
  }

  /** キックの履歴を取りに行く（管理者のみ）。BANするかの判断材料 */
  function requestKicks() {
    if (!joined) return;
    send({ t: 'kicks' });
  }

  function sendBan(id, why) {
    if (!joined) return;
    send({ t: 'ban', id, why });
  }

  function sendUnban(email) {
    if (!joined) return;
    send({ t: 'unban', email });
  }

  function requestBans() {
    if (!joined) return;
    send({ t: 'bans' });
  }

  function close() {
    clearWelcomeTimer();
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // noop
      }
    }
  }

  return {
    sendPos,
    sendChat,
    sendUpdate,
    sendEmote,
    sendScreen,
    sendPlayback,
    sendMove,
    sendEventCreate,
    sendEventUpdate,
    sendEventDelete,
    requestEvents,
    sendBlock,
    sendUnblock,
    sendKick,
    requestKicks,
    sendBan,
    sendUnban,
    requestBans,
    requestYtCode,
    sendYtUnlink,
    close,
  };
}
