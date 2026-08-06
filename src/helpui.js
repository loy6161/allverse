// ============================================================
// ヘルプパネル（❓）
//
// VRChatを知らない人が来る前提のサービスなので、遊びに来た人向けの
// 「つかいかた」を常設で見られる場所を作る。
// 「運営向け」タブはイベントを立てる側（管理者・VIP）だけの情報なので、
// それ以外の人には**タブごと**出さない（見えても混乱させるだけのため）。
//
// 権限は入場後にログイン/権限確定が来て変わりうるので、開くたびに
// getRole() を読み直す（roomui.js / people.js と同じ考え方）。
// ============================================================

const STYLE_ID = 'vc-help-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-help-btn {
  width: 34px; height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.08);
  color: #eaf6ff; font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.vc-help-btn:hover { border-color: rgba(0,255,234,0.6); }

.vc-help-panel {
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
.vc-help-hidden { display: none; }

/* スマホでは、このパネルを開くボタンが入っている動画のコントロールより上の段に出す
   （roomui.js / people.js と同じ積み方。1か所で決めた --m-* を各モジュールが参照する） */
@media (max-width: 640px) {
  .vc-help-panel {
    right: 12px; left: 12px; width: auto;
    bottom: var(--m-panel2-bottom);
    /* 上に伸びても右上のボタン列に届かない高さで止める。vh 固定だと低い端末で
       突き抜けるので、残りの空きから計算する（roomui.js と同じ理由） */
    max-height: calc(100vh - var(--m-panel2-bottom) - 145px);
  }
}

.vc-help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.vc-help-title { font-size: 12px; letter-spacing: 2px; color: rgba(0,255,234,0.85); }
.vc-help-x {
  border: none; background: none; color: rgba(220,235,255,0.6);
  font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px;
}
.vc-help-x:hover { color: #fff; }

.vc-help-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.vc-help-tab {
  padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05);
  color: rgba(234,246,255,0.7);
}
.vc-help-tab:hover { border-color: rgba(0,255,234,0.5); }
.vc-help-tab.active {
  background: rgba(0,255,234,0.15); color: #7cffdc; border-color: rgba(0,255,234,0.6);
}

.vc-help-sec { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; margin-top: 10px; }
.vc-help-sec:first-child { border-top: none; padding-top: 0; margin-top: 0; }
.vc-help-h { font-size: 12px; font-weight: bold; color: rgba(220,235,255,0.9); margin-bottom: 4px; }

/* 表示のせってい（2026-08-03追加） */
.vc-help-note { font-size: 11px; line-height: 1.7; color: rgba(220,235,255,0.6); margin: 4px 0 8px; }
.vc-help-choices { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.vc-help-choice {
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.06);
  color: #eaf6ff;
  border-radius: 8px;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.vc-help-choice:hover { border-color: rgba(0,255,234,0.6); }
.vc-help-choice.active {
  border-color: rgba(0,255,234,0.9);
  background: rgba(0,255,234,0.2);
  font-weight: bold;
}
.vc-help-list { margin: 0; padding-left: 18px; line-height: 1.6; }
.vc-help-list li { margin-bottom: 5px; }
.vc-help-key {
  display: inline-block; padding: 1px 6px; margin: 0 1px; border-radius: 4px;
  background: rgba(255,255,255,0.12); font-size: 11px; white-space: nowrap;
}
`;
  document.head.appendChild(style);
}

/** つかいかたタブの中身。誰でも見られる */
function renderUsage(body) {
  const sections = [
    {
      h: '動く・見る',
      items: [
        '移動: <span class="vc-help-key">WASD</span> または <span class="vc-help-key">矢印キー</span>／ジャンプ: <span class="vc-help-key">Space</span>',
        '視点: ドラッグで回せます／ズーム: ホイール（スマホはピンチ）',
        '視点の高さ: <b>マウスの中ボタンを押したまま上下</b>にドラッグ（押しただけで元の高さに戻ります）。アバターが小さくて見づらいときに使えます',
        '一人称視点: ホイールを、これ以上寄れない所からさらに内側へ回すと切り替わります（引くと三人称に戻ります）',
      ],
    },
    {
      h: 'エモート（数字キー1〜6）',
      items: [
        '<span class="vc-help-key">1</span> 👋手をふる　<span class="vc-help-key">2</span> 👏拍手　<span class="vc-help-key">3</span> ⤴️ジャンプ',
        '<span class="vc-help-key">4</span> 🕺おどる　<span class="vc-help-key">5</span> 💗ハート　<span class="vc-help-key">6</span> 🔦ペンライト',
        '<b><span class="vc-help-key">0</span> でスペシャルエモートに切り替わります</b>（もう一度押すと戻ります）。テンキーだけで操作できます',
        'スペシャルエモート: ✊コブシ　😄ニコニコ　🤘ヘッドバンキング　⭐星　🎆花火　🍺乾杯',
        '<b>打った言葉でも動きます</b>：<b>888</b>で拍手、<b>www</b>でニコニコ、<b>乾杯</b>で🍺、絵文字を並べるとその絵文字のエモート。たくさん並べるとその数だけ続けて動きます',
        '<b>YouTubeのコメントでも会場のチャットでも同じように反応します</b>（ふつうの会話では何も出ません）。自分だけ止めたいときは ⚙設定 で切れます',
      ],
    },
    {
      h: '画面の便利機能',
      items: [
        'スクリーンを画面いっぱいに: <span class="vc-help-key">F</span>',
        'UIを一時的に隠す: <span class="vc-help-key">H</span>',
        '頭上のネームプレートの表示切替: <span class="vc-help-key">N</span>',
        'スマホは画面下の操作キーで移動、右上の⚙から動画のコントロールを開けます',
      ],
    },
    {
      h: '困ったとき',
      items: [
        '音が出ないとき: 画面に出ている「🔇 タップで音を出す」を押してください（スマホは音を出さずに始まる決まりになっています）',
        '映像が止まって遅れて感じるとき: 🔄（Resync）を押すと読み込み直せます',
        '迷惑な人がいたら: 右上の ⚙ →「参加者」からその人を「ブロック」できます。お互いに見えなくなり、相手には知らされません',
      ],
    },
    {
      h: 'ログインすると増えること',
      items: [
        'できるようになること: チャット・エモート・見た目（アバター）の変更',
        'ログインしないゲストのままだと閲覧だけで、これらは使えません',
      ],
    },
    {
      h: 'NPC（賑やかし）が気になるとき',
      items: [
        'NPCは、人が少ない時間でも会場が寂しく見えないように出している飾りです（実在の人ではありません）',
        '右上の ⚙ →「NPC設定」のスライダーで<b>自分の画面だけ</b>減らせます。「消す」で0にもできます。設定はこの端末に残ります',
      ],
    },
    {
      h: 'コメントしたいとき',
      items: [
        'ふだんは画面左下のチャット欄から、会場にいる人へ話しかけられます（ログインが必要）',
        '配信と連動しているイベントでは、会場のチャット欄は<b>お知らせ専用</b>になり、コメントはYouTubeのチャットから送ります（会場内に表示されます）',
        'スマホでは会場の中にYouTubeチャットを出せないため、「YouTubeチャットを開く」ボタンから別画面で開きます',
      ],
    },
    {
      h: 'ネームプレートの色',
      items: [
        '👑 金＝管理者　⭐ マゼンタ＝VIP　シアン＝ふつうの参加者　灰＝NPC（賑やかし・実在の人ではありません）',
      ],
    },
  ];

  for (const sec of sections) {
    const box = document.createElement('div');
    box.className = 'vc-help-sec';
    const h = document.createElement('div');
    h.className = 'vc-help-h';
    h.textContent = sec.h;
    box.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'vc-help-list';
    for (const item of sec.items) {
      const li = document.createElement('li');
      li.innerHTML = item; // 中身はこのファイル内の固定文言のみ（外部入力は入れない）
      ul.appendChild(li);
    }
    box.appendChild(ul);
    body.appendChild(box);
  }
}

/**
 * 運営向けタブの中身。admin/vip のときだけタブごと出す。
 * BANだけは管理者専用の操作だが、キックとの違いが分かるようここで併記する。
 */
function renderAdmin(body) {
  const sections = [
    {
      h: 'イベントの立て方',
      items: [
        '右下の 🚪 パネルから作成できます（管理者・VIP）',
        'イベントが0件だと誰も入場できないため、入場画面にも作成フォームがあります',
        '<b>立てた本人が、そのイベントの持ち主になります。</b>設定の変更・動画の差し替え・閉じるは、持ち主と管理者だけができます（他の人のイベントには触れません）',
      ],
    },
    {
      h: 'イベント設定',
      items: [
        '合言葉（空ならパブリック＝誰でも入れる）',
        '定員（1〜60）。<b>いま入っている人数より下げることはできません</b>',
        'ログインした人だけ入れるようにする、の切替',
        'VRChatの客席に映像を出す（ONにできるのは同時に1イベントだけ）',
        '<b>YouTubeチャット連動</b>：ONにすると会場のチャット入力欄が消え、代わりにYouTubeのライブチャットが会場に出ます。配信中はこちらを推奨（コメントがYouTube側に集まります）',
        '<b>配信が終わったら</b>：チャット欄の「💬 会場チャットを開く」を押すと、その場で会場チャットに戻せます（運営だけに見えます・全員に反映）。そのまま交流できます',
        '<b>会場の明るさ</b>：ふつう／明るめ／いちばん明るい の3段階。<b>そのイベントにいる全員の画面</b>が変わります（個人設定ではありません）',
        '<b>ステージに上がれるようにする</b>：ONにすると<b>管理者とVIPだけ</b>ステージへ歩いて上がれます。お客さんは客席のままです',
        '<b>NPCの上限</b>：空欄なら自動（定員の空きぶん）。0にすると全員の画面からNPCが消えます',
        '<b>運営メッセージ</b>：会場の上部に出したままにできます。空にすると消えます。「緊急」はUIを隠していても表示されます',
      ],
    },
    {
      h: '動画',
      items: [
        '右上の 📺 から動画を差し替えられます',
        '再生・一時停止などの操作は、<b>同じイベントの全ルーム</b>に届きます（ルームごとには変えられません）',
      ],
    },
    {
      h: 'キック と BAN の違い',
      items: [
        'キック：その場から退出させます。管理者・VIPが使え、<b>何分入れなくするかを選べます</b>（0分＝すぐ入り直せる／5・15・60・180分）',
        'キックの締め出しは<b>ゲストにも効きます</b>（ブラウザ単位）。ただしブラウザの保存を消されると入り直せてしまうので、完全な締め出しではありません',
        'BAN：Googleアカウント単位で再入場そのものを止めます。<b>管理者だけ</b>が使え、一覧からいつでも解除できます',
        'キックの履歴は 👥 パネルに残ります（管理者のみ）。同じ人が何回蹴られたかも出るので、BANにするかの判断に使えます',
      ],
    },
    {
      h: 'NPC（賑やかし）',
      items: [
        'NPCは<b>各自の画面にだけ</b>出ています。誰かが減らしても他の人には影響しません',
        '🚪 パネルのスライダーは自分の画面用。全体の上限はイベント設定の「NPCの上限」で決めます',
      ],
    },
    {
      h: 'イベントの記録',
      items: [
        '🚪 パネル下部の 📊 から見られます（管理者のみ）',
        'ピーク同接・累計人数・滞在時間・CSVの書き出しが確認できます',
      ],
    },
    {
      h: 'イベントを閉じるとき',
      items: ['閉じると、その時いる人も全員退場になります（🚪 パネルの「閉じる」）'],
    },
  ];

  for (const sec of sections) {
    const box = document.createElement('div');
    box.className = 'vc-help-sec';
    const h = document.createElement('div');
    h.className = 'vc-help-h';
    h.textContent = sec.h;
    box.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'vc-help-list';
    for (const item of sec.items) {
      const li = document.createElement('li');
      li.innerHTML = item; // 中身はこのファイル内の固定文言のみ（外部入力は入れない）
      ul.appendChild(li);
    }
    box.appendChild(ul);
    body.appendChild(box);
  }
}

/**
 * @param {Object} p
 * @param {HTMLElement} p.slot ボタンを置く場所（動画パネル内。roomui.js と同じ使い方）
 * @param {() => string} p.getRole 現在の権限（'guest'|'user'|'vip'|'admin'）
 */
export function initHelpUI({ slot, getRole }) {
  injectStyle();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vc-help-btn';
  btn.title = 'ヘルプ';
  btn.textContent = '❓';
  slot.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'vc-help-panel vc-help-hidden';
  document.body.appendChild(panel);

  let open = false;
  // 「運営向け」タブを開いた後にゲストへ戻る想定は薄いが、念のため
  // 権限が落ちたら「つかいかた」へ戻す（render() 内で判定する）
  let activeTab = 'usage';

  function closePanel() {
    open = false;
    panel.classList.add('vc-help-hidden');
  }

  function openPanel() {
    open = true;
    panel.classList.remove('vc-help-hidden');
    render();
  }

  btn.addEventListener('click', () => (open ? closePanel() : openPanel()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closePanel();
  });

  function render() {
    // 権限は入場後に確定するため、開くたびに読み直す
    const role = getRole();
    const showAdminTab = role === 'admin' || role === 'vip';
    if (activeTab === 'admin' && !showAdminTab) activeTab = 'usage';

    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'vc-help-head';
    const title = document.createElement('div');
    title.className = 'vc-help-title';
    title.textContent = 'ヘルプ';
    head.appendChild(title);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'vc-help-x';
    x.textContent = '×'; // ×
    x.title = '閉じる';
    x.addEventListener('click', closePanel);
    head.appendChild(x);
    panel.appendChild(head);

    const tabs = document.createElement('div');
    tabs.className = 'vc-help-tabs';
    const usageTab = document.createElement('button');
    usageTab.type = 'button';
    usageTab.className = 'vc-help-tab' + (activeTab === 'usage' ? ' active' : '');
    usageTab.textContent = 'つかいかた';
    usageTab.addEventListener('click', () => {
      activeTab = 'usage';
      render();
    });
    tabs.appendChild(usageTab);

    if (showAdminTab) {
      const adminTab = document.createElement('button');
      adminTab.type = 'button';
      adminTab.className = 'vc-help-tab' + (activeTab === 'admin' ? ' active' : '');
      adminTab.textContent = '運営向け';
      adminTab.addEventListener('click', () => {
        activeTab = 'admin';
        render();
      });
      tabs.appendChild(adminTab);
    }
    panel.appendChild(tabs);

    const body = document.createElement('div');
    panel.appendChild(body);

    if (activeTab === 'admin' && showAdminTab) {
      renderAdmin(body);
    } else {
      renderUsage(body);
    }
  }

  return { close: closePanel };
}
