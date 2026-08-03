// ============================================================
// YouTubeの利用枠(quota)を守る仕組みの自己テスト（2026-08-04追加）
//
// なぜ要るのか:
//   2026-08-03、本番の配信中に quotaExceeded で連動が止まった。
//   原因は配信中の消費ではなく、**イベントを立てっぱなしにしていた待機時間**で、
//   30秒おきに「まだ配信していない？」と聞き続けて枠を焼き切っていた。
//   ここが元に戻ると、また配信本番で止まる。数字で見張る。
//
// 実行:
//   cd server && node test_ytquota.js
// ============================================================

import { LiveChatReader, getYouTubeReadStatus, __quotaTestHooks } from './ytread.js';

let pass = 0;
let fail = 0;
function ok(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`[PASS] ${label}${extra ? ` - ${extra}` : ''}`);
  } else {
    fail++;
    console.error(`[FAIL] ${label}${extra ? ` - ${extra}` : ''}`);
  }
}

const { nextQuotaResetAt, IDLE_INTERVAL_MS, QUOTA_RESET_HOUR_JST } = __quotaTestHooks;

console.log('\n[1] 待機中の間隔が枠に収まる');
// 待機だけで1日どれだけ使うか。1回5ユニット、枠は10,000
const idlePerDay = Math.floor((24 * 3600_000) / IDLE_INTERVAL_MS) * 5;
console.log(`  待機だけで1日 ${idlePerDay} ユニット（枠10,000）`);
ok('待機の消費が1日3,000ユニット未満', idlePerDay < 3000, `${idlePerDay}`);
// 3時間の配信ぶん（10秒間隔）と足しても枠に収まること
const live3h = Math.floor((3 * 3600_000) / 10_000) * 5;
console.log(`  3時間の配信で ${live3h} ユニット`);
ok('待機＋3時間配信でも枠(10,000)に収まる', idlePerDay + live3h < 10_000,
  `${idlePerDay + live3h}`);
// ここが「以前の30秒」に戻ると落ちる（30秒だと待機だけで14,400）
ok('待機の間隔が30秒より長い（枠切れの主因だった）', IDLE_INTERVAL_MS > 30_000,
  `${IDLE_INTERVAL_MS / 1000}秒`);

console.log('\n[2] 枠が戻る時刻の計算（JSTの17時・太平洋時間の0時）');
// JST 22:00 → 翌日の17:00 まで待つ
const at22 = Date.UTC(2026, 7, 3, 13, 0, 0); // 2026-08-03 13:00 UTC = 22:00 JST
const reset1 = nextQuotaResetAt(at22);
const h1 = new Date(reset1 + 9 * 3600_000).getUTCHours();
ok('22時に切れたら次の17時を指す', h1 === QUOTA_RESET_HOUR_JST, `JST${h1}時`);
ok('22時に切れたら19時間後（＝日付が変わった先）', reset1 - at22 === 19 * 3600_000,
  `${(reset1 - at22) / 3600_000}時間後`);

// JST 10:00 → 同じ日の17:00 まで（7時間後）
const at10 = Date.UTC(2026, 7, 4, 1, 0, 0); // 10:00 JST
const reset2 = nextQuotaResetAt(at10);
ok('午前に切れたらその日の17時（7時間後）', reset2 - at10 === 7 * 3600_000,
  `${(reset2 - at10) / 3600_000}時間後`);

// ちょうど17時ちょうどは「次の日」を指す（過ぎている扱い）
const at17 = Date.UTC(2026, 7, 4, 8, 0, 0); // 17:00 JST
ok('17時ちょうどなら翌日を指す（同じ時刻で止まらない）',
  nextQuotaResetAt(at17) - at17 === 24 * 3600_000);

console.log('\n[3] 誰もいなければAPIを叩かない');
const before = getYouTubeReadStatus();
// shouldPoll が false を返すリーダー。APIキーが無い環境でも tick は門番で止まる
const reader = new LiveChatReader('dummyVideo', () => {}, { shouldPoll: () => false });
reader.stopped = false; // start() はキーが無いと何もしないので、直接まわす
await reader.tick();
reader.stop();
const after = getYouTubeReadStatus();
ok('叩いた回数が増えていない', after.calls === before.calls,
  `${before.calls} → ${after.calls}`);
ok('「読まなかった」が数えられている', after.skipped === before.skipped + 1,
  `${before.skipped} → ${after.skipped}`);

console.log('\n[4] 状態表示に枠の情報が出る');
const st = getYouTubeReadStatus();
ok('quotaUsed がある', typeof st.quotaUsed === 'number', String(st.quotaUsed));
ok('idleIntervalMs がある', st.idleIntervalMs === IDLE_INTERVAL_MS, String(st.idleIntervalMs));
ok('枠切れしていなければ quotaOutUntil は null', st.quotaOutUntil === null);

console.log(`\n=== ${pass + fail}項目中 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
