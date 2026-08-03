// ============================================================
// YouTubeのライブチャットを会場に埋め込む（2026-08-02追加）
//
// なぜこうするのか（設計の経緯は docs/WHY.md §29）:
//   配信中はYouTubeのチャットが賑わった方がよい。ところがブラウザ会場に
//   独自チャットがあると、そちらに書く人が出て会話が2か所に分裂する。
//   そこで**発言はYouTubeへ一本化**し、会場にはYouTubeのチャットそのものを置く。
//
// ここに置いているのはYouTubeのページそのもの（iframe）なので、
//   ・入力欄・スパチャ・メンバー表示・モデレーションが全部そのまま使える
//   ・投稿はYouTubeに対して直接行われ、こちらのAPIは1回も使わない
//     （＝APIの利用枠も、ユーザーごとの許可も要らない）
//
// ⚠ 公式に「モバイルWebでの埋め込みは非対応」と案内されているため、
//   スマホでは埋め込まず「YouTubeで開く」ボタンにしている。
// ⚠ ブラウザのサードパーティCookie制限によっては、埋め込み内でログイン状態が
//   引き継がれず投稿できないことがある。その場合の逃げ道として、
//   PCでも「別タブで開く」ボタンを常に出しておく。
// ============================================================

import { makeFloating, isFloatEnabled } from './floatwin.js';

const STYLE_ID = 'vc-ytchat-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-yt {
  position: fixed;
  right: 16px;
  /* ⚠ 右下の操作ボタン（❓ヘルプ / 🚪イベント / 👥参加者 / 全画面）と
     動画のコントロールがここに並んでいる。bottom:16px にすると
     **その上に覆いかぶさってボタンが押せなくなる**（2026-08-03 本番で発覚。
     設定画面を閉じられない状態になった）。ボタン列の上まで持ち上げる */
  bottom: 110px;
  width: min(340px, calc(100vw - 32px));
  height: min(460px, calc(100vh - 260px));
  display: flex; flex-direction: column;
  border-radius: 12px; overflow: hidden;
  background: rgba(12,12,28,0.96);
  border: 1px solid rgba(0,255,234,0.35);
  box-shadow: 0 0 30px rgba(0,0,0,0.5);
  font-family: "Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif;
  z-index: 38;
}
.vc-yt-hidden { display: none; }

.vc-yt-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  font-size: 12px; letter-spacing: 1px;
  color: rgba(0,255,234,0.85);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.vc-yt-title { flex: 1 1 auto; }
.vc-yt-head button {
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06);
  color: #eaf6ff; border-radius: 8px; font-size: 11px; padding: 4px 8px; cursor: pointer;
}
.vc-yt-head button:hover { border-color: rgba(0,255,234,0.6); }

