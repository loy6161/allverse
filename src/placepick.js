// ============================================================
// 入場前の「イベント／ルーム選択」画面
//
// アバターを決めたあと、どこに入るかを選ぶ一歩を挟む。
// ワールドに入ったあとの切り替え（roomui.js の 🚪 パネル）はそのまま残してある。
//
// 「ルーム」はVRChatでいうインスタンス。VRChatを知らない人にも通じる語を選んでいる。
// ============================================================

import { fetchConfig, isSignedIn, getIdToken } from './login.js';
import { fetchServerPrefs } from './prefs.js';

const STYLE_ID = 'vc-place-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-place-panel {
  width: min(680px, 92vw);
  max-height: 92vh;
  overflow-y: auto;
  background: linear-gradient(160deg, rgba(12,12,28,0.94), rgba(18,8,30,0.94));
  border: 1px solid rgba(0,255,234,0.35);
  border-radius: 18px;
  padding: 28px 32px 30px;
  box-shadow: 0 0 40px rgba(0,255,234,0.15), 0 0 90px rgba(255,0,229,0.08);
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  color: #eaf6ff;
}
.vc-place-title {
  margin: 0 0 4px;
  text-align: center;
  font-size: 26px;
  letter-spacing: 4px;
  font-weight: 800;
  background: linear-gradient(90deg,#00ffea,#ff00e5);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.vc-place-sub {
  margin: 0 0 20px;
  text-align: center;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(220,235,255,0.6);
}
.vc-place-ev {
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  transition: border-color 0.15s, background 0.15s;
}
.vc-place-ev.selected {
  border-color: #00ffea;
  background: rgba(0,255,234,0.06);
}
.vc-place-ev.locked { opacity: 0.5; }
.vc-place-ev-head {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer;
}
.vc-place-ev-name { font-size: 16px; font-weight: bold; flex: 1 1 auto; }
.vc-place-ev-count { font-size: 12px; color: rgba(220,235,255,0.65); }
.vc-place-ev-note { font-size: 11px; color: rgba(255,180,120,0.9); margin-top: 4px; }

/* 会場が閉まっているとき */
.vc-place-closed {
  text-align: center;
  padding: 28px 12px;
  border: 1px dashed rgba(255,255,255,0.2);
  border-radius: 12px;
  margin-bottom: 16px;
}
.vc-place-closed-title { font-size: 17px; font-weight: bold; margin-bottom: 8px; }
.vc-place-closed-note { font-size: 12px; color: rgba(220,235,255,0.6); line-height: 1.7; }

/* 合言葉の入力 */
.vc-place-code { margin-top: 12px; }
.vc-place-label { display: block; font-size: 12px; color: rgba(220,235,255,0.75); margin-bottom: 5px; }
.vc-place-input {
  width: 100%; box-sizing: border-box;
  padding: 9px 12px; border-radius: 9px; font-size: 14px;
  border: 1px solid rgba(0,255,234,0.35); background: rgba(6,8,20,0.6); color: #eaf6ff;
  outline: none; font-family: inherit;
}
.vc-place-input:focus { border-color: rgba(0,255,234,0.9); box-shadow: 0 0 10px rgba(0,255,234,0.3); }

/* 管理人向けの作成フォーム */
.vc-place-admin {
  margin-top: 16px; padding: 16px;
  border: 1px solid rgba(255,209,71,0.4); border-radius: 12px;
  background: rgba(38,26,4,0.28);
}
.vc-place-admin-title { font-size: 13px; font-weight: bold; color: #ffd147; margin-bottom: 12px; }
.vc-place-row2 { display: flex; gap: 10px; flex-wrap: wrap; }
.vc-place-row2 > * { flex: 1 1 140px; }
.vc-place-check { display: flex; align-items: center; gap: 7px; font-size: 12px; margin-top: 10px; cursor: pointer; }
.vc-place-err { font-size: 12px; color: #ff8b8b; min-height: 16px; margin-top: 8px; }

.vc-place-rooms { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.vc-place-chip {
  padding: 7px 14px; border-radius: 16px; font-size: 13px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #eaf6ff;
  transition: all 0.12s;
}
.vc-place-chip:hover { border-color: rgba(0,255,234,0.6); }
.vc-place-chip.selected {
  background: linear-gradient(90deg, rgba(0,255,234,0.25), rgba(255,0,229,0.2));
  border-color: #00ffea; color: #fff;
}
.vc-place-chip.full { opacity: 0.4; cursor: not-allowed; }

.vc-place-hint {
  font-size: 11px; line-height: 1.6; color: rgba(220,235,255,0.5);
  margin: 6px 0 16px;
}
/* 入場ボタンの真上に置く記録の断り書き。
   読ませたいが入場の邪魔にはしたくないので、ヒントより一段小さく暗くする */
.vc-place-terms {
  font-size: 10.5px; line-height: 1.65; color: rgba(220,235,255,0.42);
  margin: 14px 0 6px; padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.vc-place-btns { display: flex; gap: 10px; margin-top: 8px; }
.vc-place-go {
  flex: 1 1 auto; padding: 14px 20px; font-size: 17px; font-weight: bold; letter-spacing: 4px;
  border: none; border-radius: 10px; cursor: pointer; color: #06060f;
  background: linear-gradient(90deg,#00ffea,#ff00e5);
  box-shadow: 0 0 18px rgba(0,255,234,0.55), 0 0 34px rgba(255,0,229,0.35);
}
.vc-place-back {
  flex: 0 0 auto; padding: 14px 20px; font-size: 14px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.25); border-radius: 10px; cursor: pointer;
  color: rgba(230,240,255,0.85); background: rgba(255,255,255,0.08);
}
`;
  document.head.appendChild(style);
}

/**
 * イベント／ルーム選択画面を出す。
 * @param {Object} p
 * @param {(sel:{eventId:string, roomNumber:number|null}) => void} p.onDecide 決定時
 * @param {() => void} [p.onBack] 「アバターに戻る」を押したとき
 */
export async function openPlacePicker({ onDecide, onBack }) {
  injectStyle();

  const root = document.getElementById('join-screen');
  root.classList.remove('hidden');
  root.innerHTML = '<div class="vc-place-panel"><p class="vc-place-sub">読み込み中…</p></div>';

  const cfg = await fetchConfig();
  let events = Array.isArray(cfg.events) && cfg.events.length ? cfg.events : [];

  // 管理人かどうか。イベントを作るUIを出すかの判断だけに使う（可否の判定はサーバー側）
  let isAdmin = false;
  if (isSignedIn()) {
    const prof = await fetchServerPrefs(getIdToken());
    isAdmin = Boolean(prof && prof.role === 'admin');
  } else if (cfg.login === false) {
    // ログイン機能そのものが無効な環境（ローカル開発）では管理機能を誰でも触れる
    isAdmin = true;
  }

  /** イベント一覧を取り直す（作成・閉店のあと） */
  async function reloadEvents() {
    const fresh = await fetchConfig(true); // キャッシュではなく取り直す
    events = Array.isArray(fresh.events) ? fresh.events : [];
    if (!events.some((e) => e.id === selectedEventId)) {
      selectedEventId = events.length ? events[0].id : '';
      selectedRoom = null;
    }
    render();
  }

  let selectedEventId = events.length ? events[0].id : '';
  // 入るルームは必ず明示的に選ばせる（「おまかせ」は 2026-07-30 に廃止）。
  // 既定は「空きのある一番小さい番号」で、画面を開いた時点で選択済みの状態にする
  let selectedRoom = null;
  /** 入場する場所（CITYのイベントのときだけ選べる。既定は会場の中） */
  let spawnAt = 'club';
  // 合言葉つきイベント用。イベントごとに覚えておく（選び直しても消えないように）
  const codeByEvent = new Map();

  /** そのイベントで空きのある最小番号ルーム（無ければ1） */
  function firstOpenRoom(ev) {
    const list = ev && ev.rooms && ev.rooms.length ? ev.rooms : [{ room: 1, full: false }];
    const open = list.find((r) => !r.full);
    return (open || list[0]).room;
  }

  const panel = document.createElement('div');
  panel.className = 'vc-place-panel';

  function render() {
    panel.innerHTML = '';

    const title = document.createElement('h1');
    title.className = 'vc-place-title';
    title.textContent = 'どこに入る？';
    panel.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'vc-place-sub';
    sub.textContent = 'イベントとルームを選んでください';
    panel.appendChild(sub);

    // 会場が閉まっている（管理人が何も立てていない）
    if (events.length === 0) {
      sub.textContent = '';
      const closed = document.createElement('div');
      closed.className = 'vc-place-closed';
      const ct = document.createElement('div');
      ct.className = 'vc-place-closed-title';
      ct.textContent = '🌙 いまは開いていません';
      const cn = document.createElement('div');
      cn.className = 'vc-place-closed-note';
      cn.textContent = isAdmin
        ? 'イベントを立てると会場が開きます。'
        : 'イベントが開かれるまでお待ちください。';
      closed.append(ct, cn);
      panel.appendChild(closed);

      if (isAdmin) panel.appendChild(buildAdminForm());
      panel.appendChild(buildButtons(false));
      return;
    }

    const hint = document.createElement('div');
    hint.className = 'vc-place-hint';
    hint.textContent =
      'ルーム＝VRChatでいうインスタンス。同じイベントなら、どのルームでも同じ映像が同じ位置で流れます。入ったあとでも 🚪 ボタンから移動できます。';
    panel.appendChild(hint);

    for (const ev of events) {
      const needLogin = ev.requireLogin && !isSignedIn();
      const box = document.createElement('div');
      box.className =
        'vc-place-ev' + (ev.id === selectedEventId ? ' selected' : '') + (needLogin ? ' locked' : '');

      const head = document.createElement('div');
      head.className = 'vc-place-ev-head';
      const nm = document.createElement('div');
      nm.className = 'vc-place-ev-name';
      nm.textContent = ev.name + (ev.requireLogin ? ' 🔒' : '') + (ev.hasCode ? ' 🔑' : '');
      const ct = document.createElement('div');
      ct.className = 'vc-place-ev-count';
      ct.textContent = `${ev.count}人`;
      head.append(nm, ct);
      head.addEventListener('click', () => {
        if (needLogin) return;
        selectedEventId = ev.id;
        selectedRoom = null;
        render();
      });
      box.appendChild(head);

      if (needLogin) {
        const note = document.createElement('div');
        note.className = 'vc-place-ev-note';
        note.textContent = 'このイベントに入るにはログインが必要です（前の画面でログインできます）';
        box.appendChild(note);
      }

      // 選択中のイベントだけルームを開いて見せる（一覧が縦に伸びすぎないように）
      if (ev.id === selectedEventId && !needLogin) {
        // まだ選んでいなければ、空きのあるルームを選んだ状態にしておく
        if (selectedRoom === null) selectedRoom = firstOpenRoom(ev);

        const rooms = document.createElement('div');
        rooms.className = 'vc-place-rooms';

        // 合言葉が要るイベントは、ここで入力してもらう（照合はサーバー）
        if (ev.hasCode) {
          const wrap = document.createElement('div');
          wrap.className = 'vc-place-code';
          const lb = document.createElement('label');
          lb.className = 'vc-place-label';
          lb.textContent = '合言葉（主催者から聞いてください）';
          const inp = document.createElement('input');
          inp.className = 'vc-place-input';
          inp.type = 'text';
          inp.value = codeByEvent.get(ev.id) || '';
          inp.placeholder = '合言葉を入力';
          inp.addEventListener('input', () => codeByEvent.set(ev.id, inp.value));
          wrap.append(lb, inp);
          box.appendChild(wrap);
        }

        const list = ev.rooms && ev.rooms.length ? ev.rooms : [{ room: 1, count: 0, full: false }];
        for (const r of list) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className =
            'vc-place-chip' + (selectedRoom === r.room ? ' selected' : '') + (r.full ? ' full' : '');
          chip.textContent = `ルーム${r.room}（${r.count}人）`;
          chip.disabled = r.full;
          chip.addEventListener('click', () => {
            if (r.full) return;
            selectedRoom = r.room;
            render();
          });
          rooms.appendChild(chip);
        }
        box.appendChild(rooms);
      }

      panel.appendChild(box);
    }

    if (isAdmin) panel.appendChild(buildAdminForm());
    panel.appendChild(buildButtons(true));
  }

  /**
   * 下段のボタン。canEnter=false のときは「入場する」を出さない（会場が閉まっているとき）。
   *
   * 入場ボタンの真上に、記録についての断り書きを置く（2026-07-31）。
   * イベントの動員を記録するようになり、ブラウザに匿名の番号を保存するため、
   * 「入る前に読める場所」に書いておく必要がある。
   * ※ 文面はloyさんが決める領域。ここにあるのは事実だけを並べた暫定文
   */
  function buildButtons(canEnter) {
    const frag = document.createDocumentFragment();

    if (canEnter) {
      const terms = document.createElement('div');
      terms.className = 'vc-place-terms';
      // 2026-08-02: 項目を並べる書き方から、**汎用的な書き方**に変えた（loyさん指示）。
      // 記録するものが増えるたびに文面を直すのは現実的でないし、直し忘れると
      // 「書いていないものを記録している」状態になる。何を記録するかではなく
      // 「イベントでの記録が残ること」を伝える形にしてある
      terms.textContent =
        '入場すると、このブラウザに匿名の番号を保存し、イベントでの記録（入退場や発言など）が保存されます。' +
        '記録は主催者がイベントの運営・記録のために使います。' +
        'メールアドレスそのものは保存しません。';
      frag.appendChild(terms);
    }

    const btns = document.createElement('div');
    btns.className = 'vc-place-btns';

    if (onBack) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'vc-place-back';
      back.textContent = '← アバター';
      back.addEventListener('click', () => {
        root.innerHTML = '';
        onBack();
      });
      btns.appendChild(back);
    }

    if (canEnter) {
      // ---- ジョイン地点（2026-08-06追加）----
      // loyさん「結局繋がるわけだけどジョイン地点として選べるといい」
      // CITY のイベントだけ、会場の中と街のどちらから始めるかを選べる
      const evNow = events.find((e) => e.id === selectedEventId);
      if (evNow && evNow.world === 'city') {
        const spawnRow = document.createElement('div');
        spawnRow.className = 'vc-place-rooms';
        const label = document.createElement('div');
        label.className = 'vc-place-sub';
        label.textContent = '入場する場所';
        spawnRow.appendChild(label);
        for (const [value, text] of [['club', 'clubVERSE の中'], ['city', '街（会場の外）']]) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'vc-place-chip' + (spawnAt === value ? ' selected' : '');
          chip.textContent = text;
          chip.addEventListener('click', () => {
            spawnAt = value;
            render();
          });
          spawnRow.appendChild(chip);
        }
        frag.appendChild(spawnRow);
      }

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'vc-place-go';
      go.textContent = '入場する';
      go.addEventListener('click', () => {
        root.classList.add('hidden');
        root.innerHTML = '';
        // 満室のルームはボタン自体が押せないので、ここに来る値は必ず入れる番号
        onDecide({
          eventId: selectedEventId,
          roomNumber: selectedRoom,
          entryCode: codeByEvent.get(selectedEventId) || '',
          // 'club'（会場の中）/ 'city'（街）。CITY のイベントでだけ選べる
          spawnAt,
        });
      });
      btns.appendChild(go);
    }
    frag.appendChild(btns);
    return frag;
  }

  /**
   * 管理人向け「イベントを立てる」フォーム。
   * 常設イベントを廃止したので、ここが無いと会場を開く手段が無くなる（2026-07-30）。
   */
  function buildAdminForm() {
    const box = document.createElement('div');
    box.className = 'vc-place-admin';
    const title = document.createElement('div');
    title.className = 'vc-place-admin-title';
    title.textContent = '👑 イベントを立てる（管理者）';
    box.appendChild(title);

    const mk = (labelText, el) => {
      const w = document.createElement('div');
      const lb = document.createElement('label');
      lb.className = 'vc-place-label';
      lb.textContent = labelText;
      w.append(lb, el);
      return w;
    };
    const input = (ph, value = '') => {
      const i = document.createElement('input');
      i.className = 'vc-place-input';
      i.type = 'text';
      i.placeholder = ph;
      i.value = value;
      return i;
    };

    const nameI = input('例: 金曜ライブ');
    const codeI = input('空ならパブリック（誰でも入れる）');
    const capI = input('30');
    capI.type = 'number';
    capI.min = '1';
    capI.max = '20000'; // 上限は外してある（2026-08-06 loyさん指示）
    capI.value = '30';

    box.appendChild(mk('イベント名', nameI));
    const row = document.createElement('div');
    row.className = 'vc-place-row2';
    row.append(mk('合言葉', codeI), mk('1ルームの定員', capI));
    box.appendChild(row);

    const loginChk = document.createElement('input');
    loginChk.type = 'checkbox';
    const loginLb = document.createElement('label');
    loginLb.className = 'vc-place-check';
    loginLb.append(loginChk, document.createTextNode('ログイン必須にする（ゲストを入れない）'));
    box.appendChild(loginLb);

    const vrcChk = document.createElement('input');
    vrcChk.type = 'checkbox';
    const vrcLb = document.createElement('label');
    vrcLb.className = 'vc-place-check';
    vrcLb.append(vrcChk, document.createTextNode('VRChatの客席に出す（同時にONにできるのは1つ）'));
    box.appendChild(vrcLb);

    const err = document.createElement('div');
    err.className = 'vc-place-err';
    box.appendChild(err);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'vc-place-go';
    go.textContent = 'イベントを立てる';
    go.addEventListener('click', async () => {
      const name = nameI.value.trim();
      if (!name) {
        err.textContent = 'イベント名を入れてください';
        return;
      }
      go.disabled = true;
      err.textContent = '';
      try {
        const res = await fetch('api/admin/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            code: codeI.value.trim(),
            cap: Number(capI.value) || 30,
            requireLogin: loginChk.checked,
            vrc: vrcChk.checked,
            idt: getIdToken() || undefined,
            devRole: new URLSearchParams(location.search).get('devRole') || undefined,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          err.textContent =
            data.error === 'admin-only'
              ? 'イベントを立てられるのは管理者だけです'
              : data.error === 'too-many-events'
                ? 'イベントの数が上限に達しています'
                : 'イベントを立てられませんでした';
          go.disabled = false;
          return;
        }
        selectedEventId = data.ev.id;
        selectedRoom = null;
        await reloadEvents();
      } catch (e) {
        err.textContent = '通信に失敗しました';
        go.disabled = false;
      }
    });
    box.appendChild(go);
    return box;
  }

  render();
  root.innerHTML = '';
  root.appendChild(panel);
}
