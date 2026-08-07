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
    body.textContent = item.txt;
    // 写真つきの投稿（2026-08-08・loyさん「SNS投稿したけど写真でないね」）
    if (item.img) {
      const im = document.createElement('img');
      im.src = item.img;
      im.style.cssText = 'width:100%;border-radius:9px;margin:4px 0 6px;'
        + 'border:1px solid rgba(255,255,255,0.15);display:block;';
      body.appendChild(im);
    }
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
 * 連絡帳（フレンド）— 2026-08-08・loyさん依頼。
 * ここに居る人へ申請 → 相手が受けるとフレンド。**メッセージはフレンドだけ**。
 */
export function renderFriends(host, { people, friends, requests, onRequest, onAccept, onDecline, onRemove, onTalk }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = 'フレンドになるとメッセージを送り合えます。⚠ 名簿はこの端末だけに残ります。';
  host.appendChild(note);

  const section = (title) => {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:11px;letter-spacing:1px;color:rgba(0,255,234,0.8);margin:10px 0 6px;';
    h.textContent = title;
    host.appendChild(h);
  };
  const row = (label, buttons) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 9px;margin-bottom:6px;'
      + 'border-radius:10px;font-size:12px;background:rgba(255,255,255,0.05);'
      + 'border:1px solid rgba(255,255,255,0.14);';
    const n = document.createElement('span');
    n.textContent = label;
    n.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    r.appendChild(n);
    for (const [text, fn, color] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = 'padding:3px 8px;font-size:11px;border-radius:7px;cursor:pointer;'
        + `color:#eaf6ff;background:rgba(255,255,255,0.07);border:1px solid ${color || 'rgba(255,255,255,0.25)'};`;
      b.addEventListener('click', fn);
      r.appendChild(b);
    }
    host.appendChild(r);
  };

  if (requests.length) {
    section('届いている申請');
    for (const name of requests) {
      row(name, [
        ['受ける', () => onAccept(name), '#9be34a'],
        ['断る', () => onDecline(name), 'rgba(255,255,255,0.25)'],
      ]);
    }
  }

  section(`フレンド（${friends.length}人）`);
  if (!friends.length) {
    const p = document.createElement('p');
    p.className = 'vc-phone-note';
    p.textContent = 'まだ居ません。下の「この会場に居る人」から申請できます。';
    host.appendChild(p);
  }
  for (const name of friends) {
    row(name, [
      ['話す', () => onTalk(name), '#00ffea'],
      ['外す', () => onRemove(name), 'rgba(255,120,140,0.6)'],
    ]);
  }

  section('この会場に居る人');
  const others = people.filter((x) => !friends.includes(x.name));
  if (!others.length) {
    const p = document.createElement('p');
    p.className = 'vc-phone-note';
    p.textContent = 'いま他に誰も居ません。';
    host.appendChild(p);
  }
  for (const x of others) {
    row(x.name, [['申請', () => onRequest(x), '#ffd86b']]);
  }
}

/**
 * 送金（ポイントを譲る）— 2026-08-08・loyさん依頼。
 * ⚠ 相手は**フレンドかつ会場に居る人**だけ。誰にでも送れると、
 *   あとで換金の抜け道（現金でポイントを売買する）に使われる恐れがある
 */
export function renderPay(host, { balance, targets, onSend, message }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';
  note.textContent = `いま ${balance.toLocaleString()} VC。フレンドで、いま会場に居る人に渡せます。`;
  host.appendChild(note);

  if (message) {
    const m = document.createElement('div');
    m.style.cssText = 'font-size:12px;color:#9be34a;margin-bottom:8px;';
    m.textContent = message;
    host.appendChild(m);
  }

  if (!targets.length) {
    const p = document.createElement('p');
    p.className = 'vc-phone-note';
    p.textContent = '渡せる相手が居ません（フレンドが会場に居るときに使えます）。';
    host.appendChild(p);
    return;
  }

  const sel = document.createElement('select');
  sel.style.cssText = 'width:100%;padding:7px;border-radius:9px;margin-bottom:8px;font-size:12px;'
    + 'color:#eaf6ff;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.25);';
  for (const t of targets) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    o.style.color = '#000';
    sel.appendChild(o);
  }
  host.appendChild(sel);

  const amount = document.createElement('input');
  amount.type = 'number';
  amount.min = '1';
  amount.value = '100';
  amount.style.cssText = 'width:100%;padding:7px 9px;border-radius:9px;margin-bottom:8px;font-size:12px;'
    + 'color:#fff;background:rgba(255,255,255,0.07);border:1px solid rgba(0,255,234,0.35);outline:none;';
  amount.addEventListener('keydown', (e) => e.stopPropagation());
  host.appendChild(amount);

  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = '渡す';
  go.style.cssText = 'width:100%;padding:10px;font-size:13px;font-weight:700;border-radius:11px;'
    + 'cursor:pointer;border:none;color:#06121a;background:linear-gradient(90deg,#00ffea,#ff00e5);';
  go.addEventListener('click', () => {
    const n = Math.floor(Number(amount.value));
    const t = targets.find((x) => x.id === sel.value);
    if (!t || !(n > 0)) return;
    onSend(t, n);
  });
  host.appendChild(go);
}

