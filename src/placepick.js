// ============================================================
// 入場前の「イベント／ルーム選択」画面
//
// アバターを決めたあと、どこに入るかを選ぶ一歩を挟む。
// ワールドに入ったあとの切り替え（roomui.js の 🚪 パネル）はそのまま残してある。
//
// 「ルーム」はVRChatでいうインスタンス。VRChatを知らない人にも通じる語を選んでいる。
// ============================================================

import { fetchConfig, isSignedIn } from './login.js';

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
  const events = Array.isArray(cfg.events) && cfg.events.length ? cfg.events : [];

  let selectedEventId = events.length ? events[0].id : '';
  // 入るルームは必ず明示的に選ばせる（「おまかせ」は 2026-07-30 に廃止）。
  // 既定は「空きのある一番小さい番号」で、画面を開いた時点で選択済みの状態にする
  let selectedRoom = null;

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
      nm.textContent = ev.name + (ev.requireLogin ? ' 🔒' : '');
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

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'vc-place-go';
    go.textContent = '入場する';
    go.addEventListener('click', () => {
      root.classList.add('hidden');
      root.innerHTML = '';
      // 満室のルームはボタン自体が押せないので、ここに来る値は必ず入れる番号。
      // 万一 null のままなら（イベントが空など）サーバー側の自動割り当てに任せる
      onDecide({ eventId: selectedEventId, roomNumber: selectedRoom });
    });
    btns.appendChild(go);

    panel.appendChild(btns);
  }

  render();
  root.innerHTML = '';
  root.appendChild(panel);
}
