import {
  getWallet, onWalletChange, claimTestTopup, TEST_TOPUP_AMOUNT, getLoginStat,
  grantAchievementReward,
} from './wallet.js';
import { itemById } from './catalog.js';
import { parseAccessories, toggleAccessory } from './accessory.js';
import {
  renderMap, renderSns, renderMessenger, renderCamera, renderFriends, renderPay, renderCall,
  renderHouse,
} from './phoneapps.js';
import { getHouse, onHouseChange, rentRoom, placeItem, removeLast, clearItems, placeableItems, RENT } from './housing.js';
import {
  renderAlbum, addPhoto, removePhoto, renderAchievements, unlock,
  renderRanking, renderWeather, ACHIEVEMENTS,
} from './phoneextra.js';
import { getFriends, onFriendsChange, isFriend, acceptRequest, declineRequest, removeFriend } from './friends.js';

// ============================================================
// スマホ（2026-08-08・loyさん発案）
//
// > なんか、設定とかそういうの全部まとめたスマホがあるといいかも。
// > スマホだして、そこで設定やインベントリやアプリが入っててだいたいのことは
// > そこでできると、困ったらスマホ開けばいい、になるよね
//
// ★ なぜ作るか
//   ・入口が1つになる。いま右上にボタンが7つ並んでいて、初見では何がどれか分からない
//   ・持ち物が「お店の中でしか開けない」状態を解消できる（どこでも開ける）
//
// ★ 何を中に入れて、何を外に残すか（loyさん指定 2026-08-08）
//   外に残す: **UI非表示（👁）・ネーム表示（🏷）・退室（🏃）**
//     → 👁 は押せなくなると戻せない、🏃 は緊急の出口。スマホの中に隠すと詰む
//   中に入れる: アバター変更・設定・ルーム・ヘルプ・持ち物・ウォレット
//   入れない: **ショップ・カジノ・ガチャ（施設は建物）**
//     → 現地へ行く意味を残すため（loyさん「施設は建物」）
//
// ⚠ 既にある画面（設定・ルーム・ヘルプ・アバター変更）は**作り直していない**。
//   スマホのアプリを押すと、右上に元からあるボタンを押したのと同じことが起きる。
//   作り直すと、それぞれが持っている細かい挙動（権限の出し分け・保存・同期）を
//   すべて写し直すことになり、確実に取りこぼす。
// ============================================================

