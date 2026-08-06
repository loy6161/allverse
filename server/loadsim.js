// ============================================================
// 負荷の測定（仮想ユーザー）— 2026-08-06追加
//
// loyさん「管理者用にNPCとは別に、測定できるものを付けておいて。
//          10000人くらいまではかってみたい。」
//
// ★ なぜ「仮想」なのか
//   本物の接続を1万本張るのは無理（ブラウザは1ホストに数百までしか繋げず、
//   別のPCを何十台も用意する話になる）。
//   代わりに**サーバーの中に1万人ぶんの「人」を作り、本物とまったく同じ配信処理を通す**。
//   重さの正体は「位置を全員ぶん JSON にして書き出す」ところなので、
//   受け取り口だけを差し替えれば、費用のほとんどはそのまま再現できる。
//
// ★ 実ユーザーには1通も送らない
//   仮想ユーザーは専用の入れ物（このファイルの中）だけで完結し、
//   本物のイベント・ルームには混ざらない。だから**本番中に走らせても、
//   お客さんの画面には何も起きない**（サーバーのCPUは食うので、そこだけ注意）。
//
// ★ 何を見れば「限界」が分かるか
//   通数ではなく **タイマーの遅れ（lagMs）**。
//   100ms ごとに動かしているつもりが 150ms になっていたら、
//   その時点でサーバーは追いつけていない＝本物のユーザーの位置も遅れる。
// ============================================================

/** 一度に作れる仮想ユーザーの上限（事故防止） */
export const MAX_VIRTUAL = 20000;

/**
 * アバターとして見せられる人数の上限。
 *
 * ⚠ 300 → 5000（2026-08-06）。loyさん「上限300は少ない ぜんぜん動くよ。5000にして。
 *   負荷テストなのにセーフティーにしてどうするの？テストにならん」。
 *   **こちらの見積もりで頭を押さえない**。動かなくなる点を見つけるのが目的なので、
 *   重くなるかどうかは実際に出して確かめてもらう。
 */
export const MAX_SHOWN = 5000;

/** 何もしなくても自動で止まるまでの時間（測りっぱなしを防ぐ） */
const AUTO_STOP_MS = 3 * 60 * 1000;

/** 位置を送る間隔。本物のクライアントと同じ 10Hz */
const TICK_MS = 100;

/**
 * 1周期に使ってよい時間の上限（ms）。
 *
 * ⚠ これが無いとサーバーが固まる（2026-08-06 loyさん「1ルームの上限決めないで」）。
 *   1ルームに1万人置くと 1周期あたり 1万 × 9,999 ＝ **約1億通**になり、
 *   1周期が数十秒かかって、その間サーバーは何も応答できない
 *   （自動停止の判定すら回らない）。
 *   そこで**途中で打ち切り**、「捌けなかったぶん」を結果として出す。
 *   捌けなかった量そのものが「この人数は無理」という答えになる。
 */
const TICK_BUDGET_MS = 60;

/**
 * 受け取り口の代わり。**本物と同じように JSON を組み立てて**、
 * 送った通数とバイト数だけ数える（ソケットに書き出す代わり）。
 */
function makeSink(counters) {
  return {
    readyState: 1,
    OPEN: 1,
    send(text) {
      counters.msgs++;
      counters.bytes += text.length;
    },
  };
}

/**
 * 測定を作る。
 * @param {object} p
 * @param {(payload:object) => void} p.onReport 1秒ごとに結果を渡す相手
 */
