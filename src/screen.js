import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// デモ用の埋め込み動画ID（24時間ライブ配信・埋め込み許可されているもの）。
// ⚠ 既定値としては**使わない**。サーバーに繋がらないときのデモ表示で
//   main.js が明示的に渡すためだけに残してある
//   （2026-08-06: 動画が入っていない会場ではスクリーンごと出さない方針にした）
export const DEMO_VIDEO_ID = 'unrobrGhlv0'; // clubVERSE関連動画（loyさん指定）

/** VRの右目にも映像を出すか（本人の選択を覚えておく場所） */
const RIGHT_EYE_KEY = 'vc.vr.rightEye';

// ステージのLEDスクリーン位置に合わせたYouTube埋め込みレイヤー（CSS3D方式）
// - 入場前: 空（背後のWebGL製「VERSE CITY」スクリーンが見える）
// - play() 呼び出しで iframe を生成して再生開始（入場ボタンのクリックが
//   ユーザー操作になるので、音声つき自動再生が許可されやすい）
//
// 【前後関係について】
// YouTubeのiframeはWebGLの中に描けないため、素直に重ねるとスクリーンが常に手前になり、
// スクリーンの前に立ったアバターが映像に隠れてしまう。
// そこで iframe を「キャンバスの後ろ」に置き、キャンバス側のスクリーン面を
// 「色を書かず深度だけ書くマテリアル」にして穴を開ける。
// これで映像は穴から見え、手前のアバターはキャンバスに描かれて映像の上に出る。
/**
 * @param {Object} [place] スクリーンの場所と大きさ。ワールドによって違うので外から渡す。
 *   既定は仮ワールドのLED位置（幅14×高さ7・world(0, 5.4, -18.95)）。
 */
/**
 * @param {THREE.Camera} camera
 * @param {THREE.Scene} scene
 * @param {object} place スクリーンの位置と大きさ（world.screen）
 * @param {{startMuted?: boolean}} opts
 *   startMuted … 消音で始める。スマホ・タブレットは「音ありの自動再生」が
 *   ブラウザに禁止されており、音ありで始めようとすると再生自体が始まらない
 *   （2026-07-31 loyさん報告「スマホだと再生はじまらない」）。
 *   消音での自動再生は許されているので、まず消音で流して、音は本人のタップで出す。
 */
