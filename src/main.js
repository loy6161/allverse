import * as THREE from 'three';
import { createWorld } from './world.js';
import { createClubWorld } from './world_club.js';
import { createAvatar } from './avatar.js';
import { preloadAvatars } from './avatar_glb.js';
import { initJoinScreen, openCustomizer } from './join.js';
import { openPlacePicker } from './placepick.js';
import { saveLocalPrefs } from './prefs.js';
import { getChatEmote } from './bubbletime.js';
import { initMobile } from './mobile.js';
import { initChat } from './chat.js';
import { initSimPlayers } from './players.js';
import { initControls } from './controls.js';
import { initLiveScreen } from './screen.js';
import { initSoundGate } from './soundgate.js';
import { initNet, avToConfig } from './net.js';
import { initRemotePlayers } from './remote.js';
import { initEmoteBar } from './emotebar.js';
import { initScreenUI } from './screenui.js';
import { initViewMode } from './viewmode.js';
import { initPlayerControls } from './playerctl.js';
import { initRoomUI } from './roomui.js';
import { initLogsUI } from './logsui.js';
import { initPeopleUI } from './people.js';
import { initHelpUI } from './helpui.js';
import { initNoticeBar } from './noticebar.js';
import { initTopBar } from './topbar.js';
import { initSettingsUI } from './settingsui.js';
import { initAdminUI } from './adminui.js';
import { initConnBanner } from './connbanner.js';
import { initYouTubeChat } from './ytchat.js';
import { initExitButton } from './exitbtn.js';
import { initSelfView, getReflection, getBloom } from './selfview.js';
import { createBloom } from './bloom.js';
import { initFpsMeter, getFpsMeter } from './fpsmeter.js';
import { createLowPower, getLowPower } from './lowpower.js';

preloadAvatars(); // GLBアバターを先読み（入場前にロードを済ませる）

const canvas = document.getElementById('scene');
// alpha:true = キャンバスを透過可能にする。スクリーン面に開けた「穴」から
// 背後のYouTube iframeを見せ、手前のアバターはキャンバス側に描くため（screen.js参照）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// タッチ端末（スマホ想定）では負荷軽減のため影を無効化
const IS_TOUCH =
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || location.search.includes('mobile=1');
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 6, 14);
camera.lookAt(0, 1, 0);

// 会場の切り替え。既定はVRChatから持ってきた clubVERSE。
// 仮ワールドに戻したいときは ?world=mock を付ける（見比べ用に残してある）
const WORLD_KIND = new URLSearchParams(location.search).get('world') === 'mock' ? 'mock' : 'club';
const world =
  WORLD_KIND === 'club'
    ? createClubWorld(scene, { renderer })
    : createWorld(scene, { lowSpec: IS_TOUCH }); // タッチ端末は負荷を抑えた構成

// 背景色はキャンバスではなくページ側で持つ（キャンバスを透過させるため）。
// 見た目は変わらないが、スクリーン面の穴から背後のiframeが見えるようになる。
const skyColor = scene.background && scene.background.isColor ? scene.background : null;
if (skyColor) {
  document.body.style.background = `#${skyColor.getHexString()}`;
  scene.background = null;
}

// スクリーンの位置は会場ごとに違うので、ワールド側が持っている値を渡す
// 実写系のテクスチャが白飛びするので、clubVERSE では色調を整えてから出す
if (WORLD_KIND === 'club') {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
}

// ブルーム（2026-08-04追加）。clubVERSEのときだけ。
// ⚠ スマホはMSAAを切る（描き先を変えるとキャンバスの antialias が効かないので
//   代わりに描き先側でMSAAを持つ。負荷が上がるぶん、タッチ端末では諦める）
const bloom = WORLD_KIND === 'club' ? createBloom(renderer, { samples: IS_TOUCH ? 0 : 2 }) : null;
let bloomOn = getBloom();

// 軽量モード（2026-08-06追加）。
// ⚠ loyさんの環境はGPUを使わない設定（VRChat優先）なので、CPU描画でも成立させる必要がある。
//   描画の細かさ・影・ライトをまとめて落とす（lowpower.js の説明を参照）
const lowPower = createLowPower({
  renderer,
  scene,
  world,
  basePixelRatio: Math.min(window.devicePixelRatio, 2),
  baseShadow: !IS_TOUCH,
  onResize: () => {
    if (bloom) bloom.setSize(window.innerWidth, window.innerHeight);
  },
});
lowPower.setEnabled(getLowPower());

// fps表示（2026-08-04追加・管理者/VIP用）。既定はOFF。
// 何を切れば軽くなるかを本番中に判断できるよう、人数と重い機能の状態も一緒に出す
const fpsMeter = initFpsMeter({
  getStats: () => ({
    people: 1 + (remote ? remote.count() : 0),
    npc: sim ? sim.count() : 0,
    bloom: Boolean(bloom && bloomOn),
    reflect: getReflection(),
    width: renderer.domElement.width,
    height: renderer.domElement.height,
  }),
});

// タッチ端末は音ありの自動再生が禁止されているので、消音で始めて本人のタップで音を出す
const liveScreen = initLiveScreen(camera, scene, world.screen || {}, { startMuted: IS_TOUCH });

let player = null;
let controls = null;
let chat = null;
let sim = null;
let net = null;
let remote = null;
let myId = null;
let demoMode = false;
let screenUI = null;
let videoPanel = null;
let roomUI = null;

// 権限とイベント（サーバーのwelcomeで確定する）
let myRole = 'user'; // 'admin' | 'vip' | 'user' | 'guest'
// 「できるかどうか」はサーバーの判断をそのまま使う（ログイン未設定の間は全員が操作できる）
let canControlVideo = true;
// 「管理者そのものか」。canControlVideo（いまのイベントを操作できるか）とは別物。
// VIPは自分のイベントを操作できるが管理者ではないので、
// BAN・キックの履歴・イベントの記録といった管理者専用のものはこちらで出し分ける
let isAdminUser = true;
let currentEvent = null;
let currentRoom = null;
let knownEvents = [];
let namesHidden = false; // ネームプレートを消しているか（アバターを作り直したときに再適用するため保持）
let peopleUI = null;
let blockedList = []; // 自分がブロックしている相手（解除UIに出す）
let banList = []; // BAN一覧（管理者のみサーバーから届く）
let kickLog = []; // キックの履歴（管理者のみ）。あとでBANするかの判断材料
let noticeBar = null; // 運営メッセージの固定枠
let topBar = null; // 右上のツールバー（会場と自分に関するボタン）
let emoteBar = null; // エモートバー（並べ方の設定を変えたら描き直す）
let settingsUI = null; // ⚙設定パネル（表示設定・参加者・NPC設定・管理）
let adminUI = null; // 管理タブ（コールのワード・運営メンバー）
let callLists = []; // コールのワード表（運営のみサーバーから届く）
let staffList = []; // 運営メンバー一覧（管理者のみ）
// 接続が切れていることを出すバナー（2026-08-03追加）。
// initNet より先に作る必要がある（繋がらないと分かるのが接続直後のため）
let connBanner = null;
let ytChat = null; // YouTubeのライブチャット（連動イベントのときだけ出す）
// YouTubeチャンネルとの連携状態（2026-08-03追加）。
// welcome はUIの組み立てより先に来ることがあるので、ここで受けておいて後から流し込む
let ytLinkState = { on: false, linked: false };
let helpUI = null;
// 自分のアバターの小窓（2026-08-04追加）。一人称やシアター表示でも自分の動きが見える
let selfView = null;
let chatMode = 'local'; // 'local' … 独自チャット / 'youtube' … YouTubeへ一本化
// キック/BAN/入場拒否の説明。設定されているときは、切断を「通信不良」として扱わない
let removedReason = '';

