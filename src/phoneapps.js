// ============================================================
// スマホのアプリ（2026-08-08・loyさん依頼「マップ・メッセンジャー・SNS」＋こちらの判断で追加）
//
// > あと、せっかくだからスマホ機能で、マップ（全体マップと現在地）／
// > メッセンジャー（1対1でのチャット）／SNS（Xみたいに投稿できる。）
// > あと、まだモックなのでいろいろ検証したいのでこんな機能もできるよとか、
// > 君の判断で実装してみて。……イメージはGTA6。
//
// ここは**画面だけ**。通信は net.js、残高は wallet.js に任せる。
//
// ⚠ SNS・メッセンジャーは**サーバーに残らない**（メモリだけ・再起動で消える）。
//   残す設計は通報や削除の話とセットなので、モックの段階では持たない。
// ============================================================

const MAP_SIZE = 300; // 地図の1辺（px）

/**
 * マップ（全体図と現在地）。
 * ⚠ 街は 4600m 四方あるので、そのまま描くと自分が点にもならない。
 *   **全体図**と**周辺（200m四方）**を切り替えられるようにする
 */
export function renderMap(host, { getPlayer, getShops, getVenue }) {
  const wrap = document.createElement('div');
  const cv = document.createElement('canvas');
  cv.width = MAP_SIZE;
  cv.height = MAP_SIZE;
  cv.style.cssText = 'width:100%;border-radius:12px;background:#080a12;display:block;';
  wrap.appendChild(cv);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
  let zoomed = true; // 既定は周辺（そちらの方が役に立つ）
  const mkBtn = (label, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'flex:1;padding:6px;font-size:11px;border-radius:8px;cursor:pointer;'
      + `color:#eaf6ff;border:1px solid ${on ? '#00ffea' : 'rgba(255,255,255,0.22)'};`
      + `background:${on ? 'rgba(0,255,234,0.18)' : 'rgba(255,255,255,0.06)'};`;
    return b;
  };
  const near = mkBtn('周辺', zoomed);
  const all = mkBtn('全体', !zoomed);
  row.append(near, all);
  wrap.appendChild(row);

  const info = document.createElement('div');
  info.style.cssText = 'margin-top:8px;font-size:11px;color:rgba(220,235,255,0.6);line-height:1.6;';
  wrap.appendChild(info);
  host.appendChild(wrap);


  function draw() {
    const ctx = cv.getContext('2d');
    const p = getPlayer ? getPlayer() : null;
    const px = p ? p.position.x : 0;
    const pz = p ? p.position.z : 0;
    // 表示範囲（m）。周辺=±120m、全体=街ぜんぶ
    const half = zoomed ? 120 : 2400;
    const cx = zoomed ? px : 0;
    const cz = zoomed ? pz : 0;
    const toX = (x) => ((x - cx) / (half * 2) + 0.5) * MAP_SIZE;
    const toY = (z) => ((z - cz) / (half * 2) + 0.5) * MAP_SIZE;

    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // 道（200mごとの碁盤目）。全体図では細かすぎるので間引く
    const step = zoomed ? 200 : 800;
    ctx.strokeStyle = 'rgba(120,160,200,0.18)';
    ctx.lineWidth = 1;
    const from = Math.floor((cx - half) / step) * step;
    for (let x = from; x <= cx + half; x += step) {
      ctx.beginPath();
      ctx.moveTo(toX(x), 0);
      ctx.lineTo(toX(x), MAP_SIZE);
      ctx.stroke();
    }
    const fromZ = Math.floor((cz - half) / step) * step;
    for (let z = fromZ; z <= cz + half; z += step) {
      ctx.beginPath();
      ctx.moveTo(0, toY(z));
      ctx.lineTo(MAP_SIZE, toY(z));
      ctx.stroke();
    }

    // 会場（clubVERSE）
    const venue = getVenue ? getVenue() : null;
    if (venue) {
      ctx.fillStyle = 'rgba(0,255,234,0.22)';
      ctx.strokeStyle = '#00ffea';
      const x0 = toX(venue.minX);
      const y0 = toY(venue.minZ);
      const w = toX(venue.maxX) - x0;
      const h = toY(venue.maxZ) - y0;
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeRect(x0, y0, w, h);
      ctx.fillStyle = '#7ffff0';
      ctx.font = '10px sans-serif';
      ctx.fillText('clubVERSE', x0 + 3, y0 + 12);
    }

    // お店・カジノ
    for (const s of (getShops ? getShops() : [])) {
      ctx.fillStyle = s.color || '#ffd86b';
      const x = toX(s.x);
      const y = toY(s.z);
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = 'rgba(230,240,255,0.85)';
      ctx.font = '9px sans-serif';
      ctx.fillText(s.label, x + 7, y + 3);
    }

    // 現在地（向きつき）
    const x = toX(px);
    const y = toY(pz);
    ctx.save();
    ctx.translate(x, y);
    // 3Dの向き（rotation.y）は「+Zを向いている＝地図では下」を0とする
    if (p) ctx.rotate(-p.rotation.y + Math.PI);
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    info.textContent = `現在地 X ${Math.round(px)} / Z ${Math.round(pz)}`
      + `（${zoomed ? '周辺 240m四方' : '街ぜんぶ 4.6km四方'}）`;
  }

  // ボタンの見た目を切り替える（作り直さずに塗る）
  function paintBtns() {
    near.style.borderColor = zoomed ? '#00ffea' : 'rgba(255,255,255,0.22)';
    near.style.background = zoomed ? 'rgba(0,255,234,0.18)' : 'rgba(255,255,255,0.06)';
    all.style.borderColor = !zoomed ? '#00ffea' : 'rgba(255,255,255,0.22)';
    all.style.background = !zoomed ? 'rgba(0,255,234,0.18)' : 'rgba(255,255,255,0.06)';
  }
  near.onclick = () => { zoomed = true; paintBtns(); draw(); };
  all.onclick = () => { zoomed = false; paintBtns(); draw(); };
  paintBtns();

  draw();
  const timer = setInterval(draw, 500); // 歩くと動くので定期的に描き直す
  return () => clearInterval(timer);
}

