// ============================================================
// 参加者パネル（👥）— 迷惑行為への対処
//
// 強さの違う3つを、使える人ごとに出し分ける:
//   ブロック … 誰でも。自分と相手が互いに見えなくなるだけ（相手には通知されない）
//   キック   … 管理者・VIP。その場から退出させる。すぐ入り直せる
//   BAN      … 管理者だけ。Googleアカウント単位で再入場を止める
//
// 3Dのアバターを直接クリックさせる案もあったが、動き回る相手を狙うのは難しく、
// 誤操作も起きやすい。一覧から名前を見て選ぶ形にしている。
// ============================================================

const STYLE_ID = 'vc-people-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-people-btn {
  width: 34px; height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.08);
  color: #eaf6ff; font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.vc-people-btn:hover { border-color: rgba(0,255,234,0.6); }

.vc-people-panel {
  position: fixed;
  right: 16px; bottom: 96px;
  width: min(360px, calc(100vw - 32px));
  max-height: 60vh; overflow-y: auto;
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
.vc-people-hidden { display: none; }

.vc-people-title { font-size: 12px; letter-spacing: 2px; color: rgba(0,255,234,0.85); margin-bottom: 8px; }
.vc-people-hint { font-size: 11px; color: rgba(220,235,255,0.5); margin: -4px 0 10px; line-height: 1.5; }
.vc-people-empty { color: rgba(220,235,255,0.5); font-size: 12px; padding: 4px 0; }

.vc-people-row {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 0;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.vc-people-row:first-of-type { border-top: none; }
.vc-people-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vc-people-name.me { color: rgba(220,235,255,0.55); }

.vc-people-act {
  padding: 4px 9px; border-radius: 12px; font-size: 11px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #eaf6ff;
  white-space: nowrap;
}
.vc-people-act:hover { border-color: rgba(255,140,160,0.75); color: #ffd9e0; }
.vc-people-act.danger { border-color: rgba(255,120,140,0.45); color: rgba(255,190,200,0.95); }

.vc-people-section { border-top: 1px solid rgba(255,255,255,0.12); margin-top: 12px; padding-top: 10px; }
.vc-people-undo {
  border: none; background: none; color: rgba(0,255,234,0.85);
  cursor: pointer; font-size: 11px; padding: 2px 4px;
}
`;
  document.head.appendChild(style);
}

/** 権限を名前の前の記号にする（ネームプレートと揃える） */
function markFor(role) {
  if (role === 'admin') return '👑 ';
  if (role === 'vip') return '⭐ ';
  return '';
}

/**
 * @param {Object} p
 * @param {HTMLElement} p.slot ボタンを置く場所
 * @param {() => string} p.getRole 自分の権限
 * @param {() => string} p.getMyName 自分の表示名
 * @param {() => Array<{id:string,name:string,role:string}>} p.getPeople 今見えている人
 * @param {() => Array<{k:string,n:string}>} p.getBlocked ブロック中の相手
 * @param {() => Array<{email:string,name:string,byName:string,reason:string}>} p.getBans BAN一覧
 * @param {(id:string) => void} p.onBlock
 * @param {(k:string) => void} p.onUnblock
 * @param {(id:string) => void} p.onKick
 * @param {(id:string, why:string) => void} p.onBan
 * @param {(email:string) => void} p.onUnban
 * @param {() => void} p.onRefresh 開いたときにサーバーへ最新を取りに行く
 */
export function initPeopleUI({
  slot,
  getRole,
  getMyName,
  getPeople,
  getBlocked,
  getBans,
  onBlock,
  onUnblock,
  onKick,
  onBan,
  onUnban,
  onRefresh,
}) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-people-btn';
  btn.title = '参加者';
  btn.textContent = '👥';
  slot.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'vc-people-panel vc-people-hidden';
  document.body.appendChild(panel);

  let open = false;

  function closePanel() {
    open = false;
    panel.classList.add('vc-people-hidden');
  }

  function openPanel() {
    open = true;
    panel.classList.remove('vc-people-hidden');
    if (onRefresh) onRefresh();
    render();
  }

  btn.addEventListener('click', () => (open ? closePanel() : openPanel()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closePanel();
  });

  /** 取り消しにくい操作なので、名前を出して1回確かめる */
  function confirmAct(message) {
    return window.confirm(message);
  }

  function render() {
    const role = getRole();
    const isStaff = role === 'admin' || role === 'vip';
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'vc-people-title';
    title.textContent = '参加者';
    panel.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'vc-people-hint';
    hint.textContent = 'ブロックすると、その人とお互いに見えなくなります。相手には知らされません。';
    panel.appendChild(hint);

    // 自分
    const meRow = document.createElement('div');
    meRow.className = 'vc-people-row';
    const meName = document.createElement('div');
    meName.className = 'vc-people-name me';
    meName.textContent = `${markFor(role)}${getMyName()}（あなた）`;
    meRow.appendChild(meName);
    panel.appendChild(meRow);

    const people = getPeople();
    if (!people.length) {
      const empty = document.createElement('div');
      empty.className = 'vc-people-empty';
      empty.textContent = 'ほかに人はいません。';
      panel.appendChild(empty);
    }

    for (const p of people) {
      const row = document.createElement('div');
      row.className = 'vc-people-row';

      const name = document.createElement('div');
      name.className = 'vc-people-name';
      name.textContent = `${markFor(p.role)}${p.name}`;
      row.appendChild(name);

      const blockBtn = document.createElement('button');
      blockBtn.className = 'vc-people-act';
      blockBtn.textContent = 'ブロック';
      blockBtn.addEventListener('click', () => {
        if (!confirmAct(`${p.name} をブロックします。\nお互いに見えなくなります（相手には知らされません）。`)) return;
        onBlock(p.id);
      });
      row.appendChild(blockBtn);

      // 管理者・VIPは、同格以上には使えない（蹴り合いにならないように）
      const targetIsStaff = p.role === 'admin' || p.role === 'vip';
      if (isStaff && !targetIsStaff) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'vc-people-act danger';
        kickBtn.textContent = 'キック';
        kickBtn.addEventListener('click', () => {
          if (!confirmAct(`${p.name} をこの場から退出させます。\n入り直すことはできます。`)) return;
          onKick(p.id);
        });
        row.appendChild(kickBtn);
      }
      if (role === 'admin' && !targetIsStaff) {
        const banBtn = document.createElement('button');
        banBtn.className = 'vc-people-act danger';
        banBtn.textContent = 'BAN';
        banBtn.addEventListener('click', () => {
          if (!confirmAct(`${p.name} を BAN します。\n以後このGoogleアカウントでは入れなくなります。`)) return;
          const why = window.prompt('理由（任意・あとで一覧に出ます）', '') || '';
          onBan(p.id, why);
        });
        row.appendChild(banBtn);
      }

      panel.appendChild(row);
    }

    // ---- ブロック中（自分の分） ----
    const blocked = getBlocked();
    if (blocked.length) {
      const sec = document.createElement('div');
      sec.className = 'vc-people-section';
      const label = document.createElement('div');
      label.className = 'vc-people-title';
      label.textContent = `ブロック中（${blocked.length}人）`;
      sec.appendChild(label);

      for (const b of blocked) {
        const row = document.createElement('div');
        row.className = 'vc-people-row';
        const name = document.createElement('div');
        name.className = 'vc-people-name';
        name.textContent = b.n;
        const undo = document.createElement('button');
        undo.className = 'vc-people-undo';
        undo.textContent = '解除';
        undo.addEventListener('click', () => onUnblock(b.k));
        row.append(name, undo);
        sec.appendChild(row);
      }
      panel.appendChild(sec);
    }

    // ---- BAN一覧（管理者だけ） ----
    if (role === 'admin') {
      const sec = document.createElement('div');
      sec.className = 'vc-people-section';
      const label = document.createElement('div');
      label.className = 'vc-people-title';
      label.textContent = 'BAN中';
      sec.appendChild(label);

      const list = getBans();
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'vc-people-empty';
        empty.textContent = 'BANしている人はいません。';
        sec.appendChild(empty);
      }
      for (const b of list) {
        const row = document.createElement('div');
        row.className = 'vc-people-row';
        const name = document.createElement('div');
        name.className = 'vc-people-name';
        name.textContent = b.reason ? `${b.name}（${b.reason}）` : b.name;
        const undo = document.createElement('button');
        undo.className = 'vc-people-undo';
        undo.textContent = '解除';
        undo.addEventListener('click', () => onUnban(b.email));
        row.append(name, undo);
        sec.appendChild(row);
      }
      panel.appendChild(sec);
    }
  }

  return {
    /** 一覧の中身が変わったとき（人の出入り・ブロック・BAN）に呼ぶ */
    refresh() {
      if (open) render();
    },
    close: closePanel,
  };
}