.vc-yt-body { flex: 1 1 auto; position: relative; background: #0f0f0f; }
.vc-yt-body iframe { width: 100%; height: 100%; border: 0; display: block; }

.vc-yt-fallback {
  padding: 14px; font-size: 12px; line-height: 1.7; color: #eaf6ff;
  display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
}
.vc-yt-open {
  padding: 10px 16px; border: none; border-radius: 9px; cursor: pointer;
  font-weight: bold; color: #06060f;
  background: linear-gradient(90deg,#00ffea,#ff00e5);
}
.vc-yt-note { font-size: 11px; color: rgba(220,235,255,0.5); line-height: 1.6; }

/* ---- 自分の発言をアバターに出す（合言葉での連携） ---- */
.vc-yt-link {
  border-top: 1px solid rgba(255,255,255,0.1);
  padding: 8px 10px;
  font-size: 11px; line-height: 1.7; color: #eaf6ff;
  display: flex; flex-direction: column; gap: 6px;
}
.vc-yt-link button {
  align-self: flex-start;
  border: 1px solid rgba(0,255,234,0.5); background: rgba(0,255,234,0.08);
  color: #eaf6ff; border-radius: 8px; font-size: 11px; padding: 5px 10px; cursor: pointer;
}
.vc-yt-link button:hover { background: rgba(0,255,234,0.18); }
.vc-yt-code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 18px; font-weight: bold; letter-spacing: 2px;
  color: #00ffea; user-select: all;
}
.vc-yt-linked { color: #7dffb0; }

/* UI非表示（Hキー）に追従する */
body.vc-ui-hidden .vc-yt { display: none; }

/* スマホは埋め込みが使えないので、開くボタンだけの小さな帯にする */
@media (max-width: 640px) {
  .vc-yt {
    right: 12px; left: 12px; width: auto;
    bottom: var(--m-panel2-bottom, 96px);
    height: auto; max-height: 40vh;
  }
}
`;
  document.head.appendChild(style);
}

/**
 * 埋め込みが使える環境か。公式にモバイルWebは非対応と案内されている。
 * タッチ判定は main.js の IS_TOUCH と同じ式に揃える（`?mobile=1` の確認用も含む）。
 * PCのブラウザを細くしただけの場合は埋め込みのままにする（実機ではないため）。
 */
function canEmbed() {
  if (typeof window === 'undefined') return false;
  const touch =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    location.search.includes('mobile=1');
  const narrow = window.innerWidth <= 640;
  return !(touch && narrow);
}

/**
 * @param {Object} p
 * @param {() => string} p.getVideoId いま流している動画のID
 * @param {() => void} [p.onRequestCode] 合言葉をくれ、とサーバーに頼む
 * @param {() => void} [p.onUnlink] 連携をやめる
 */
export function initYouTubeChat({ getVideoId, onRequestCode, onUnlink }) {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'vc-yt vc-yt-hidden';

  const head = document.createElement('div');
  head.className = 'vc-yt-head';
  const title = document.createElement('div');
  title.className = 'vc-yt-title';
  title.textContent = 'YouTube チャット';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = '別タブで開く';
  // 埋め込みの中でログインが切れていて投稿できないときの逃げ道。
  // PCでも常に出しておく（Cookieの制限は環境によって変わるため）
  openBtn.addEventListener('click', () => openExternal());
  head.append(title, openBtn);

  const body = document.createElement('div');
  body.className = 'vc-yt-body';

  // ---- 自分の発言をアバターに出す（合言葉での連携・2026-08-03追加） ----
  //
  // YouTubeのチャットは誰でも書けるので、そのままでは「会場にいるどのアバターの
  // 発言なのか」が分からない。そこで会場側で合言葉を出し、それをYouTubeへ
  // 打ってもらうことで、そのチャンネルと本人を結びつける。
  // 一度繋げば次回以降は不要（サーバーが覚えている）。
  const link = document.createElement('div');
  link.className = 'vc-yt-link';
  root.append(head, body, link);
  document.body.appendChild(root);

  let linkState = { on: false, linked: false };

  function renderLink() {
    link.innerHTML = '';
    if (!linkState.on) {
      // サーバー側の読み取りが動いていない（APIキー未設定）。
      // 出しても押せないだけなので、枠ごと消す
      link.style.display = 'none';
      return;
    }
    link.style.display = 'flex';

    if (linkState.linked) {
      const ok = document.createElement('div');
      ok.className = 'vc-yt-linked';
      ok.textContent = linkState.ytName
        ? `✔ ${linkState.ytName} として連携済み。YouTubeでの発言があなたのアバターに出ます。`
        : '✔ 連携済み。YouTubeでの発言があなたのアバターに出ます。';
      const off = document.createElement('button');
      off.type = 'button';
      off.textContent = '連携をやめる';
      off.addEventListener('click', () => {
        if (onUnlink) onUnlink();
      });
      link.append(ok, off);
      return;
    }

    if (linkState.code) {
      const p = document.createElement('div');
      p.textContent = 'この合言葉を YouTube のチャットに送ってください:';
      const code = document.createElement('div');
      code.className = 'vc-yt-code';
      code.textContent = linkState.code;
      const note = document.createElement('div');
      note.className = 'vc-yt-note';
      note.textContent = '送ると、あなたのYouTubeでの発言がアバターの上に出るようになります。10分で期限切れになります。';
      link.append(p, code, note);
      return;
    }

    const p = document.createElement('div');
    p.textContent = 'YouTubeでの発言を、自分のアバターの上に出せます。';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '🔗 自分のチャンネルと繋ぐ';
    btn.addEventListener('click', () => {
      if (onRequestCode) onRequestCode();
    });
    link.append(p, btn);
  }

  let shown = false;
  let mountedFor = '';

  function chatUrl(videoId) {
    // embed_domain は埋め込み元のホスト名。これが無いとYouTube側に拒否される。
    //
    // dark_theme=1（2026-08-03追加）:
    //   YouTube側は既定で**白背景**のチャットを出す。暗い会場の中に白い板が入るだけでなく、
    //   実際に**白背景に白い文字**になって読めない状態だった（loyさん指摘）。
    //   ⚠ 中身はYouTubeのページなので、こちらのCSSでは一切手を出せない。
    //     色を変える手段はこのパラメータしかない
    return (
      `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}` +
      `&embed_domain=${encodeURIComponent(location.hostname)}` +
      `&dark_theme=1`
    );
  }

  function openExternal() {
    const v = getVideoId();
    if (!v) return;
    window.open(chatUrl(v), '_blank', 'noopener');
  }

  /** スマホ用。埋め込まずに案内とボタンだけ置く */
  function renderFallback() {
    body.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'vc-yt-fallback';
    const p = document.createElement('div');
    p.textContent = 'このイベントのコメントは YouTube のチャットに集まります。';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vc-yt-open';
    btn.textContent = '▶ YouTube チャットを開く';
    btn.addEventListener('click', openExternal);
    const note = document.createElement('div');
    note.className = 'vc-yt-note';
    // 「なぜスマホだけ別画面なのか」を書いておかないと不具合に見える
    note.textContent = 'スマホではYouTubeのチャットを会場の中に表示できないため、別画面で開きます。';
    box.append(p, btn, note);
    body.appendChild(box);
  }

  function renderEmbed(videoId) {
    body.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = chatUrl(videoId);
    frame.title = 'YouTube ライブチャット';
    body.appendChild(frame);
  }

  let mountedEmbed = null; // 埋め込みで描いたか（画面幅が変わったら描き直す判断に使う）

  function mount() {
    const v = getVideoId();
    if (!v) {
      body.innerHTML = '';
      mountedFor = '';
      mountedEmbed = null;
      return;
    }
    const embed = canEmbed();
    // 同じ動画で描き方も同じなら貼り直さない（入力中の文字が消えるため）
    if (mountedFor === v && mountedEmbed === embed) return;
    mountedFor = v;
    mountedEmbed = embed;
    if (embed) renderEmbed(v);
    else renderFallback();
  }

  // 画面の幅が変わると「埋め込めるか」の判定も変わる。
  // 変わったときだけ描き直す（毎回貼り直すとチャットが読み込み直しになる）
  window.addEventListener('resize', () => {
    if (shown && mountedEmbed !== null && mountedEmbed !== canEmbed()) mount();
  });

  // 動画が差し替わったのに refresh() を呼び忘れた経路があっても追いつくようにする。
  // 2026-08-03、イベントを移動したときに呼び忘れがあり、チャットだけ前の動画のまま
  // 残って「このライブストリームではチャットは無効です」と出た。
  // mount() は動画idが同じなら何もしないので、ここを回しても貼り直しは起きない
  setInterval(() => {
    if (shown) mount();
  }, 3000);

  // 掴んで動かす・大きさを変える（2026-08-03追加）。
  // 右下の動画コントロールと重なるのを、本人の手で逃がせるようにする
  if (isFloatEnabled()) {
    makeFloating(root, { key: 'ytchat', title: 'YouTube チャット', minW: 260, minH: 220 });
  }

  renderLink();

  return {
    /** YouTube連動イベントのときだけ出す */
    setVisible(on) {
      shown = Boolean(on);
      root.classList.toggle('vc-yt-hidden', !shown);
      if (shown) mount();
    },
    /** 入場時に、読み取りが有効か・既に繋がっているかを受け取る */
    setLinkState({ on, linked, ytName = '' }) {
      linkState = { ...linkState, on: Boolean(on), linked: Boolean(linked), ytName };
      if (linkState.linked) linkState.code = '';
      renderLink();
    },
    /** 合言葉が届いた */
    showCode(code) {
      linkState.code = code || '';
      renderLink();
    },
    /** 動画が差し替わったら貼り直す */
    refresh() {
      if (shown) mount();
    },
    isVisible: () => shown,
  };
}
