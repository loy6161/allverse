// ============================================================
// スマホのおまけアプリ 5つ（2026-08-08）
//
// loyさん「他にも面白そうなの5つくらい考えて実装しておいて。」
// GTA6のイメージに寄せて、**街を歩く理由になるもの**と**遊んだ記録が残るもの**を選んだ。
//
//   1. 📸 アルバム … 撮った写真をスマホに残す。あとからSNSへ投稿できる
//   2. 🏆 実績     … 初投稿・初ガチャ・初ドライブなど。遊びの入口を教える役も兼ねる
//   3. 📈 ランキング … SNSのいいね数。会場の中の話題が見える
//   4. 🧭 ナビ     … 行き先を選ぶと矢印と距離が出る。21km²の街で迷わないため
//   5. ☀ 天気     … 晴れ／霧／雨。街の見え方が変わる（自分の画面だけ）
//
// ⚠ アルバムと実績はこの端末に保存する（モック）。天気も自分の画面だけ。
// ============================================================

const ALBUM_KEY = 'vc.album';
const ACH_KEY = 'vc.achievements';
/** 写真は重いので枚数を絞る（1枚30KB前後 × 12枚） */
const ALBUM_MAX = 12;

// ---------------- アルバム ----------------

export function getAlbum() {
  try {
    const v = JSON.parse(localStorage.getItem(ALBUM_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function addPhoto(dataUrl) {
  if (!dataUrl) return;
  const list = getAlbum();
  list.unshift({ img: dataUrl, t: Date.now() });
  try {
    localStorage.setItem(ALBUM_KEY, JSON.stringify(list.slice(0, ALBUM_MAX)));
  } catch {
    // 容量が足りないときは古いものから捨てて入れ直す
    try {
      localStorage.setItem(ALBUM_KEY, JSON.stringify(list.slice(0, 4)));
    } catch { /* それでも駄目なら諦める */ }
  }
}

export function removePhoto(t) {
  const list = getAlbum().filter((p) => p.t !== t);
  try {
    localStorage.setItem(ALBUM_KEY, JSON.stringify(list));
  } catch { /* 保存できなくても表示は消える */ }
}

export function renderAlbum(host, { onPost, onDelete }) {
  const list = getAlbum();
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = list.length
    ? `${list.length}枚（新しい順・最大${ALBUM_MAX}枚）。カメラで撮ると自動で入ります。`
    : 'まだ写真がありません。📷カメラで撮ると、ここに残ります。';
  host.appendChild(note);

  for (const p of list) {
    const card = document.createElement('div');
    card.style.cssText = 'margin-bottom:10px;';
    const im = document.createElement('img');
    im.src = p.img;
    im.style.cssText = 'width:100%;border-radius:10px;display:block;'
      + 'border:1px solid rgba(255,255,255,0.15);';
    card.appendChild(im);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:5px;';
    for (const [label, fn] of [['SNSに投稿', () => onPost(p.img)], ['削除', () => onDelete(p.t)]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'flex:1;padding:5px;font-size:11px;border-radius:8px;cursor:pointer;'
        + 'color:#eaf6ff;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.22);';
      b.addEventListener('click', fn);
      row.appendChild(b);
    }
    card.appendChild(row);
    host.appendChild(card);
  }
}

// ---------------- 実績 ----------------

export const ACHIEVEMENTS = [
  { id: 'first_post', icon: '🐦', name: 'はじめてのつぶやき', how: 'SNSに投稿する' },
  { id: 'first_photo', icon: '📷', name: 'カメラマン', how: '写真を撮る' },
  { id: 'first_gacha', icon: '🎁', name: '運試し', how: 'ガチャを回す' },
  { id: 'first_slot', icon: '🎰', name: 'ギャンブラー', how: 'スロットを回す' },
  { id: 'first_drink', icon: '🍺', name: '乾杯', how: 'バーで飲む' },
  { id: 'first_drive', icon: '🚗', name: 'ドライブ', how: '車に乗る' },
  { id: 'first_friend', icon: '📇', name: 'ともだち', how: 'フレンドができる' },
  { id: 'first_call', icon: '📹', name: 'もしもし', how: 'ビデオ通話をする' },
  { id: 'first_room', icon: '🏠', name: '我が家', how: '部屋を借りる' },
  { id: 'rich', icon: '💰', name: '小金持ち', how: '5,000 VC 貯める' },
];

export function getAchievements() {
  try {
    const v = JSON.parse(localStorage.getItem(ACH_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** 達成を記録する。初めてなら true（＝画面に出す） */
export function unlock(id) {
  const v = getAchievements();
  if (v[id]) return false;
  v[id] = Date.now();
  try {
    localStorage.setItem(ACH_KEY, JSON.stringify(v));
  } catch { /* 保存できなくても遊べる */ }
  return true;
}

export function renderAchievements(host) {
  const got = getAchievements();
  const done = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = `${done} / ${ACHIEVEMENTS.length} 個`;
  host.appendChild(note);
  for (const a of ACHIEVEMENTS) {
    const on = Boolean(got[a.id]);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:7px 9px;margin-bottom:6px;'
      + 'border-radius:10px;font-size:12px;'
      + (on
        ? 'background:rgba(0,255,234,0.10);border:1px solid rgba(0,255,234,0.45);'
        : 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);opacity:0.65;');
    row.innerHTML = `<span style="font-size:18px">${on ? a.icon : '🔒'}</span>`
      + `<span><b>${a.name}</b><br><span style="font-size:10px;color:rgba(220,235,255,0.6)">${a.how}</span></span>`;
    host.appendChild(row);
  }
}

// ---------------- ランキング ----------------

/**
 * SNSのいいね数で並べる。
 * ⚠ 所持ポイントの順位は作らない。**いまは残高が各端末にある**ので、
 *   自己申告の数字を並べることになり、順位として意味を持たない
 */
export function renderRanking(host, { posts }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = 'いま会場で話題の投稿（いいねの多い順）。'
    + '⚠ 所持ポイントの順位は、残高が各端末にあるあいだは出しません（自己申告になるため）。';
  host.appendChild(note);

  const sorted = [...posts].sort((a, b) => (b.likes || []).length - (a.likes || []).length).slice(0, 10);
  if (!sorted.length) {
    const p = document.createElement('p');
    p.className = 'vc-phone-note';
    p.textContent = 'まだ投稿がありません。';
    host.appendChild(p);
    return;
  }
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:7px 9px;margin-bottom:6px;'
      + 'border-radius:10px;font-size:12px;background:rgba(255,255,255,0.05);'
      + 'border:1px solid rgba(255,255,255,0.12);';
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    row.innerHTML = `<span>${medal}</span><span style="flex:1;min-width:0;overflow:hidden;`
      + `text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.n)}: ${escapeHtml(p.txt)}</span>`
      + `<span style="color:#ff6fd8">♥${(p.likes || []).length}</span>`;
    host.appendChild(row);
  });
}

// ---------------- ナビ ----------------

export const NAVI_SPOTS = [
  { id: 'club', name: 'clubVERSE（会場）', x: 4, z: 20 },
  { id: 'shop', name: 'VERSE SHOP', x: -64, z: -18 },
  { id: 'casino', name: 'VERSE CASINO', x: -64, z: 14 },
  { id: 'house', name: 'マイルーム', x: -65, z: 44 },
  { id: 'cars', name: '車の停め場', x: -40, z: -6 },
];

export function renderNavi(host, { current, onSet, playerPos }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = '行き先を選ぶと、画面の下に矢印と距離が出ます。街は4.6km四方あるので迷ったらここへ。';
  host.appendChild(note);

  for (const s of NAVI_SPOTS) {
    const d = Math.round(Math.hypot(s.x - playerPos.x, s.z - playerPos.z));
    const b = document.createElement('button');
    b.type = 'button';
    const on = current === s.id;
    b.style.cssText = 'display:flex;width:100%;gap:8px;align-items:center;padding:9px 10px;'
      + 'margin-bottom:6px;border-radius:10px;cursor:pointer;color:#eaf6ff;font-size:12px;'
      + `background:${on ? 'rgba(0,255,234,0.14)' : 'rgba(255,255,255,0.05)'};`
      + `border:1px solid ${on ? '#00ffea' : 'rgba(255,255,255,0.14)'};`;
    b.innerHTML = `<span>${on ? '🧭' : '📍'}</span><span style="flex:1">${s.name}</span>`
      + `<span style="color:rgba(220,235,255,0.6)">${d}m</span>`;
    b.addEventListener('click', () => onSet(on ? null : s));
    host.appendChild(b);
  }
}

// ---------------- 天気 ----------------

export const WEATHERS = [
  { id: 'clear', name: '晴れ', icon: '☀', fog: 0x05070f, near: 0.45, far: 1 },
  { id: 'fog', name: '霧', icon: '🌫', fog: 0x121826, near: 0.05, far: 0.35 },
  { id: 'rain', name: '雨', icon: '🌧', fog: 0x0a1220, near: 0.15, far: 0.6 },
];

export function renderWeather(host, { current, onSet }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = '街の見え方が変わります（自分の画面だけ）。霧を濃くすると遠くを描かないぶん軽くもなります。';
  host.appendChild(note);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;';
  for (const w of WEATHERS) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = current === w.id;
    b.style.cssText = 'flex:1;padding:12px 4px;border-radius:11px;cursor:pointer;font-size:12px;'
      + `color:#eaf6ff;background:${on ? 'rgba(0,255,234,0.16)' : 'rgba(255,255,255,0.06)'};`
      + `border:1px solid ${on ? '#00ffea' : 'rgba(255,255,255,0.2)'};`;
    b.innerHTML = `<div style="font-size:20px">${w.icon}</div>${w.name}`;
    b.addEventListener('click', () => onSet(w));
    row.appendChild(b);
  }
  host.appendChild(row);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