// サーバーが操作を断ったときの説明文
const DENY_MESSAGES = {
  'admin-only': 'この操作は管理者のみです',
  'guest-no-chat': 'コメントするにはログインが必要です',
  'guest-no-emote': 'エモートを使うにはログインが必要です',
  'guest-no-avatar': '見た目を変えるにはログインが必要です',
  'login-required': 'このイベントに入るにはログインが必要です',
  'cannot-delete': 'このイベントは削除できません',
  'no-event': 'いま開いているイベントがありません',
  'bad-code': '合言葉が違います',
  'event-full': 'このイベントは満員です',
  'capacity-too-small': 'いま入っている人数より少ない定員にはできません',
  'too-many-events': 'イベントの数が上限に達しています',
  'staff-only': 'この操作は管理者・VIPのみです',
  'not-your-event': 'このイベントは、立てた本人か管理者だけが操作できます',
  'chat-on-youtube': 'このイベントのコメントは YouTube のチャットからどうぞ',
  'cannot-kick-staff': '管理者・VIPはキックできません',
  'cannot-ban-staff': '管理者・VIPはBANできません',
  'cannot-ban-guest': 'ゲストはBANできません（Googleアカウント単位のため）。キックで対応してください',
  'too-many-blocks': 'ブロックできる人数の上限に達しています',
};

/**
 * 入場できなかったことを画面いっぱいに伝える。
 *
 * 入場処理はワールドの描画を先に始めるので、断られたことに気づかないと
 * 「入れたのに誰もいない会場」に見える。そこで入場画面の上に理由を出す。
 * 入り直しはページの読み込み直しで行う（ワールドを途中まで作った状態から
 * 安全に巻き戻すより確実。見た目の設定はブラウザに保存してあるので選び直しにはならない）。
 */
function showEntryBlocked(title, note) {
  const root = document.getElementById('join-screen');
  if (!root) return;
  // ワールド用のUI（エモート・動画パネル・操作キー等）を全部隠す。
  // viewmode.js の「UI非表示」と同じ仕組みに相乗りする
  document.body.classList.add('vc-ui-hidden');
  // 上の一括非表示に含まれない表示トグル自身も隠す（押しても意味がないため）
  for (const sel of ['.vc-ui-toggle', '.vc-name-toggle']) {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  }

  root.classList.remove('hidden');
  root.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'vc-place-panel';
  const h = document.createElement('h1');
  h.className = 'vc-place-title';
  h.textContent = '入場できませんでした';
  const t = document.createElement('div');
  t.className = 'vc-place-closed-title';
  t.style.textAlign = 'center';
  t.style.marginTop = '18px';
  t.textContent = title;
  const n = document.createElement('div');
  n.className = 'vc-place-closed-note';
  n.style.textAlign = 'center';
  n.style.marginTop = '8px';
  n.textContent = note || '';
  const btns = document.createElement('div');
  btns.className = 'vc-place-btns';
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'vc-place-go';
  again.textContent = '入り直す';
  again.addEventListener('click', () => location.reload());
  btns.appendChild(again);
  panel.append(h, t, n, btns);
  root.appendChild(panel);
}

// 現在のプレイヤー情報（再カスタムで書き換わる）
const session = { name: '', config: null };

const hud = document.getElementById('hud');
const chatRoot = document.getElementById('chat-root');
const playerCountEl = document.getElementById('player-count');
const roomNameEl = document.getElementById('room-name');
const avatarBtn = document.getElementById('avatar-btn');

// ※ 以前あった `?npc=1`（NPCを手動で足す確認用）は廃止した。
//   NPCの人数は「管理者が決めた上限」と「各自のスライダー」で決まるようになり、
//   直後の updateCount() が必ず上書きするため、フラグが効かなくなっていた（2026-08-02）。
//   手で増減したいときは 🚪 パネルのスライダーを使う

// サーバーが伝えてきた最新の人数。NPCだけ増減したときの再計算に使う
let lastServerCount = null;

function updateCount(serverCount) {
  if (serverCount !== undefined) lastServerCount = serverCount;
  autoFillNpc(); // 先に空席を埋めてから数える（表示が1回ぶん遅れないように）
  const npc = sim ? sim.count() : 0;
  const others = remote ? remote.count() : 0;
  // 数えるのは実在の人だけ。NPCは「+NPC 18」と別に出して、人数を水増しして見せない
  const real = lastServerCount != null ? lastServerCount : 1 + others;
  playerCountEl.textContent = npc > 0 ? `${real} 人（+NPC ${npc}）` : `${real} 人`;
  if (roomUI && roomUI.refreshNpc) roomUI.refreshNpc();
}

/** ヘッダーの表示を「イベント名 ＋ ルーム番号」にする */
function updateHeader(room) {
  currentRoom = room;
  const evName = currentEvent ? currentEvent.name : 'VERSE CITY';
  roomNameEl.textContent = `${evName} #${room}`;
}

/**
 * パネルの出し分けに使う権限。
 *
 * ログイン未設定（ローカル開発）では全員が管理者相当になるので、生の myRole だけを見ると
 * 「操作はできるのにパネルが出ない」というちぐはぐが起きる。サーバーが配る isAdmin を優先する。
 * ⚠ **canControlVideo（いまのイベントを操作できるか）とは別物**。
 *   そちらで判定すると、VIPが自分のイベントにいる間だけ管理者専用パネルが見えてしまう。
 */
function staffRole() {
  if (isAdminUser) return 'admin';
  return myRole;
}

/**
 * ステージに上がれるかを操作系へ伝える（2026-08-04追加）。
 *
 * テストユーザーの要望:
 *   > 管理人+VIPはステージにのれるようにしたい。（イベント設定でON/OFFあり）
 *
 * **イベント設定がON** かつ **自分が管理者かVIP** の両方が要る。
 * ⚠ 権限の見方は🚪パネルと揃える（staffRole）。生の myRole だけを見ると、
 *   ログイン未設定のローカルで「操作はできるのに上がれない」がちぐはぐになる。
 * ⚠ ここでOFFにしても、既にステージの上にいる人はその場に残る。
 *   足元から床が消えたように落とすと、何が起きたか分からないため
 *   （動けば客席側へ丸められて自然に降りる）。
 */