export function createLoadSim({ onReport, onShow } = {}) {
  /** 仮想ユーザー。{ id, room, x, z, r } の配列 */
  let users = [];
  /** ルーム番号 -> そのルームの仮想ユーザー */
  let byRoom = new Map();
  let perRoom = 15;
  /**
   * そのうち何人を**実際のアバターとして測定者の画面へ流すか**（2026-08-06追加）。
   * loyさん「これは数値だけ？実際にあばたーはでないの？だして検証したい。」
   * 全員ぶんを1人へ流すのは無理なので（1万人＝10万通/秒を1本の回線へ）、
   * 先頭から指定人数だけ配る。見た目と描画の負担を目で確かめるためのもの。
   */
  let showCount = 0;
  let timer = null;
  let reportTimer = null;
  let stopAt = 0;
  let startedAt = 0;

  const counters = { msgs: 0, bytes: 0 };
  const sink = makeSink(counters);

  // 1周期ぶんの計測
  let lastTick = 0;
  let worstLag = 0;
  let sumLag = 0;
  let ticks = 0;
  let busyMs = 0; // 配信そのものに使った時間
  let skipped = 0; // 時間切れで送れなかった通数
  let intended = 0; // 本来送るはずだった通数

  function reset() {
    counters.msgs = 0;
    counters.bytes = 0;
    skipped = 0;
    intended = 0;
    worstLag = 0;
    sumLag = 0;
    ticks = 0;
    busyMs = 0;
  }

  /** 1周期: 全員が位置を送り、同室の全員へ配る（本物の broadcastToRoom と同じ形） */
  function tick() {
    const now = Date.now();
    const lag = lastTick ? now - lastTick - TICK_MS : 0;
    lastTick = now;
    if (lag > worstLag) worstLag = lag;
    sumLag += Math.max(0, lag);
    ticks++;

    // この周期で本来送るはずの通数（1ルームN人なら N×(N-1)）。
    // ⚠ 「この周期ぶん」と「集計ぶん」を分けること。混ぜると
    //   捌けなかった数が本来必要な数より大きくなる（2026-08-06 実際にそうなった）
    let tickIntended = 0;
    for (const [, members] of byRoom) tickIntended += members.length * (members.length - 1);
    intended += tickIntended;

    const t0 = process.hrtime.bigint();
    const deadline = t0 + BigInt(TICK_BUDGET_MS * 1e6);
    let over = false;
    let sent = 0;
    outer: for (const [, members] of byRoom) {
      for (const u of members) {
        // 少しずつ歩く（同じ値だと本物と違って圧縮が効いてしまう）
        // その場を中心に少しだけ歩く（見せたときに動いて見えるように）
        u.x = u.x0 + Math.sin((now / 1000 + u.n) * 0.7) * 0.6;
        u.z = u.z0 + Math.cos((now / 1000 + u.n) * 0.5) * 0.6;
        u.r = (u.r + 3) % 360;
        // ★ 本物と同じ「1通ずつ JSON にして全員へ書く」形にする。
        //   ここを「1回だけ stringify して使い回す」と実装が変わってしまい、
        //   測っているものが本物と別物になる（server.js の send() は毎回 stringify する）
        for (let i = 0; i < members.length; i++) {
          if (members[i] === u) continue;
          sink.send(JSON.stringify({ t: 'pos', id: u.id, x: u.x, z: u.z, r: u.r, m: true }));
          sent++;
          // 1024通ごとに時間を見る（毎回見ると時計を読む費用の方が高くつく）
          if ((sent & 1023) === 0 && process.hrtime.bigint() > deadline) {
            over = true;
            break outer;
          }
        }
      }
    }
    busyMs += Number(process.hrtime.bigint() - t0) / 1e6;
    if (over) skipped += Math.max(0, tickIntended - sent);

    // 測定者の画面へ「見せるぶん」だけ位置を流す（1周期に1通だけにまとめる）
    if (showCount > 0 && onShow) {
      const n = Math.min(showCount, users.length);
      const list = new Array(n);
      for (let i = 0; i < n; i++) {
        const u = users[i];
        list[i] = [u.id, Math.round(u.x * 10) / 10, Math.round(u.z * 10) / 10, u.r];
      }
      onShow(list);
    }

    if (stopAt && Date.now() > stopAt) stop('時間切れ（自動停止）');
  }

  function report() {
    if (!timer) return;
    const secs = ticks * (TICK_MS / 1000) || 1;
    const mem = process.memoryUsage();
    const payload = {
      running: true,
      users: users.length,
      perRoom,
      rooms: byRoom.size,
      msgsPerSec: Math.round(counters.msgs / secs),
      mbPerSec: +(counters.bytes / secs / 1024 / 1024).toFixed(2),
      // ★ ここが限界の判定。10ms を超え始めたら追いつけていない
      lagAvgMs: +(sumLag / Math.max(1, ticks)).toFixed(1),
      lagWorstMs: worstLag,
      // 1秒のうち何msを配信に使っているか（1000に近いほど余裕がない）
      busyMsPerSec: Math.round(busyMs / secs),
      // 時間内に捌けなかった通数（0でなければ、その設定は無理という答え）
      skippedPerSec: Math.round(skipped / secs),
      intendedPerSec: Math.round(intended / secs),
      memMB: Math.round(mem.rss / 1024 / 1024),
      elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    };
    reset();
    if (onReport) onReport(payload);
  }

  /**
   * 開始。
   * @param {number} n 仮想ユーザーの人数
   * @param {number} sizeOfRoom 1ルームあたりの人数
   */
  function start(n, sizeOfRoom = 15, show = 0) {
    stop();
    const count = Math.max(0, Math.min(MAX_VIRTUAL, Math.trunc(Number(n) || 0)));
    // ⚠ 1ルームの人数に上限は付けない（2026-08-06 loyさん「1ルームの上限決めないで。
    //   それもテストしたいから」）。無茶な値を入れても固まらないよう、
    //   1周期の時間を TICK_BUDGET_MS で打ち切り、捌けなかった量を結果に出す
    perRoom = Math.max(1, Math.min(MAX_VIRTUAL, Math.trunc(Number(sizeOfRoom) || 15)));
    // 見せる人数。1人の画面が耐えられる範囲に抑える（アバター1体＝約12回の描画）
    showCount = Math.max(0, Math.min(MAX_SHOWN, Math.trunc(Number(show) || 0)));
    users = [];
    byRoom = new Map();
    for (let i = 0; i < count; i++) {
      const room = Math.floor(i / perRoom) + 1;
      // 会場の中に散らす（見せるときに重ならないよう、格子状に置いてから歩かせる）
      const col = i % 20;
      const row = Math.floor(i / 20) % 20;
      const u = {
        id: `v${i}`,
        n: i,
        room,
        x: -9 + col * 1.6,
        z: -12 + row * 1.6,
        x0: -9 + col * 1.6,
        z0: -12 + row * 1.6,
        r: 0,
      };
      users.push(u);
      if (!byRoom.has(room)) byRoom.set(room, []);
      byRoom.get(room).push(u);
    }
    reset();
    lastTick = 0;
    startedAt = Date.now();
    stopAt = Date.now() + AUTO_STOP_MS;
    timer = setInterval(tick, TICK_MS);
    reportTimer = setInterval(report, 1000);
    return { users: users.length, rooms: byRoom.size, perRoom, showCount };
  }

  function stop(reason = '') {
    if (timer) clearInterval(timer);
    if (reportTimer) clearInterval(reportTimer);
    timer = null;
    reportTimer = null;
    const had = users.length;
    users = [];
    byRoom = new Map();
    if (had && onReport) onReport({ running: false, users: 0, reason });
    return had;
  }

  return {
    start,
    stop,
    isRunning: () => Boolean(timer),
    status: () => ({ running: Boolean(timer), users: users.length, perRoom }),
  };
}
