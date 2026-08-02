// ============================================================
// イベントの記録（管理者だけが見られる）
//
// 🚪パネルの中に差し込むセクション。イベントを立ててから閉じるまでの
//   ・同接の経過（グラフ）
//   ・ピーク同接とその時刻
//   ・累計ユニーク人数 と のべ入場回数
//   ・滞在時間（平均・中央値）
// を見て、CSVで持ち出せる。
//
// 記録は閉じたイベントも残る（閉じたら消えるなら記録の意味がない）。
//
// 集計の中身は server/stats.js が計算する。ここは見せるだけ。
// ============================================================

const STYLE_ID = 'vc-logs-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vc-logs { border-top: 1px solid rgba(255,255,255,0.12); margin-top: 12px; padding-top: 10px; }
.vc-logs-run {
  border: 1px solid rgba(255,255,255,0.12); border-radius: 9px;
  padding: 8px 10px; margin-bottom: 6px; cursor: pointer;
}
.vc-logs-run:hover { border-color: rgba(0,255,234,0.5); }
.vc-logs-run.open { border-color: rgba(0,255,234,0.7); background: rgba(0,255,234,0.05); cursor: default; }
.vc-logs-name { font-weight: bold; display: flex; align-items: center; gap: 6px; }
.vc-logs-live {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: bold;
  background: rgba(255,0,90,0.85); color: #fff;
}
.vc-logs-when { font-size: 11px; color: rgba(220,235,255,0.5); margin-top: 2px; }
.vc-logs-kpi { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12px; }
.vc-logs-kpi b { color: #7cffdc; font-size: 14px; }
.vc-logs-graph { margin: 8px 0 4px; }
.vc-logs-graph svg { display: block; width: 100%; height: 70px; }
.vc-logs-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.vc-logs-actions button {
  padding: 5px 10px; border-radius: 14px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #eaf6ff;
  font-weight: normal;
}
.vc-logs-actions button:hover { border-color: rgba(0,255,234,0.6); }
.vc-logs-empty { font-size: 12px; color: rgba(220,235,255,0.5); }

/* 会場チャットの記録。件数が多くなるので、この枠の中だけスクロールさせる */
.vc-logs-chat {
  margin-top: 8px; padding: 8px 9px;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
  max-height: 160px; overflow-y: auto;
}
.vc-logs-chat-line {
  font-size: 11px; line-height: 1.6; color: rgba(220,235,255,0.8);
  word-break: break-word; padding: 1px 0;
}
`;
  document.head.appendChild(style);
}

/** 2026/07/31 22:05 の形。表示はブラウザのローカル時間 */
function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 秒 → 「1時間23分」「45秒」 */
function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

/** ファイル名に使えない文字を落とす */
function safeFileName(s) {
  return String(s || 'event').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

/** 刻みを人が読める形に（サーバーの stats.js と同じ表記） */
function stepLabel(stepMs) {
  const s = Math.round((stepMs || 60000) / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}分` : `${Math.round(m / 60)}時間`;
}

/** 同接の経過を折れ線に。件数が少ないときも形になるよう、点が1つでも横線を引く */
function buildGraph(series, stepMs) {
  const wrap = document.createElement('div');
  wrap.className = 'vc-logs-graph';
  if (!series || !series.length) return wrap;

  const W = 300;
  const H = 70;
  const pad = 4;
  const maxN = Math.max(1, ...series.map((p) => p.n));
  const n = series.length;
  const xAt = (i) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const yAt = (v) => H - pad - (v * (H - pad * 2)) / maxN;

  const pts = series.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.n).toFixed(1)}`).join(' ');
  // 面を塗ると小さいグラフでも形が読み取りやすい
  const area = `${pad},${H - pad} ${pts} ${(n === 1 ? W / 2 : W - pad).toFixed(1)},${H - pad}`;

  wrap.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="同時接続数の経過">` +
    `<polygon points="${area}" fill="rgba(0,255,234,0.15)"></polygon>` +
    `<polyline points="${pts}" fill="none" stroke="#00ffea" stroke-width="1.5"></polyline>` +
    `</svg>`;

  const scale = document.createElement('div');
  scale.className = 'vc-logs-when';
  scale.textContent = `縦軸の上端 = ${maxN}人 ／ ${stepLabel(stepMs)}ごと・${series.length}点`;
  wrap.appendChild(scale);
  return wrap;
}

