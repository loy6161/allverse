// ============================================================
// 管理タブ（⚙設定の中・管理者/VIPだけに出す）（2026-08-03追加）
//
// loyさんの要望:
//   > 曲のコールとかあるけど、その時は絵文字じゃないから、コールにもペンラ反応するといいな。
//   > でも新曲も増えたりするから、都度実装は手間なので、ファイル更新で対応できるとよいね。
//   > それか、ワード管理画面みたいなのがあるといい。
//   > これはVIP権限もいまはRenderいかないとなので、管理画面で追加管理できるとよいな。
//
// ファイル方式ではなく画面にした理由:
//   ファイルだと**追加のたびにデプロイが要る**＝loyさんが自分で足せない。
//   コールはその日のセトリで変わるので、開演前にその場で足せることに意味がある。
//
// 中身は2つ:
//   コールのワード … 複数のリストを作って、イベントごとに切り替える（管理者・VIP）
//   運営メンバー   … VIP/管理者の追加と削除（管理者だけ）
// ============================================================

/** ワードに割り当てられるエモート。エモートバーと同じ12種 */
const EMOTE_CHOICES = [
  ['penlight', '🔦 ペンライト'],
  ['clap', '👏 拍手'],
  ['wave', '👋 手をふる'],
  ['jump', '⤴️ ジャンプ'],
  ['dance', '🕺 おどる'],
  ['heart', '💗 ハート'],
  ['fist', '✊ コブシ'],
  ['smile', '😄 ニコニコ'],
  ['headbang', '🤘 ヘッドバンキング'],
  ['star', '⭐ 星'],
  ['firework', '🎆 花火'],
  ['cheers', '🍺 乾杯'],
];