/**
 * ビデオ通話の画面（2026-08-08）。
 * state: 'idle' 相手を選ぶ / 'ring' 呼び出し中 / 'incoming' 着信 / 'live' 通話中
 */
export function renderCall(host, { state, friends, peer, view, onCall, onAccept, onEnd }) {
  const note = document.createElement('p');
  note.className = 'vc-phone-note';

  if (state === 'idle') {
    note.textContent = 'フレンドで、いま同じ会場に居る人と話せます。'
      + '⚠ 相手のアバターの顔がそのまま映ります（カメラは使いません）。';
    host.appendChild(note);
    if (!friends.length) {
      const p = document.createElement('p');
      p.className = 'vc-phone-note';
      p.textContent = '通話できる相手が居ません（フレンドが同じ会場に居るときに使えます）。';
      host.appendChild(p);
      return;
    }
    for (const f of friends) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'display:flex;width:100%;gap:8px;align-items:center;padding:9px 10px;'
        + 'margin-bottom:6px;border-radius:10px;cursor:pointer;color:#eaf6ff;font-size:12px;'
        + 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);';
      b.innerHTML = `<span>📹</span><span>${escapeHtml(f.name)}</span>`;
      b.addEventListener('click', () => onCall(f));
      host.appendChild(b);
    }
    return;
  }

  const title = document.createElement('div');
  title.style.cssText = 'text-align:center;font-size:13px;font-weight:700;margin-bottom:8px;';
  title.textContent = peer ? peer.name : '';
  host.appendChild(title);

  if (state === 'live' && view) {
    host.appendChild(view);
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = 'height:150px;border-radius:12px;display:flex;align-items:center;'
      + 'justify-content:center;font-size:34px;background:#0a0c16;'
      + 'border:1px solid rgba(255,255,255,0.16);';
    ph.textContent = state === 'incoming' ? '📞' : '📹';
    host.appendChild(ph);
  }

  const label = document.createElement('div');
  label.style.cssText = 'text-align:center;font-size:11px;color:rgba(220,235,255,0.6);margin:8px 0;';
  label.textContent = state === 'ring' ? '呼び出し中…'
    : state === 'incoming' ? '着信中' : '通話中';
  host.appendChild(label);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;';
  if (state === 'incoming') {
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = '出る';
    ok.style.cssText = 'flex:1;padding:10px;font-size:13px;font-weight:700;border-radius:11px;'
      + 'cursor:pointer;border:none;color:#06121a;background:#9be34a;';
    ok.addEventListener('click', onAccept);
    row.appendChild(ok);
  }
  const end = document.createElement('button');
  end.type = 'button';
  end.textContent = state === 'incoming' ? '断る' : '切る';
  end.style.cssText = 'flex:1;padding:10px;font-size:13px;font-weight:700;border-radius:11px;'
    + 'cursor:pointer;border:none;color:#fff;background:#e2445c;';
  end.addEventListener('click', onEnd);
  row.appendChild(end);
  host.appendChild(row);
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
    // ⚠ 元の画像は数百KBある。そのまま配ると通信が詰まるので、
    //   **横360pxのJPEGに縮めてから**送る（30KB前後）。モックなのでこれで十分
    shrink(dataUrl, 360).then((small) => onPostPhoto(small));
  });
}

/** 画像を横幅 maxW まで縮めた JPEG のデータURLにする */
function shrink(dataUrl, maxW) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