/**
 * SNS（Xのような投稿）。
 * ⚠ 投稿はサーバーのメモリだけ（再起動で消える）。写真は載せない（重いので印だけ）
 */
export function renderSns(host, { posts, myId, onPost, onLike, denied }) {
  const box = document.createElement('div');

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 140;
  input.placeholder = 'いまどうしてる？（140文字）';
  input.style.cssText = 'flex:1;min-width:0;padding:7px 9px;font-size:12px;border-radius:9px;'
    + 'color:#fff;background:rgba(255,255,255,0.07);border:1px solid rgba(0,255,234,0.35);outline:none;';
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = '投稿';
  send.style.cssText = 'padding:7px 12px;font-size:12px;border-radius:9px;cursor:pointer;border:none;'
    + 'color:#06121a;background:linear-gradient(90deg,#00ffea,#ff00e5);font-weight:700;';
  const post = () => {
    const t = input.value.trim();
    if (!t) return;
    onPost(t);
    input.value = '';
  };
  send.addEventListener('click', post);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') post();
    e.stopPropagation(); // 移動キーに食われないように
  });
  form.append(input, send);
  box.appendChild(form);

  if (denied) {
    const d = document.createElement('div');
    d.style.cssText = 'font-size:11px;color:#ff9aa2;margin-bottom:8px;';
    d.textContent = denied;
    box.appendChild(d);
  }

  if (!posts.length) {
    const p = document.createElement('p');
    p.className = 'vc-phone-note';
    p.textContent = 'まだ投稿がありません。最初の1件を書いてみてください。';
    box.appendChild(p);
  }

  for (const item of posts) {
    const card = document.createElement('div');
    card.style.cssText = 'padding:9px 10px;margin-bottom:8px;border-radius:11px;'
      + 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:6px;align-items:baseline;font-size:11px;';
    const badge = item.role === 'admin' ? '👑 ' : item.role === 'vip' ? '⭐ ' : '';
    const when = new Date(item.t);
    head.innerHTML = `<b>${badge}${escapeHtml(item.n)}</b>`
      + `<span style="color:rgba(220,235,255,0.45)">${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}</span>`;
    const body = document.createElement('div');
    body.style.cssText = 'font-size:12px;line-height:1.6;margin:4px 0 6px;white-space:pre-wrap;word-break:break-word;';
    body.textContent = item.txt + (item.photo ? ' 📷' : '');
    const like = document.createElement('button');
    like.type = 'button';
    const liked = (item.likes || []).includes(myId);
    like.textContent = `♥ ${(item.likes || []).length}`;
    like.style.cssText = 'padding:3px 9px;font-size:11px;border-radius:8px;cursor:pointer;'
      + `color:${liked ? '#ff6fd8' : '#eaf6ff'};background:rgba(255,255,255,0.06);`
      + `border:1px solid ${liked ? '#ff6fd8' : 'rgba(255,255,255,0.2)'};`;
    like.addEventListener('click', () => onLike(item.pid));
    card.append(head, body, like);
    box.appendChild(card);
  }
  host.appendChild(box);
}