export function initLiveScreen(camera, scene, place = {}, opts = {}) {
  const SC = {
    x: place.x != null ? place.x : 0,
    y: place.y != null ? place.y : 5.4,
    z: place.z != null ? place.z : -18.95,
    width: place.width || 14,
    height: place.height || 7,
  };
  /**
   * 映像の層を入れる箱。
   * ⚠ **最初から必ず作って、中に入れたまま動かさない**（2026-08-08 修正）。
   *   二眼に切り替えるときに層を別の親へ移していたら、iframe が付け直しになって
   *   **再生が止まり、音も消えた**（loyさん「二眼にすると再生が止まって音もミュートになる」）。
   *   DOMの引っ越しは iframe の読み込みやり直しになるので、二度とやらない。
   *   普段はこの箱が画面いっぱい・変換なしなので、あってもなくても同じ見え方になる
   */
  const stage = document.createElement('div');
  stage.className = 'vc-screen-layer vc-vr-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;';
  document.body.appendChild(stage);

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  const layer = cssRenderer.domElement;
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  // ⚠ 二眼モードは画面のものを全部隠すが、**この層だけは残す**（映像がここにある）
  layer.className = 'vc-screen-layer';
  stage.appendChild(layer);

  const cssScene = new THREE.Scene();

  // WebGL側のスクリーン面と同じ場所・同じ大きさに重ねる（ズレると穴から映像がはみ出す）
  const PX_W = 1120;
  const PX_H = Math.round((PX_W * SC.height) / SC.width);
  const holder = document.createElement('div');
  holder.style.width = `${PX_W}px`;
  holder.style.height = `${PX_H}px`;
  holder.style.background = 'transparent';
  holder.style.pointerEvents = 'none';

  const cssObj = new CSS3DObject(holder);
  cssObj.position.set(SC.x, SC.y, SC.z);
  cssObj.scale.setScalar(SC.width / PX_W);
  cssScene.add(cssObj);

  let started = false;
  // ⚠ 最初は**空**。動画が指定されていない会場ではスクリーンを出さない
  //   （2026-08-06 loyさん「動画のURL入ってない時はスクリーン非表示」）。
  //   デモ用のIDは、サーバーに繋がらないときだけ main.js から明示的に渡される
  let currentVideoId = '';
  let iframe = null;
  let interactive = false;

  // ワールド側のLEDスクリーン面（PlaneGeometry 14x7）を探して、
  // 再生中は「深度だけ書いて色を書かない」マテリアルに差し替える＝穴を開ける。
  // ワールド側はスクリーン位置に複数の面（映像面・発光面など）を重ねているので、
  // 該当する面はすべて対象にしないと、残った面が映像を覆ってしまう。
  const screenMeshes = [];
  const originalMaterials = new Map();
  const occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });

  function findScreenMeshes() {
    if (!scene || screenMeshes.length) return;
    const wp = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry && o.geometry.parameters;
      if (!p || p.width !== SC.width || p.height !== SC.height) return;
      o.getWorldPosition(wp);
      // スクリーン位置の近傍にあるものだけを対象にする
      if (Math.abs(wp.x - SC.x) < 1 && Math.abs(wp.y - SC.y) < 1 && Math.abs(wp.z - SC.z) < 1.5) {
        if (!screenMeshes.includes(o)) screenMeshes.push(o);
      }
    });
  }

  /**
   * スクリーンの面そのものを出す/消す（2026-08-06追加）。
   * 動画が入っていない会場では、置き看板だけの黒い板を出したままにしない。
   */
  function setScreenVisible(on) {
    findScreenMeshes();
    for (const mesh of screenMeshes) mesh.visible = on;
  }

  function setOccluder(on) {
    findScreenMeshes();
    for (const mesh of screenMeshes) {
      if (on) {
        if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
        mesh.material = occluderMaterial;
        // three は不透明物をマテリアル単位でまとめてから奥行き順に描くため、
        // 何もしないとスクリーン枠などが穴より先に描かれて塞いでしまう。
        // 最初に描いて深度を書き込むことで、後ろのものを確実に隠す。
        mesh.renderOrder = -1;
      } else if (originalMaterials.has(mesh)) {
        mesh.material = originalMaterials.get(mesh);
        mesh.renderOrder = 0;
      }
    }
  }

  // 動画を差し替えるとプレイヤーが作り直されるため、
  // ユーザーの設定（ミュート・音量・再生状態）を覚えておいて毎回復元する。
  // ※これは各自の手元の設定であり、他の人には同期しない
  const prefs = { muted: Boolean(opts.startMuted), volume: 70, playing: true };

  function applyPrefs() {
    command('setVolume', [prefs.volume]);
    if (prefs.muted) command('mute');
    else command('unMute');
    if (!prefs.playing) command('pauseVideo');
    disableCaptions();
  }

  /**
   * 字幕を出さない（2026-07-31 loyさん指示「字幕は現状は無くていい」）。
   *
   * URLの `cc_load_policy=0` は「既定ではONにしない」という意味しかなく、強制力がない。
   * 実際、7/30にこれを入れたあとも本番で字幕が出続けた。
   * 併記していた `cc_lang_pref=ja` はむしろ「日本語字幕を使う」という意思表示として
   * 解釈されるため、こちらは削除した（mountIframe を参照）。
   *
   * 確実に消すには、プレイヤーから**字幕モジュール自体を降ろす**。
   * モジュール名はYouTubeの世代で 'cc'（旧）と 'captions'（現行）の2つがあり、
   * どちらが使われるかは動画やプレイヤーの版で変わるので両方に投げる。
   * 存在しない方は黙って無視されるだけなので、両方送って害はない。
   *
   * ※ これは各自の手元のプレイヤーへの指示で、他の人には同期しない（音量・ミュートと同じ）
   */
  function disableCaptions() {
    command('unloadModule', ['captions']);
    command('unloadModule', ['cc']);
  }

  /**
   * 字幕を消し続ける。
   *
   * 読み込み直後に1回投げるだけでは足りなかった（2026-07-31 実機で確認）。
   * プレイヤーは**字幕モジュールを後から読み込む**ので、まだ無いものを降ろしても
   * 何も起きず、あとから読み込まれた時点で字幕が出てしまう。
   * 実際 bhyRIVxvw1Q の10分頃で出続け、手で unloadModule を投げ直したら消えた
   * ＝「命令は効くが、投げる時機が早すぎる」ことが分かった。
   *
   * 正攻法は YouTube IFrame API のプレイヤーオブジェクトから onApiChange を拾うことだが、
   * ここは postMessage で直接やりとりしている（APIの読み込みを増やしたくない）ため、
   * 短い間隔で投げ続ける形にした。1回あたりの中身は空メッセージ2通で、負荷は無視できる。
   * ライブ配信は途中から自動字幕が入ることもあるので、止めずに投げ続ける。
   */
  const CC_RETRY_MS = 2000;
  let ccTimer = null;
  function keepCaptionsOff() {
    if (ccTimer) clearInterval(ccTimer);
    disableCaptions();
    ccTimer = setInterval(disableCaptions, CC_RETRY_MS);
  }

  function mountIframe(videoId) {
    if (iframe) holder.removeChild(iframe);
    hasState = false; // 新しいプレイヤーになるので、接続の確立からやり直す
    iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    // enablejsapi=1 と origin 指定で、postMessage による再生・音量操作が有効になる。
    // ミュート中は mute=1 で読み込む（postMessageが届く前に音が出るのを防ぐ）
    const origin = encodeURIComponent(location.origin);
    // cc_load_policy=0 … 字幕を既定でONにしない。ただし**これだけでは消えない**
    //   （7/30に入れたが本番で出続けた）。実際に消しているのは disableCaptions()。
    // ⚠ cc_lang_pref は付けない（2026-07-31 削除）。「字幕を出すときの言語」の指定だが、
    //   付けること自体が「字幕を使う」意思表示として扱われ、逆にONになる原因になっていた。
    //   7/30のコメントには「併記すると自動翻訳が乗りにくい」とあったが、これは誤りだった
    // タッチ端末では**常に消音で読み込む**。
    // 音ありで始めようとするとブラウザが自動再生ごと止めてしまい、再生が始まらない。
    // 本人が既に音を出していた場合は、読み込み後に applyPrefs が unMute を投げて戻す
    // （その時点では画面を触ったあとなので、音を出すのは許可される）。
    // これが無いと、音を出したあとに 🔄 を押すたび止まってしまう
    const startMutedParam = prefs.muted || opts.startMuted ? 1 : 0;
    iframe.src =
      `https://www.youtube.com/embed/${videoId}` +
      `?autoplay=1&mute=${startMutedParam}&playsinline=1&rel=0&enablejsapi=1` +
      `&cc_load_policy=0&origin=${origin}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    holder.appendChild(iframe);
    // 読み込み後に listening を送ると再生位置などが届くようになる。
    // 同時に、覚えておいた設定を復元する（プレイヤー準備待ちのため数回試みる）
    iframe.addEventListener('load', () => {
      ensureListening();
      applyPrefs();
      setTimeout(applyPrefs, 1000);
      setTimeout(applyPrefs, 2500);
      keepCaptionsOff(); // 字幕モジュールは後から読み込まれるので投げ続ける
    });
  }

  // 入場ボタンのクリック（ユーザー操作）を起点に再生開始する
  function play(videoId) {
    if (videoId) currentVideoId = videoId;
    if (started) return;
    started = true;
    // 動画が無い会場では何も出さない（あとで setVideo が来たら、そこで出す）
    if (!currentVideoId) {
      setScreenVisible(false);
      return;
    }
    holder.style.background = '#000';
    setOccluder(true); // スクリーン面に穴を開けて、後ろのiframeを見せる
    mountIframe(currentVideoId);
  }

  /**
   * 動画を消す（2026-08-06追加・loyさん「一度入れた動画を消す方法」
   * 「消したらスクリーンもOFF」）。
   * iframeを外し、穴も閉じ、スクリーンの面ごと消す。
   */
  function clearVideo() {
    currentVideoId = '';
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
    syncRightEye(); // 二眼の右目も消す（残すと消したはずの動画が鳴り続ける）
    hasState = false;
    holder.style.background = 'transparent';
    setOccluder(false); // 穴を閉じる（閉じないと会場に抜けた穴が残る）
    setScreenVisible(false);
  }

  // プレイヤーを直接操作したいとき（一時停止・音量）だけ、一時的に前面へ出す。
  // 前面にある間はアバターより手前に描かれるので、操作が終わったら戻す。
  function setInteractive(on) {
    interactive = !!on;
    layer.style.zIndex = interactive ? '6' : '1';
    holder.style.pointerEvents = interactive ? 'auto' : 'none';
    return interactive;
  }

  function toggleInteractive() {
    return setInteractive(!interactive);
  }

  // ---- プレイヤー操作（YouTube IFrame API を postMessage で呼ぶ） ----
  // スクリーンは3D空間の奥にあって直接クリックしづらいので、
  // 別UI（playerctl.js）からここを経由して再生・音量を操作する。
  function command(func, args = []) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com',
      );
    } catch (e) {
      // プレイヤー未準備などは無視（次の操作で効く）
    }
  }

  // YouTubeから再生位置・長さ・再生状態を受け取る（listening を送ると定期的に届く）
  const stateListeners = new Set();
  // canSeek … シークが許されるか。ライブ配信は基本的に不可
  const state = {
    currentTime: 0,
    duration: 0,
    playing: true,
    live: false,
    canSeek: true,
    muted: false,
    volume: 70,
  };

  let hasState = false; // プレイヤーから情報が届いた＝操作を受け付けられる合図
  /** state.currentTime が届いた時刻（二眼の左右合わせで、いまの位置に直すために使う） */
  let stateAt = 0;

  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://www.youtube.com') return;
    let data;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch (err) {
      return;
    }
    if (!data || !data.info) return;
    hasState = true;
    const info = data.info;
    if (typeof info.currentTime === 'number') {
      state.currentTime = info.currentTime;
      // ⚠ **いつの値か**を覚えておく（2026-08-08）。位置は数百ミリ秒おきにしか届かないので、
      //   左右をそのまま引き算すると、届いた時刻の差がそのまま「ずれ」に化ける。
      //   二眼の左右合わせでは、この時刻を使って「いまの位置」に直してから比べる
      stateAt = performance.now();
    }

    // ---- ライブ配信かどうかの判定 ----
    //
    // 以前は「duration が 0 か 86400超ならライブ」としていたが、これが誤りだった。
    // 実測（2026-07-30・実際の配信 uivHn9u0ggA）では duration = 13905秒 が返ってきて、
    // 0でも86400超でもないため**ライブ配信を通常動画と誤認**していた。
    // その結果 applySync が seekTo を投げ、配信が途中で止まっていた。
    //
    // YouTube は progressState で正確な情報をくれるので、そちらを正とする:
    //   ingestionTime … ライブ取り込みの時刻。ライブ配信のときだけ入る
    //   isAtLiveHead  … 配信の最前にいるか
    //   allowSeeking  … シークして良いか（ライブは false のことが多い）
    //   seekableEnd   … 実際にシークできる終端（duration とは別物）
    const ps = info.progressState;
    if (ps && typeof ps === 'object') {
      if (typeof ps.duration === 'number') state.duration = ps.duration;
      state.live =
        (typeof ps.ingestionTime === 'number' && ps.ingestionTime > 0) || ps.isAtLiveHead === true;
      state.canSeek = ps.allowSeeking !== false;
    } else if (typeof info.duration === 'number') {
      // progressState が来ないプレイヤー向けの保険（従来の判定）
      state.duration = info.duration;
      state.live = !info.duration || info.duration > 86400;
      state.canSeek = !state.live;
    }
    if (typeof info.playerState === 'number') state.playing = info.playerState === 1;
    // 実際のプレイヤーの音量・ミュート状態（UIの表示をここに合わせる）
    if (typeof info.muted === 'boolean') state.muted = info.muted;
    if (typeof info.volume === 'number') state.volume = info.volume;
    for (const cb of stateListeners) cb({ ...state });
  });

  function startListening() {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        'https://www.youtube.com',
      );
    } catch (e) {
      // まだ準備できていない場合は次の呼び出しで届く
    }
  }

  // プレイヤーの準備が整うまで接続要求を送り続ける。
  // 1回だけだと、タブが裏にある時などに取りこぼして
  // 以後ずっと再生位置が取れなくなる（時間表示とシーク同期が死ぬ）。
  let listenTimer = null;
  function ensureListening() {
    startListening();
    if (listenTimer) return;
    let tries = 0;
    listenTimer = setInterval(() => {
      tries += 1;
      if (hasState || tries > 40) {
        clearInterval(listenTimer);
        listenTimer = null;
        return;
      }
      startListening();
    }, 1500);
  }

  const player = {
    play: () => {
      prefs.playing = true;
      command('playVideo');
    },
    pause: () => {
      prefs.playing = false;
      command('pauseVideo');
    },
    mute: () => {
      prefs.muted = true;
      command('mute');
    },
    unMute: () => {
      prefs.muted = false;
      command('unMute');
    },
    setVolume: (v) => {
      prefs.volume = Math.max(0, Math.min(100, Math.round(v)));
      command('setVolume', [prefs.volume]);
    },
    seekTo: (sec) => command('seekTo', [Math.max(0, sec), true]),
    // 他の人の操作（や途中入場時のルーム状態）を自分の映像に反映する。
    // 送信はしない＝ここから同期のループは起きない。
    applySync: ({ st, pos }) => {
      let tries = 0;
      const run = () => {
        // プレイヤーがまだ応答していなければ準備を待つ（最大約5秒）
        if (!hasState && tries < 7) {
          tries += 1;
          setTimeout(run, 700);
          return;
        }
        // ライブ配信では位置合わせをしない。
        // 配信の再生位置は「いま流れている時刻」なので、サーバーが持つ経過秒に
        // 飛ばすと配信が止まる（2026-07-30 の不具合の原因）
        if (typeof pos === 'number' && !state.live && state.canSeek) {
          command('seekTo', [Math.max(0, pos), true]);
        }
        if (st === 'pause') {
          prefs.playing = false;
          command('pauseVideo');
        } else {
          prefs.playing = true;
          command('playVideo');
        }
      };
      run();
    },
    onState: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    getState: () => ({ ...state }),
  };

  // 会場の共有スクリーンを別の動画に差し替える（サーバー経由で全員に届く）
  function setVideo(videoId) {
    const id = String(videoId || '').trim();
    if (id === currentVideoId) return;
    // 空＝動画を消す（スクリーンも消える）
    if (!id) {
      clearVideo();
      return;
    }
    currentVideoId = id;
    setScreenVisible(true);
    if (started) {
      holder.style.background = '#000';
      setOccluder(true); // 消したあとに入れ直した場合、穴を開け直す必要がある
      mountIframe(currentVideoId);
      syncRightEye(); // 二眼で見ている人の右目も入れ替える
    }
  }

  /**
   * いまの動画を読み込み直す（Resync）。
   * ライブ配信は回線が詰まると配信の最前から遅れていき、そのまま戻らないことがある。
   * 読み込み直すと最前から再生し直せる。通常動画では頭出しになる。
   */
  function reload() {
    if (!started || !currentVideoId) return;
    hasState = false;
    mountIframe(currentVideoId);
    syncRightEye();
  }

  function getVideo() {
    return currentVideoId;
  }

  // ------------------------------------------------------------------
  // 二眼（スマホVR）用のもう1枚（2026-08-08・loyさん「スクリーンの映像が見えない。真っ暗」）
  //
  // ⚠ 映像はYouTubeのiframeで、**WebGLの中には描けない**（別ドメインの映像は
  //   テクスチャにできない）。だから3D空間に置いたDOMをキャンバスの穴から透かしている。
  //   ところが二眼にすると穴が左右2つになり、**DOMは1つしか置けない**ので片目しか映らない。
  //   → 右目用に**もう1枚 iframe を用意する**。⚠ 音は左だけ（右は必ず消音）。
  //     再生位置は厳密には揃わないが、平面のスクリーンなので気になりにくい。
  //     ⚠ 通信と負荷は2倍になる。二眼をやめたら必ず片付ける
  // ------------------------------------------------------------------
  let stereoOn = false;
  /** 右目にも映像を出すか（回線が細いときは切れる。覚える） */
  let rightEyeWanted = true;
  try {
    const saved = localStorage.getItem(RIGHT_EYE_KEY);
    if (saved !== null) rightEyeWanted = saved === '1';
  } catch { /* 読めなくても既定でよい */ }
  let cssRendererR = null;
  let holderR = null;
  let iframeR = null;

  function buildRightEye() {
    if (cssRendererR) return;
    cssRendererR = new CSS3DRenderer();
    const l = cssRendererR.domElement;
    l.style.position = 'absolute';
    l.style.inset = '0';
    l.style.pointerEvents = 'none';
    l.className = 'vc-screen-layer';
    stage.appendChild(l);
    // ⚠⚠ 右目の入れ物は**わざと小さく作る**（2026-08-08・loyさん「左が読み込みになる」）。
    //   YouTubeは**プレイヤーの大きさを見て画質を決める**ので、小さく作れば
    //   自動的に低い画質を配信してくる。`setPlaybackQuality` の指定は
    //   聞いてもらえないことが多く、当てにならなかった。
    //   小さく作って、3D側で引き伸ばして同じ大きさに見せる。
    //   ⚠ 右目の画がやや粗くなるが、**左目が途切れる方がずっと悪い**
    //     （同じ配信を2本受けるので、回線は左目と取り合いになる）
    const PX_W_R = 426; // 240p相当。左目(1120px)の約1/2.6
    const PX_H_R = Math.round((PX_W_R * SC.height) / SC.width);
    holderR = document.createElement('div');
    holderR.style.width = `${PX_W_R}px`;
    holderR.style.height = `${PX_H_R}px`;
    holderR.style.background = '#000';
    holderR.style.pointerEvents = 'none';
    const objR = new CSS3DObject(holderR);
    objR.position.set(SC.x, SC.y, SC.z);
    objR.scale.setScalar(SC.width / PX_W_R);
    cssSceneR.add(objR);
  }

  const cssSceneR = new THREE.Scene();

  /**
   * 右目にも映像を出す（2026-08-08 再挑戦）。
   *
   * ⚠ 一度これで「両方とも読み込み中のまま」になったが、**本当の原因は別**だった
   *   （毎フレーム層の style を書き直していて、そのたびに iframe が置き直しになっていた）。
   *   そちらを直したので、もう一度2本立てる。
   * ⚠ 右目は**必ず消音**（音が二重に鳴ると聞けたものではない）。
   *   さらに**画質を落とす**よう頼む（同じ配信を2本受けるので、帯域を少しでも減らす）。
   *   ⚠ 画質の指定は聞いてもらえないことがある。効かなくても害はない
   */
  /**
   * 右目にも映像を出す（2026-08-08・**別ドメインで解決**）。
   *
   * ⚠⚠ 左目と**同じ www.youtube.com** で2本目を作ると、YouTube が1本目を止めて
   *   巻き戻す（実測: 42秒 → 2.3秒）。ところが **www.youtube-nocookie.com** にすると
   *   別のプレイヤーとして扱われ、**1本目はそのまま再生を続ける**（実測で確認）。
   *   同じ中身が配信されている別ドメインなので、映像は同じものが出る。
   * ⚠ 右目は**必ず消音**（音が二重に鳴ると聞けたものではない）。
   * ⚠ 再生位置は厳密には揃わない（別プレイヤーなので）。平面のスクリーンなので
   *   多少ずれても立体視は壊れないが、気になるようなら右目を消す判断もある
   */
  function mountRightIframe() {
    if (!currentVideoId || !holderR || !rightEyeWanted) return;
    if (iframeR) holderR.removeChild(iframeR);
    iframeR = document.createElement('iframe');
    iframeR.style.width = '100%';
    iframeR.style.height = '100%';
    iframeR.style.border = '0';
    const origin = encodeURIComponent(location.origin);
    iframeR.src = `https://www.youtube-nocookie.com/embed/${currentVideoId}`
      + `?autoplay=1&mute=1&playsinline=1&rel=0&controls=0&cc_load_policy=0`
      + `&enablejsapi=1&origin=${origin}`;
    iframeR.allow = 'autoplay; encrypted-media';
    iframeR.addEventListener('load', () => {
      commandR('mute', []);
      // ⚠ **画質を落とす**（同じ配信を2本受けるので、少しでも軽く・細くする）。
      //   聞いてもらえないことがあるが、効かなくても害はない
      commandR('setPlaybackQuality', ['small']);
      listenRight();
      // 読み込み直後だけは、位置を知らなくても1回合わせておく
      setTimeout(syncRightTime, 2500);
      setTimeout(() => commandR('setPlaybackQuality', ['small']), 3000);
    });
    holderR.appendChild(iframeR);
    startRightSync();
  }

  /** 右目のプレイヤーへ命令を送る */
  function commandR(func, args = []) {
    if (!iframeR || !iframeR.contentWindow) return;
    try {
      iframeR.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube-nocookie.com',
      );
    } catch { /* 届かなくても映像は出る */ }
  }

  /** 右目のいまの再生位置（右目のプレイヤーから届く） */
  let rightTime = null;
  /** その値が届いた時刻 */
  let rightAt = 0;
  let rightListening = false;

  /**
   * 右目のプレイヤーから状態をもらえるようにする。
   * ⚠ 位置を知らないと「ずれているときだけ直す」ができず、
   *   定期的に無条件でシークすることになる。**それが致命的だった**（下記）
   */
  function listenRight() {
    if (!rightListening) {
      rightListening = true;
      window.addEventListener('message', (e) => {
        if (e.origin !== 'https://www.youtube-nocookie.com') return;
        let d;
        try {
          d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        } catch {
          return;
        }
        if (d && d.info && typeof d.info.currentTime === 'number') {
          rightTime = d.info.currentTime;
          rightAt = performance.now();
        }
      });
    }
    const ping = () => {
      if (!iframeR || !iframeR.contentWindow) return;
      try {
        iframeR.contentWindow.postMessage(
          JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
          'https://www.youtube-nocookie.com',
        );
      } catch { /* 届かなくても映像は出る */ }
    };
    ping();
    setTimeout(ping, 1500);
  }

  /**
   * 右目の再生位置を左目に合わせる。
   *
   * ⚠⚠ **ずれているときだけ**動かす（2026-08-08・loyさんの実機で判明）。
   *   10秒ごとに無条件でシークしていたら、シークのたびに読み込み直しが起きて
   *   **両目とも「読み込み中」のまま**になった（loyさん「数秒だけいけた
   *   けど両方読み込み中になった」）。
   *   同じ動画を同じ速さで流しているので、いちど合えばそうそうズレない。
   * ⚠ ライブ配信では位置合わせが効かない（常に最前）。そのときは害もない
   */
  /** これ以上ずれたら、飛ばして直す（秒）。飛ばすと読み込み直しになるので大きめ */
  const RIGHT_JUMP_AT = 3.0;
  /**
   * ここまで合っていれば、何もしない（秒）。
   * ⚠ 細かく合わせにいくほど右目が先読みを増やし、**左目の分の回線を食う**
   *   （2026-08-08 loyさん「左が読み込みになる」）。
   *   0.15秒は5フレームぶん。平面のスクリーンなら見て分からない範囲で、
   *   ここを緩めるぶん左目が安定する
   */
  const RIGHT_OK = 0.15;
  /**
   * 追い込みに使う速さ。
   * ⚠ YouTubeは**決まった値しか受け付けない**（0.25/0.5/0.75/1/1.25/…）。
   *   1.1 のような細かい指定は等速に丸められる（2026-08-08 実測）。
   *   なので「速さを細かくする」のではなく、**当てる時間を細かくする**
   */
  const RIGHT_FAST = 1.25;
  const RIGHT_SLOW = 0.75;
  /** 1秒あたりどれだけ詰まるか（1.25倍・0.75倍のとき） */
  const CATCH_PER_SEC = 0.25;
  let rightRate = 1;
  let rateTimer = null;

  function setRightRate(v) {
    if (v === rightRate) return;
    rightRate = v;
    commandR('setPlaybackRate', [v]);
  }

  /**
   * いまの再生位置を、**届いた時刻から今までの経過ぶん進めて**見積もる。
   * ⚠ 位置は数百ミリ秒おきにしか届かない。そのまま引き算すると、
   *   届いた時刻の差（最大で数百ミリ秒）がまるごと「ずれ」に化ける。
   *   ここを直すだけで、見かけのずれがかなり小さくなる
   */
  function estimate(value, at, rate) {
    if (!Number.isFinite(value) || !at) return NaN;
    return value + ((performance.now() - at) / 1000) * rate;
  }

  function syncRightTime() {
    if (!iframeR || !hasState || !state) return;
    if (rateTimer) return; // 追い込み中は、終わるまで触らない
    const left = estimate(Number(state.currentTime), stateAt, 1);
    if (!Number.isFinite(left)) return;
    if (!Number.isFinite(rightTime)) {
      // 位置がまだ分からない間は、1回だけ飛ばして合わせる
      commandR('seekTo', [left, true]);
      commandR('playVideo', []);
      return;
    }
    const right = estimate(rightTime, rightAt, rightRate);
    const d = left - right; // 正＝右目が遅れている
    if (Math.abs(d) > RIGHT_JUMP_AT) {
      setRightRate(1);
      commandR('seekTo', [left, true]);
      commandR('playVideo', []);
      return;
    }
    if (Math.abs(d) <= RIGHT_OK) {
      setRightRate(1);
      return;
    }
    // ⚠⚠ **必要なぶんだけ**速さを当てて、自分で等速に戻す（2026-08-08）。
    //   速さは1.25/0.75しか選べないので、当てっぱなしだと必ず行き過ぎる。
    //   「どれだけずれているか」から**当てる時間**を計算するのが正しい
    // ⚠ 速さを変えている間は先読みが増えて回線を食う。当てる時間には上限を置く
    const ms = Math.min(Math.abs(d) / CATCH_PER_SEC, 1.2) * 1000;
    setRightRate(d > 0 ? RIGHT_FAST : RIGHT_SLOW);
    rateTimer = setTimeout(() => {
      rateTimer = null;
      setRightRate(1);
    }, ms);
  }

  /**
   * ずれ直しの見回り。
   * ⚠ 速さで詰める方式なので**こまめに見る**（飛ばさないので、見るだけなら軽い）
   */
  const RIGHT_SYNC_MS = 900;
  let rightSyncTimer = null;
  let syncTicks = 0;
  function startRightSync() {
    if (rightSyncTimer) clearInterval(rightSyncTimer);
    syncTicks = 0;
    rightSyncTimer = setInterval(() => {
      syncTicks += 1;
      // 位置を教えてもらい直すのは、ときどきでよい
      if (syncTicks % 8 === 1) listenRight();
      syncRightTime();
    }, RIGHT_SYNC_MS);
  }

  function stopRightSync() {
    if (rightSyncTimer) clearInterval(rightSyncTimer);
    rightSyncTimer = null;
    if (rateTimer) clearTimeout(rateTimer);
    rateTimer = null;
    rightTime = null;
    rightAt = 0;
    rightRate = 1;
  }

  function clearRightEye() {
    stopRightSync();
    if (iframeR && holderR) holderR.removeChild(iframeR);
    iframeR = null;
    if (cssRendererR && cssRendererR.domElement.parentNode) {
      cssRendererR.domElement.parentNode.removeChild(cssRendererR.domElement);
    }
    cssRendererR = null;
    holderR = null;
    // ⚠ 層は**動かさない**（動かすと iframe が付け直しになって再生が止まる）。
    //   箱と層の大きさ・位置だけ、画面いっぱいの普段の姿へ戻す
    stage.style.width = '';
    stage.style.height = '';
    stage.style.inset = '0';
    layer.style.left = '';
    layer.style.top = '';
    layer.style.width = '';
    layer.style.height = '';
    layer.style.transform = '';
  }

  /**
   * 右目の映像を、いまの動画に合わせ直す（2026-08-08 レビュー指摘）。
   * ⚠ これを呼ばないと、**二眼で見ている間に動画が切り替わっても右目だけ古いまま**になる。
   *   動画の切り替えは他の人の操作でも起きる（サーバーから降ってくる）ので、
   *   二眼中に画面を触っていなくても発生する
   */
  function syncRightEye() {
    if (!stereoOn) return;
    if (!currentVideoId) {
      if (iframeR && holderR) holderR.removeChild(iframeR);
      iframeR = null;
      return;
    }
    mountRightIframe();
  }

  /**
   * 二眼モードの入り／切り。呼ぶのは vrview 側。
   *
   * ★ 右目にも映像を出す。**別ドメイン（youtube-nocookie）を使う**のが鍵。
   *   切り分けの記録:
   *     ・同じ www.youtube.com で2本目を作ると、左目が 42秒 → 2.3秒 に巻き戻された
   *     ・`setStereo(true)` だけでは戻らない（2本目がまだDOMに出ていないため）。
   *       二眼の描画が回って**2本目が本当に読み込まれた瞬間**に戻る
   *     ・全画面／層のstyle変更／層のサイズ変更／描画1回、はいずれも無関係だった
   *     ・**www.youtube-nocookie.com にしたら巻き戻らなくなった**（別プレイヤー扱い）
   */
  function setStereo(on) {
    if (on === stereoOn) return;
    stereoOn = Boolean(on);
    if (stereoOn) {
      buildRightEye();
      mountRightIframe();
    } else {
      clearRightEye();
      // 片目に戻すので、レイヤーの大きさも戻す
      lastStereoW = 0;
      lastStereoH = 0;
      cssRenderer.setSize(window.innerWidth, window.innerHeight);
      layer.style.clipPath = '';
      layer.style.transform = '';
    }
  }

  function update() {
    cssRenderer.render(cssScene, camera);
  }

  /**
   * 二眼で1フレーム描く（2026-08-08）。
   * 左右それぞれのカメラで、画面の左半分・右半分に置く。
   * @param {THREE.Camera} camL
   * @param {THREE.Camera} camR
   * @param {{w:number,h:number,rotated:boolean}} view 描画領域（回して出しているかも渡す）
   */
  /** 前に置いたときの大きさ（同じなら触らない） */
  let lastStereoW = 0;
  let lastStereoH = 0;

  function updateStereo(camL, camR, view) {
    if (!stereoOn || !cssRendererR) return;
    const halfW = Math.floor(view.w / 2);
    // ⚠⚠ **大きさが変わったときだけ**位置と大きさを触る（2026-08-08）。
    //   毎フレーム style を書き直していたら、そのたびに iframe が置き直しになり、
    //   **動画が再生に入れず「読み込み中」のまま**になった（loyさんの実機）。
    //   ここは1秒に60回走る場所なので、「同じ値でも代入」は許されない
    const sizeChanged = halfW !== lastStereoW || view.h !== lastStereoH;
    if (sizeChanged) {
      lastStereoW = halfW;
      lastStereoH = view.h;
      stage.style.inset = 'auto';
      stage.style.left = '0px';
      stage.style.top = '0px';
      stage.style.width = `${view.w}px`;
      stage.style.height = `${view.h}px`;
    }
    for (const [rend, cam, offset] of [[cssRenderer, camL, 0], [cssRendererR, camR, halfW]]) {
      const el = rend.domElement;
      if (sizeChanged) {
        rend.setSize(halfW, view.h);
        el.style.position = 'absolute';
        el.style.inset = 'auto';
        el.style.left = `${offset}px`;
        el.style.top = '0px';
        el.style.width = `${halfW}px`;
        el.style.height = `${view.h}px`;
        el.style.transform = '';
      }
      rend.render(rend === cssRenderer ? cssScene : cssSceneR, cam);
    }
  }

  window.addEventListener('resize', () => {
    if (stereoOn) return; // 二眼中は updateStereo が毎フレーム決める
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 会場ができた直後は動画が分からない。分かるまでスクリーンは出さない
  setScreenVisible(false);

  return {
    play, setVideo, getVideo, clearVideo, reload, update,
    setStereo, updateStereo,
    /**
     * 右目にも映像を出すか（2026-08-08）。
     * ⚠ 同じ配信を2本受けるので、細い回線では**左目が途切れる**ことがある。
     *   そのときは false にすると、左目だけになって確実に流れる（右目は黒い板）。
     *   覚えるので、次に入ったときも同じ設定で始まる
     */
    setRightEye(on) {
      const v = Boolean(on);
      if (v === rightEyeWanted) return;
      rightEyeWanted = v;
      try {
        localStorage.setItem(RIGHT_EYE_KEY, v ? '1' : '0');
      } catch { /* 覚えられなくても、その場では効く */ }
      if (!stereoOn) return;
      if (v) mountRightIframe();
      else {
        stopRightSync();
        if (iframeR && holderR) holderR.removeChild(iframeR);
        iframeR = null;
      }
    },
    getRightEye: () => rightEyeWanted,
    setInteractive, toggleInteractive, player,
  };
}