function applyStageAccess() {
  if (!controls || !controls.setStageAllowed) return;
  const role = staffRole();
  const allowed = Boolean(currentEvent && currentEvent.stageAccess)
    && (role === 'admin' || role === 'vip');
  controls.setStageAllowed(allowed);
}

/** 権限をネームプレートの見た目に変換する（管理者=👑 / VIP=⭐） */
function badgeForRole(role) {
  return role === 'admin' || role === 'vip' ? role : '';
}

/** 権限に応じてUIの出し分けをする（動画操作は管理者のみ） */
function applyRoleToUi() {
  if (videoPanel) videoPanel.setControllable(canControlVideo);
  // 権限が確定するのはイベント設定より後のことがあるので、ここでも通す
  applyStageAccess();
  if (screenUI) screenUI.setVisible(canControlVideo);
}

/** NPCの入れ物を用意する（人数0でも作っておき、あとから増減できるようにする） */
function ensureSim() {
  if (!sim) {
    sim = initSimPlayers(scene, { count: 0, bounds: world.bounds });
    if (namesHidden) sim.setNamesVisible(false);
  }
  return sim;
}

// ---- NPC（賑やかし）の人数 ----
//
// 2026-08-02 に二段構えへ変更（loyさん設計）:
//   ・**管理者はグローバル**。イベント設定の npcMax が「全員に効く上限」になる
//     （-1 は自動＝キャパ − 実在人数。これまでの挙動）
//   ・**ユーザーはローカル**。自分の画面だけ、その上限の範囲で減らせる
//   ・上限は超えられない。だから**管理者が0にすれば全員の画面から消える**
//
// NPCはサーバーに繋がっていない各自の画面だけの存在なので、
// ここで言う「グローバル」は「同じNPCが見える」ではなく「上限が共有される」の意味。
const NPC_PREF_KEY = 'allverse.npc.v1';

let roomCapacity = 30;
let npcMaxFromServer = -1; // -1 = 自動（キャパ − 実在人数）
let npcUserLimit = loadNpcPref(); // null = 上限いっぱい（既定）

