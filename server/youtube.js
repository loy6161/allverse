// ============================================================
// ワールド内チャット → YouTubeライブチャットへの転送（クロスポスト）
//
// ■ 誰の権限で投稿するか
// 「発言した本人のYouTubeアカウントで投稿する」形にはしていない。
// 投稿に必要な youtube.force-ssl はGoogleの「制限付きスコープ」で、
// 全参加者に許可させるにはアプリ審査と第三者セキュリティ評価が要る。
// そこで**配信者（管理者）のアカウント1つだけが認可**し、その名義で
// 「なまえ: 本文」の形にまとめて流す。認可するのが1アカウントなら
// テストユーザー枠（100人まで）に収まり、審査なしで今すぐ動く。
//
// ■ 1日に送れる回数がかなり少ない
// YouTube Data APIの既定枠は1日10,000ユニット。投稿(liveChatMessages.insert)は
// 1回50ユニットなので **1日200回まで**。そのままでは配信1本ももたない。
// だから数秒ぶんの発言を1通にまとめて送る。枠を使い切ったら投稿を止めて、
// ワールド内には「今日はもう配信に送れません」と出す（黙って捨てない）。
// 枠を増やすにはGoogleへの申請が必要。
//
// ■ 環境変数
//   GOOGLE_CLIENT_ID     … ログインと共用（必須）
//   GOOGLE_CLIENT_SECRET … クロスポート用に追加で必要（未設定なら機能ごと無効）
//   PUBLIC_URL           … https://allverse.onrender.com など。認可の戻り先に使う
//   YT_QUOTA_PER_DAY     … 1日に使えるユニット数（既定10000。増枠が通ったら上げる）
// ============================================================

import { OAuth2Client } from 'google-auth-library';
import { loadSecret, saveSecret, deleteSecret } from './store.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const QUOTA_PER_DAY = Number(process.env.YT_QUOTA_PER_DAY || 10000);

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const SECRET_KEY = 'yt_refresh_token';

const COST_INSERT = 50; // liveChatMessages.insert
const COST_VIDEOS_LIST = 1; // videos.list

const FLUSH_MS = 6000; // 何秒ぶんをまとめるか
const MAX_MESSAGE_LEN = 200; // YouTubeライブチャット1通の上限
const MAX_QUEUE = 60; // これ以上たまったら古い方から捨てる（無限にためない）
const CHAT_ID_TTL_MS = 5 * 60 * 1000; // liveChatIdの再取得間隔

/** 認可の戻り先。PUBLIC_URLが無いときはリクエストのホストから組み立てる */
function redirectUriFor(req) {
  if (PUBLIC_URL) return `${PUBLIC_URL}/api/yt/callback`;
  const host = req && req.headers ? req.headers.host : '';
  const proto = req && req.headers && req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'] : 'http';
  return host ? `${proto}://${host}/api/yt/callback` : '';
}

function makeClient(req) {
  return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUriFor(req));
}

/** この機能が使える設定になっているか */
export function isCrossPostConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ------------------------------------------------------------
// 状態
// ------------------------------------------------------------
let refreshToken = ''; // 配信者が認可した証。ログには絶対に出さない
let channelTitle = ''; // 画面に「どのチャンネルに繋がっているか」を出すため
let enabled = false; // 管理者が転送をONにしているか（既定OFF）

let quotaDate = ''; // 太平洋時間の日付。Googleの枠はこの時刻でリセットされる
let quotaUsed = 0;

let cachedChatId = '';
let cachedChatIdAt = 0;
let cachedForVideo = '';

let queue = []; // 送信待ちの発言
let flushTimer = null;
let lastError = '';

/** 認可の途中で使う一度きりの合言葉（別サイトから認可画面を踏ませないため） */
const pendingStates = new Map(); // state -> 期限

/** Googleの枠は太平洋時間の0時に戻る。日付が変わったら使用量を0に戻す */
function quotaToday() {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (d !== quotaDate) {
    quotaDate = d;
    quotaUsed = 0;
  }
  return quotaUsed;
}

function spendQuota(units) {
  quotaToday();
  quotaUsed += units;
}

