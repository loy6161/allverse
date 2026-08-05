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
.vc-room-hidden { display: none; }

/* スマホでは、このパネルを開くボタンが入っている動画のコントロールより上の段に出す */
@media (max-width: 640px) {
  .vc-room-panel {
    right: 12px; left: 12px; width: auto;
    bottom: var(--m-panel2-bottom);
    /* 上に伸びても右上のボタン（⚙ は top:95・高さ34）に届かない高さで止める。
       vh の固定値だと画面が低い端末で突き抜けるので、残りの空きから計算する */
    max-height: calc(100vh - var(--m-panel2-bottom) - 145px);
  }
}


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

/* ---- イベント設定の中身（2026-08-04 レイアウト整理） ----
   loyさん「どこまでが設定わかりにくい」「設定内のレイアウトも調整して。見づらい」。
   ・枠で囲って「ここからここまでが設定」を見せる
   ・項目は［見出し＋入力＋説明］の3段で必ず同じ形にする（前は入力だけ／説明が上／説明が下がバラバラだった） */
.vc-room-settings {
  border: 1px solid rgba(0,255,234,0.35);
  border-radius: 10px;
  background: rgba(0,255,234,0.04);
  padding: 12px;
  margin-top: 10px;
}
.vc-room-field { margin-bottom: 12px; }
.vc-room-flabel {
  font-size: 11px; font-weight: bold; letter-spacing: 1px;
  color: rgba(220,235,255,0.8); margin-bottom: 4px;
}
.vc-room-settings .vc-room-input,
.vc-room-settings input[type="text"],
.vc-room-settings input[type="number"] {
  width: 100%; box-sizing: border-box; margin: 0;
  padding: 7px 9px; border-radius: 7px; font-size: 13px;
  border: 1px solid rgba(0,255,234,0.3); background: rgba(255,255,255,0.06); color: #fff; outline: none;
}
.vc-room-fhint { font-size: 11px; color: rgba(220,235,255,0.5); margin-top: 4px; line-height: 1.5; }
.vc-room-check { margin-bottom: 12px; }
.vc-room-settings .vc-room-check label { margin-bottom: 0; }
.vc-room-check .vc-room-fhint { margin-left: 20px; }

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
 * @param {(payload:object) => void} p.onUpdateEvent 立てたあとの設定変更
 * @param {(id:string) => void} p.onDeleteEvent
 * @param {() => void} p.onRefresh
 * @param {() => number} [p.getNpcCount] NPCの現在数
 * @param {() => number} [p.getNpcCeiling] 管理者が決めた上限（これを超えて増やせない）
 * @param {() => boolean} [p.isNpcAuto] 自動補充中かどうか
 * @param {(n:number|null) => void} [p.onNpcCount] NPCの人数を指定する（null で自動補充に戻す）
 * @param {{element:HTMLElement, refresh:() => void}} [p.adminExtra]
 *        管理者のときだけパネル末尾に差し込むセクション（イベントの記録）。
 *        中身はそちらが持ち、こちらは置き場所を貸すだけにしている
 */