function loadNpcPref() {
  try {
    const raw = localStorage.getItem(NPC_PREF_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  } catch {
    return null; // localStorageが使えなくても機能自体は動かす
  }
}

function saveNpcPref(v) {
  try {
    if (v == null) localStorage.removeItem(NPC_PREF_KEY);
    else localStorage.setItem(NPC_PREF_KEY, String(v));
  } catch {
    // 保存できなくてもその場では効くので続行
  }
}

/** 管理者が決めた全体の上限。-1（自動）なら空席のぶん */
function npcCeiling() {
  if (npcMaxFromServer >= 0) return npcMaxFromServer;
  const real = lastServerCount != null ? lastServerCount : 1 + (remote ? remote.count() : 0);
  return Math.max(0, roomCapacity - real);
}

/** 実際に出す数＝上限と自分の設定の小さい方 */
function desiredNpc() {
  const ceil = npcCeiling();
  return npcUserLimit == null ? ceil : Math.min(npcUserLimit, ceil);
}

function autoFillNpc() {
  if (!sim || demoMode) return; // デモモードは別枠で人数を決めている
  const want = desiredNpc();
  if (sim.count() !== want) sim.setCount(want);
}

/** 5 → 「5分」 / 60 → 「1時間」。キックの締め出し時間の表示に使う */
function formatMinutes(mins) {
  const m = Math.max(0, Math.trunc(mins || 0));
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
}

/**
 * チャットの形を切り替える（2026-08-02）。
 *
 * 'youtube' のとき、独自チャットの**入力欄だけ**を隠して「お知らせ欄」として残す。
 * パネルごと消すと「ログインが必要です」などの案内も一緒に消えてしまい、
 * ゲストが理由の分からないまま詰まる（loyさん指摘）。
 */
function applyChatMode(mode) {
  const next = mode === 'youtube' ? 'youtube' : 'local';
  const changed = next !== chatMode;
  chatMode = next;

  // ここは**毎回そのまま反映する**（変化したときだけにしない）。
  // welcome は UI ができる前に届くことがあり、そのとき差分だけ見ていると
  // あとから作られた YouTube チャットが出ないままになる
  if (chat && chat.setInputVisible) chat.setInputVisible(chatMode === 'local');
  if (ytChat) ytChat.setVisible(chatMode === 'youtube');
  // 入力欄が無いあいだ、運営にだけ「会場チャットを開く」を出す（2026-08-04追加）。
  // 配信が終わったあとそのまま交流したい、という要望への入口
  applyOpenLocalButton();

  // 案内は切り替わったときだけ（毎回出すとお知らせ欄が埋まる）
  if (changed && chat) {
    chat.addMessage(
      '',
      chatMode === 'youtube'
        ? 'このイベントのコメントは YouTube のチャットに集まります'
        : 'このイベントでは会場内のチャットが使えます',
      { system: true },
    );
  }
}

/**
 * 「会場チャットを開く」ボタンの出し分け（2026-08-04追加）。
 *
 * loyさんの要望:
 *   > YouTubeの生配信視聴中はいいんだけど、配信終わった後とかにそのまま交流したいのに
 *   > 今の仕様だとチャットが使えないよね？切り替えられるといいかも。
 *
 * 設定パネル（🚪→設定→連動のチェックを外す）でも同じことはできるが、
 * 配信直後にやるには遠い。**入力欄があるはずの場所**にそのまま出す。
 *
 * 出すのは **YouTube連動ONで、かつ運営（管理者・VIP）のとき**だけ。
 * お客さんに見せると、押しても断られるボタンになる。
 */
function applyOpenLocalButton() {
  if (!chat || !chat.setOpenLocalVisible) return;
  const role = staffRole();
  const isStaff = role === 'admin' || role === 'vip';
  chat.setOpenLocalVisible(chatMode === 'youtube' && isStaff);
}

/** 運営メッセージの固定枠を出す/消す */
function applyNotice(notice) {
  if (noticeBar) noticeBar.set(notice);
}

/**
 * イベント設定を反映する（入場時・移動時・途中変更時に通る唯一の入口）。
 *
 * 以前は定員を welcome と moved でしか受け取っておらず、
 * **途中でキャパを変えてもNPCが増えなかった**（2026-08-02 loyさん指摘）。
 * サーバーは変更を配っていたのに、受け取る側が使っていなかったのが原因。
 */
function applyEventSettings(ev) {
  if (!ev) return;
  currentEvent = ev;
  if (Number.isFinite(ev.cap)) roomCapacity = ev.cap;
  if (Number.isFinite(ev.npcMax)) npcMaxFromServer = ev.npcMax;
  if (typeof ev.chatMode === 'string') applyChatMode(ev.chatMode);
  // 会場の明るさ（2026-08-04追加）。運営が決めた値が全員に効く。
  // 途中で変えられたときもここを通るので、その場で明るさが変わる
  if (world && world.setBrightness) world.setBrightness(ev.brightness || 'normal');
  // ステージに上がれるか（2026-08-04追加）。イベント設定がONで、
  // かつ自分が管理者かVIPのときだけ。どちらか欠けたら上がれない
  applyStageAccess();
  applyNotice(ev.notice || null);
  updateCount();
}

// サーバーに繋がらない/切断されたときは従来のNPCデモに切り替える
function startDemoMode() {
  if (demoMode) return;
  demoMode = true;
  if (remote) remote.clear();
  // デモモードでは人数を自前で決めるので、autoFillNpc は demoMode を見て降りる

  // 退出させられた場合は、原因を伝えるのが先。
  // 「通信が不安定なのかな」と誤解させないよう、NPCで賑やかしたりしない
  if (removedReason) {
    ensureSim().setCount(0);
    chat.addMessage('', removedReason, { system: true });
    updateCount(null);
    return;
  }

  // 一人きりの画面にならないよう、デモ用のNPCを出す
  ensureSim().setCount(7);
  chat.addMessage('', 'オフラインデモモード（同期サーバー未接続）', { system: true });
  updateCount(null);
}

// 入場は2段階: ①アバターと名前 → ②イベント/ルーム選択 → ワールドへ
function startEntryFlow(prev = {}) {
  initJoinScreen((picked) => {
    openPlacePicker({
      onDecide: ({ eventId, roomNumber, entryCode }) => {
        enterWorld({ ...picked, eventId, roomNumber, entryCode });
      },
      // 「← アバター」で1歩目に戻る（選んだ見た目と名前は保つ）
      onBack: () => startEntryFlow({ name: picked.name, config: picked.config }),
    });
  }, prev);
}
startEntryFlow();

function enterWorld({ name, config, eventId, roomNumber, idToken, entryCode }) {
  // 入場ボタンのクリック（ユーザー操作）を起点にライブ再生を開始する
  liveScreen.play();

  session.name = name;
  session.config = { ...config };

  player = createAvatar({ ...config, name });
  player.position.copy(world.spawnPoint);
  scene.add(player);

  controls = initControls(camera, player, renderer.domElement, {
    bounds: world.bounds,
    // ステージの範囲（2026-08-04追加）。無いワールドでは undefined になり、
    // その場合は登壇そのものが成立しない（従来どおり客席だけ）
    stage: world.stage,
    // 足元の高さ。clubVERSE は実際のモデルにレイを撃って拾う（矩形の近似ではない）
    groundYAt: world.groundYAt,
    // シアター表示でカメラを寄せる先。ワールドごとにスクリーンの位置が違う
    screen: world.screen,
    // 自分は物理でジャンプするが、高さは誰にも送っていない（presence も x/z/向き だけ）。
    // なので他の人の画面には「1回だけ跳ぶエモート(hop)」として見せる。
    // ⤴️ボタンの jump（3回跳ねる）を使うと、1回しか跳んでいないのに
    // 他人からは3回跳ねて見えてしまうため、専用のものを分けた（2026-08-03）
    onJump: () => {
      if (net && !demoMode) net.sendEmote('hop');
    },
  });

  chat = initChat({
    onSend: (text) => {
      if (myRole === 'guest') {
        chat.addMessage('', 'コメントするにはログインが必要です', { system: true });
        return;
      }
      chat.addMessage(session.name, text, { self: true });
      if (player.userData.say) player.userData.say(text);
      // ワールド内だけに届くローカル発言（YouTubeへは流さない）
      if (net && !demoMode) net.sendChat(text, 'local');
    },
    // 運営が「会場チャットを開く」を押した（2026-08-04追加）。
    // イベント設定を local に戻すだけ。全員に同時に反映される
    onOpenLocalChat: () => {
      if (!currentEvent) return;
      if (net && !demoMode) net.sendEventUpdate({ id: currentEvent.id, chatMode: 'local' });
    },
  });

  // リアルタイム同期へ接続（失敗時は onDisconnect → NPCデモにフォールバック）
  remote = initRemotePlayers(scene);
  // 接続が切れたことを出すバナー。initNet より先に作る
  // （繋がらないと分かるのは接続の直後なので、後から作ると1回目の通知を取りこぼす）
  connBanner = initConnBanner();
  net = initNet({
    name,
    config,
    idToken,
    eventId,
    roomNumber,
    entryCode,
    handlers: {
      onWelcome: ({ rejoined, id, name: assignedName, av: assignedAv, room, peers, count, cap, screen, playback, role, canControl, isAdmin, event, events, blocked, yt }) => {
        // 繋ぎ直しで入り直した場合、周りの人は総入れ替えになる。
        // 消さずに足すと、切れる前の人が幽霊として残ったままになる（2026-08-03追加）
        if (rejoined) remote.clear();
        myId = id;
        // YouTubeとの連携状態。UIがまだ無い（入場直後）ことがあるので覚えておく
        ytLinkState = yt || { on: false, linked: false };
        // 「コメントでアバターを動かすか」は端末の設定。入場のたびに伝え直す
        // （サーバーは覚えていないので、送らないと既定のONで動いてしまう）
        if (net && !demoMode) net.sendYtEmote(getChatEmote());
        if (ytChat) ytChat.setLinkState(ytLinkState);
        myRole = role || 'user';
        canControlVideo = canControl !== false;
        isAdminUser = isAdmin !== false;

        // 見た目もサーバーが決める場合がある（ゲストは髪なし＋IDで決まる色）。
        // ここで受け取った姿に差し替えないと、**自分の画面だけ違う姿**になり、
        // 本人はそれに気づけない（2026-08-02 修正）
        const serverConfig = assignedAv ? avToConfig(assignedAv) : null;
        const avChanged =
          serverConfig && JSON.stringify(serverConfig) !== JSON.stringify(session.config);
        if (serverConfig) session.config = serverConfig;

        // 表示名も権限もサーバーが決める（ログイン名 or ゲスト連番／管理者かどうか）。
        // 入場画面の時点ではどちらも分からないので、確定した内容で作り直す。
        // 名前が同じでも、👑や⭐を付けるためにここを通る必要がある
        const needsRebuild =
          (assignedName && assignedName !== session.name) || badgeForRole(myRole) !== '' || avChanged;
        if (needsRebuild) {
          if (assignedName) session.name = assignedName;
          const pos = player.position.clone();
          const rotY = player.rotation.y;
          scene.remove(player);
          player = createAvatar({ ...session.config, name: session.name, badge: badgeForRole(myRole) });
          player.position.copy(pos);
          player.rotation.y = rotY;
          if (namesHidden && player.userData.setNameVisible) player.userData.setNameVisible(false);
          scene.add(player);
          controls.setAvatar(player);
        }
        knownEvents = events || [];
        blockedList = blocked || [];
        updateHeader(room);
        peers.forEach((p) => remote.addPeer(p));
        lastServerCount = count;
        // 定員・NPC上限・チャットの形・運営メッセージをまとめて反映する
        applyEventSettings(event);
        if (peopleUI) peopleUI.refresh();
        // 途中入場でも、その部屋で今流れている動画と再生位置に合わせる
        if (screen) {
          liveScreen.setVideo(screen);
          if (screenUI) screenUI.setCurrent(screen);
          // YouTubeチャットは動画ごとに別物なので、ここでも貼り直す。
          // これが無いと、イベントを移動したときにチャットだけ前の動画のまま残り、
          // 「このライブストリームではチャットは無効です」と出る
          // （2026-08-03 本番テストで発覚）
          if (ytChat) ytChat.refresh();
        }
        if (playback) liveScreen.player.applySync(playback);
        applyRoleToUi();
      },
      // 別のイベント/ルームへ移動したとき: 周りの人を総入れ替えする
      onMoved: ({ room, peers, count, cap, screen, playback, event }) => {
        remote.clear();
        peers.forEach((p) => remote.addPeer(p));
        if (peopleUI) peopleUI.refresh();
        updateHeader(room);
        lastServerCount = count;
        applyEventSettings(event || currentEvent);
        if (screen) {
          liveScreen.setVideo(screen);
          if (screenUI) screenUI.setCurrent(screen);
          // YouTubeチャットは動画ごとに別物なので、ここでも貼り直す。
          // これが無いと、イベントを移動したときにチャットだけ前の動画のまま残り、
          // 「このライブストリームではチャットは無効です」と出る
          // （2026-08-03 本番テストで発覚）
          if (ytChat) ytChat.refresh();
        }
        if (playback) liveScreen.player.applySync(playback);
        chat.addMessage('', `${currentEvent ? currentEvent.name : ''} のルーム${room} に移動しました`, {
          system: true,
        });
      },
      onEvents: (list) => {
        knownEvents = list || [];
        if (roomUI) roomUI.setEvents(knownEvents);
        // 一覧にも自分がいるイベントの最新設定が入っている。
        // ここで拾わないと、定員を増やしてもNPCが増えないままになる
        const mine = currentEvent ? knownEvents.find((e) => e.id === currentEvent.id) : null;
        if (mine) applyEventSettings(mine);
      },
      onDenied: ({ reason, by, why, min, until }) => {
        // ---- 入場そのものを断られたケース ----
        // ワールドは既に描き始めているので、何もしないと「入れたのに人が誰もいない」
        // ように見えてしまう（2026-07-31 loyさん報告: 合言葉なしで入れる＋NPCが全員消える）。
        // 実際は弾かれているので、画面を出して入り直してもらう
        if (reason === 'no-event' || reason === 'bad-code' || reason === 'event-full') {
          showEntryBlocked(
            reason === 'no-event'
              ? 'いま開いているイベントがありません'
              : reason === 'bad-code'
                ? '合言葉が違います'
                : 'このイベントは満員です',
            reason === 'bad-code'
              ? '主催者から聞いた合言葉をもう一度確かめてください。'
              : reason === 'event-full'
                ? '別のルームが空いていることがあります。少し待ってからお試しください。'
                : '管理者がイベントを開くまでお待ちください。',
          );
          return;
        }
        if (reason === 'login-required') {
          showEntryBlocked('ログインが必要です', 'このイベントに入るにはGoogleログインが必要です。');
          return;
        }
        if (reason === 'capacity-too-small') {
          chat.addMessage(
            '',
            `いま入っている人数（${min || '?'}人）より少ない定員にはできません`,
            { system: true },
          );
          return;
        }
        if (reason === 'kicked-out') {
          // キックの締め出し中。何分後に入れるかを出さないと、
          // 「入れない」だけが残って不具合に見える
          const left = until ? Math.max(1, Math.ceil((until - Date.now()) / 60000)) : 0;
          removedReason =
            `${by || '運営'} によって一時的に締め出されています。` +
            (left ? `あと ${formatMinutes(left)} で入れます。` : '') +
            (why ? `（理由: ${why}）` : '');
          showEntryBlocked(removedReason);
          return;
        }
        if (reason === 'banned') {
          // 入場そのものを断られた。理由を画面に出して、デモモードには落とさない
          removedReason = why
            ? `${by || '管理者'} によってBANされています（理由: ${why}）`
            : `${by || '管理者'} によってBANされています`;
          return;
        }
        chat.addMessage('', DENY_MESSAGES[reason] || 'その操作は許可されていません', { system: true });
      },
      onPeerJoin: (p) => {
        remote.addPeer(p);
        // 入退場のお知らせは**管理者だけ**に出す（2026-08-02 loyさん指示）。
        // 人が多い会だとこれでお知らせ欄が埋まり、
        // 「ログインが必要です」のような**本人向けの案内が流れて見えなくなる**
        if (myRole === 'admin') chat.addMessage('', `${p.n} が入場しました`, { system: true });
        if (peopleUI) peopleUI.refresh();
      },
      onPeerMove: (m) => remote.movePeer(m),
      onPeerUpdate: (m) => remote.updatePeer(m),
      onPeerLeave: (id) => {
        // 退場した人の名前は、消す前に一覧から拾う
        const gone = remote ? remote.list().find((x) => x.id === id) : null;
        if (myRole === 'admin' && gone && gone.name) {
          chat.addMessage('', `${gone.name} が退場しました`, { system: true });
        }
        remote.removePeer(id);
        if (peopleUI) peopleUI.refresh();
      },
      // ---- 迷惑行為への対処 ----
      onBlocked: ({ k, n }) => {
        blockedList = [...blockedList.filter((b) => b.k !== k), { k, n }];
        chat.addMessage('', `${n} をブロックしました（お互いに見えなくなります）`, { system: true });
        if (peopleUI) peopleUI.refresh();
      },
      onBlockedList: (list) => {
        blockedList = list;
        if (peopleUI) peopleUI.refresh();
      },
      onModerated: ({ act, n, mins }) => {
        const kickMsg = mins > 0
          ? `${n} をキックしました（${formatMinutes(mins)} 再入場できません）`
          : `${n} をキックしました`;
        chat.addMessage('', act === 'ban' ? `${n} をBANしました` : kickMsg, { system: true });
        if (net && myRole === 'admin') net.requestBans();
        if (peopleUI) peopleUI.refresh();
      },
      onBans: (list) => {
        banList = list;
        if (peopleUI) peopleUI.refresh();
      },
      // 退出させられた側。切断が続くので、デモモードに落ちる前に理由を出す
      onKicked: ({ by, mins, why }) => {
        removedReason =
          mins > 0
            ? `${by} によって退出させられました。${formatMinutes(mins)} は入り直せません。` +
              (why ? `（理由: ${why}）` : '')
            : `${by} によって退出させられました。入り直すことはできます。`;
      },
      // 運営向けの通知。管理者にだけ届く（VIPがキックしたときも気づけるように）
      onStaffNote: ({ kind, n, by, mins, why }) => {
        if (kind !== 'kick' || !chat) return;
        const span = mins > 0 ? `${formatMinutes(mins)}の締め出し` : '締め出しなし';
        chat.addMessage('', `【運営】${by} が ${n} をキック（${span}）${why ? ` 理由: ${why}` : ''}`, {
          system: true,
        });
      },
      // コールのワード表・運営メンバーの一覧が届いた（管理タブ用・2026-08-03追加）
      onCallLists: (lists) => {
        callLists = lists || [];
        if (settingsUI && settingsUI.refreshIfAdminOpen) settingsUI.refreshIfAdminOpen();
        if (roomUI && roomUI.setCallLists) roomUI.setCallLists(callLists);
      },
      onStaffList: (list) => {
        staffList = list || [];
        if (settingsUI && settingsUI.refreshIfAdminOpen) settingsUI.refreshIfAdminOpen();
      },
      onKicks: (list) => {
        kickLog = list || [];
        if (peopleUI) peopleUI.refresh();
      },
      // イベント設定が途中で変わった（定員・NPC上限・チャットの形・運営メッセージ）
      onEventChanged: (ev) => {
        applyEventSettings(ev);
        if (roomUI && net) net.requestEvents();
      },
      onBanned: ({ by, why }) => {
        removedReason = why
          ? `${by} によってBANされました（理由: ${why}）。このアカウントでは入れません。`
          : `${by} によってBANされました。このアカウントでは入れません。`;
      },
      onChat: (m) => {
        // YouTube由来の発言は、自分のものでも吹き出しを出す。
        // 自分はYouTube側に書いたので、会場の画面にはまだ何も出ていない
        if (m.scope === 'yt') {
          chat.addMessage(m.n, m.txt, { yt: true });
          if (m.id === myId) {
            if (player && player.userData.say) player.userData.say(m.txt);
          } else {
            remote.say(m.id, m.txt);
          }
          return;
        }
        if (m.id === myId) return; // 自分の発言はローカルで表示済み
        chat.addMessage(m.n, m.txt);
        remote.say(m.id, m.txt);
      },
      // 合言葉が届いた（YouTubeのチャットに打つと繋がる）
      onYtCode: ({ ok, code }) => {
        if (ok && ytChat) ytChat.showCode(code);
      },
      // 繋がった／解除された
      onYtLinked: ({ ok, ytName, saved }) => {
        ytLinkState = { ...ytLinkState, linked: Boolean(ok), ytName: ytName || '' };
        if (ytChat) ytChat.setLinkState(ytLinkState);
        if (ok) {
          chat.addMessage('', `YouTubeチャンネルと繋がりました${ytName ? `（${ytName}）` : ''}。YouTubeでの発言があなたのアバターに出ます。`, { system: true });
          // 保存できていないと、サーバーが入れ替わった時点で繋がりが消える。
          // 黙っていると「繋がったはずなのに出ない」になるので、その場で言う
          if (saved === false) {
            chat.addMessage('', '⚠ ただし、この繋がりを保存できませんでした。サーバーが入れ替わると消えるので、そのときはもう一度合言葉を打ってください。', { system: true });
          }
        } else {
          chat.addMessage('', 'YouTubeチャンネルとの連携を解除しました。', { system: true });
        }
      },
      onCount: (c) => updateCount(c),
      onPeerEmote: (m) => {
        // ⚠ 自分のぶんも来る。エモートバーから出したものは既にローカルで再生しているが、
        //   **YouTubeのコメント由来はサーバー発**なので、ここで再生しないと
        //   「他人には見えているのに自分だけ動かない」状態になる（2026-08-03）
        if (m.id === myId) {
          if (player && player.userData.playEmote) player.userData.playEmote(m.e, m.n || 1);
          return;
        }
        remote.emote(m.id, m.e, m.n || 1);
      },
      onScreen: ({ v, by }) => {
        liveScreen.setVideo(v);
        if (screenUI) screenUI.setCurrent(v);
        // YouTubeチャットは動画ごとに別物なので、差し替わったら貼り直す
        if (ytChat) ytChat.refresh();
        chat.addMessage('', `${by} がスクリーンを変更しました`, { system: true });
      },
      // 他の人の再生/一時停止/シークを自分の映像にも反映する
      onPlayback: (pb) => liveScreen.player.applySync(pb),
      // 管理人がイベントを閉じた。会場ごと無くなったので入場画面へ戻す
      onClosed: ({ name: evName }) => {
        removedReason = `「${evName || 'イベント'}」は終了しました`;
        showEntryBlocked(
          `「${evName || 'イベント'}」は終了しました`,
          'ご参加ありがとうございました。',
        );
      },
      onDisconnect: () => startDemoMode(),
      // 接続の状態が変わった（2026-08-03追加）。
      // 黙ってオフラインになるのを防ぐため、画面にはっきり出す
      onConnectionState: ({ state, attempt, rejoined }) => {
        if (!connBanner) return;
        if (state === 'online') {
          connBanner.hide();
          // 繋ぎ直したときだけ知らせる。最初の入場では出さない（当たり前のことなので）
          if (rejoined) chat.addMessage('', '接続が戻りました。', { system: true });
          return;
        }
        if (state === 'offline') {
          connBanner.show('接続が切れました。繋ぎ直しています…');
          return;
        }
        if (state === 'reconnecting') {
          connBanner.show(
            attempt > 1
              ? `接続が切れました。繋ぎ直しています…（${attempt}回目）`
              : '接続が切れました。繋ぎ直しています…',
          );
        }
      },
    },
  });

  // NPCの入れ物は常に用意しておく（人数は上限と各自の設定から決まる）。
  // 人数0なら何も描かないので、通常の入場では一切影響しない
  ensureSim();

  // スマホは消音で始まるので、音を出すための案内を出す
  if (IS_TOUCH) {
    initSoundGate({
      player: liveScreen.player,
      onTap: () => chat.addMessage('', '音を出しました', { system: true }),
    });
  }

  updateCount(null);
  hud.classList.remove('hidden');
  chatRoot.classList.remove('hidden');
  avatarBtn.classList.remove('hidden');

  // 右上のツールバー（2026-08-03追加）。
  // 右下は「動画のコントローラー」だけにして、会場と自分に関するものはここへ集める
  topBar = initTopBar();
  // アバター変更もここに入れる（index.html に元からある要素を移動する）
  avatarBtn.classList.add('vc-topbar-wide');
  topBar.slot.appendChild(avatarBtn);

  // 退室（2026-08-04追加・テストユーザー要望）。
  // タブを閉じるしか出る方法が無かったので、入場画面へ戻れるようにする
  initExitButton({ slot: topBar.slot });

  // 自分のアバターの小窓（2026-08-04追加）。
  // ⚠ 着替えると player が差し替わるので、そのつど取り直す（変数を掴まない）
  selfView = initSelfView({ getPlayer: () => player });

  // 床の反射（2026-08-04追加）。前回この端末で選んだ設定をここで効かせる。
  // ⚠ 入場のたびに通す。ここを忘れると「設定は残っているのに映らない」になる
  if (world && world.setReflection) world.setReflection(getReflection());

  // エモートバー（自分の分はローカルで即再生し、サーバーへも通知）
  emoteBar = initEmoteBar({
    onEmote: (id) => {
      if (myRole === 'guest') {
        chat.addMessage('', 'エモートを使うにはログインが必要です', { system: true });
        return;
      }
      if (player.userData.playEmote) player.userData.playEmote(id);
      if (net && !demoMode) net.sendEmote(id);
    },
  });

  // 右下の動画パネル（再生・音量・シーク）。シアター表示と動画変更のボタンもここに入れる
  videoPanel = initPlayerControls({
    player: liveScreen.player,
    // 再生/一時停止/シークはイベント全体で揃える（音量・ミュートは各自の設定なので送らない）
    // 自分の画面だけ映像を読み込み直す。他の人には通知しない
    // （ライブが遅れて止まった人だけが復帰できればよいため）
    onReload: () => {
      liveScreen.reload();
      chat.addMessage('', '映像を読み込み直しました', { system: true });
    },
    onAction: (type, pos) => {
      if (!canControlVideo) return; // 権限が無ければ共有状態を動かさない
      // ライブ配信かどうかも伝える。サーバーはライブなら位置を持たない
      const live = Boolean(liveScreen.player.getState().live);
      if (net && !demoMode) net.sendPlayback(type === 'pause' ? 'pause' : 'play', pos, live);
    },
  });

  // スクリーン変更パネル（会場全員のスクリーンが切り替わる共有状態）
  screenUI = initScreenUI({
    slot: videoPanel.slot,
    onChange: (videoId) => {
      if (net && !demoMode) {
        net.sendScreen(videoId); // サーバー経由で全員に反映（自分にも返ってくる）
      } else {
        liveScreen.setVideo(videoId); // オフラインデモ時は自分の画面だけ
        screenUI.setCurrent(videoId);
      }
    },
  });
  screenUI.setCurrent(liveScreen.getVideo());

  // 運営メッセージの固定枠（チャットに流すと見逃されるので別枠に出す）
  noticeBar = initNoticeBar();
  // YouTubeのライブチャット。連動イベントのときだけ出す
  ytChat = initYouTubeChat({
    getVideoId: () => liveScreen.getVideo(),
    onRequestCode: () => net && net.requestYtCode(),
    onUnlink: () => net && net.sendYtUnlink(),
  });
  // 入場時に受け取った連携状態を反映する（welcome の方が先に来るため）
  ytChat.setLinkState(ytLinkState);
  // ヘルプ（❓）。運営向けタブは管理者・VIPにだけ出る。
  // 権限の見方は🚪パネルと揃える（ログイン未設定の環境では全員が運営扱いになる仕様のため、
  // myRole だけ見ると「操作はできるのに手引きが読めない」というちぐはぐが起きる）
  helpUI = initHelpUI({ slot: topBar.slot, getRole: () => staffRole() });
  // 入場時点のイベント設定を反映する（この時点でUIが揃ったので改めて通す）
  applyEventSettings(currentEvent);

  // イベントの記録（管理者だけ。🚪パネルの末尾に差し込む）
  const logsUI = initLogsUI({
    // 記録のAPIは管理者専用なので、VIPには出さない（出すと押しても弾かれる）
    getRole: () => staffRole(),
    getIdToken: () => idToken || '',
  });

  // イベント／ルームの移動パネル（管理者はイベント作成もここから）
  roomUI = initRoomUI({
    slot: topBar.slot,
    // イベント作成はVIPにも開放されている。個々のイベントを操作できるかは
    // サーバーが各イベントに付ける mine で判断するので、ここは役職だけ渡す
    getRole: () => staffRole(),
    getCurrent: () => ({ eventId: currentEvent ? currentEvent.id : '', room: currentRoom }),
    onMove: (evId, room, code) => {
      if (net && !demoMode) net.sendMove(evId, room, code);
    },
    onCreateEvent: (payload) => {
      if (net && !demoMode) net.sendEventCreate(payload);
    },
    onUpdateEvent: (payload) => {
      if (net && !demoMode) net.sendEventUpdate(payload);
    },
    onDeleteEvent: (id) => {
      if (net && !demoMode) net.sendEventDelete(id);
    },
    onRefresh: () => {
      if (net && !demoMode) net.requestEvents();
    },
    // NPCは自分の画面にだけ出る。上限は管理者がイベント設定で決めている
    getNpcCount: () => (sim ? sim.count() : 0),
    getNpcCeiling: () => npcCeiling(),
    isNpcAuto: () => npcUserLimit == null,
    onNpcCount: (n) => {
      // n が null なら「上限いっぱい」に戻す
      npcUserLimit = n === null ? null : Math.max(0, Math.trunc(n));
      saveNpcPref(npcUserLimit); // 次に来たときも同じ見え方にする
      ensureSim();
      autoFillNpc();
      updateCount(); // サーバー人数は据え置きでNPCぶんだけ数え直す
    },
    adminExtra: logsUI,
  });
  roomUI.setEvents(knownEvents);

  // 参加者パネル（ブロック／キック／BAN）
  peopleUI = initPeopleUI({
    // 2026-08-03: ⚙設定の中に入れたので、独立したボタンは出さない（slotを渡さない）
    slot: null,
    getRole: () => staffRole(),
    getMyName: () => session.name,
    getPeople: () => (remote ? remote.list() : []),
    getBlocked: () => blockedList,
    getBans: () => banList,
    getKicks: () => kickLog,
    onBlock: (id) => {
      if (net && !demoMode) net.sendBlock(id);
    },
    onUnblock: (k) => {
      if (net && !demoMode) net.sendUnblock(k);
    },
    onKick: (id, mins, why) => {
      if (net && !demoMode) net.sendKick(id, mins, why);
    },
    onBan: (id, why) => {
      if (net && !demoMode) net.sendBan(id, why);
    },
    onUnban: (email) => {
      if (net && !demoMode) net.sendUnban(email);
    },
    // 管理者のときだけBAN一覧を取りに行く（一般ユーザーには断られるので送らない）
    onRefresh: () => {
      if (net && !demoMode && myRole === 'admin') {
        net.requestBans();
        net.requestKicks(); // BANするかの判断材料（キックの履歴）
      }
    },
  });

  // ⚙設定パネル（2026-08-03追加）。表示設定・参加者・NPC設定をここへ集めた。
  // ヘルプ（読むところ）と設定（変えるところ）を分けるため
  // 管理タブ（コールのワード・運営メンバー）。2026-08-03追加
  adminUI = initAdminUI({
    getLists: () => callLists,
    getStaff: () => staffList,
    getRole: () => staffRole(),
    onSaveList: (list) => {
      if (net && !demoMode) net.sendCallListSave(list);
    },
    onDeleteList: (id) => {
      if (net && !demoMode) net.sendCallListDelete(id);
    },
    onSaveStaff: (email, role) => {
      if (net && !demoMode) net.sendStaffSave(email, role);
    },
    onDeleteStaff: (email) => {
      if (net && !demoMode) net.sendStaffDelete(email);
    },
    // 開いたときに最新を取りに行く（他の運営が変えているかもしれない）
    onRefresh: () => {
      if (!net || demoMode) return;
      net.requestCallLists();
      if (myRole === 'admin') net.requestStaff();
    },
  });

  settingsUI = initSettingsUI({
    slot: topBar.slot,
    people: peopleUI,
    rooms: roomUI,
    admin: adminUI,
    getRole: () => staffRole(),
    // エモートの並べ方・並び順を変えたら、バーを描き直す
    onEmotePrefsChange: () => {
      if (emoteBar && emoteBar.refreshPrefs) emoteBar.refreshPrefs();
    },
    // 「コメントでアバターを動かす」の切り替えは、サーバーが判断に使うので伝える
    onChatEmoteChange: (on) => {
      if (net && !demoMode) net.sendYtEmote(on);
    },
    // 自分の姿の小窓（2026-08-04追加）。自分の画面だけの設定なのでサーバーへは送らない
    onSelfViewChange: (on) => {
      if (selfView) selfView.setEnabled(on);
    },
    // 床の反射（2026-08-04追加）。端末の性能に左右されるので自分の画面だけの設定
    onReflectionChange: (on) => {
      if (world && world.setReflection) world.setReflection(on);
    },
    // ブルーム（2026-08-04追加）。同じく端末ごとの設定
    onBloomChange: (on) => {
      bloomOn = on;
    },
    // fps表示（2026-08-04追加）。運営が重さを見るための道具
    onFpsMeterChange: (on) => {
      fpsMeter.setEnabled(on);
    },
    // 軽量モード（2026-08-06追加）。端末ごとの設定
    onLowPowerChange: (on) => {
      lowPower.setEnabled(on);
    },
  });
  // 前回「出す」にしていたら、権限があるあいだは出したままにする
  if (['admin', 'vip'].includes(staffRole())) fpsMeter.setEnabled(getFpsMeter());

  // welcomeが先に来ている場合に備えて、権限の反映をここでもう一度実行する
  applyRoleToUi();

  // スクリーン全画面（シアター）＝動画パネル内 ／ UI表示切替＝画面右上のアイコン
  initViewMode({
    controls,
    // ⛶全画面は映像の機能なので動画パネルのまま。
    // 🏷ネームプレート・👁UI非表示は右上バーの右端へ
    slot: videoPanel.slot,
    toggleSlot: topBar,
    // ネームプレートと吹き出しは3D空間の中にあるのでCSSでは消えない。個別に切り替える。
    // 「UI非表示(H)」と「ネームプレートだけ非表示(N)」の両方をまとめた結果が来る
    // シアター表示中は会場の造形を消して、映像が柱で隠れないようにする
    // （ワールドが対応していれば。仮ワールドは遮るものが無いので持っていない）
    onTheater: (on) => {
      if (world.setVenueVisible) world.setVenueVisible(!on);
    },
    onNamesVisible: (show) => {
      namesHidden = !show;
      if (player && player.userData.setNameVisible) player.userData.setNameVisible(show);
      if (remote && remote.setNamesVisible) remote.setNamesVisible(show);
      if (sim && sim.setNamesVisible) sim.setNamesVisible(show);
    },
  });

  // Pキー: スクリーンを一時的に手前に出してYouTubeプレイヤーを直接操作できるようにする
  // （普段は映像がアバターの後ろに来るよう背面に置いているため）
  window.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key.toLowerCase() !== 'p' || e.repeat) return;
    e.preventDefault();
    const on = liveScreen.toggleInteractive();
    chat.addMessage(
      '',
      on ? 'スクリーンを操作モードにしました（もう一度Pで戻す）' : 'スクリーンを通常表示に戻しました',
      { system: true },
    );
  });

  // スマホ対応（タッチ端末 or ?mobile=1 のときだけ有効化される）
  initMobile({ controls, chatRoot });
}

