// ============================================================
// 空腹（2026-08-08・loyさん依頼） — **モック**
//
// > ・会場外では、お腹がすいて（足が遅くなる）飲食で回復。ライブには支障が出ないように。
//
// ★ 決めごと（loyさんの「ライブには支障が出ないように」を守るための線引き）
//   ・**会場（clubVERSE）の中では減らない。** ライブを観ている間は一切関係しない
//   ・**街に出ている間だけ**ゆっくり減る
//   ・減っても**歩けなくはならない**。遅くなるだけ（最悪でも既定の60%）
//   ・**会場に戻れば止まる**。戻った瞬間に困らないよう、罰は速度だけにする
//
// ⚠ 数字はこの端末だけに保存する（モック）。本番はサーバー側の持ち物と一緒に置く。
// ============================================================

const KEY = 'vc.hunger';
/** 満腹＝100。街に出ている間、1分あたりこれだけ減る */
const DRAIN_PER_MIN = 2.5;
/** これを下回ると遅くなり始める */
export const SLOW_FROM = 50;
/** いちばん遅いときの速さ（既定に対する割合） */
const MIN_SPEED = 0.6;

const listeners = new Set();
let value = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    // ⚠ null を Number() に通すと **0** になる（＝いきなりペコペコで始まる）。
    //   保存が無いときは満腹から始める（2026-08-08 実測して気づいた）
    if (raw === null || raw === '') return 100;
    const v = Number(JSON.parse(raw));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 100;
  } catch {
    return 100;
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Math.round(value)));
  } catch { /* 保存できなくても遊べる */ }
}

export function getHunger() {
  return value;
}

export function onHungerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(value);
}

/**
 * 毎フレーム呼ぶ。
 * @param {number} dt 前のフレームからの秒数
 * @param {boolean} inVenue 会場（clubVERSE）の中に居るか
 */
export function updateHunger(dt, inVenue) {
  if (inVenue) return; // ★ 会場の中では減らない（ライブに支障を出さない）
  const before = Math.round(value);
  value = Math.max(0, value - (DRAIN_PER_MIN / 60) * dt);
  if (Math.round(value) !== before) {
    save();
    notify();
  }
}

/** 食べる・飲むと回復する */
export function eat(amount = 25) {
  value = Math.min(100, value + amount);
  save();
  notify();
  return Math.round(value);
}

/**
 * いまの歩く速さの倍率。
 * 50を下回ってから0に向かって、なだらかに 1.0 → 0.6 まで落ちる
 */
export function speedFactor() {
  if (value >= SLOW_FROM) return 1;
  const t = value / SLOW_FROM; // 0..1
  return MIN_SPEED + (1 - MIN_SPEED) * t;
}

/** 見た目の状態（表示用） */
export function hungerLabel() {
  if (value >= 70) return { text: '満腹', color: '#9be34a' };
  if (value >= SLOW_FROM) return { text: 'ふつう', color: '#eaf6ff' };
  if (value >= 20) return { text: 'お腹がすいた', color: '#ffd86b' };
  return { text: 'ペコペコ', color: '#ff9aa2' };
}