const STYLE_ID = 'vc-phone-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* 開くボタン。右下（動画のコントローラーの上）に置く */
.vc-phone-btn {
  position: fixed; right: 18px; bottom: 190px; z-index: 25;
  width: 46px; height: 46px; border-radius: 14px; cursor: pointer;
  font-size: 22px; line-height: 1;
  color: #eaf6ff; background: rgba(10,12,24,0.85);
  border: 1px solid rgba(0,255,234,0.55);
  box-shadow: 0 0 14px rgba(0,255,234,0.25);
}
.vc-phone-btn:hover { border-color: #00ffea; }
/* 📱本体のバッジ（未読の合計。2026-08-08）。開いていなくても気づけるように */
.vc-phone-outer-badge {
  display: none; position: absolute; top: -4px; right: -4px; min-width: 17px; height: 17px;
  padding: 0 3px; border-radius: 9px; background: #ff4fd8; color: #fff; font-size: 10px;
  font-weight: 700; align-items: center; justify-content: center; line-height: 1;
  box-shadow: 0 0 6px rgba(255,79,216,0.85); border: 1px solid rgba(255,255,255,0.5);
}

/* 筐体（loyさん「スマホの筐体作る」） */
.vc-phone {
  position: fixed; right: 24px; bottom: 96px; z-index: 62;
  width: 360px; height: 640px;
  max-height: calc(100vh - 130px);
  border-radius: 38px;
  padding: 12px 10px;
  background: linear-gradient(160deg, #23283a, #12141f);
  border: 1px solid rgba(255,255,255,0.22);
  box-shadow: 0 18px 50px rgba(0,0,0,0.6), 0 0 24px rgba(0,255,234,0.18);
  display: flex; flex-direction: column;
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif;
  color: #eaf6ff;
}
/* 画面（筐体の内側） */
.vc-phone-screen {
  flex: 1 1 auto; min-height: 0; border-radius: 28px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 0%, #16263a, #0a0c16 70%);
  display: flex; flex-direction: column;
}
/* 上のノッチ */
.vc-phone-notch {
  position: absolute; left: 50%; top: 16px; transform: translateX(-50%);
  width: 96px; height: 18px; border-radius: 0 0 12px 12px; background: #0a0c16;
}
/* 下のホームバー（押すとホームに戻る） */
.vc-phone-home {
  flex: 0 0 auto; margin: 8px auto 2px; width: 110px; height: 5px; border-radius: 3px;
  background: rgba(255,255,255,0.5); cursor: pointer;
}
.vc-phone-status {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 10px 16px 6px; font-size: 11px; color: rgba(220,235,255,0.75);
}
.vc-phone-coin { margin-left: auto; color: #ffd86b; font-weight: 700; }
/* ⚠ 閉じるボタンは**筐体の中**に置く。外の📱ボタンは筐体の裏に隠れて押せなかった
   （2026-08-08 loyさん「スマホを閉じれないね」）。Tab / Esc でも閉じられる */
.vc-phone-x {
  width: 22px; height: 22px; border-radius: 7px; cursor: pointer; font-size: 12px; line-height: 1;
  color: #eaf6ff; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.28);
}
.vc-phone-x:hover { border-color: #ff6fd8; }

/* カメラのときは小さくして、街が見えるようにする（歩きながら撮れる） */
.vc-phone.vc-phone-cam {
  height: 320px; width: 300px; opacity: 0.97;
}
.vc-phone-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 14px 14px; }
.vc-phone-apps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 10px; padding-top: 6px; }
.vc-app {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  background: none; border: none; color: #eaf6ff; cursor: pointer; padding: 0;
}
.vc-app-ico {
  position: relative;
  width: 54px; height: 54px; border-radius: 15px; font-size: 25px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, rgba(0,255,234,0.22), rgba(255,0,229,0.18));
  border: 1px solid rgba(255,255,255,0.18);
}
/* アプリごとの未読バッジ（📇連絡帳・💬メッセージ・📹通話。2026-08-08・見たら消える） */
.vc-app-badge {
  position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px; padding: 0 3px;
  border-radius: 9px; background: #ff4fd8; color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; line-height: 1;
  box-shadow: 0 0 5px rgba(255,79,216,0.8); border: 1px solid rgba(255,255,255,0.5);
}
.vc-app:hover .vc-app-ico { border-color: #00ffea; }
.vc-app-name { font-size: 10px; color: rgba(220,235,255,0.8); }
.vc-phone-title {
  display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700;
  padding: 2px 0 10px;
}
.vc-phone-back {
  padding: 3px 9px; font-size: 11px; border-radius: 8px; cursor: pointer;
  color: #eaf6ff; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.22);
}
.vc-phone-note { font-size: 11px; line-height: 1.6; color: rgba(220,235,255,0.55); margin: 0 0 10px; }
.vc-phone-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.vc-phone-card {
  padding: 8px; border-radius: 10px; text-align: center;
  border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.04);
}
.vc-phone-card .ico { font-size: 22px; }
.vc-phone-card .nm { font-size: 11px; margin: 2px 0; }
.vc-phone-card .sub { font-size: 10px; color: rgba(150,255,220,0.9); }
.vc-phone-card button {
  width: 100%; margin-top: 6px; padding: 4px; font-size: 11px; border-radius: 7px; cursor: pointer;
  color: #eaf6ff; background: rgba(0,255,234,0.12); border: 1px solid rgba(0,255,234,0.5);
}
.vc-log-row {
  display: flex; gap: 8px; font-size: 11px; padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.vc-log-amt { margin-left: auto; font-weight: 700; }
.vc-log-plus { color: #9be34a; }

/* ---- 既にある画面をスマホの中に収める（2026-08-08）----
   ⚠ 元の画面は position:fixed で画面の隅に出るように作られている。
   スマホの中に入れる間だけ、位置と装飾を打ち消す（元のCSSは触らない）。
   これをやらないと、スマホの外に出たまま**閉じるボタンが無くなる**
   （開閉ボタンをスマホの中へ移したため。loyさん「開くと閉じれなくなる」） */
.vc-in-phone {
  position: static !important;
  inset: auto !important;
  transform: none !important;
  width: 100% !important;
  max-width: 100% !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 4px 0 !important;
  border: none !important;
  background: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  z-index: auto !important;
}
/* ⚠ display は**上書きしない**。上書きすると、中の✕で閉じても消えず
   （!important が勝つ）、押しても何も起きないように見える（2026-08-08 レビュー指摘） */
.vc-log-minus { color: #ff9aa2; }

@media (max-width: 640px), (max-height: 480px) {
  .vc-phone { right: 10px; left: 10px; width: auto; bottom: 84px; height: auto; max-height: 72vh; }
  /* ⚠ 位置は固定pxではなく --m-phone-bottom（style.css）を使う。
     畳んだエモートのすぐ上に積む計算式なので、エモート側の高さを変えても
     ここが自動で追従する（2026-08-08 スマホUI整理） */
  .vc-phone-btn { right: 10px; bottom: var(--m-phone-bottom); }
  /* エモートを開いている間だけ📱を隠す。開いたエモートは一時的に上へ伸びて
     このボタンの位置と被るため（loyさん「スマホUIがぐちゃぐちゃ」対応） */
  body.vc-m-emote-open .vc-phone-btn { display: none; }
}
`;
  document.head.appendChild(style);
}

/**
 * スマホを用意する。
 * @param {{
 *   apps: {id:string,name:string,icon:string,run:()=>void,show?:()=>boolean}[],
 *   getConfig: ()=>object,
 *   onWear: (cfg:object)=>void,
 *   onOpenChange?: (open:boolean)=>void,
 * }} opts
 */
export function initPhone(opts = {}) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-phone-btn';
  btn.innerHTML = '📱<span class="vc-phone-outer-badge" id="vc-phone-outer-badge"></span>';
  btn.title = 'スマホ（設定・持ち物・アプリ）';
  document.body.appendChild(btn);
  const outerBadgeEl = btn.querySelector('#vc-phone-outer-badge');

  const phone = document.createElement('div');
  phone.className = 'vc-phone';
  phone.style.display = 'none';
  phone.innerHTML = `
    <div class="vc-phone-screen">
      <div class="vc-phone-notch"></div>
      <div class="vc-phone-status">
        <span id="vc-phone-clock"></span>
        <span class="vc-phone-coin" id="vc-phone-coin"></span>
        <button type="button" class="vc-phone-x" id="vc-phone-x" title="閉じる">✕</button>
      </div>
      <div class="vc-phone-body" id="vc-phone-body"></div>
    </div>
    <div class="vc-phone-home" id="vc-phone-home" title="ホームに戻る"></div>
  `;
  document.body.appendChild(phone);

  const bodyEl = phone.querySelector('#vc-phone-body');
  const coinEl = phone.querySelector('#vc-phone-coin');
  const clockEl = phone.querySelector('#vc-phone-clock');

  let open = false;
  let view = 'home';
  /** 地図の描き直しを止めるための後始末 */
  let stopMap = null;
  /** カメラのライブプレビュー（drawImageの間引き）を止めるための後始末 */
  let stopCamera = null;
  /** 文字入力中か（input/textareaにフォーカスがあるあいだ）。歩行の可否に使う */
  let typing = false;
  /** SNSの投稿（サーバーから届いたもの。新しい順） */
  let posts = [];
  /** SNS・DMで断られた理由（1回だけ出す） */
  let denied = '';
  /** メッセンジャーのやり取り（相手id → メッセージの配列）。**この端末だけ**に残る */
  const threads = {};
  /** いま開いている相手 */
  let dmWith = null;
  /** 送金の結果メッセージ（1回だけ出す） */
  let payMsg = '';
  /** 通話の状態: idle / ring（こちらから呼び出し中）/ incoming（着信）/ live（通話中） */
  let callState = 'idle';
  /** 通話の相手 { id, name } */
  let callPeer = null;

  const paintStatus = () => {
    coinEl.textContent = `${getWallet().balance.toLocaleString()} VC`;
    const d = new Date();
    clockEl.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  onWalletChange(paintStatus);
  onHouseChange(() => {
    if (open && view === 'house') paint();
  });
  onFriendsChange(() => {
    // home も含める：ホーム画面の📇バッジ（届いている申請数）をその場で更新するため
    if (open && (view === 'friends' || view === 'dm' || view === 'pay' || view === 'home')) paint();
    updateOuterBadge();
  });

  /** 未読メッセージの合計（📇連絡帳・💬メッセージ・📹通話のバッジに使う内部計算） */
  function unreadDmCount() {
    let n = 0;
    for (const id of Object.keys(threads)) n += threads[id].filter((m) => !m.mine && !m.read).length;
    return n;
  }

  /**
   * 📱本体（開閉ボタン）のバッジ。開いていなくても「何か来てる」と分かるように、
   * 合計件数だけを常時ここに出す（2026-08-08・loyさん「通知が欲しい」）。
   */
  function updateOuterBadge() {
    const n = getFriends().requests.length + unreadDmCount() + (callState === 'incoming' ? 1 : 0);
    outerBadgeEl.textContent = n > 9 ? '9+' : String(n);
    outerBadgeEl.style.display = n > 0 ? 'flex' : 'none';
  }

  // ---- ホーム ----
  function renderHome() {
    const grid = document.createElement('div');
    grid.className = 'vc-phone-apps';
    // アプリごとのバッジ数（見たら消える・2026-08-08）
    const badges = {
      friends: getFriends().requests.length,
      dm: unreadDmCount(),
      call: callState === 'incoming' ? 1 : 0,
    };
    for (const app of opts.apps || []) {
      if (app.show && !app.show()) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vc-app';
      const n = badges[app.id] || 0;
      const badgeHtml = n ? `<span class="vc-app-badge">${n > 9 ? '9+' : n}</span>` : '';
      b.innerHTML = `<div class="vc-app-ico">${app.icon}${badgeHtml}</div><div class="vc-app-name">${app.name}</div>`;
      b.addEventListener('click', () => {
        if (app.inside) {
          view = app.id;
          paint();
          return;
        }
        if (app.host) {
          // 既にある画面を**スマホの中で**開く（loyさん「スマホの中で開くようにしないとだね」）
          openHosted(app);
          return;
        }
        // 画面いっぱいで開くもの（アバターの着せ替えなど）。スマホは閉じる
        setOpen(false);
        app.run();
      });
      grid.appendChild(b);
    }
    bodyEl.appendChild(grid);
  }

  /** いまスマホの中に借りている画面（戻すときに使う） */
  let hosted = null;

  /**
   * 既にある画面をスマホの中に入れて開く。
   * ⚠ 作り直さない。**元の要素をそのまま借りてくる**（中の細かい挙動を写し損ねないため）。
   *   閉じるときは必ず元の場所へ返す。返し忘れると次に開いたとき出てこない
   */
  function openHosted(app) {
    // ⚠ ボタンは**開閉の切り替え**なので、既に開いているときに押すと閉じてしまう。
    //   閉じているときだけ押す
    const found = document.querySelector(app.host);
    if (!found || getComputedStyle(found).display === 'none') app.run();
    const el = document.querySelector(app.host);
    if (!el) return;
    hosted = { app, el, parent: el.parentNode, next: el.nextSibling, watch: null };
    view = `host:${app.id}`;
    paint();
    // 中の✕で閉じられたら、スマホのホームへ戻す（空の画面が残らないように）
    hosted.watch = setInterval(() => {
      if (!hosted) return;
      if (getComputedStyle(hosted.el).display === 'none') {
        releaseHosted();
        view = 'home';
        paint();
      }
    }, 300);
  }

  function releaseHosted() {
    if (!hosted) return;
    const { app, el, parent, next, watch } = hosted;
    hosted = null;
    if (watch) clearInterval(watch);
    el.classList.remove('vc-in-phone');
    if (parent) parent.insertBefore(el, next || null);
    // もう一度ボタンを押して閉じる（開閉が同じボタンなので、これで元に戻る）。
    // ⚠ **開いているときだけ**押す。スマホの中で✕を押して既に閉じている場合に押すと、
    //   スマホの外で開き直してしまい、閉じるボタンの無い画面が残る（2026-08-08 レビュー指摘）
    if (app.run && getComputedStyle(el).display !== 'none') app.run();
  }

  function header(title) {
    const h = document.createElement('div');
    h.className = 'vc-phone-title';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'vc-phone-back';
    back.textContent = '← ホーム';
    back.addEventListener('click', () => {
      releaseHosted();
      view = 'home';
      paint();
    });
    const t = document.createElement('span');
    t.textContent = title;
    h.append(back, t);
    bodyEl.appendChild(h);
  }

  // ---- 持ち物（スマホの中で完結する）----
  function renderBag() {
    header('持ち物');
    const w = getWallet();
    const ids = Object.keys(w.items).filter((id) => w.items[id] > 0);
    if (!ids.length) {
      const p = document.createElement('p');
      p.className = 'vc-phone-note';
      p.textContent = 'まだ何も持っていません。街のお店・ガチャ・カジノで手に入ります。';
      bodyEl.appendChild(p);
      return;
    }
    const note = document.createElement('p');
    note.className = 'vc-phone-note';
    // 2026-08-08・loyさん「飲み物のめない」の修正。バーの建物まで行かなくても
    // ここから飲めるようにした（アクセサリーは今までどおり「着ける」）
    note.textContent = '「着ける」を押すとその場で見た目に反映されます。飲み物は「飲む」で1つ減り、お腹が回復します。';
    bodyEl.appendChild(note);

    const worn = opts.getConfig ? parseAccessories(opts.getConfig().accessory) : [];
    const list = document.createElement('div');
    list.className = 'vc-phone-list';
    for (const id of ids) {
      const it = itemById(id);
      if (!it) continue;
      const on = it.accessory && worn.includes(it.accessory);
      const card = document.createElement('div');
      card.className = 'vc-phone-card';
      card.innerHTML = `<div class="ico">${it.icon}</div><div class="nm">${it.name}</div>`
        + `<div class="sub">${w.items[id]}個${on ? '・着用中' : ''}</div>`;
      if (it.kind === 'wear' && opts.onWear && opts.getConfig) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = on ? '外す' : '着ける';
        b.addEventListener('click', () => {
          const cfg = { ...opts.getConfig() };
          cfg.accessory = toggleAccessory(cfg.accessory, it.accessory);
          opts.onWear(cfg);
          paint();
        });
        card.appendChild(b);
      } else if (it.cat === 'drink' && opts.onDrink) {
        // ⚠ バー（shopui.js）と同じ道を通す。ここだけ別の減らし方をすると
        //   個数がズレる（addItemを2か所で別々に書かない）
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '飲む';
        b.addEventListener('click', () => {
          opts.onDrink(it);
          paint();
        });
        card.appendChild(b);
      }
      list.appendChild(card);
    }
    bodyEl.appendChild(list);
  }

  // ---- ウォレット（残高と履歴）----
  function renderWallet() {
    header('ウォレット');
    const w = getWallet();
    const big = document.createElement('div');
    big.style.cssText = 'font-size:26px;font-weight:700;color:#ffd86b;text-align:center;padding:6px 0 12px;';
    big.textContent = `${w.balance.toLocaleString()} VC`;
    bodyEl.appendChild(big);

    const note = document.createElement('p');
    note.className = 'vc-phone-note';
    note.textContent = '⚠ いまはこの端末の中だけの残高です（VRChat側とはまだ繋がっていません）。';
    bodyEl.appendChild(note);

    // VCの稼ぎ方の案内（2026-08-08・loyさん「VCを稼ぐ方法がないと詰むね」）
    const how = document.createElement('p');
    how.className = 'vc-phone-note';
    how.innerHTML = '<b>VCの稼ぎ方</b><br>'
      + '・🏆実績を達成する（初回だけ報酬あり）<br>'
      + '・街に落ちているコインを拾う（歩いていると見つかります）<br>'
      + '・街を歩き回っていると数分おきに滞在ボーナス<br>'
      + '・フレンドになる（お互いに1回ずつ）<br>'
      + '・毎日1回のログインボーナス／イベント参加ボーナス';
    bodyEl.appendChild(how);

    // ⚠⚠ テスト用の即席チャージ。**モック期間だけ**のボタン（本番には持ち込まない）
    const testRow = document.createElement('div');
    testRow.style.cssText = 'margin-bottom:10px;';
    const testNote = document.createElement('p');
    testNote.className = 'vc-phone-note';
    testNote.textContent = '⚠ 下のボタンはテスト用（モック限定）。本番には無くなります。';
    testRow.appendChild(testNote);
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.textContent = `テスト用: ${TEST_TOPUP_AMOUNT.toLocaleString()} VC 追加`;
    testBtn.style.cssText = 'width:100%;padding:8px;font-size:12px;border-radius:8px;cursor:pointer;'
      + 'color:#eaf6ff;background:rgba(255,209,71,0.14);border:1px solid rgba(255,209,71,0.6);';
    testBtn.addEventListener('click', () => {
      claimTestTopup();
      paint();
    });
    testRow.appendChild(testBtn);
    bodyEl.appendChild(testRow);

    if (!w.log.length) return;
    for (const row of w.log.slice(0, 20)) {
      const r = document.createElement('div');
      r.className = 'vc-log-row';
      const d = new Date(row.t);
      r.innerHTML = `<span>${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}</span>`
        + `<span>${row.reason || ''}</span>`
        + `<span class="vc-log-amt ${row.amount > 0 ? 'vc-log-plus' : 'vc-log-minus'}">`
        + `${row.amount > 0 ? '+' : ''}${row.amount}</span>`;
      bodyEl.appendChild(r);
    }
  }

  function paint() {
    // ⚠ 借りている画面は innerHTML='' で消してはいけない（元に返せなくなる）。
    //   先に外へ逃がしてから中身を作り直す
    if (hosted && hosted.el.parentNode === bodyEl) bodyEl.removeChild(hosted.el);
    bodyEl.innerHTML = '';
    paintStatus();
    if (hosted && view === `host:${hosted.app.id}`) {
      header(hosted.app.name);
      hosted.el.classList.add('vc-in-phone');
      bodyEl.appendChild(hosted.el);
      return;
    }
    if (stopMap) {
      stopMap();
      stopMap = null;
    }
    if (stopCamera) {
      stopCamera();
      stopCamera = null;
    }
    syncMovable();
    if (view === 'bag') renderBag();
    else if (view === 'wallet') renderWallet();
    else if (view === 'map') {
      header('マップ');
      // ⚠ ナビ（行き先）は独立アプリ🧭を廃止し、マップの中に統合した
      //   （2026-08-08 loyさん「ナビはマップの中にあった方がいいね」）。
      //   選択肢の描画・距離計算は phoneextra.js の renderNavi をそのまま呼び直している
      //   （作り直すと距離計算の細かい挙動を写し損ねるため）
      stopMap = renderMap(bodyEl, {
        ...(opts.map || {}),
        naviCurrent: opts.getNavi ? opts.getNavi() : null,
        onNaviSet: (spot) => {
          if (opts.onNavi) opts.onNavi(spot);
          paint();
        },
      });
    } else if (view === 'sns') {
      header('SNS');
      renderSns(bodyEl, {
        posts,
        myId: opts.getMyId ? opts.getMyId() : '',
        denied,
        onPost: (txt) => {
          if (opts.onSnsPost) opts.onSnsPost(txt);
        },
        onLike: (pid) => {
          if (opts.onSnsLike) opts.onSnsLike(pid);
        },
      });
      denied = '';
    } else if (view === 'friends') {
      header('連絡帳');
      const fr = getFriends();
      renderFriends(bodyEl, {
        people: (opts.getPeople ? opts.getPeople() : []),
        friends: fr.friends,
        requests: fr.requests,
        onRequest: (person) => {
          if (opts.onFriendReq) opts.onFriendReq(person.id);
          payMsg = '';
          paint();
        },
        onAccept: (name) => {
          acceptRequest(name);
          // 相手にも「受けたよ」を伝える（いま会場に居れば届く）
          const person = (opts.getPeople ? opts.getPeople() : []).find((x) => x.name === name);
          if (person && opts.onFriendOk) opts.onFriendOk(person.id, person.name);
          paint();
        },
        onDecline: (name) => {
          declineRequest(name);
          paint();
        },
        onRemove: (name) => {
          removeFriend(name);
          paint();
        },
        onTalk: (name) => {
          const person = (opts.getPeople ? opts.getPeople() : []).find((x) => x.name === name);
          if (!person) return;
          dmWith = person.id;
          view = 'dm';
          paint();
        },
      });
    } else if (view === 'pay') {
      header('送金');
      const fr = getFriends();
      const targets = (opts.getPeople ? opts.getPeople() : []).filter((x) => fr.friends.includes(x.name));
      renderPay(bodyEl, {
        balance: getWallet().balance,
        targets,
        message: payMsg,
        onSend: (t, n) => {
          if (opts.onPay) opts.onPay(t, n);
          payMsg = '';
          paint();
        },
      });
      payMsg = '';
    } else if (view === 'dm') {
      header('メッセンジャー');
      // ⚠ 話せるのは**フレンドだけ**（loyさん「メッセージはフレンドのみがいいね」）。
      //   会場に居るだけの人へ送りつける道を作らない
      const people = (opts.getPeople ? opts.getPeople() : [])
        .filter((x) => x.id !== (opts.getMyId ? opts.getMyId() : ''))
        .filter((x) => isFriend(x.name));
      const active = dmWith ? people.find((x) => x.id === dmWith) || { id: dmWith, name: '相手' } : null;
      // 開いたら既読にする
      if (active && threads[active.id]) for (const m of threads[active.id]) m.read = true;
      renderMessenger(bodyEl, {
        people,
        threads,
        active,
        myId: opts.getMyId ? opts.getMyId() : '',
        onOpen: (id) => {
          dmWith = id;
          paint();
        },
        onBack: () => {
          dmWith = null;
          paint();
        },
        onSend: (to, txt) => {
          if (opts.onDm) opts.onDm(to, txt);
        },
      });
    } else if (view === 'album') {
      header('アルバム');
      renderAlbum(bodyEl, {
        onPost: (img) => {
          if (opts.onSnsPost) opts.onSnsPost('📷 アルバムから', img);
          view = 'sns';
          paint();
        },
        onDelete: (t) => {
          removePhoto(t);
          paint();
        },
      });
    } else if (view === 'ach') {
      header('実績');
      renderAchievements(bodyEl);
    } else if (view === 'rank') {
      header('ランキング');
      renderRanking(bodyEl, { posts, balance: getWallet().balance, loginStat: getLoginStat() });
    } else if (view === 'weather') {
      header('天気');
      renderWeather(bodyEl, {
        current: opts.getWeather ? opts.getWeather() : 'clear',
        onSet: (w) => {
          if (opts.onWeather) opts.onWeather(w);
          paint();
        },
      });
    } else if (view === 'house') {
      header('マイルーム');
      const h = getHouse();
      renderHouse(bodyEl, {
        rented: h.rented,
        rent: RENT,
        balance: getWallet().balance,
        placed: h.items.length,
        stock: placeableItems(getWallet().items),
        message: payMsg,
        onRent: () => {
          if (!opts.onRentRoom) return;
          const ok = opts.onRentRoom(RENT);
          payMsg = ok ? '' : 'ポイントが足りません';
          if (ok) rentRoom();
          paint();
        },
        onPlace: (item) => {
          // ⚠ 置く場所は**いま立っている場所**。部屋の外なら断る
          const where = opts.getRoomSpot ? opts.getRoomSpot() : null;
          if (!where) {
            payMsg = '部屋の中で押してください（街の西にあります）';
            paint();
            return;
          }
          placeItem(item.id, where.x, where.z, where.r);
          if (opts.onHouseChanged) opts.onHouseChanged();
          payMsg = `${item.name} を置きました`;
          paint();
        },
        onUndo: () => {
          removeLast();
          if (opts.onHouseChanged) opts.onHouseChanged();
          paint();
        },
        onClear: () => {
          clearItems();
          if (opts.onHouseChanged) opts.onHouseChanged();
          paint();
        },
      });
      payMsg = '';
    } else if (view === 'call') {
      header('ビデオ通話');
      const fr = getFriends();
      const friends = (opts.getPeople ? opts.getPeople() : []).filter((x) => fr.friends.includes(x.name));
      renderCall(bodyEl, {
        state: callState,
        friends,
        peer: callPeer,
        // 通話中は相手のアバターを映す小さな画面を差し込む
        view: callState === 'live' && opts.callView ? opts.callView() : null,
        onCall: (f) => {
          callPeer = f;
          callState = 'ring';
          if (opts.onCall) opts.onCall('call', f.id);
          paint();
        },
        onAccept: () => {
          if (!callPeer) return;
          callState = 'live';
          if (opts.onCall) opts.onCall('accept', callPeer.id);
          if (opts.onCallLive) opts.onCallLive(callPeer.id);
          paint();
        },
        onEnd: () => {
          if (callPeer && opts.onCall) opts.onCall('end', callPeer.id);
          if (opts.onCallLive) opts.onCallLive(null);
          callState = 'idle';
          callPeer = null;
          paint();
        },
      });
    } else if (view === 'camera') {
      header('カメラ');
      stopCamera = renderCamera(bodyEl, {
        shoot: () => {
          const img = opts.shoot ? opts.shoot() : '';
          if (img) {
            // 撮ったらアルバムに残す（縮めてから入れる）
            if (opts.shrinkForAlbum) opts.shrinkForAlbum(img).then((small) => addPhoto(small || img));
            else addPhoto(img);
            if (unlock('first_photo') && opts.onAchievement) opts.onAchievement('カメラマン');
          }
          return img;
        },
        onPostPhoto: (img) => {
          if (opts.onSnsPost) opts.onSnsPost('📷 撮ったよ', img);
          view = 'sns';
          paint();
        },
      });
    } else renderHome();
  }

  /**
   * 歩けるかを決めて外へ伝える。
   * ⚠ 2026-08-08 loyさん「スマホは出しっぱなしでも歩けた方がいいかも。」
   *   → 開いていても常に歩ける。**文字入力中（input/textareaにフォーカス）だけ止める**
   *   （WASDが打てなくなるため）。カメラは元から歩けたので、いまは全画面が同じ扱いになった
   */
  function syncMovable() {
    const canWalk = !typing;
    phone.classList.toggle('vc-phone-cam', open && view === 'camera');
    if (opts.onOpenChange) opts.onOpenChange(!canWalk);
  }

  // input/textarea にフォーカスが入っている間だけ歩行を止める。
  // ⚠ focusout は「別の入力欄へ移った」直後にも一瞬発生するので、次のフォーカス先を
  //   確かめてから判定する（setTimeoutで1tick待つ）
  phone.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      typing = true;
      syncMovable();
    }
  });
  phone.addEventListener('focusout', () => {
    setTimeout(() => {
      const wasTyping = typing;
      const el = document.activeElement;
      typing = Boolean(
        el && phone.contains(el)
        && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable),
      );
      syncMovable();
      // 入力を終えた瞬間に描き直す。入力中は setPosts/addDm 側で描画を止めているので、
      // その間に届いていた更新（他人の投稿・メッセージ）をここで反映する
      if (wasTyping && !typing && open && (view === 'sns' || view === 'dm')) paint();
    }, 0);
  });

  function setOpen(next) {
    if (!next) {
      releaseHosted(); // 閉じる前に借りている画面を返す
      typing = false; // 閉じたら入力中フラグも必ず戻す（入れっぱなしで歩けなくなるのを防ぐ）
      // ⚠ マップは0.5秒ごとに描き直している。閉じたまま回り続けないよう止める
      if (stopMap) {
        stopMap();
        stopMap = null;
      }
      if (stopCamera) {
        stopCamera();
        stopCamera = null;
      }
    }
    open = next;
    phone.style.display = open ? 'flex' : 'none';
    if (open) {
      view = 'home';
      paint();
    }
    syncMovable();
  }

  phone.querySelector('#vc-phone-home').addEventListener('click', () => {
    releaseHosted();
    view = 'home';
    paint();
  });
  btn.addEventListener('click', () => setOpen(!open));
  phone.querySelector('#vc-phone-x').addEventListener('click', () => setOpen(false));

  // Tabキーでも開け閉めできる（ゲームでよくある持ち物のキー）。
  // ⚠ ブラウザの既定（次の入力欄へ移動）を止める
  window.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      setOpen(!open);
    } else if (e.key === 'Escape' && open) {
      setOpen(false);
    }
  });

  updateOuterBadge(); // 初期表示（既に届いている申請等があれば最初から出す）

  return {
    isOpen: () => open,
    /**
     * SNSの一覧が届いた。
     * ⚠ **文字入力中は再描画しない**（2026-08-08・ブラウザでの実機検証で発覚した不具合）。
     *   paint() は bodyEl.innerHTML='' で中身を作り直すため、他人の投稿が届くたびに
     *   自分が書きかけの入力欄が消え、フォーカスも外れて「歩けない」が解除されてしまう
     *   （文字入力中だけ歩行を止める仕組みが、外からの通信で無効化される）。
     *   入力し終えて欄を離れれば、次の描き直しで普通に反映される
     */
    setPosts(list) {
      posts = Array.isArray(list) ? list : [];
      if (open && view === 'sns' && !typing) paint();
    },
    /** 新しい投稿が1件届いた */
    addPost(post) {
      if (!post) return;
      posts.unshift(post);
      posts = posts.slice(0, 50);
      if (open && view === 'sns' && !typing) paint();
    },
    /** いいねの数が変わった */
    updateLikes(pid, count) {
      const p = posts.find((x) => x.pid === pid);
      if (!p) return;
      // 数だけ届くので、自分が押したかどうかは配列の長さで持ち直す
      p.likes = new Array(count).fill('?');
      if (open && view === 'sns' && !typing) paint();
    },
    /** 断られた理由（投稿できない等） */
    setDenied(why) {
      denied = why || '';
      if (open && view === 'sns' && !typing) paint();
    },
    /** 1対1のメッセージが届いた／送った。⚠ 理由は setPosts と同じ（文字入力中は描き直さない） */
    addDm(msg) {
      const other = msg.mine ? msg.to : msg.from;
      if (!threads[other]) threads[other] = [];
      threads[other].push({ txt: msg.txt, mine: Boolean(msg.mine), at: msg.at, read: Boolean(msg.mine) });
      if (open && view === 'dm' && !typing) paint();
      updateOuterBadge();
      return other;
    },
    /**
     * 通話の合図が届いた。
     * ring=呼ばれた / accept=相手が出た / end=切れた
     */
    onCallSignal({ kind, id, name }) {
      // ⚠ 通話中に別の人から呼ばれても**乗っ取らせない**（2026-08-08 レビュー指摘）。
      //   相手を差し替えると、いま話している相手を切る手段が画面から消える
      if (kind === 'ring' && (callState === 'live' || callState === 'ring')) {
        if (opts.onCallBusy) opts.onCallBusy(name);
        return;
      }
      // 自分の通話相手以外からの accept / end は無視する（取り違え防止）
      if (kind !== 'ring' && callPeer && id && callPeer.id !== id) return;
      if (kind === 'ring') {
        callPeer = { id, name };
        callState = 'incoming';
        setOpen(true);
        view = 'call';
        paint();
        updateOuterBadge();
        return;
      }
      if (kind === 'accept') {
        callState = 'live';
        if (opts.onCallLive) opts.onCallLive(id);
        if (open && view === 'call') paint();
        updateOuterBadge();
        return;
      }
      // end
      callState = 'idle';
      callPeer = null;
      if (opts.onCallLive) opts.onCallLive(null);
      if (open && view === 'call') paint();
      updateOuterBadge();
    },
    /** 実績を解除する（外の出来事から呼ぶ）。初回だけVCの報酬が付く（2026-08-08） */
    unlockAchievement(id, label) {
      if (!unlock(id)) return;
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (def && def.reward) grantAchievementReward(def.reward, label);
      if (opts.onAchievement) opts.onAchievement(label, def ? def.reward : 0);
    },
    /** 送金の結果を出す */
    setPayMessage(text) {
      payMsg = text || '';
      if (open && view === 'pay') paint();
    },
    /** 連絡帳を開く（申請が来たときの案内から飛べるように） */
    openFriends() {
      setOpen(true);
      view = 'friends';
      paint();
    },
    /** 未読の合計（バッジ用） */
    unreadCount: unreadDmCount,
    setOpen,
    /** 持ち物をすぐ開く（他から呼べるように） */
    openBag() {
      setOpen(true);
      view = 'bag';
      paint();
    },
    /** ウォレットをすぐ開く（送金の通知トーストから飛べるように・2026-08-08） */
    openWallet() {
      setOpen(true);
      view = 'wallet';
      paint();
    },
    /** 指定の相手とのメッセージ画面をすぐ開く（通知トーストから飛べるように・2026-08-08） */
    openDm(id) {
      setOpen(true);
      dmWith = id;
      view = 'dm';
      paint();
    },
    /** 通話画面をすぐ開く（着信の通知トーストから飛べるように・2026-08-08） */
    openCall() {
      setOpen(true);
      view = 'call';
      paint();
    },
    setVisible(on) {
      btn.style.display = on ? '' : 'none';
      if (!on) setOpen(false);
    },
  };
}