// ---- 入場後のアバター再カスタム ----
avatarBtn.addEventListener('click', () => {
  if (myRole === 'guest') {
    if (chat) chat.addMessage('', '見た目を変えるにはログインが必要です', { system: true });
    return;
  }
  openCustomizer({
    name: session.name,
    config: session.config,
    onApply: ({ name, config }) => {
      session.name = name;
      session.config = { ...config };
      // 入場後に変えた姿も次回に持ち越す（サーバー側は update を受けて保存する）
      saveLocalPrefs({ config });

      // 位置と向きを保ったままアバターを作り直す
      const pos = player.position.clone();
      const rotY = player.rotation.y;
      scene.remove(player);
      player = createAvatar({ ...config, name, badge: badgeForRole(myRole) });
      player.position.copy(pos);
      player.rotation.y = rotY;
      if (namesHidden && player.userData.setNameVisible) player.userData.setNameVisible(false);
      scene.add(player);
      controls.setAvatar(player);

      chat.addMessage('', `${name} がアバターを変更しました`, { system: true });
      if (net && !demoMode) net.sendUpdate(name, config);
    },
  });
});

const clock = new THREE.Clock();
const prevPos = new THREE.Vector3();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (world.update) world.update(dt, t);

  if (player) {
    controls.update(dt);
    if (player.userData.update) player.userData.update(dt);
    if (sim) sim.update(dt);
    if (remote) remote.update(dt);

    // 自分の位置をサーバーへ（net.js側で10Hzスロットル＋変化なしスキップ）
    if (net && !demoMode) {
      const moving = prevPos.distanceToSquared(player.position) > 1e-6;
      net.sendPos(
        player.position.x,
        player.position.z,
        Math.round(THREE.MathUtils.radToDeg(player.rotation.y)),
        moving
      );
      prevPos.copy(player.position);
    }
  } else {
    // 入場前はステージ周りをゆっくり旋回するカメラ
    const r = 26;
    camera.position.set(Math.sin(t * 0.12) * r, 9, Math.cos(t * 0.12) * r);
    camera.lookAt(0, 3, 0);
  }

  fpsMeter.tick();
  if (bloom && bloomOn) bloom.render(scene, camera);
  else renderer.render(scene, camera);
  // 自分の姿の小窓（2026-08-04追加）。**本編を描いたあと**に呼ぶ。
  // 一人称やシアター表示でも出したままにする（そこが本来の使いどころ）
  if (selfView) selfView.render(renderer, scene);
  liveScreen.update();
}
loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (bloom) bloom.setSize(window.innerWidth, window.innerHeight);
});

// 開発用の覗き口。見た目の不具合を「パーツを消して切り分ける」ために使う。
// 参照を渡すだけで挙動は変えない。
// 動作確認用の入口。描画が止まる環境（ブラウザのタブが裏など）でも
// controls.update(dt) を手で回して挙動を確かめられるようにしてある
window.__vc = {
  scene,
  camera,
  renderer,
  world,
  get controls() { return controls; },
  get player() { return player; },
  // 自分の姿の小窓（2026-08-04追加）。描画が止まる環境でも
  // selfView.render(renderer, scene) を手で呼んで確かめられるようにしてある
  get selfView() { return selfView; },
  get currentEvent() { return currentEvent; },
  // ブルーム（2026-08-04追加）。効き目を絵と数値で確かめるための入口
  bloom,
  get bloomOn() { return bloomOn; },
  set bloomOn(v) { bloomOn = Boolean(v); },
};
