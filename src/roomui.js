// ============================================================
// イベント／ルームのパネル
//
// ・誰でも: イベントとルームの一覧を見て、好きな部屋へ移動できる
// ・管理者: イベントの作成と削除ができる
//
// 「ルーム」はVRChatでいうインスタンスにあたる。VRChatを知らない人にも通じるよう
// 表記は「ルーム」で統一している（2026-07-29 確定）。
// ============================================================

const STYLE_ID = 'vc-room-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-room-btn {
  width: 34px; height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.08);
  color: #eaf6ff; font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.vc-room-btn:hover { border-color: rgba(0,255,234,0.6); }

.vc-room-panel {
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
.vc-room-hidden { display: none; }

.vc-room-title { font-size: 12px; letter-spacing: 2px; color: rgba(0,255,234,0.85); margin-bottom: 8px; }
.vc-room-hint { font-size: 11px; color: rgba(220,235,255,0.5); margin: -4px 0 10px; line-height: 1.5; }

.vc-room-event { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 10px; }
.vc-room-event:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.vc-room-event-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.vc-room-event-name { font-weight: bold; flex: 1 1 auto; }
.vc-room-event-name.current { color: #7cffdc; }

.vc-room-list { display: flex; flex-wrap: wrap; gap: 6px; }
.vc-room-chip {
  padding: 5px 10px; border-radius: 14px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #eaf6ff;
}
.vc-room-chip:hover { border-color: rgba(0,255,234,0.6); }
.vc-room-chip.here { background: linear-gradient(90deg, rgba(0,255,234,0.25), rgba(255,0,229,0.2)); border-color: #00ffea; }
.vc-room-chip.full { opacity: 0.4; cursor: not-allowed; }

.vc-room-admin { border-top: 1px solid rgba(255,255,255,0.12); margin-top: 12px; padding-top: 10px; }
.vc-room-admin input[type="text"] {
  width: 100%; box-sizing: border-box; margin-bottom: 6px;
  padding: 7px 9px; border-radius: 7px; font-size: 13px;
  border: 1px solid rgba(0,255,234,0.3); background: rgba(255,255,255,0.06); color: #fff; outline: none;
}
.vc-room-admin label { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 8px; }
.vc-room-admin button {
  padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
  font-weight: bold; color: #06060f; background: linear-gradient(90deg,#00ffea,#ff00e5);
}
.vc-npc-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.vc-npc-row input[type="range"] { flex: 1 1 auto; accent-color: #00ffea; }
.vc-npc-num { font-size: 12px; min-width: 46px; text-align: right; color: rgba(220,235,255,0.85); }

.vc-room-del {
  border: none; background: none; color: rgba(255,140,160,0.85);
  cursor: pointer; font-size: 11px; padding: 2px 4px;
}
`;
  document.head.appendChild(style);
}

/**
 * @param {Object} p
 * @param {HTMLElement} p.slot ボタンを置く場所（動画パネル内）
 * @param {() => string} p.getRole 現在の権限
 * @param {() => {eventId:string, room:number|null}} p.getCurrent 今いる場所
 * @param {(eventId:string, room:number|null) => void} p.onMove
 * @param {(payload:{name:string,videoId:string,requireLogin:boolean}) => void} p.onCreateEvent
 * @param {(id:string) => void} p.onDeleteEvent
 * @param {() => void} p.onRefresh
 * @param {() => number} [p.getNpcCount] 負荷テスト用NPCの現在数
 * @param {(n:number) => void} [p.onNpcCount] 負荷テスト用NPCの人数変更
 */
export function initRoomUI({
  slot,
  getRole,
  getCurrent,
  onMove,
  onCreateEvent,
  onDeleteEvent,
  onRefresh,
  getNpcCount,
  onNpcCount,
}) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-room-btn';
  btn.title = 'イベント・ルーム';
  btn.textContent = '🚪';
  slot.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'vc-room-panel vc-room-hidden';
  document.body.appendChild(panel);

  let events = [];
  let open = false;

  function closePanel() {
    open = false;
    panel.classList.add('vc-room-hidden');
  }

  function openPanel() {
    open = true;
    panel.classList.remove('vc-room-hidden');
    if (onRefresh) onRefresh();
    render();
  }

  btn.addEventListener('click', () => (open ? closePanel() : openPanel()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closePanel();
  });

  function render() {
    const role = getRole();
    const cur = getCurrent();
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'vc-room-title';
    title.textContent = 'イベント / ルーム';
    panel.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'vc-room-hint';
    hint.textContent = 'ルーム＝VRChatでいうインスタンス。同じイベントなら、どのルームでも同じ映像が同じ位置で流れます。';
    panel.appendChild(hint);

    if (!events.length) {
      const empty = document.createElement('div');
      empty.textContent = '読み込み中…';
      panel.appendChild(empty);
      return;
    }

    for (const ev of events) {
      const box = document.createElement('div');
      box.className = 'vc-room-event';

      const head = document.createElement('div');
      head.className = 'vc-room-event-head';
      const name = document.createElement('div');
      name.className = 'vc-room-event-name' + (ev.id === cur.eventId ? ' current' : '');
      name.textContent = `${ev.name}（${ev.count}人）` + (ev.requireLogin ? ' 🔒' : '');
      head.appendChild(name);

      if (role === 'admin' && !ev.permanent) {
        const del = document.createElement('button');
        del.className = 'vc-room-del';
        del.textContent = '削除';
        del.addEventListener('click', () => onDeleteEvent(ev.id));
        head.appendChild(del);
      }
      box.appendChild(head);

      const list = document.createElement('div');
      list.className = 'vc-room-list';
      const rooms = ev.rooms && ev.rooms.length ? ev.rooms : [{ room: 1, count: 0, full: false }];
      for (const r of rooms) {
        const chip = document.createElement('button');
        const here = ev.id === cur.eventId && r.room === cur.room;
        chip.className = 'vc-room-chip' + (here ? ' here' : '') + (r.full && !here ? ' full' : '');
        chip.textContent = `#${r.room}（${r.count}）`;
        chip.addEventListener('click', () => {
          if (r.full && !here) return;
          onMove(ev.id, r.room);
          closePanel();
        });
        list.appendChild(chip);
      }
      box.appendChild(list);
      panel.appendChild(box);
    }

    if (role === 'admin') {
      const admin = document.createElement('div');
      admin.className = 'vc-room-admin';

      const label = document.createElement('div');
      label.className = 'vc-room-title';
      label.textContent = 'イベントを作る';
      admin.appendChild(label);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'イベント名（例: WEEKENDS vol.12）';
      nameInput.maxLength = 24;
      admin.appendChild(nameInput);

      const videoInput = document.createElement('input');
      videoInput.type = 'text';
      videoInput.placeholder = 'YouTubeのURL または 動画ID（後からでも設定できます）';
      admin.appendChild(videoInput);

      const loginLabel = document.createElement('label');
      const loginCheck = document.createElement('input');
      loginCheck.type = 'checkbox';
      loginLabel.appendChild(loginCheck);
      loginLabel.appendChild(document.createTextNode('ログインした人だけ入れるようにする'));
      admin.appendChild(loginLabel);

      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.textContent = '作成';
      createBtn.addEventListener('click', () => {
        const nm = nameInput.value.trim();
        if (!nm) return;
        onCreateEvent({
          name: nm,
          videoId: extractVideoId(videoInput.value.trim()),
          requireLogin: loginCheck.checked,
        });
        nameInput.value = '';
        videoInput.value = '';
        loginCheck.checked = false;
      });
      admin.appendChild(createBtn);
      panel.appendChild(admin);

      // ---- 負荷テスト用のNPC ----
      // 自分の画面にだけ出る。他の人には見えないので、いつ試しても迷惑にならない
      const test = document.createElement('div');
      test.className = 'vc-room-admin';

      const testLabel = document.createElement('div');
      testLabel.className = 'vc-room-title';
      testLabel.textContent = '負荷テスト（NPC）';
      test.appendChild(testLabel);

      const testHint = document.createElement('div');
      testHint.className = 'vc-room-hint';
      testHint.textContent = '自分の画面にだけ人を増やして、描画が重くならないか確かめられます。他の人には見えません。';
      test.appendChild(testHint);

      const row = document.createElement('div');
      row.className = 'vc-npc-row';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '5';
      range.value = String(getNpcCount ? getNpcCount() : 0);
      const num = document.createElement('span');
      num.className = 'vc-npc-num';
      num.textContent = `${range.value} 体`;
      const apply = (v) => {
        num.textContent = `${v} 体`;
        if (onNpcCount) onNpcCount(Number(v));
      };
      range.addEventListener('input', () => apply(range.value));
      row.append(range, num);
      test.appendChild(row);

      const presets = document.createElement('div');
      presets.className = 'vc-room-list';
      for (const n of [0, 10, 30, 60, 100]) {
        const b = document.createElement('button');
        b.className = 'vc-room-chip';
        b.textContent = n === 0 ? '消す' : `${n}体`;
        b.addEventListener('click', () => {
          range.value = String(n);
          apply(n);
        });
        presets.appendChild(b);
      }
      test.appendChild(presets);
      panel.appendChild(test);
    }
  }

  /** URLでも動画IDでも受け付ける（screenui.js と同じ考え方） */
  function extractVideoId(raw) {
    if (!raw) return '';
    const s = raw.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const m =
      s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
      s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
      s.match(/\/live\/([A-Za-z0-9_-]{11})/) ||
      s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  return {
    setEvents(list) {
      events = Array.isArray(list) ? list : [];
      if (open) render();
    },
    close: closePanel,
  };
}