const STYLE_ID = 'vc-admin-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-adm-sec { border-top: 1px solid rgba(255,255,255,0.12); margin-top: 12px; padding-top: 10px; }
.vc-adm-sec:first-child { border-top: none; margin-top: 0; padding-top: 0; }
.vc-adm-row { display: flex; gap: 6px; align-items: center; margin: 5px 0; }
.vc-adm-row input[type=text],
.vc-adm-row select {
  flex: 1 1 auto; min-width: 0;
  background: rgba(6,5,16,0.9);
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 7px; color: #eaf6ff; font-size: 12px; padding: 5px 8px;
}
.vc-adm-row select { flex: 0 0 auto; max-width: 46%; }
.vc-adm-btn {
  flex: 0 0 auto;
  border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.06);
  color: #eaf6ff; border-radius: 7px; font-size: 11px; padding: 5px 9px; cursor: pointer;
}
.vc-adm-btn:hover { border-color: rgba(0,255,234,0.6); }
.vc-adm-btn.danger { border-color: rgba(255,120,140,0.5); color: #ffc9d2; }
.vc-adm-btn.primary { border-color: rgba(0,255,234,0.7); background: rgba(0,255,234,0.15); }
.vc-adm-note { font-size: 11px; line-height: 1.7; color: rgba(220,235,255,0.6); margin: 4px 0 8px; }
.vc-adm-word { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
.vc-adm-word .w { flex: 1 1 auto; }
.vc-adm-fixed { color: rgba(220,235,255,0.5); font-size: 11px; }
.vc-adm-empty { color: rgba(220,235,255,0.5); font-size: 12px; padding: 4px 0; }
`;
  document.head.appendChild(style);
}

/**
 * @param {Object} p
 * @param {() => Array} p.getLists コールのリスト一覧
 * @param {() => Array} p.getStaff 運営メンバー一覧
 * @param {() => string} p.getRole 自分の権限
 * @param {(list:object) => void} p.onSaveList
 * @param {(id:string) => void} p.onDeleteList
 * @param {(email:string, role:string) => void} p.onSaveStaff
 * @param {(email:string) => void} p.onDeleteStaff
 * @param {() => void} p.onRefresh 開いたときにサーバーへ最新を取りに行く
 */
export function initAdminUI({
  getLists,
  getStaff,
  getRole,
  onSaveList,
  onDeleteList,
  onSaveStaff,
  onDeleteStaff,
  onRefresh,
}) {
  injectStyle();

  /** いま編集しているリストのid（'' なら新規） */
  let editingId = '';
  /** 編集中のワード。保存を押すまでサーバーへ送らない */
  let draft = null;

  function startEdit(list) {
    editingId = list ? list.id : '';
    draft = {
      name: list ? list.name : '',
      words: list ? list.words.map((w) => ({ ...w })) : [],
    };
  }

  function render(body) {
    body.innerHTML = '';
    const isAdmin = getRole() === 'admin';

    // ---------------- コールのワード ----------------
    const sec1 = document.createElement('div');
    sec1.className = 'vc-adm-sec';
    const h1 = document.createElement('div');
    h1.className = 'vc-help-h';
    h1.textContent = 'コールのワード';
    sec1.appendChild(h1);

    const note1 = document.createElement('div');
    note1.className = 'vc-adm-note';
    note1.textContent =
      'YouTubeのコメントにこの言葉が入っていたら、連携している人のアバターが動きます。曲のコールなどを登録しておけます。リストは何個でも作れて、どれを使うかはイベントごとに選びます（🚪のイベント設定）。使わないイベントでは「使わない」を選んでください。';
    sec1.appendChild(note1);

    const lists = getLists() || [];

    if (!draft) {
      // 一覧
      if (!lists.length) {
        const e = document.createElement('div');
        e.className = 'vc-adm-empty';
        e.textContent = 'まだリストがありません。';
        sec1.appendChild(e);
      }
      for (const l of lists) {
        const row = document.createElement('div');
        row.className = 'vc-adm-row';
        const name = document.createElement('div');
        name.style.flex = '1 1 auto';
        name.textContent = `${l.name}（${l.words.length}語）`;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'vc-adm-btn';
        edit.textContent = '編集';
        edit.addEventListener('click', () => {
          startEdit(l);
          render(body);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'vc-adm-btn danger';
        del.textContent = '削除';
        del.addEventListener('click', () => {
          if (!window.confirm(`「${l.name}」を削除します。よろしいですか？`)) return;
          onDeleteList(l.id);
        });
        row.append(name, edit, del);
        sec1.appendChild(row);
      }

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'vc-adm-btn primary';
      add.textContent = '＋ リストを作る';
      add.addEventListener('click', () => {
        startEdit(null);
        render(body);
      });
      sec1.appendChild(add);
    } else {
      // 編集画面
      const nameRow = document.createElement('div');
      nameRow.className = 'vc-adm-row';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'リスト名（例: clubVERSE用）';
      nameInput.value = draft.name;
      nameInput.addEventListener('input', () => {
        draft.name = nameInput.value;
      });
      nameRow.appendChild(nameInput);
      sec1.appendChild(nameRow);

      for (let i = 0; i < draft.words.length; i++) {
        const item = draft.words[i];
        const row = document.createElement('div');
        row.className = 'vc-adm-word';
        const w = document.createElement('input');
        w.type = 'text';
        w.className = 'w';
        w.placeholder = 'コールの言葉';
        w.value = item.w;
        w.addEventListener('input', () => {
          item.w = w.value;
        });
        const sel = document.createElement('select');
        for (const [id, label] of EMOTE_CHOICES) {
          const op = document.createElement('option');
          op.value = id;
          op.textContent = label;
          if (id === item.e) op.selected = true;
          sel.appendChild(op);
        }
        sel.addEventListener('change', () => {
          item.e = sel.value;
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'vc-adm-btn danger';
        del.textContent = '×';
        del.addEventListener('click', () => {
          draft.words.splice(i, 1);
          render(body);
        });
        row.append(w, sel, del);
        sec1.appendChild(row);
      }

      const addW = document.createElement('button');
      addW.type = 'button';
      addW.className = 'vc-adm-btn';
      addW.textContent = '＋ ワードを追加';
      addW.addEventListener('click', () => {
        draft.words.push({ w: '', e: 'penlight' });
        render(body);
      });

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'vc-adm-btn primary';
      save.textContent = '保存';
      save.addEventListener('click', () => {
        const name = draft.name.trim();
        if (!name) {
          window.alert('リスト名を入れてください。');
          return;
        }
        // 空のワードは落としてから送る
        const words = draft.words.filter((x) => x.w && x.w.trim()).map((x) => ({ w: x.w.trim(), e: x.e }));
        onSaveList({ id: editingId || undefined, name, words });
        draft = null;
        editingId = '';
        render(body);
      });

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'vc-adm-btn';
      cancel.textContent = 'やめる';
      cancel.addEventListener('click', () => {
        draft = null;
        editingId = '';
        render(body);
      });

      const btnRow = document.createElement('div');
      btnRow.className = 'vc-adm-row';
      btnRow.append(addW, save, cancel);
      sec1.appendChild(btnRow);

      const hint = document.createElement('div');
      hint.className = 'vc-adm-note';
      hint.textContent =
        '言葉は「含まれていれば」反応します。「リバーブ」と登録しておけば「リバーブ！」でも動きます。長い言葉から順に見るので、「リバーブ」と「リバーブ最高」を両方登録しても大丈夫です。';
      sec1.appendChild(hint);
    }
    body.appendChild(sec1);

    // ---------------- 運営メンバー（管理者だけ） ----------------
    if (!isAdmin) return;

    const sec2 = document.createElement('div');
    sec2.className = 'vc-adm-sec';
    const h2 = document.createElement('div');
    h2.className = 'vc-help-h';
    h2.textContent = '運営メンバー';
    sec2.appendChild(h2);

    const note2 = document.createElement('div');
    note2.className = 'vc-adm-note';
    note2.textContent =
      'VIPはイベントを立てて、自分のイベントを操作できます。管理者は全部できます。ここで足した人は次のログインから反映されます（すでに入っている人は入り直しが必要です）。';
    sec2.appendChild(note2);

    for (const st of getStaff() || []) {
      const row = document.createElement('div');
      row.className = 'vc-adm-row';
      const label = document.createElement('div');
      label.style.flex = '1 1 auto';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.textContent = `${st.role === 'admin' ? '👑' : '⭐'} ${st.email}`;
      row.appendChild(label);
      if (st.fixed) {
        const fixed = document.createElement('span');
        fixed.className = 'vc-adm-fixed';
        fixed.textContent = 'Renderの設定';
        row.appendChild(fixed);
      } else {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'vc-adm-btn danger';
        del.textContent = '外す';
        del.addEventListener('click', () => {
          if (!window.confirm(`${st.email} を運営から外します。よろしいですか？`)) return;
          onDeleteStaff(st.email);
        });
        row.appendChild(del);
      }
      sec2.appendChild(row);
    }

    const addRow = document.createElement('div');
    addRow.className = 'vc-adm-row';
    const email = document.createElement('input');
    email.type = 'text';
    email.placeholder = 'メールアドレス（Googleアカウント）';
    const roleSel = document.createElement('select');
    for (const [v, label] of [['vip', '⭐ VIP'], ['admin', '👑 管理者']]) {
      const op = document.createElement('option');
      op.value = v;
      op.textContent = label;
      roleSel.appendChild(op);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'vc-adm-btn primary';
    addBtn.textContent = '追加';
    addBtn.addEventListener('click', () => {
      const e = email.value.trim();
      if (!e || !e.includes('@')) {
        window.alert('メールアドレスを入れてください。');
        return;
      }
      onSaveStaff(e, roleSel.value);
      email.value = '';
    });
    addRow.append(email, roleSel, addBtn);
    sec2.appendChild(addRow);

    const note3 = document.createElement('div');
    note3.className = 'vc-adm-note';
    note3.textContent =
      '「Renderの設定」と出ている人は、この画面からは外せません。全員を外してしまうと誰も管理できなくなるため、最後の砦として残してあります。';
    sec2.appendChild(note3);

    body.appendChild(sec2);
  }

  return {
    /** ⚙設定パネルの中へ描く */
    renderInto(body) {
      if (onRefresh) onRefresh();
      render(body);
    },
    /** サーバーから新しい一覧が届いたら描き直す */
    refresh(body) {
      if (body) render(body);
    },
  };
}