/** メッセンジャー（1対1）。相手は同じイベントに居る人だけ */
export function renderMessenger(host, { people, threads, active, myId, onOpen, onSend, onBack }) {
  if (!active) {
    const note = document.createElement('p');
    note.className = 'vc-phone-note';
    note.textContent = people.length
      ? '相手を選ぶと1対1で話せます（会場に居る人だけ・履歴は自分の端末だけ）。'
      : 'いま話せる相手が居ません（同じイベントに誰か入ると出ます）。';
    host.appendChild(note);
    for (const p of people) {
      const b = document.createElement('button');
      b.type = 'button';
      const unread = (threads[p.id] || []).filter((m) => !m.mine && !m.read).length;
      b.style.cssText = 'display:flex;width:100%;gap:8px;align-items:center;padding:8px 10px;'
        + 'margin-bottom:6px;border-radius:10px;cursor:pointer;color:#eaf6ff;'
        + 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);font-size:12px;';
      b.innerHTML = `<span>💬</span><span>${escapeHtml(p.name)}</span>`
        + (unread ? `<span style="margin-left:auto;color:#ff6fd8">${unread}</span>` : '');
      b.addEventListener('click', () => onOpen(p.id));
      host.appendChild(b);
    }
    return;
  }

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'vc-phone-back';
  back.textContent = '← 一覧';
  back.addEventListener('click', onBack);
  head.append(back, document.createTextNode(active.name));
  host.appendChild(head);

  const log = document.createElement('div');
  log.style.cssText = 'max-height:300px;overflow-y:auto;margin-bottom:8px;';
  for (const m of threads[active.id] || []) {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;margin:3px 0;${m.mine ? 'justify-content:flex-end;' : ''}`;
    const b = document.createElement('div');
    b.style.cssText = 'max-width:80%;padding:6px 9px;border-radius:12px;font-size:12px;line-height:1.5;'
      + 'word-break:break-word;'
      + (m.mine
        ? 'background:rgba(0,255,234,0.18);border:1px solid rgba(0,255,234,0.4);'
        : 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);');
    b.textContent = m.txt;
    row.appendChild(b);
    log.appendChild(row);
  }
  host.appendChild(log);

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;gap:6px;';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = 'メッセージ';
  input.style.cssText = 'flex:1;min-width:0;padding:7px 9px;font-size:12px;border-radius:9px;'
    + 'color:#fff;background:rgba(255,255,255,0.07);border:1px solid rgba(0,255,234,0.35);outline:none;';
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = '送信';
  send.style.cssText = 'padding:7px 12px;font-size:12px;border-radius:9px;cursor:pointer;border:none;'
    + 'color:#06121a;background:linear-gradient(90deg,#00ffea,#ff00e5);font-weight:700;';
  const go = () => {
    const t = input.value.trim();
    if (!t) return;
    onSend(active.id, t);
    input.value = '';
  };
  send.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
    e.stopPropagation();
  });
  form.append(input, send);
  host.appendChild(form);
  setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
}

/**
 * カメラ（こちらの判断で追加・2026-08-08）。
 * GTAの「スナップマティック」に当たるもの。いまの画面を撮って、保存かSNS投稿ができる。
 * ⚠ 撮るのは3Dの画面だけ。**YouTubeの映像は写らない**
 *   （動画はブラウザが別に合成しているので、canvas には入っていない）
 */
export function renderCamera(host, { shoot, onPostPhoto }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = 'いまの画面を撮ります。⚠ 3Dの絵だけで、YouTubeの映像は写りません（別々に描かれているため）。';
  host.appendChild(note);

  const preview = document.createElement('img');
  preview.style.cssText = 'width:100%;border-radius:10px;display:none;margin-bottom:8px;'
    + 'border:1px solid rgba(255,255,255,0.18);';
  host.appendChild(preview);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '📷 撮る';
  btn.style.cssText = 'width:100%;padding:10px;font-size:13px;font-weight:700;border-radius:11px;'
    + 'cursor:pointer;border:none;color:#06121a;background:linear-gradient(90deg,#00ffea,#ff00e5);';
  host.appendChild(btn);

  const row = document.createElement('div');
  row.style.cssText = 'display:none;gap:6px;margin-top:8px;';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '保存';
  const toSns = document.createElement('button');
  toSns.type = 'button';
  toSns.textContent = 'SNSに投稿';
  for (const b of [save, toSns]) {
    b.style.cssText = 'flex:1;padding:7px;font-size:12px;border-radius:9px;cursor:pointer;'
      + 'color:#eaf6ff;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.22);';
  }
  row.append(save, toSns);
  host.appendChild(row);

  let dataUrl = '';
  btn.addEventListener('click', () => {
    dataUrl = shoot();
    if (!dataUrl) return;
    preview.src = dataUrl;
    preview.style.display = 'block';
    row.style.display = 'flex';
  });
  save.addEventListener('click', () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `allverse_${Date.now()}.png`;
    a.click();
  });
  toSns.addEventListener('click', () => {
    if (!dataUrl) return;
    onPostPhoto();
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