/**
 * @param {Object} p
 * @param {() => string} p.getRole 'admin' のときだけ中身を出す
 * @param {() => string} p.getIdToken Googleログインのトークン（管理者判定に使う）
 */
export function initLogsUI({ getRole, getIdToken }) {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'vc-logs';

  let runs = null; // null = 未取得
  let openRunId = '';
  let detail = null; // 展開中の1件
  let loading = false;
  let errorMsg = '';

  /** 管理者判定に必要なものを毎回そろえる。開発時の devRole もWS側と同じ形で通す */
  function authBody(extra) {
    const body = { ...(extra || {}) };
    const idt = getIdToken ? getIdToken() : '';
    if (idt) body.idt = idt;
    const devRole = new URLSearchParams(location.search).get('devRole');
    if (devRole) body.devRole = devRole;
    return body;
  }

  async function post(path, extra) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody(extra)),
    });
    return res;
  }

  async function loadRuns() {
    if (loading) return;
    loading = true;
    errorMsg = '';
    render();
    try {
      const res = await post('api/admin/logs', {});
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : 'failed');
      runs = data.runs || [];
      if (data.persistent === false) {
        errorMsg = '※ Tursoが未設定のため、記録はサーバー再起動で消えます';
      }
    } catch (e) {
      runs = [];
      errorMsg = '記録を読み込めませんでした（管理者としてログインしているか確認してください）';
    }
    loading = false;
    render();
  }

  async function openRun(runId) {
    openRunId = runId;
    detail = null;
    render();
    try {
      const res = await post('api/admin/log', { runId });
      const data = await res.json();
      if (data && data.ok) detail = data;
    } catch (e) {
      detail = null;
    }
    render();
  }

  async function downloadCsv(run, format) {
    try {
      const res = await post('api/admin/log', { runId: run.runId, format });
      if (!res.ok) return;
      const text = await res.text();
      const label =
        format === 'csv-visits' ? '訪問ログ' : format === 'csv-chat' ? 'チャット' : '同接の経過';
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${safeFileName(run.name)}_${label}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      // 落としても実害はない（もう一度押せばよい）
    }
  }

  function kpi(root2, label, value) {
    const d = document.createElement('div');
    d.innerHTML = `${label} <b></b>`;
    d.querySelector('b').textContent = value;
    root2.appendChild(d);
  }

  function buildRunBox(run) {
    const box = document.createElement('div');
    box.className = 'vc-logs-run' + (run.runId === openRunId ? ' open' : '');

    const name = document.createElement('div');
    name.className = 'vc-logs-name';
    name.textContent = run.name;
    if (run.live) {
      const tag = document.createElement('span');
      tag.className = 'vc-logs-live';
      tag.textContent = '開催中';
      name.appendChild(tag);
    }
    box.appendChild(name);

    const when = document.createElement('div');
    when.className = 'vc-logs-when';
    when.textContent =
      `${fmtTime(run.openedAt)} 〜 ${run.live ? '（開催中）' : fmtTime(run.closedAt)}` +
      ` ／ ${fmtDuration(run.durationSec)}`;
    box.appendChild(when);

    const k = document.createElement('div');
    k.className = 'vc-logs-kpi';
    kpi(k, 'ピーク同接', `${run.peak}人`);
    kpi(k, '累計', `${run.unique}人`);
    kpi(k, 'のべ入場', `${run.entries}回`);
    if (run.live) kpi(k, 'いま', `${run.nowInside}人`);
    box.appendChild(k);

    if (run.runId !== openRunId) {
      box.addEventListener('click', () => openRun(run.runId));
      return box;
    }

    // ---- 展開したときの中身 ----
    if (!detail) {
      const load = document.createElement('div');
      load.className = 'vc-logs-empty';
      load.textContent = '読み込み中…';
      box.appendChild(load);
      return box;
    }

    box.appendChild(buildGraph(detail.series, detail.stepMs));

    const k2 = document.createElement('div');
    k2.className = 'vc-logs-kpi';
    kpi(k2, 'ピークの時刻', fmtTime(run.peakAt));
    kpi(k2, '平均同接', `${run.avgConcurrent}人`);
    kpi(k2, '平均滞在', fmtDuration(run.avgStaySec));
    kpi(k2, '滞在の中央値', fmtDuration(run.medianStaySec));
    kpi(k2, '最長滞在', fmtDuration(run.maxStaySec));
    kpi(k2, 'ログイン/ゲスト', `${run.entriesLoggedIn}/${run.entriesGuest}`);
    box.appendChild(k2);

    const hint = document.createElement('div');
    hint.className = 'vc-logs-when';
    hint.textContent =
      '「累計」は同じブラウザ・同じアカウントを1人として数えた人数です。NPCは含みません。';
    box.appendChild(hint);

    // 直近の発言を画面にも出す。何か起きたとき、CSVを落とさずその場で確認できるように
    const chat = detail.chat || [];
    if (chat.length) {
      const chatBox = document.createElement('div');
      chatBox.className = 'vc-logs-chat';

      const chatTitle = document.createElement('div');
      chatTitle.className = 'vc-logs-when';
      chatTitle.textContent =
        chat.length > 20
          ? `💬 会場チャット ${chat.length}件（新しい20件だけ表示。全部はCSVで）`
          : `💬 会場チャット ${chat.length}件`;
      chatBox.appendChild(chatTitle);

      for (const m of chat.slice(-20)) {
        const line = document.createElement('div');
        line.className = 'vc-logs-chat-line';
        line.textContent = `${fmtTime(m.createdAt)}　${m.name}: ${m.txt}`;
        // 表示名が同じ人がいても取り違えないように、素性はツールチップで出す
        line.title = `ルーム${m.room} / ${m.visitor}${m.scope === 'stream' ? ' / 配信にも送信' : ''}`;
        chatBox.appendChild(line);
      }
      box.appendChild(chatBox);
    }

    const actions = document.createElement('div');
    actions.className = 'vc-logs-actions';
    const csv1 = document.createElement('button');
    csv1.type = 'button';
    csv1.textContent = '📄 訪問ログCSV';
    csv1.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadCsv(run, 'csv-visits');
    });
    const csv2 = document.createElement('button');
    csv2.type = 'button';
    csv2.textContent = '📈 同接の経過CSV';
    csv2.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadCsv(run, 'csv-series');
    });
    const csv3 = document.createElement('button');
    csv3.type = 'button';
    csv3.textContent = `💬 チャットCSV（${(detail.chat || []).length}件）`;
    csv3.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadCsv(run, 'csv-chat');
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '閉じる';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      openRunId = '';
      detail = null;
      render();
    });
    actions.append(csv1, csv2, csv3, close);
    box.appendChild(actions);

    return box;
  }

  function render() {
    root.innerHTML = '';
    if (getRole() !== 'admin') return;

    const title = document.createElement('div');
    title.className = 'vc-room-title';
    title.textContent = '📊 イベントの記録';
    root.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'vc-room-hint';
    hint.textContent = '立ててから閉じるまでの同接・累計・滞在時間。閉じたイベントも残ります。';
    root.appendChild(hint);

    if (runs === null) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vc-room-chip';
      btn.textContent = loading ? '読み込み中…' : '記録を見る';
      btn.disabled = loading;
      btn.addEventListener('click', loadRuns);
      root.appendChild(btn);
      if (errorMsg) {
        const err = document.createElement('div');
        err.className = 'vc-logs-empty';
        err.textContent = errorMsg;
        root.appendChild(err);
      }
      return;
    }

    if (errorMsg) {
      const err = document.createElement('div');
      err.className = 'vc-logs-empty';
      err.textContent = errorMsg;
      root.appendChild(err);
    }

    if (!runs.length) {
      const empty = document.createElement('div');
      empty.className = 'vc-logs-empty';
      empty.textContent = 'まだ記録がありません。イベントを立てると、ここに残ります。';
      root.appendChild(empty);
    }

    for (const run of runs) root.appendChild(buildRunBox(run));

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'vc-room-chip';
    reload.textContent = '🔄 更新';
    reload.addEventListener('click', loadRuns);
    root.appendChild(reload);
  }

  render();

  return {
    /** 🚪パネルが描き直されるたびに、この要素を差し込んでもらう */
    element: root,
    /** パネルを開いたとき。1度取得済みなら黙って最新化する */
    refresh() {
      if (getRole() !== 'admin') return;
      if (runs === null) render();
      else loadRuns();
    },
  };
}