function quotaLeft() {
  return Math.max(0, QUOTA_PER_DAY - quotaToday());
}

/** 投稿できる状態か（設定・認可・ON・枠）をまとめて見る */
export function getCrossPostStatus() {
  return {
    configured: isCrossPostConfigured(),
    connected: Boolean(refreshToken),
    channel: channelTitle,
    enabled,
    quotaUsed: quotaToday(),
    quotaPerDay: QUOTA_PER_DAY,
    postsLeft: Math.floor(quotaLeft() / COST_INSERT),
    queued: queue.length,
    error: lastError,
  };
}

/** 起動時に、保存してある認可を読み戻す */
export async function initCrossPost() {
  if (!isCrossPostConfigured()) {
    console.log('[youtube] GOOGLE_CLIENT_SECRET 未設定 → クロスポストは無効');
    return false;
  }
  const saved = await loadSecret(SECRET_KEY);
  if (saved) {
    refreshToken = saved;
    console.log('[youtube] 保存済みの認可を読み込みました（クロスポストは管理者がONにすると動きます）');
  }
  return Boolean(refreshToken);
}

// ------------------------------------------------------------
// 認可（配信者が1回だけ通す）
// ------------------------------------------------------------

/** 認可画面のURLを作る。stateは10分で失効させる */
export function buildAuthUrl(req) {
  const state = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);

  return makeClient(req).generateAuthUrl({
    access_type: 'offline', // 再起動後も使えるよう refresh_token をもらう
    prompt: 'consent', // 2回目以降も refresh_token を確実にもらうため
    scope: [SCOPE],
    state,
  });
}

/** 認可からの戻り。コードを引き換えて、次回以降使える形で保存する */
export async function handleAuthCallback(req, code, state) {
  if (!pendingStates.has(state) || pendingStates.get(state) < Date.now()) {
    return { ok: false, error: 'この認可リンクは期限切れです。もう一度やり直してください。' };
  }
  pendingStates.delete(state);

  try {
    const { tokens } = await makeClient(req).getToken(code);
    if (!tokens.refresh_token) {
      return { ok: false, error: '再認可の情報が受け取れませんでした。Googleの「サードパーティのアクセス」から一度解除してやり直してください。' };
    }
    refreshToken = tokens.refresh_token;
    await saveSecret(SECRET_KEY, refreshToken);
    await refreshChannelTitle(req);
    lastError = '';
    return { ok: true, channel: channelTitle };
  } catch (e) {
    // トークンが混ざらないようメッセージだけ残す
    lastError = String(e && e.message ? e.message : e).slice(0, 200);
    return { ok: false, error: lastError };
  }
}

/** 認可を外す。保存も消す */
export async function disconnect() {
  refreshToken = '';
  channelTitle = '';
  enabled = false;
  queue = [];
  await deleteSecret(SECRET_KEY);
}

export function setEnabled(v) {
  enabled = Boolean(v) && Boolean(refreshToken);
  if (!enabled) queue = [];
  return enabled;
}

export function isEnabled() {
  return enabled;
}

// ------------------------------------------------------------
// API呼び出し
// ------------------------------------------------------------

async function accessToken(req) {
  if (!refreshToken) return '';
  const c = makeClient(req);
  c.setCredentials({ refresh_token: refreshToken });
  const res = await c.getAccessToken();
  return res && res.token ? res.token : '';
}

async function callApi(req, method, url, body) {
  const token = await accessToken(req);
  if (!token) throw new Error('認可されていません');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(String(reason).slice(0, 200));
    err.reason = json?.error?.errors?.[0]?.reason || '';
    throw err;
  }
  return json;
}

