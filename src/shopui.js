import { CATEGORIES, CATALOG, itemById, GACHA, gachaOdds, drawGacha } from './catalog.js';
import { getWallet, onWalletChange, spend, grant, addItem } from './wallet.js';
import { toggleAccessory, parseAccessories } from './accessory.js';

// ============================================================
// お店・持ち物・ガチャ・カジノ の画面 — **モック**（2026-08-07）
//
// loyさん「まずはこの構想のモックを作って。ポイント管理はあとでもいい」。
// VRChat側の VERSE CITY 構想（VERSE COINでカジノ・ガチャ・バー・将来はハウジング）を
// ブラウザでも触れる形にして、**遊びの流れが成立するか**を先に見るためのもの。
//
// ⚠⚠ **残高も当たり外れも、いまはこのブラウザの中だけで決めています。**
//   本番では台帳もスロットの目も**サーバーが決めます**（docs/SPEC_POINTS.md）。
//   ここで作った画面はそのまま使い、呼び先を差し替える前提で書いてあります。
// ============================================================

const STYLE_ID = 'vc-shop-style';
const COIN = 'VC'; // 画面に出す通貨の単位（VERSE COIN の仮表記）

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-shop-panel {
  position: fixed;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(680px, calc(100vw - 32px));
  max-height: min(78vh, 640px);
  display: flex; flex-direction: column;
  padding: 0;
  border-radius: 16px;
  background: linear-gradient(160deg, rgba(12,12,28,0.98), rgba(18,8,30,0.98));
  border: 1px solid rgba(0,255,234,0.4);
  box-shadow: 0 0 40px rgba(0,255,234,0.18), 0 0 90px rgba(255,0,229,0.1);
  color: #eaf6ff;
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif;
  z-index: 60;
}
.vc-shop-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.12);
}
.vc-shop-title { font-size: 15px; letter-spacing: 2px; font-weight: 700; }
.vc-shop-mock {
  font-size: 9px; letter-spacing: 1px; padding: 2px 7px; border-radius: 8px;
  color: #ffe9a8; background: rgba(255,209,71,0.16); border: 1px solid rgba(255,209,71,0.5);
}
.vc-shop-balance { margin-left: auto; font-size: 14px; font-weight: 700; color: #ffd86b; }
.vc-shop-close {
  width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.06); color: #eaf6ff;
}
.vc-shop-tabs { display: flex; gap: 6px; padding: 10px 16px 0; }
.vc-shop-tab {
  flex: 1 1 0; padding: 8px 4px; font-size: 13px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #eaf6ff;
}
.vc-shop-tab.on {
  background: linear-gradient(90deg, rgba(0,255,234,0.25), rgba(255,0,229,0.2));
  border-color: #00ffea;
}
.vc-shop-body { padding: 12px 16px 16px; overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0; }
.vc-shop-note { font-size: 11px; line-height: 1.6; color: rgba(220,235,255,0.55); margin: 0 0 10px; }
.vc-shop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.vc-shop-card {
  padding: 10px; border-radius: 12px; text-align: center;
  border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.04);
}
.vc-shop-ico { font-size: 26px; line-height: 1.2; }
.vc-shop-name { font-size: 12px; margin: 4px 0 2px; }
.vc-shop-price { font-size: 12px; color: #ffd86b; margin-bottom: 8px; }
.vc-shop-buy {
  width: 100%; padding: 6px; font-size: 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(0,255,234,0.5); background: rgba(0,255,234,0.12); color: #eaf6ff;
}
.vc-shop-buy:disabled { opacity: 0.45; cursor: default; }
.vc-shop-owned { font-size: 11px; color: rgba(150,255,220,0.9); }
.vc-shop-cat { font-size: 11px; letter-spacing: 1px; color: rgba(0,255,234,0.8); margin: 14px 0 6px; }
.vc-shop-cat:first-child { margin-top: 0; }
.vc-shop-msg { min-height: 20px; font-size: 12px; color: #9be34a; margin-top: 10px; }
.vc-slot {
  display: flex; gap: 10px; justify-content: center; margin: 6px 0 12px;
}
.vc-slot-reel {
  width: 76px; height: 92px; border-radius: 12px; font-size: 40px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.35);
}
.vc-big-btn {
  display: block; width: 100%; padding: 12px; font-size: 14px; font-weight: 700;
  border-radius: 12px; cursor: pointer; border: none; color: #06121a;
  background: linear-gradient(90deg, #00ffea, #ff00e5);
}
.vc-big-btn:disabled { opacity: 0.5; cursor: default; }
.vc-odds { font-size: 11px; color: rgba(220,235,255,0.6); line-height: 1.8; }
.vc-shop-back {
  position: fixed; inset: 0; z-index: 59;
  background: rgba(3,4,10,0.55); backdrop-filter: blur(3px);
}
@media (max-width: 640px) {
  .vc-shop-panel { width: calc(100vw - 20px); max-height: 82vh; }
  .vc-shop-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
}
`;
  document.head.appendChild(style);
}

let openPanel = null;

/** いま開いているお店の画面を閉じる */
export function closeShop() {
  if (!openPanel) return;
  openPanel.remove();
  openPanel = null;
  const back = document.getElementById('vc-shop-back');
  if (back) back.remove();
  // 前に出していた「自分の姿」を元の重なり順に戻す
  const selfView = document.querySelector('.vc-selfview');
  if (selfView) selfView.style.zIndex = '';
}

export function isShopOpen() {
  return Boolean(openPanel);
}

/**
 * お店／カジノの画面を開く。
 * @param {'shop'|'casino'} kind どの建物に入ったか
 * @param {{ getConfig:()=>object, onWear:(cfg:object)=>void }} hooks
 *   買った飾りをその場で着けるために、いまの見た目と反映先をもらう
 */
export function openShop(kind, hooks = {}) {
  // どのタブから開くか（店の中の台ごとに違う。2026-08-08）
  const startTab = hooks.tab || null;
  injectStyle();
  closeShop();

  const back = document.createElement('div');
  back.id = 'vc-shop-back';
  back.className = 'vc-shop-back';
  back.addEventListener('click', closeShop);
  document.body.appendChild(back);

  // ⚠ 「自分の姿」の小窓を暗幕より前に出す（2026-08-07・レビューで発覚）。
  //   買ったものを着けても**暗幕の裏に隠れて変化が見えなかった**。
  //   ここが見えないと「買う → 着る」の手応えが無くなる
  const selfView = document.querySelector('.vc-selfview');
  if (selfView) selfView.style.zIndex = '61';

  const panel = document.createElement('div');
  panel.className = 'vc-shop-panel';
  panel.innerHTML = `
    <div class="vc-shop-head">
      <div class="vc-shop-title">${kind === 'casino' ? 'VERSE CASINO' : 'VERSE SHOP'}</div>
      <div class="vc-shop-mock">モック</div>
      <div class="vc-shop-balance" id="vc-balance"></div>
      <button type="button" class="vc-shop-close" id="vc-shop-close">✕</button>
    </div>
    <div class="vc-shop-tabs" id="vc-shop-tabs"></div>
    <div class="vc-shop-body" id="vc-shop-body"></div>
  `;
  document.body.appendChild(panel);
  openPanel = panel;

  panel.querySelector('#vc-shop-close').addEventListener('click', closeShop);

  const balanceEl = panel.querySelector('#vc-balance');
  const bodyEl = panel.querySelector('#vc-shop-body');
  const tabsEl = panel.querySelector('#vc-shop-tabs');

  const paintBalance = () => {
    balanceEl.textContent = `${getWallet().balance.toLocaleString()} ${COIN}`;
  };
  const off = onWalletChange(paintBalance);
  paintBalance();

  const TABS = kind === 'casino'
    ? [['slot', 'スロット'], ['bar', 'バー'], ['gacha', 'ガチャ'], ['bag', '持ち物']]
    : [['shop', 'お店'], ['gacha', 'ガチャ'], ['bag', '持ち物']];

  let current = TABS.some(([id]) => id === startTab) ? startTab : TABS[0][0];

  function paintTabs() {
    tabsEl.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vc-shop-tab' + (id === current ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        current = id;
        paintTabs();
        paintBody();
      });
      tabsEl.appendChild(b);
    }
  }

  // ⚠ 画面を作り直すと出したばかりの一言が消える（買った直後・飲んだ直後）。
  //   作り直しをまたいで1回だけ出せるように、ここに置いておく
  let flash = '';
  /**
   * しばらく画面をどける（アバターの動きを見せるため）。
   * ⚠ 消すのではなく**隠すだけ**。消すと開き直す操作が要る
   */
  function peek(ms) {
    if (!openPanel) return;
    const el = openPanel;
    const bk = document.getElementById('vc-shop-back');
    el.style.visibility = 'hidden';
    if (bk) bk.style.visibility = 'hidden';
    setTimeout(() => {
      el.style.visibility = '';
      if (bk) bk.style.visibility = '';
    }, ms);
  }

  function msgBox() {
    const m = document.createElement('div');
    m.className = 'vc-shop-msg';
    m.textContent = flash;
    flash = '';
    return m;
  }

  // ---- お店 ----
  function renderShop() {
    const wallet = getWallet();
    const note = document.createElement('p');
    note.className = 'vc-shop-note';
    note.textContent = 'アバターの飾りは買うとすぐ着けられます。バーと家具は持ち物に入りますが、'
      + 'ブラウザにはまだ置く場所がありません（VRChat側と同じ番号で持っています）。';
    bodyEl.appendChild(note);
    const msg = msgBox();

    for (const cat of CATEGORIES) {
      const items = CATALOG.filter((it) => it.cat === cat.id);
      if (!items.length) continue;
      const h = document.createElement('div');
      h.className = 'vc-shop-cat';
      h.textContent = cat.label;
      bodyEl.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'vc-shop-grid';
      for (const it of items) {
        const owned = (wallet.items[it.id] || 0) > 0;
        const card = document.createElement('div');
        card.className = 'vc-shop-card';
        card.innerHTML = `
          <div class="vc-shop-ico">${it.icon}</div>
          <div class="vc-shop-name">${it.name}</div>
          <div class="vc-shop-price">${it.price} ${COIN}</div>
        `;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vc-shop-buy';
        if (owned && it.kind === 'wear') {
          btn.textContent = '着ける';
          btn.addEventListener('click', () => {
            wear(it);
            msg.textContent = `${it.name} を着けました`;
          });
        } else {
          btn.textContent = owned ? `買う（${wallet.items[it.id]}個）` : '買う';
          btn.disabled = getWallet().balance < it.price;
          btn.addEventListener('click', () => {
            if (!spend(it.price, `買い物: ${it.name}`)) {
              msg.textContent = `ポイントが足りません（${it.price} ${COIN} 必要）`;
              return;
            }
            addItem(it.id, 1);
            flash = `${it.name} を買いました`;
            paintBody();
          });
        }
        card.appendChild(btn);
        grid.appendChild(card);
      }
      bodyEl.appendChild(grid);
    }
    bodyEl.appendChild(msg);
  }

  /** 買った飾りをその場で着ける（アバターの見た目に反映） */
  function wear(it) {
    if (!hooks.getConfig || !hooks.onWear || !it.accessory) return;
    const cfg = { ...hooks.getConfig() };
    cfg.accessory = toggleAccessory(cfg.accessory, it.accessory);
    hooks.onWear(cfg);
  }

  // ---- 持ち物 ----
  function renderBag() {
    const wallet = getWallet();
    const ids = Object.keys(wallet.items).filter((id) => wallet.items[id] > 0);
    const note = document.createElement('p');
    note.className = 'vc-shop-note';
    note.textContent = ids.length
      ? '「着ける」を押すと、その場で見た目に反映されます（もう一度押すと外れます）。'
      : (kind === 'casino'
        ? 'まだ何も持っていません。ガチャで手に入ります。'
        : 'まだ何も持っていません。お店かガチャで手に入ります。');
    bodyEl.appendChild(note);
    if (!ids.length) return;

    const msg = msgBox();
    const grid = document.createElement('div');
    grid.className = 'vc-shop-grid';
    const worn = hooks.getConfig ? parseAccessories(hooks.getConfig().accessory) : [];
    for (const id of ids) {
      const it = itemById(id);
      if (!it) continue;
      const card = document.createElement('div');
      card.className = 'vc-shop-card';
      const on = it.accessory && worn.includes(it.accessory);
      card.innerHTML = `
        <div class="vc-shop-ico">${it.icon}</div>
        <div class="vc-shop-name">${it.name}</div>
        <div class="vc-shop-owned">${wallet.items[id]}個${on ? '・着用中' : ''}</div>
      `;
      if (it.kind === 'wear') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vc-shop-buy';
        btn.style.marginTop = '8px';
        btn.textContent = on ? '外す' : '着ける';
        btn.addEventListener('click', () => {
          wear(it);
          flash = on ? `${it.name} を外しました` : `${it.name} を着けました`;
          paintBody();
        });
        card.appendChild(btn);
      }
      grid.appendChild(card);
    }
    bodyEl.appendChild(grid);
    bodyEl.appendChild(msg);
  }

  // ---- ガチャ ----
  function renderGacha() {
    const note = document.createElement('p');
    note.className = 'vc-shop-note';
    note.textContent = `1回 ${GACHA.price} ${COIN}。出るものと確率は下のとおりです。`;
    bodyEl.appendChild(note);

    const result = document.createElement('div');
    result.className = 'vc-shop-card';
    result.style.margin = '0 auto 12px';
    result.style.maxWidth = '200px';
    result.innerHTML = '<div class="vc-shop-ico">🎁</div><div class="vc-shop-name">回してみよう</div>';
    bodyEl.appendChild(result);

    const msg = msgBox();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vc-big-btn';
    btn.textContent = `回す（${GACHA.price} ${COIN}）`;
    btn.disabled = getWallet().balance < GACHA.price;
    btn.addEventListener('click', () => {
      // ⚠ 足りないときに**黙って何もしない**と「壊れている」と思われる（レビューで指摘）
      if (hooks.onAchievement) hooks.onAchievement('first_gacha', '運試し');
      if (!spend(GACHA.price, 'ガチャ')) {
        msg.textContent = 'ポイントが足りません';
        return;
      }
      msg.textContent = '';
      const it = drawGacha();
      addItem(it.id, 1);
      result.innerHTML = `<div class="vc-shop-ico">${it.icon}</div>`
        + `<div class="vc-shop-name">${it.name}</div>`
        + '<div class="vc-shop-owned">手に入れました</div>';
      btn.disabled = getWallet().balance < GACHA.price;
    });
    bodyEl.appendChild(btn);
    bodyEl.appendChild(msg);

    const odds = document.createElement('div');
    odds.className = 'vc-odds';
    odds.style.marginTop = '12px';
    odds.innerHTML = '<div class="vc-shop-cat">出るものと確率</div>'
      + gachaOdds().map((o) => `${o.item.icon} ${o.item.name} … ${o.percent}%`).join('<br>');
    bodyEl.appendChild(odds);
  }

  // ---- スロット ----
  const SLOT_FACES = ['🍒', '🔔', '⭐', '🍋', '7️⃣'];
  const SLOT_BET = 50;

  function renderSlot() {
    const note = document.createElement('p');
    note.className = 'vc-shop-note';
    note.textContent = `1回 ${SLOT_BET} ${COIN}。3つ揃いで20倍、**隣り合った2つ**揃いで2倍。`
      + '⚠ いまは当たり外れをこのブラウザで決めています（本番はサーバーが決めます）。';
    bodyEl.appendChild(note);

    const reels = document.createElement('div');
    reels.className = 'vc-slot';
    const cells = [0, 1, 2].map(() => {
      const c = document.createElement('div');
      c.className = 'vc-slot-reel';
      c.textContent = '❓';
      reels.appendChild(c);
      return c;
    });
    bodyEl.appendChild(reels);

    const msg = msgBox();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vc-big-btn';
    btn.textContent = `回す（${SLOT_BET} ${COIN}）`;
    btn.disabled = getWallet().balance < SLOT_BET;

    let spinning = false;
    btn.addEventListener('click', () => {
      if (spinning) return;
      if (hooks.onAchievement) hooks.onAchievement('first_slot', 'ギャンブラー');
      if (!spend(SLOT_BET, 'スロット')) {
        msg.textContent = 'ポイントが足りません';
        return;
      }
      spinning = true;
      btn.disabled = true;
      msg.textContent = '';
      const face = () => SLOT_FACES[Math.floor(Math.random() * SLOT_FACES.length)];
      const final = [face(), face(), face()];
      // 回っているように見せる。止まるのは左から順
      let ticks = 0;
      const timer = setInterval(() => {
        ticks++;
        for (let i = 0; i < 3; i++) {
          if (ticks > 6 + i * 5) cells[i].textContent = final[i];
          else cells[i].textContent = face();
        }
        if (ticks > 6 + 2 * 5) {
          clearInterval(timer);
          spinning = false;
          const [a, b, c] = final;
          let win = 0;
          // ⚠ **隣り合った2つ**だけを当たりにする。左と右（a===c）も当たりにしていたら、
          //   「何も揃って見えないのに当たった」と受け取られた（2026-08-07 レビューで指摘）
          if (a === b && b === c) win = SLOT_BET * 20;
          else if (a === b || b === c) win = SLOT_BET * 2;
          if (win) {
            grant(win, 'スロットの当たり');
            msg.textContent = `${win} ${COIN} の当たり！`;
          } else {
            msg.textContent = 'はずれ';
          }
          btn.disabled = getWallet().balance < SLOT_BET;
        }
      }, 70);
    });
    bodyEl.appendChild(btn);
    bodyEl.appendChild(msg);
  }

  /**
   * バー（2026-08-08・loyさん「飲む動作まで作る」）。
   * 買うとその場で飲める。**飲むと1つ減る**（消えもの）。
   * ★ 3Dは作っていない。既存の「乾杯」エモート（ビールジョッキが出る）を再生している
   */
  function renderBar() {
    const wallet = getWallet();
    const note = document.createElement('p');
    note.className = 'vc-shop-note';
    note.textContent = '買うと持ち物に入ります。「飲む」を押すと1つ減って、乾杯の動作をします'
      + '（まわりの人にも見えます）。';
    bodyEl.appendChild(note);

    const msg = msgBox();
    const grid = document.createElement('div');
    grid.className = 'vc-shop-grid';
    for (const it of CATALOG.filter((x) => x.cat === 'drink')) {
      const have = wallet.items[it.id] || 0;
      const card = document.createElement('div');
      card.className = 'vc-shop-card';
      card.innerHTML = `
        <div class="vc-shop-ico">${it.icon}</div>
        <div class="vc-shop-name">${it.name}</div>
        <div class="vc-shop-price">${it.price} ${COIN}</div>
        <div class="vc-shop-owned">${have}個</div>
      `;
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'vc-shop-buy';
      buy.style.marginTop = '6px';
      buy.textContent = '買う';
      buy.disabled = wallet.balance < it.price;
      buy.addEventListener('click', () => {
        if (!spend(it.price, `バー: ${it.name}`)) {
          msg.textContent = `ポイントが足りません（${it.price} ${COIN} 必要）`;
          return;
        }
        addItem(it.id, 1);
        flash = `${it.name} を買いました`;
        paintBody();
      });
      card.appendChild(buy);

      const drink = document.createElement('button');
      drink.type = 'button';
      drink.className = 'vc-shop-buy';
      drink.style.marginTop = '6px';
      drink.textContent = '飲む';
      drink.disabled = have <= 0;
      drink.addEventListener('click', () => {
        if ((getWallet().items[it.id] || 0) <= 0) return;
        addItem(it.id, -1); // 飲んだら減る
        if (hooks.onDrink) hooks.onDrink(it);
        // 空腹の回復（2026-08-08）。飲み物は軽め
        flash = `${it.name} を飲みました`;
        paintBody();
        // ⚠ 画面が出たままだと**飲む動作が見えない**（2026-08-08 loyさん指摘）。
        //   乾杯のエモートの間だけ画面をどける
        peek(2400);
      });
      card.appendChild(drink);
      grid.appendChild(card);
    }
    bodyEl.appendChild(grid);
    bodyEl.appendChild(msg);
  }

  function paintBody() {
    bodyEl.innerHTML = '';
    if (current === 'shop') renderShop();
    else if (current === 'bar') renderBar();
    else if (current === 'bag') renderBag();
    else if (current === 'gacha') renderGacha();
    else if (current === 'slot') renderSlot();
  }

  paintTabs();
  paintBody();

  // Escで閉じる（移動キーを奪ったままにしない）
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeShop();
      window.removeEventListener('keydown', onKey);
      off();
    }
  };
  window.addEventListener('keydown', onKey);
}