export function initRoomUI({
  slot,
  getRole,
  getCurrent,
  onMove,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
  onRefresh,
  getNpcCount,
  getNpcCeiling,
  isNpcAuto,
  onNpcCount,
  adminExtra = null,
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
  /** コールのワード表（管理タブで作ったもの）。イベント設定の選択肢に出す */
  let callLists = [];

  let npcNumEl = null; // NPCの人数表示（自動補充で増減するので参照を持っておく）

  function closePanel() {
    open = false;
    panel.classList.add('vc-room-hidden');
  }

  function openPanel() {
    open = true;
    panel.classList.remove('vc-room-hidden');
    if (onRefresh) onRefresh();
    render();
    if (adminExtra && adminExtra.refresh) adminExtra.refresh();
  }

  btn.addEventListener('click', () => (open ? closePanel() : openPanel()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closePanel();
  });

  // 設定を開いているイベントのid（管理者のみ）
  let openSettings = '';

  /**
   * 立てたあとの設定変更。
   * 変えて壊れるものだけサーバーが拒否する（いまは「定員を在室人数より下げる」だけ）。
   * 合言葉を後から付けても、既に入っている人は追い出さない＝次の入場から効く。
   */
  function buildSettings(ev) {
    const box = document.createElement('div');
    box.className = 'vc-room-admin vc-room-settings';

    const t = document.createElement('div');
    t.className = 'vc-room-title';
    t.textContent = `⚙ ${ev.name} の設定`;
    box.appendChild(t);

    /**
     * 設定を1項目ぶん置く（2026-08-04追加）。
     *
     * loyさん「設定内のレイアウトも調整して。見づらい」。
     * それまでは入力と説明がベタ置きで、**どの説明がどの入力のものか分からなかった**
     * （説明が入力の前に来ているものと後に来ているものが混在していた）。
     * **見出し → 入力 → 説明** の順に必ず揃えて、1項目を枠で囲む。
     *
     * @param {HTMLElement} parent 置き先
     * @param {string} label 見出し
     * @param {() => HTMLElement} make 入力を作る関数
     * @param {string} [hint] 入力の下に出す説明
     * @returns {HTMLElement} 作った入力（値を読むのに使う）
     */
    function field(parent, label, make, hint) {
      const row = document.createElement('div');
      row.className = 'vc-room-field';
      const h = document.createElement('div');
      h.className = 'vc-room-flabel';
      h.textContent = label;
      row.appendChild(h);
      const el = make();
      row.appendChild(el);
      if (hint) {
        const n = document.createElement('div');
        n.className = 'vc-room-fhint';
        n.textContent = hint;
        row.appendChild(n);
      }
      parent.appendChild(row);
      return el;
    }

    /** チェックボックス1つぶん（見出しは要らないのでラベルだけ） */
    function check(parent, label, checked, hint) {
      const row = document.createElement('div');
      row.className = 'vc-room-check';
      const lb = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = Boolean(checked);
      lb.append(c, document.createTextNode(label));
      row.appendChild(lb);
      if (hint) {
        const n = document.createElement('div');
        n.className = 'vc-room-fhint';
        n.textContent = hint;
        row.appendChild(n);
      }
      parent.appendChild(row);
      return c;
    }

    const nameI = field(box, 'イベント名', () => {
      const i = document.createElement('input');
      i.type = 'text';
      i.maxLength = 24;
      i.value = ev.name;
      i.className = 'vc-room-input';
      return i;
    });

    // 触っていない合言葉は送らない。
    // 何かの理由で中身が届かず空欄のまま保存すると、合言葉が消えてしまうため
    // （2026-07-31 実際に本番で消えた）。パブリックに戻したいときは
    // 空欄にする＝「触った」ことになるので、意図した変更だけが通る
    let codeTouched = false;
    const codeI = field(box, '合言葉', () => {
      const i = document.createElement('input');
      i.type = 'text';
      i.maxLength = 24;
      i.className = 'vc-room-input';
      // 合言葉の中身はサーバーが管理者にだけ返す
      i.value = ev.code || '';
      i.placeholder = '空ならパブリック（誰でも入れる）';
      i.addEventListener('input', () => { codeTouched = true; });
      return i;
    }, '管理者は合言葉なしでも入れます。');

    const capI = field(box, '定員（1〜60）', () => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '1';
      i.max = '60';
      i.className = 'vc-room-input';
      i.value = String(ev.cap ?? 30);
      return i;
    }, `いま ${ev.count}人 入っているので、それより少なくはできません。`);

    const loginC = check(box, 'ログインした人だけ入れるようにする', ev.requireLogin);
    const vrcC = check(box, 'VRChatの客席に出す', ev.vrc, 'ONにできるのは同時に1つのイベントだけです。');

    // ---- チャットの形（2026-08-02追加）----
    // 配信中はYouTubeへ一本化し、配信のないイベントでは会場チャットを使う。
    // 自動判定にしないのは、誤爆したとき運営が制御を取り戻せなくなるため
    const ytC = check(box, 'YouTubeチャット連動', ev.chatMode === 'youtube',
      'ONの間は会場のチャット入力欄が消え、コメントはYouTube側に集まります。配信が終わったらチャット欄の「💬 会場チャットを開く」で戻せます。');

    // ---- ステージ登壇（2026-08-04追加・テストユーザー要望）----
    // 「管理人+VIPはステージにのれるようにしたい。（イベント設定でON/OFFあり）」
    // ONにしても上がれるのは管理者とVIPだけ。お客さんは今までどおり客席から出られない
    const stgC = check(box, 'ステージに上がれるようにする', ev.stageAccess,
      '上がれるのは管理者とVIPだけです。お客さんは客席のままです。');

    // ---- 会場の明るさ（2026-08-04追加）----
    // 個人設定ではなくイベントの設定。同じ会場にいる全員の画面が同時に変わる。
    //
    // ⚠ **段階の名前は「1〜5」だけにする**（loyさん 2026-08-04
    //   「今の言葉だとよくわからんから、普通に5段階表示でいいよ」）。
    //   「いちばん明るい＋画面全体」のような説明は、選ぶ場では読まれない。
    // ⚠ **選んだ瞬間に反映する**（同 loyさん「プダウンセレクトしら即反映してほしい」）。
    //   保存を押すまで分からないと、見比べながら決められない。
    const briSel = field(box, '会場の明るさ', () => {
      const s = document.createElement('select');
      s.className = 'vc-room-input';
      for (const [value, label] of [
        ['normal', '1（ふつう）'],
        ['dim', '2'],
        ['bright', '3'],
        ['brightest', '4'],
        ['brightest+', '5'],
      ]) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        s.appendChild(o);
      }
      s.value = ev.brightness || 'normal';
      // 選んだ瞬間に送る。保存ボタンでも同じ値が送られるので二重でも害はない
      s.addEventListener('change', () => {
        onUpdateEvent({ id: ev.id, brightness: s.value });
      });
      return s;
    }, '数字が大きいほど明るくなります。選ぶとすぐ全員の画面に反映されます。5だけはアバターと映像も明るくなります。');

    // ---- コールのワード表（2026-08-03追加）----
    // loyさん「リスト使う使わないも選べるとライブイベント以外の観覧イベントとかでも大丈夫」。
    // 既定は「使わない」。ライブでないイベントで勝手に反応させないため
    const callSel = field(box, 'コールのワード', () => {
      const s = document.createElement('select');
      s.className = 'vc-room-input';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '使わない';
      s.appendChild(none);
      for (const l of callLists) {
        const op = document.createElement('option');
        op.value = l.id;
        op.textContent = `${l.name}（${l.words.length}語）`;
        if (l.id === ev.callList) op.selected = true;
        s.appendChild(op);
      }
      return s;
    }, 'このリストの言葉がコメントに入っていたら、その人のアバターが動きます。リストは ⚙設定 →「管理」で作れます。');

    // ---- NPCの全体上限（管理者が決める。各自はこの範囲でしか出せない）----
    const npcI = field(box, 'NPC（賑やかし）の上限', () => {
      const i = document.createElement('input');
      i.type = 'number';
      i.min = '0';
      i.max = '100';
      i.className = 'vc-room-input';
      i.placeholder = '自動';
      i.value = Number.isFinite(ev.npcMax) && ev.npcMax >= 0 ? String(ev.npcMax) : '';
      return i;
    }, '空欄なら自動（定員の空きぶん）。0にすると全員の画面から消えます。');

    // ---- 運営メッセージの固定枠 ----
    const noticeI = field(box, '運営メッセージ', () => {
      const i = document.createElement('input');
      i.type = 'text';
      i.maxLength = 120;
      i.className = 'vc-room-input';
      i.placeholder = '例: 転換中です。次の出演は○○さんです';
      i.value = ev.notice ? ev.notice.text : '';
      return i;
    }, '会場の上部に出したままになります。空にすると消えます。');
    const lvSel = field(box, '運営メッセージの種類', () => {
      const s = document.createElement('select');
      s.className = 'vc-room-input';
      for (const [val, label] of [
        ['info', 'お知らせ（青）'],
        ['important', '重要（黄）'],
        ['emergency', '緊急（赤・画面上部に固定）'],
      ]) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = label;
        s.appendChild(o);
      }
      s.value = ev.notice && ev.notice.level ? ev.notice.level : 'info';
      return s;
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存';
    save.addEventListener('click', () => {
      const npcRaw = npcI.value.trim();
      const payload = {
        id: ev.id,
        name: nameI.value.trim() || ev.name,
        cap: Number(capI.value) || ev.cap,
        requireLogin: loginC.checked,
        vrc: vrcC.checked,
        chatMode: ytC.checked ? 'youtube' : 'local',
        callList: callSel.value,
        brightness: briSel.value,
        stageAccess: stgC.checked,
        // 空欄は自動（-1）。数値ならその値を全体の上限にする
        npcMax: npcRaw === '' ? -1 : Math.max(0, Math.min(100, Number(npcRaw) || 0)),
        notice: { level: lvSel.value, text: noticeI.value.trim() },
      };
      if (codeTouched) payload.code = codeI.value.trim();
      onUpdateEvent(payload);
      openSettings = '';
    });
    box.appendChild(save);
    return box;
  }

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

    // 開いていたイベントが消えた（他の管理者が消した等）ら開きっぱなし扱いを解く。
    // これを忘れると、下の作成フォームが二度と出てこなくなる
    if (openSettings && !events.some((e) => e.id === openSettings && e.mine)) openSettings = '';

    for (const ev of events) {
      const box = document.createElement('div');
      box.className = 'vc-room-event';

      const head = document.createElement('div');
      head.className = 'vc-room-event-head';
      const name = document.createElement('div');
      name.className = 'vc-room-event-name' + (ev.id === cur.eventId ? ' current' : '');
      name.textContent =
        `${ev.name}（${ev.count}/${ev.cap ?? '?'}人）` +
        (ev.requireLogin ? ' 🔒' : '') +
        (ev.hasCode ? ' 🔑' : '') +
        (ev.vrc ? ' 🥽' : '');
      head.appendChild(name);

      // 2026-08-02: 権限はイベントごと（VIPは自分が立てたイベントだけ）。
      // サーバーが `mine` で教えてくれるので、その判断をそのまま使う
      if (ev.mine) {
        const gear = document.createElement('button');
        gear.className = 'vc-room-del';
        gear.textContent = '設定';
        gear.addEventListener('click', () => {
          openSettings = openSettings === ev.id ? '' : ev.id;
          render();
        });
        head.appendChild(gear);

        const del = document.createElement('button');
        del.className = 'vc-room-del';
        del.textContent = '閉じる';
        del.addEventListener('click', () => {
          const n = ev.count || 0;
          const msg =
            n > 0
              ? `「${ev.name}」を閉じます。いま入っている${n}人も退場になります。よろしいですか？`
              : `「${ev.name}」を閉じます。よろしいですか？`;
          if (window.confirm(msg)) onDeleteEvent(ev.id);
        });
        head.appendChild(del);
      }
      box.appendChild(head);

      if (ev.mine && openSettings === ev.id) box.appendChild(buildSettings(ev));

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
          // 合言葉つきの**別の**イベントへ移るときは、入場と同じように合言葉が要る。
          // 以前はサーバーが move で合言葉を見ていなかったため素通りできてしまっていた
          // （2026-08-02 修正）。自分のイベントなら見えているので聞かない
          let code = '';
          if (ev.id !== cur.eventId && ev.hasCode && !ev.mine) {
            code = window.prompt(`「${ev.name}」の合言葉を入力してください`, '') || '';
            if (!code) return;
          }
          onMove(ev.id, r.room, code);
          closePanel();
        });
        list.appendChild(chip);
      }
      box.appendChild(list);
      panel.appendChild(box);
    }

    // イベント作成はVIPにも開放（管理者不在でも会場を開けるように・2026-08-02）
    //
    // ⚠ 設定を開いている間はここから下（作成フォーム・イベントの記録）を出さない。
    //    loyさん「イベント設定を開いてる時は、「イベントを作る」や「イベントの記録」は
    //    非表示にして。どこまでが設定わかりにくい」。
    //    同じ形の入力欄が上下に並ぶと、どれが編集中のイベントのものか分からなくなるため
    if ((role === 'admin' || role === 'vip') && !openSettings) {
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

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = '合言葉（空ならパブリック＝誰でも入れる）';
      codeInput.maxLength = 24;
      admin.appendChild(codeInput);

      const capInput = document.createElement('input');
      capInput.type = 'number';
      capInput.min = '1';
      capInput.max = '60';
      capInput.value = '30';
      capInput.placeholder = '1ルームの定員';
      admin.appendChild(capInput);

      const loginLabel = document.createElement('label');
      const loginCheck = document.createElement('input');
      loginCheck.type = 'checkbox';
      loginLabel.appendChild(loginCheck);
      loginLabel.appendChild(document.createTextNode('ログインした人だけ入れるようにする'));
      admin.appendChild(loginLabel);

      const vrcLabel = document.createElement('label');
      const vrcCheck = document.createElement('input');
      vrcCheck.type = 'checkbox';
      vrcLabel.appendChild(vrcCheck);
      vrcLabel.appendChild(document.createTextNode('VRChatの客席に出す（ONにできるのは1つ）'));
      admin.appendChild(vrcLabel);

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
          code: codeInput.value.trim(),
          cap: Number(capInput.value) || 30,
          vrc: vrcCheck.checked,
        });
        nameInput.value = '';
        videoInput.value = '';
        codeInput.value = '';
        capInput.value = '30';
        loginCheck.checked = false;
        vrcCheck.checked = false;
      });
      admin.appendChild(createBtn);
      panel.appendChild(admin);

      // イベントの記録（logsui.js が中身を持つ）。管理者のときだけ末尾に置く
      if (adminExtra && adminExtra.element) panel.appendChild(adminExtra.element);
    }

    // ⚠ NPCの人数調整は 2026-08-03 に⚙設定パネルへ移した（loyさん
    //   「ルーム画面にNPC設定はいらなくなるね」）。ここには出さない。
    //   部品（buildNpcSection）は renderNpcInto から使われ続ける
  }

  /** NPCの人数スライダー。上限は管理者が決めた値 */
  function buildNpcSection() {
    const box = document.createElement('div');
    box.className = 'vc-room-admin';

    const label = document.createElement('div');
    label.className = 'vc-room-title';
    label.textContent = 'NPC（賑やかし）';
    box.appendChild(label);

    const ceil = getNpcCeiling ? getNpcCeiling() : 0;
    const now = getNpcCount ? getNpcCount() : 0;
    const isAuto = isNpcAuto ? isNpcAuto() : true;

    const hint = document.createElement('div');
    hint.className = 'vc-room-hint';
    hint.textContent =
      ceil > 0
        ? `人の少ない時間でも寂しく見えないように出している飾りです。自分の画面だけ減らせます（上限 ${ceil}体）。`
        : '運営がNPCを出さない設定にしているため、いまは調整できません。';
    box.appendChild(hint);

    const row = document.createElement('div');
    row.className = 'vc-npc-row';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(Math.max(0, ceil));
    range.step = '1';
    range.value = String(Math.min(now, Math.max(0, ceil)));
    range.disabled = ceil <= 0;
    const num = document.createElement('span');
    num.className = 'vc-npc-num';
    num.textContent = isAuto ? `自動 ${now}体` : `${now} 体`;
    npcNumEl = num; // 人数が動いたら refreshNpc() で書き換える

    range.addEventListener('input', () => {
      const v = Number(range.value);
      num.textContent = `${v} 体`;
      if (onNpcCount) onNpcCount(v);
    });
    row.append(range, num);
    box.appendChild(row);

    const presets = document.createElement('div');
    presets.className = 'vc-room-list';
    const autoBtn = document.createElement('button');
    autoBtn.className = 'vc-room-chip' + (isAuto ? ' here' : '');
    autoBtn.textContent = 'おまかせ';
    autoBtn.addEventListener('click', () => {
      if (onNpcCount) onNpcCount(null); // 上限いっぱいに戻す
      render();
    });
    presets.appendChild(autoBtn);
    const zero = document.createElement('button');
    zero.className = 'vc-room-chip';
    zero.textContent = '消す';
    zero.addEventListener('click', () => {
      range.value = '0';
      num.textContent = '0 体';
      if (onNpcCount) onNpcCount(0);
    });
    presets.appendChild(zero);
    box.appendChild(presets);
    return box;
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
    /**
     * NPCの調整だけを別の場所（⚙設定パネル）へ描く（2026-08-03追加）。
     * loyさんの整理方針に合わせて、設定系はまとめて⚙の中から触れるようにした。
     * 中身は🚪パネルのものと同じ部品なので、どちらから触っても同じ結果になる。
     */
    renderNpcInto(host) {
      if (!host) return;
      host.innerHTML = '';
      host.appendChild(buildNpcSection());
    },
    /** コールのワード表が届いた／変わったときに差し替える（2026-08-03追加） */
    setCallLists(lists) {
      callLists = Array.isArray(lists) ? lists : [];
    },
    /** 自動補充でNPCが増減したときに、開いているパネルの人数表示を合わせる */
    refreshNpc() {
      if (!open || !npcNumEl) return;
      const auto = isNpcAuto ? isNpcAuto() : false;
      const now = getNpcCount ? getNpcCount() : 0;
      npcNumEl.textContent = auto ? `自動 ${now}体` : `${now} 体`;
    },
    close: closePanel,
  };
}
