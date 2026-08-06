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
.vc-adm-row input[type=number],
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
  onLoadSim,
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

    // ---------------- 負荷の測定（2026-08-06追加） ----------------
    //
    // loyさん「管理者用にNPCとは別に、測定できるものを付けておいて。
    //          10000人くらいまではかってみたい。」
    //
    // ⚠ NPCとは別物。NPCは自分の画面の飾りで通信は起きない。
    //   こちらは**サーバーの中に仮想のユーザーを作り、本物と同じ配信処理を回す**。
    //   実ユーザーには1通も届かないが、サーバーのCPUは本当に使う。
    const sec3 = document.createElement('div');
    sec3.className = 'vc-adm-sec';
    const h3 = document.createElement('div');
    h3.className = 'vc-help-h';
    h3.textContent = '負荷の測定（何人まで耐えられるか）';
    sec3.appendChild(h3);
    const note4 = document.createElement('div');
    note4.className = 'vc-adm-note';
    note4.textContent =
      'サーバーの中に仮想のユーザーを作って、本物と同じ「位置を配る処理」を回します。'
      + 'お客さんの画面には何も起きません（1通も届きません）が、サーバーのCPUは本当に使うので、'
      + '本番中に大きな人数で回すと本物の動きが遅れます。3分で自動的に止まります。'
      + ' ⚠ ここで測れるのは「配る内容を組み立てるまで」です。実際はこれに通信の書き出しが乗ります。'
      + '実際に接続して測った限界は約13万通/秒だったので、その数字と見比べてください。';
    sec3.appendChild(note4);

    const simRow = document.createElement('div');
    simRow.className = 'vc-adm-row';
    const nIn = document.createElement('input');
    nIn.type = 'number';
    nIn.min = '0';
    nIn.max = '20000';
    nIn.step = '100';
    nIn.value = String(simState.n || 1000);
    nIn.className = 'vc-adm-input';
    nIn.style.maxWidth = '110px';
    const perIn = document.createElement('input');
    perIn.type = 'number';
    perIn.min = '1';
    // ⚠ 1ルームの上限は付けない（2026-08-06 loyさん「1ルームの上限決めないで。
    //   それもテストしたいから」）。無茶な値でもサーバーは固まらない（時間で打ち切る）
    perIn.max = '20000';
    perIn.value = String(simState.perRoom || 15);
    perIn.className = 'vc-adm-input';
    perIn.style.maxWidth = '90px';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'vc-adm-btn';
    startBtn.textContent = simState.running ? '測定を止める' : '測定を始める';
    simBtnEl = startBtn;
    startBtn.addEventListener('click', () => {
      if (!onLoadSim) return;
      if (simState.running) {
        onLoadSim({ stop: true });
      } else {
        simState.n = Math.max(0, Number(nIn.value) || 0);
        simState.perRoom = Math.max(1, Number(perIn.value) || 15);
        onLoadSim({ n: simState.n, perRoom: simState.perRoom });
      }
    });
    const lab = (t) => {
      const e = document.createElement('span');
      e.className = 'vc-adm-note';
      e.style.margin = '0 4px';
      e.textContent = t;
      return e;
    };
    simRow.append(lab('人数'), nIn, lab('1ルーム'), perIn, startBtn);
    sec3.appendChild(simRow);

    const out = document.createElement('div');
    out.className = 'vc-adm-note';
    out.style.whiteSpace = 'pre';
    out.style.fontFamily = 'ui-monospace, Consolas, monospace';
    out.textContent = simState.text || '（まだ測っていません）';
    simOutEl = out;
    sec3.appendChild(out);

    const note5 = document.createElement('div');
    note5.className = 'vc-adm-note';
    note5.textContent =
      '見るのは「遅れ」と「捌けなかった通数」です。遅れが10msを超える、または'
      + '捌けなかった通数が出たら、その設定はもう無理という意味です。'
      + '1ルームの人数には上限を付けていません（1ルーム1万人なども試せます）。'
      + '通数は1ルームの人数の2乗で増えるので、まずそこを動かしてみてください。';
    sec3.appendChild(note5);

    body.appendChild(sec3);
  }

  /** 測定の状態（画面を描き直しても残す） */
  const simState = { running: false, n: 1000, perRoom: 15, text: '' };
  let simOutEl = null;
  let simBtnEl = null; // 走っている間は「止める」に変える（描き直さずに文字だけ差し替える）

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
    /** 測定の結果が届いた（1秒ごと） */
    setLoadSim(r) {
      simState.running = Boolean(r.running);
      if (!r.running) {
        simState.text = r.reason ? `停止しました（${r.reason}）` : '停止しました';
      } else if (r.msgsPerSec !== undefined) {
        // 判定は2つ見る:
        //   ① 遅れ（このサーバーが実際に詰まっているか）
        //   ② 通数（実接続で測った限界 13万通/秒 に対してどうか）
        const REAL_LIMIT = 130000;
        const judge = r.skippedPerSec > 0 || r.lagAvgMs > 30 || r.msgsPerSec > REAL_LIMIT * 1.2
          ? '✕ 実接続なら破綻する規模'
          : r.lagAvgMs > 10 || r.msgsPerSec > REAL_LIMIT * 0.7
            ? '△ そろそろ限界'
            : '◎ 余裕あり';
        // 捌けなかったぶん（1ルームを大きくすると、まずここが出る）
        const over = r.skippedPerSec > 0
          ? `
捌けなかった ${r.skippedPerSec.toLocaleString()}通/秒`
            + `（本来 ${r.intendedPerSec.toLocaleString()}通/秒 必要）← この設定は無理`
          : '';
        simState.text =
          `${judge}
`
          + `仮想ユーザー ${r.users}人（${r.perRoom}人 × ${r.rooms}ルーム）
`
          + `遅れ 平均${r.lagAvgMs}ms／最大${r.lagWorstMs}ms
`
          + `配信 ${r.msgsPerSec.toLocaleString()}通/秒（${r.mbPerSec}MB/秒）／実接続の限界は約130,000通/秒${over}
`
          + `処理に使った時間 ${r.busyMsPerSec}ms/秒（1000で限界）
`
          + `メモリ ${r.memMB}MB／経過 ${r.elapsedSec}秒`;
      } else {
        simState.text = `測定を始めました（${r.users}人 / ${r.perRoom}人ずつ）…`;
      }
      if (simOutEl) simOutEl.textContent = simState.text;
      if (simBtnEl) simBtnEl.textContent = simState.running ? '測定を止める' : '測定を始める';
    },
  };
}
