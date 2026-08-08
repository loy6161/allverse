// ============================================================
// 参加者パネル（👥）— 迷惑行為への対処
//
// 強さの違う3つを、使える人ごとに出し分ける:
//   ブロック … 誰でも。自分と相手が互いに見えなくなるだけ（相手には通知されない）
//   キック   … 管理者・VIP。その場から退出させる。時間を選べる（0分なら即戻れる）
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
  /* 2026-08-03: ボタンを右上バーへ移したので、パネルも右上から下へ開くようにした。
     bottom基準のままだと、画面が低いときにパネルの上端が右上バーへ食い込み、
     アバター変更ボタンなどが隠れる（loyさん「右上のパネルはアバター変更とかぶってる」）。
     バーの下端（16+48）＋余白の位置から始める */
  right: 16px; top: 74px;
  width: min(360px, calc(100vw - 32px));
  /* 下は動画のコントロール（高さ約72＋余白）まで。画面が低くても収まる */
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
.vc-people-hidden { display: none; }

/* スマホでは、このパネルを開くボタンが入っている動画のコントロールより上の段に出す */
@media (max-width: 640px), (max-height: 480px) {
  .vc-people-panel {
    right: 12px; left: 12px; width: auto;
    bottom: var(--m-panel2-bottom);
    /* 上に伸びても右上のボタン（⚙ は top:95・高さ34）に届かない高さで止める。
       vh の固定値だと画面が低い端末で突き抜けるので、残りの空きから計算する */
    max-height: calc(100vh - var(--m-panel2-bottom) - 145px);
  }
}


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
 * @param {() => Array<object>} [p.getKicks] キックの履歴（管理者のみ）
 * @param {(id:string) => void} p.onBlock
 * @param {(k:string) => void} p.onUnblock
 * @param {(id:string, mins:number, why:string) => void} p.onKick
 * @param {(id:string, why:string) => void} p.onBan
 * @param {(email:string) => void} p.onUnban
 * @param {() => void} p.onRefresh 開いたときにサーバーへ最新を取りに行く
 */
// キックで選べる締め出し時間（分）。0＝すぐ入り直せる（従来の挙動）
const KICK_CHOICES = [0, 5, 15, 60, 180];

export function initPeopleUI({
  slot,
  getRole,
  getMyName,
  getPeople,
  getBlocked,
  getBans,
  getKicks,
  onBlock,
  onUnblock,
  onKick,
  onBan,
  onUnban,
  onRefresh,
}) {
  injectStyle();

  // ⚠ 2026-08-03: 参加者は⚙設定パネルの中へ移したので、**独立したボタンは出さない**
  //   （loyさん「設定に入れたならアイコンはいらないね」）。
  //   ボタン自体は残してある——キーボードやコードから開く経路と、
  //   将来また独立させたくなったときのため。slot に入れないので画面には出ない
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-people-btn';
  btn.title = '参加者';
  btn.textContent = '👥';
  if (slot) {
    // slot を渡さなければ画面に出ない。いまは main.js から渡していない
    slot.appendChild(btn);
  }

  const ownPanel = document.createElement('div');
  ownPanel.className = 'vc-people-panel vc-people-hidden';
  document.body.appendChild(ownPanel);

  let open = false;

  function closePanel() {
    open = false;
    ownPanel.classList.add('vc-people-hidden');
  }

  function openPanel() {
    open = true;
    host = null; // 自前のパネルへ描く
    ownPanel.classList.remove('vc-people-hidden');
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

  /**
   * 描き先。既定は自前のパネルだが、⚙設定パネルの中へ描くこともできる
   * （2026-08-03追加。設定系を⚙にまとめる整理のため）
   */
  let host = null;

  function render() {
    const role = getRole();
    const isStaff = role === 'admin' || role === 'vip';
    const panel = host || ownPanel;
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
          // 2026-08-02: 時間を選べるようにした。
          // 蹴るだけでは即戻れてしまい荒らしへの対処にならなかったので、
          // BANほど重くない「一時的な締め出し」をここで賄う
          const ans = window.prompt(
            `${p.name} を退出させます。\n何分のあいだ入れなくしますか？\n` +
              '0（すぐ入り直せる）／ 5 ／ 15 ／ 60 ／ 180 から選んでください。',
            '15',
          );
          if (ans === null) return;
          const mins = KICK_CHOICES.includes(Number(ans)) ? Number(ans) : 0;
          const why = window.prompt('理由（任意・履歴に残ります）', '') || '';
          onKick(p.id, mins, why);
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

      // ---- キックの履歴（管理者だけ）----
      // タイムアウトが切れても残る。「この人、前にも蹴られてるな」を見て
      // BANするかを後から判断するための材料（loyさん設計 2026-08-02）
      const kSec = document.createElement('div');
      kSec.className = 'vc-people-section';
      const kLabel = document.createElement('div');
      kLabel.className = 'vc-people-title';
      kLabel.textContent = 'キックの履歴';
      kSec.appendChild(kLabel);

      const kicks = getKicks ? getKicks() : [];
      if (!kicks.length) {
        const empty = document.createElement('div');
        empty.className = 'vc-people-empty';
        empty.textContent = 'キックの記録はありません。';
        kSec.appendChild(empty);
      }
      // 同じ人が何回蹴られたかを数えて添える（BAN判断の目安になる）
      const counts = new Map();
      for (const k of kicks) counts.set(k.subject, (counts.get(k.subject) || 0) + 1);
      for (const k of kicks.slice(0, 20)) {
        const row = document.createElement('div');
        row.className = 'vc-people-row';
        const name = document.createElement('div');
        name.className = 'vc-people-name';
        const times = counts.get(k.subject) || 1;
        const span = k.minutes > 0 ? `${k.minutes}分` : '締め出しなし';
        name.textContent =
          `${k.name}（${span}）` +
          (times > 1 ? ` ×${times}回` : '') +
          (k.reason ? ` 理由: ${k.reason}` : '');
        name.title = `${new Date(k.createdAt).toLocaleString()} / ${k.eventName} / ${k.byName} がキック`;
        row.appendChild(name);
        kSec.appendChild(row);
      }
      panel.appendChild(kSec);
    }
  }

  return {
    /** 一覧の中身が変わったとき（人の出入り・ブロック・BAN）に呼ぶ */
    refresh() {
      if (open) render();
      else if (host) render(); // ⚙設定パネルの中に出しているときも追従させる
    },
    /**
     * 参加者一覧を別の場所（⚙設定パネル）へ描く（2026-08-03追加）。
     * 中身も操作も👥パネルと同じ部品なので、どちらから触っても同じ結果になる。
     */
    renderInto(el) {
      host = el || null;
      if (onRefresh) onRefresh();
      render();
    },
    /** ⚙設定パネルを閉じたときに呼ぶ。以後は自前のパネルへ描くように戻す */
    detach() {
      host = null;
    },
    close: closePanel,
  };
}
