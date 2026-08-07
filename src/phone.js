import { getWallet, onWalletChange } from './wallet.js';
import { itemById } from './catalog.js';
import { parseAccessories, toggleAccessory } from './accessory.js';

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

/* 筐体（loyさん「スマホの筐体作る」） */
.vc-phone {
  position: fixed; right: 24px; bottom: 96px; z-index: 62;
  width: 320px; height: 620px;
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
.vc-phone-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 14px 14px; }
.vc-phone-apps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 10px; padding-top: 6px; }
.vc-app {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  background: none; border: none; color: #eaf6ff; cursor: pointer; padding: 0;
}
.vc-app-ico {
  width: 54px; height: 54px; border-radius: 15px; font-size: 25px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, rgba(0,255,234,0.22), rgba(255,0,229,0.18));
  border: 1px solid rgba(255,255,255,0.18);
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
.vc-log-minus { color: #ff9aa2; }

@media (max-width: 640px) {
  .vc-phone { right: 10px; left: 10px; width: auto; bottom: 84px; height: auto; max-height: 72vh; }
  .vc-phone-btn { right: 10px; bottom: 168px; }
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
  btn.textContent = '📱';
  btn.title = 'スマホ（設定・持ち物・アプリ）';
  document.body.appendChild(btn);

  const phone = document.createElement('div');
  phone.className = 'vc-phone';
  phone.style.display = 'none';
  phone.innerHTML = `
    <div class="vc-phone-screen">
      <div class="vc-phone-notch"></div>
      <div class="vc-phone-status">
        <span id="vc-phone-clock"></span>
        <span class="vc-phone-coin" id="vc-phone-coin"></span>
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

  const paintStatus = () => {
    coinEl.textContent = `${getWallet().balance.toLocaleString()} VC`;
    const d = new Date();
    clockEl.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  onWalletChange(paintStatus);

  // ---- ホーム ----
  function renderHome() {
    const grid = document.createElement('div');
    grid.className = 'vc-phone-apps';
    for (const app of opts.apps || []) {
      if (app.show && !app.show()) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vc-app';
      b.innerHTML = `<div class="vc-app-ico">${app.icon}</div><div class="vc-app-name">${app.name}</div>`;
      b.addEventListener('click', () => {
        if (app.inside) {
          view = app.id;
          paint();
          return;
        }
        // 外の画面を開くアプリ。スマホは閉じる（画面が重ならないように）
        setOpen(false);
        app.run();
      });
      grid.appendChild(b);
    }
    bodyEl.appendChild(grid);
  }

  function header(title) {
    const h = document.createElement('div');
    h.className = 'vc-phone-title';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'vc-phone-back';
    back.textContent = '← ホーム';
    back.addEventListener('click', () => {
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
    note.textContent = '「着ける」を押すとその場で見た目に反映されます。';
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
    bodyEl.innerHTML = '';
    paintStatus();
    if (view === 'bag') renderBag();
    else if (view === 'wallet') renderWallet();
    else renderHome();
  }

  function setOpen(next) {
    open = next;
    phone.style.display = open ? 'flex' : 'none';
    if (open) {
      view = 'home';
      paint();
    }
    if (opts.onOpenChange) opts.onOpenChange(open);
  }

  phone.querySelector('#vc-phone-home').addEventListener('click', () => {
    view = 'home';
    paint();
  });
  btn.addEventListener('click', () => setOpen(!open));

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

  return {
    isOpen: () => open,
    setOpen,
    /** 持ち物をすぐ開く（他から呼べるように） */
    openBag() {
      setOpen(true);
      view = 'bag';
      paint();
    },
    setVisible(on) {
      btn.style.display = on ? '' : 'none';
      if (!on) setOpen(false);
    },
  };
}
