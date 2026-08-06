// ============================================================
// ⚙ 設定パネル（2026-08-03追加）
//
// loyさんの指示:
//   > ヘルプに「表示設定」が入ってるのおかしくない？
//   > それなら「設定」ボタンは別にした方がいい。
//   > その中に「表示設定」「参加者」「NPC設定」はあっていいかも。
//
// 考え方:
//   ヘルプ＝**読むところ**（使い方）／設定＝**変えるところ**。
//   この2つが混ざっていると、探すときにどちらを開けばいいか分からない。
//
// 中身は3つとも「自分の画面まわり」に関わるもの:
//   表示設定 … 吹き出しの時間・ウィンドウの扱い（自分だけに効く）
//   参加者   … 誰がいるか。ブロック・キック・BANの入口
//   NPC設定  … 賑やかしを何体出すか（自分の画面だけ）
//
// ⚠ 中身は既存のモジュールに描かせる（people.js / roomui.js）。
//   ここで作り直すと、👥パネルや🚪パネルと挙動がズレる。
// ============================================================

import { renderDisplaySettings } from './displaysettings.js';

const STYLE_ID = 'vc-settings-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-set-panel {
  position: fixed;
  right: 16px; top: 74px;
  width: min(380px, calc(100vw - 32px));
  max-height: calc(100vh - 190px); overflow-y: auto;
  padding: 14px 16px 16px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(12,12,28,0.96), rgba(18,8,30,0.96));
  border: 1px solid rgba(0,255,234,0.35);
  box-shadow: 0 0 30px rgba(0,0,0,0.5);
  color: #eaf6ff;
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  font-size: 13px;
  z-index: 40;
}
.vc-set-hidden { display: none; }

.vc-set-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.vc-set-title { font-size: 12px; letter-spacing: 2px; color: rgba(0,255,234,0.85); }
.vc-set-x {
  border: none; background: none; color: rgba(220,235,255,0.6);
  font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px;
}
.vc-set-x:hover { color: #fff; }

.vc-set-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.vc-set-tab {
  padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05);
  color: rgba(234,246,255,0.7);
}
.vc-set-tab:hover { border-color: rgba(0,255,234,0.5); }
.vc-set-tab.active {
  background: rgba(0,255,234,0.15); color: #7cffdc; border-color: rgba(0,255,234,0.6);
}

/* スマホでは、開くボタンが入っている段より上に出す（他のパネルと同じ積み方） */
@media (max-width: 640px) {
  .vc-set-panel {
    right: 12px; left: 12px; width: auto;
    top: auto;
    bottom: var(--m-panel2-bottom);
    max-height: calc(100vh - var(--m-panel2-bottom) - 145px);
  }
}
`;
  document.head.appendChild(style);
}

/**
 * @param {Object} p
 * @param {HTMLElement} p.slot ⚙ボタンを置く場所（右上バー）
 * @param {{renderInto:(el:HTMLElement)=>void, detach:()=>void}} p.people 参加者の描画を持つモジュール
 * @param {{renderNpcInto:(el:HTMLElement)=>void}} p.rooms NPC調整の描画を持つモジュール
 */
export function initSettingsUI({
  slot,
  people,
  rooms,
  admin,
  getRole,
  onEmotePrefsChange,
  onChatEmoteChange,
  onSelfViewChange,
  onReflectionChange,
  onBloomChange,
  onFpsMeterChange,
  onLowPowerChange,
}) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-set-btn';
  btn.title = '設定';
  btn.textContent = '⚙';
  slot.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'vc-set-panel vc-set-hidden';
  document.body.appendChild(panel);

  let open = false;
  let activeTab = 'display';

  function closePanel() {
    open = false;
    panel.classList.add('vc-set-hidden');
    btn.classList.remove('is-on');
    // 参加者一覧の描き先を自前のパネルへ戻す。
    // 戻さないと、閉じた後の更新が見えない場所へ描かれ続ける
    if (people && people.detach) people.detach();
  }

  function openPanel() {
    open = true;
    panel.classList.remove('vc-set-hidden');
    btn.classList.add('is-on');
    render();
  }

  btn.addEventListener('click', () => (open ? closePanel() : openPanel()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closePanel();
  });

  function render() {
    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'vc-set-head';
    const title = document.createElement('div');
    title.className = 'vc-set-title';
    title.textContent = '設定';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'vc-set-x';
    x.textContent = '×';
    x.title = '閉じる';
    x.addEventListener('click', closePanel);
    head.append(title, x);
    panel.appendChild(head);

    const tabs = document.createElement('div');
    tabs.className = 'vc-set-tabs';
    // 「管理」は運営（管理者・VIP）にだけ出す。
    // 一般の人に見えても押せないだけで混乱するので、タブごと出さない
    const role = getRole ? getRole() : 'user';
    const isStaff = role === 'admin' || role === 'vip';
    if (activeTab === 'admin' && !isStaff) activeTab = 'display';
    const tabDefs = [
      ['display', '表示設定'],
      ['people', '参加者'],
      ['npc', 'NPC設定'],
    ];
    if (isStaff) tabDefs.push(['admin', '管理']);
    for (const [id, label] of tabDefs) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'vc-set-tab' + (activeTab === id ? ' active' : '');
      t.textContent = label;
      t.addEventListener('click', () => {
        // 参加者タブから離れるときは描き先を外す（別のタブへ描かれないように）
        if (activeTab === 'people' && id !== 'people' && people && people.detach) people.detach();
        activeTab = id;
        render();
      });
      tabs.appendChild(t);
    }
    panel.appendChild(tabs);

    const body = document.createElement('div');
    panel.appendChild(body);

    if (activeTab === 'people') {
      if (people && people.renderInto) people.renderInto(body);
    } else if (activeTab === 'admin') {
      if (admin && admin.renderInto) admin.renderInto(body);
    } else if (activeTab === 'npc') {
      if (rooms && rooms.renderNpcInto) rooms.renderNpcInto(body);
    } else {
      renderDisplaySettings(body, {
        onEmotePrefsChange,
        onChatEmoteChange,
        onSelfViewChange,
        onReflectionChange,
        onBloomChange,
        onFpsMeterChange,
        onLowPowerChange,
        // fps表示は運営向けの道具なので、管理者とVIPにだけ出す
        //（お客さんの画面に数字が並んでいても使い道がない）
        showFpsMeter: ['admin', 'vip'].includes(getRole ? getRole() : ''),
      });
    }
  }

  return {
    close: closePanel,
    isOpen: () => open,
    /** 管理の一覧がサーバーから届いたときに呼ぶ（開いていれば描き直す） */
    refreshIfAdminOpen() {
      if (open && activeTab === 'admin') render();
    },
  };
}