/** どのチャンネルに繋がっているかを画面に出すため（1ユニット） */
async function refreshChannelTitle(req) {
  try {
    const json = await callApi(req, 'GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
    channelTitle = json?.items?.[0]?.snippet?.title || '';
    spendQuota(1);
  } catch (e) {
    channelTitle = '';
    lastError = e.message;
  }
}

/**
 * 動画IDから「今そのライブのチャット欄」のIDを引く。
 * 配信中でなければ空になる（＝アーカイブや通常動画では投稿できない）。
 */
async function resolveLiveChatId(req, videoId) {
  if (cachedForVideo === videoId && cachedChatId && Date.now() - cachedChatIdAt < CHAT_ID_TTL_MS) {
    return cachedChatId;
  }
  const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`;
  const json = await callApi(req, 'GET', url);
  spendQuota(COST_VIDEOS_LIST);
  const id = json?.items?.[0]?.liveStreamingDetails?.activeLiveChatId || '';
  cachedForVideo = videoId;
  cachedChatId = id;
  cachedChatIdAt = Date.now();
  return id;
}

// ------------------------------------------------------------
// 送信（まとめ送り）
// ------------------------------------------------------------

/**
 * 発言を送信待ちに積む。実際の送信は数秒後にまとめて行う。
 * @returns {{queued:boolean, why:string}} 積めなかったときは理由を返す（黙って捨てない）
 */
export function enqueue({ name, txt, videoId, onResult }) {
  if (!enabled || !refreshToken) return { queued: false, why: 'off' };
  if (!videoId) return { queued: false, why: 'no-video' };
  if (quotaLeft() < COST_INSERT) return { queued: false, why: 'quota' };

  queue.push({ name, txt, videoId });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush(onResult).catch(() => {
        /* flush内で処理済み */
      });
    }, FLUSH_MS);
  }
  return { queued: true, why: '' };
}

/**
 * たまった発言を1通にまとめて投稿する。
 * 200文字に収まらないぶんは次回に回す（切り捨てない）。
 */
async function flush(onResult) {
  if (!queue.length || !enabled || !refreshToken) return;
  if (quotaLeft() < COST_INSERT) {
    notify(onResult, 'quota');
    return;
  }

  const videoId = queue[0].videoId;
  const packed = packMessage(queue, videoId);
  queue = packed.rest;
  const text = packed.text;
  if (!text) return;

  try {
    const liveChatId = await resolveLiveChatId(null, videoId);
    if (!liveChatId) {
      queue = [];
      lastError = '';
      notify(onResult, 'not-live');
      return;
    }
    await callApi(null, 'POST', 'https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet', {
      snippet: {
        liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: text },
      },
    });
    spendQuota(COST_INSERT);
    lastError = '';
    notify(onResult, 'sent', text);
  } catch (e) {
    lastError = e.message;
    // 枠切れは何度試しても通らないので、たまった分ごと諦める
    if (e.reason === 'quotaExceeded' || e.reason === 'rateLimitExceeded') {
      quotaUsed = QUOTA_PER_DAY;
      queue = [];
      notify(onResult, 'quota');
      return;
    }
    notify(onResult, 'error', e.message);
  } finally {
    // まだ残っていれば続けて送る
    if (queue.length && !flushTimer && enabled) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush(onResult).catch(() => {});
      }, FLUSH_MS);
    }
  }
}

/**
 * 送信待ちの発言を、1通ぶん（200文字まで）に詰める。
 * 入りきらないぶんは rest として次回に回す。**切り捨てない**。
 *
 * 1行だけで200文字を超えるときはその行を切り詰める。
 * そうしないと先頭で永久に詰まって、後ろの発言が一生送られなくなる。
 *
 * 動画が切り替わったところで区切る（別の配信のコメント欄に混ぜないため）。
 *
 * @param {Array<{name:string,txt:string,videoId:string}>} items
 * @param {string} videoId 先頭の動画ID
 * @returns {{text:string, rest:Array}}
 */
export function packMessage(items, videoId, maxLen = MAX_MESSAGE_LEN) {
  const rest = [...items];
  const lines = [];
  let text = '';
  while (rest.length && rest[0].videoId === videoId) {
    const line = `${rest[0].name}: ${rest[0].txt}`;
    const next = lines.length ? `${text} / ${line}` : line;
    if (next.length > maxLen) break;
    text = next;
    lines.push(line);
    rest.shift();
  }
  if (!lines.length && rest.length) {
    const item = rest.shift();
    text = `${item.name}: ${item.txt}`.slice(0, maxLen);
  }
  return { text, rest };
}

function notify(onResult, kind, detail = '') {
  if (typeof onResult === 'function') onResult({ kind, detail });
}
