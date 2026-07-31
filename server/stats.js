// ============================================================
// イベントログの集計（純粋関数だけ。DBもネットワークも触らない）
//
// 記録は「入場」と「退場」の2点だけを残す方式にした（2026-07-31 loyさん決定）。
// 1分ごとのサンプリングより
//   ・正確（ピークを取りこぼさない）
//   ・データ量が1/10以下（1時間で数十行）
//   ・滞在時間がそのまま取れる
// という3点で優れているため。ここは、その2点から欲しい数字を復元する場所。
//
// 同接の経過も「入退場を時刻順になぞる」だけで完全に再現できる。
// 記録側で経過を持つ必要はない。
// ============================================================

/**
 * 訪問1件 = { joinedAt:number, leftAt:number|null, visitor:string, ... }
 * leftAt が null は「まだ中にいる」。集計では now で閉じたものとして扱う。
 */

/** 入退場を時刻順の増減リストにする */
function edgesOf(visits, now) {
  const es = [];
  for (const v of visits) {
    const inAt = v.joinedAt;
    const outAt = v.leftAt == null ? now : v.leftAt;
    if (!Number.isFinite(inAt)) continue;
    es.push({ t: inAt, d: 1 });
    es.push({ t: Number.isFinite(outAt) ? Math.max(outAt, inAt) : inAt, d: -1 });
  }
  // 同時刻は「退場が先」。1人出て1人入っただけのときに
  // 同接が1増えたことにならないようにする（d 昇順 = -1 が先）
  es.sort((a, b) => a.t - b.t || a.d - b.d);
  return es;
}

/**
 * 同接の変化点だけの列。[{t, n}]
 * グラフ用の等間隔サンプリングは gridSeries() の方を使う。
 */
export function changePoints(visits, now = Date.now()) {
  const out = [];
  let n = 0;
  for (const e of edgesOf(visits, now)) {
    n += e.d;
    if (out.length && out[out.length - 1].t === e.t) out[out.length - 1].n = n;
    else out.push({ t: e.t, n });
  }
  return out;
}

/**
 * 等間隔（既定1分）の同接の経過。表計算でそのままグラフにできる形。
 * 変化点から「その時刻の実際の値」を拾うので、サンプリング記録と違って
 * 取りこぼしではなく“間引き”になる（ピークは summarize() 側が正確に持つ）。
 */
export function gridSeries(visits, { from, to, stepMs = 60 * 1000 } = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const pts = changePoints(visits, to);
  const out = [];
  let i = 0;
  let n = 0;
  // 刻みが細かすぎて行数が爆発しないように上限を設ける（3000点＝1分刻みで50時間）
  const step = Math.max(1000, stepMs);
  const maxRows = 3000;
  for (let t = from, row = 0; t <= to && row < maxRows; t += step, row++) {
    while (i < pts.length && pts[i].t <= t) {
      n = pts[i].n;
      i++;
    }
    out.push({ t, n });
  }
  // 終端を必ず入れる。始まったばかりのイベント（1分未満）でも点が2つになり、
  // グラフが線として描ける。刻みの途中で終わった場合も右端まで届く
  if (out.length && out.length < maxRows && out[out.length - 1].t < to) {
    while (i < pts.length && pts[i].t <= to) {
      n = pts[i].n;
      i++;
    }
    out.push({ t: to, n });
  }
  return out;
}

/**
 * 開催時間に合った刻みを選ぶ。
 *
 * 刻みを1分に固定すると、30分のイベントは読みやすいが、
 * 5分で終わったイベントは点が5つしか出ず、山がまるごと消える
 * （実際に27秒のテストで同接5人のピークが見えなくなった）。
 * 点の数がだいたい一定になるように、きりのいい刻みから選ぶ。
 */
export function autoStepMs(durationMs, targetPoints = 120) {
  const ladder = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => s * 1000);
  const raw = Math.max(0, durationMs) / Math.max(1, targetPoints);
  for (const s of ladder) if (raw <= s) return s;
  return ladder[ladder.length - 1];
}

/** 「30秒」「5分」など、刻みを人が読める形に */
export function stepLabel(stepMs) {
  const s = Math.round(stepMs / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}分` : `${Math.round(m / 60)}時間`;
}

/** 中央値（空なら0） */
function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

/**
 * イベント1回ぶんの要約。
 *
 * @param {{openedAt:number, closedAt:number|null}} run
 * @param {Array} visits
 * @param {number} now
 */
export function summarize(run, visits, now = Date.now()) {
  const openedAt = Number(run && run.openedAt) || 0;
  const closedAt = run && run.closedAt != null ? Number(run.closedAt) : null;
  const endAt = closedAt == null ? now : closedAt;

  // ---- ピーク同接（変化点をなぞる。取りこぼしは原理的に起きない）----
  let peak = 0;
  let peakAt = openedAt;
  let n = 0;
  for (const e of edgesOf(visits, endAt)) {
    n += e.d;
    if (n > peak) {
      peak = n;
      peakAt = e.t;
    }
  }

  // ---- 滞在時間 ----
  const stays = [];
  let totalStayMs = 0;
  for (const v of visits) {
    const outAt = v.leftAt == null ? endAt : v.leftAt;
    const ms = Math.max(0, outAt - v.joinedAt);
    stays.push(ms);
    totalStayMs += ms;
  }

  const durationMs = Math.max(0, endAt - openedAt);
  // 平均同接 ＝ のべ滞在時間 ÷ 開催時間（面積を時間で割る）
  const avgConcurrent = durationMs > 0 ? totalStayMs / durationMs : 0;

  const uniques = new Set();
  let loggedIn = 0;
  let guests = 0;
  for (const v of visits) {
    uniques.add(v.visitor);
    if (String(v.visitor).startsWith('u:')) loggedIn++;
    else guests++;
  }

  return {
    openedAt,
    closedAt,
    live: closedAt == null,
    durationSec: Math.round(durationMs / 1000),
    peak,
    peakAt,
    // 累計ユニーク（案A: 同じブラウザ／同じGoogleアカウントは1人として数える）
    unique: uniques.size,
    // のべ入場回数（同じ人が入り直せばそのぶん増える）
    entries: visits.length,
    entriesLoggedIn: loggedIn,
    entriesGuest: guests,
    nowInside: visits.filter((v) => v.leftAt == null).length,
    avgConcurrent: Math.round(avgConcurrent * 100) / 100,
    avgStaySec: stays.length ? Math.round(totalStayMs / stays.length / 1000) : 0,
    medianStaySec: Math.round(median(stays) / 1000),
    maxStaySec: stays.length ? Math.round(Math.max(...stays) / 1000) : 0,
  };
}

// ------------------------------------------------------------
// CSV
//
// Excelは「BOMが無いUTF-8」を勝手にShift_JISとして読むため、
// 日本語が文字化けする。先頭にBOMを付けるのはそのため。
// ------------------------------------------------------------

const BOM = '﻿';

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** 表計算で読める時刻（ローカル時間の文字列にはしない。ズレの原因になるのでISOのまま） */
function iso(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

/** 訪問ログCSV（1行 = 1回の入場） */
export function visitsCsv(run, visits, now = Date.now()) {
  const rows = [[
    'イベント名', '訪問者ID', '種別', '表示名', 'ルーム',
    '入場時刻(UTC)', '退場時刻(UTC)', '滞在秒', '退場の理由',
  ]];
  const endAt = run && run.closedAt != null ? run.closedAt : now;
  for (const v of visits) {
    const outAt = v.leftAt == null ? null : v.leftAt;
    const stay = Math.max(0, (outAt == null ? endAt : outAt) - v.joinedAt);
    rows.push([
      run ? run.name : '',
      v.visitor,
      v.kind,
      v.name,
      v.room,
      iso(v.joinedAt),
      outAt == null ? '（在室中）' : iso(outAt),
      Math.round(stay / 1000),
      v.closedBy || '',
    ]);
  }
  return rowsToCsv(rows);
}

/**
 * 同接の経過CSV。そのまま折れ線グラフにできる。
 * 刻みは開催時間から自動で決まる（指定もできる）。
 * 経過を秒と分の両方で出すのは、短いイベントでも長いイベントでも
 * どちらかがそのまま横軸に使えるようにするため。
 */
export function seriesCsv(run, visits, { stepMs = 0, now = Date.now() } = {}) {
  const from = run ? run.openedAt : 0;
  const to = run && run.closedAt != null ? run.closedAt : now;
  const step = stepMs || autoStepMs(to - from);
  const rows = [['時刻(UTC)', '経過秒', '経過分', '同時接続数']];
  for (const p of gridSeries(visits, { from, to, stepMs: step })) {
    const el = (p.t - from) / 1000;
    rows.push([iso(p.t), Math.round(el), Math.round((el / 60) * 10) / 10, p.n]);
  }
  return rowsToCsv(rows);
}
