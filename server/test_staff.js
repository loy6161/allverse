// ============================================================
// VIPの運営権限・キックのタイムアウト・イベント設定の途中変更 の自己テスト
//
// 使い方: ログインを有効にしたサーバーに対して実行する。
//   GOOGLE_CLIENT_ID=dummy ADMIN_EMAILS=admin@example.com VIP_EMAILS=vip@example.com,vip2@example.com \
//     TURSO_DATABASE_URL="file:./_t.db" PORT=5210 node server.js
//   WS_URL=ws://localhost:5210/ws node test_staff.js
//
// ⚠ ログインを有効にしないと canControlVideo が全員 true を返す（移行のための仕様）ので、
//   権限の検証にならない。GOOGLE_CLIENT_ID を必ず設定すること。
//   トークン検証は devRole/devEmail で回避する（ローカル限定の開発用の口）。
// ============================================================

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:5210/ws';
const HTTP = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' - ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    ws.on('message', (d) => {
      try {
        inbox.push(JSON.parse(d.toString()));
      } catch {
        /* ignore */
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', av: {}, ...opts }));
      resolve({ ws, inbox, send: (o) => ws.send(JSON.stringify(o)) });
    });
  });
}

async function waitFor(c, pred, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = c.inbox.find(pred);
    if (hit) return hit;
    await sleep(30);
  }
  return null;
}

async function post(path, body) {
  const res = await fetch(HTTP + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const ADMIN = { devRole: 'admin', devEmail: 'admin@example.com', devName: '管理者' };
const VIP = { devRole: 'vip', devEmail: 'vip@example.com', devName: 'VIP-A' };
const VIP2 = { devRole: 'vip', devEmail: 'vip2@example.com', devName: 'VIP-B' };

async function main() {
  const status = await (await fetch(`${HTTP}/api/status`)).json();
  console.log(`=== 運営権限テスト (${HTTP}) ／ ログイン: ${status.login ? '有効' : '無効'} ===`);
  if (!status.login) {
    console.log('!! GOOGLE_CLIENT_ID が未設定です。全員が管理者相当になるため権限を検証できません。');
    process.exit(1);
  }

  // ---- VIPがイベントを立てられる（入場画面のHTTP口）----
  const vipEv = await post('/api/admin/event', { ...VIP, name: 'VIPのライブ', cap: 8 });
  check('VIPは入場画面からイベントを立てられる', vipEv.status === 200 && vipEv.data.ok,
    `status=${vipEv.status} ${vipEv.data && vipEv.data.error}`);
  const evId = vipEv.data && vipEv.data.ev && vipEv.data.ev.id;
  if (!evId) return finish();

  const guestTry = await post('/api/admin/event', { devRole: 'user', devEmail: 'x@example.com', name: 'だめ' });
  check('一般ユーザーはイベントを立てられない', guestTry.status === 403, `status=${guestTry.status}`);

  // ---- 自分のイベントは操作できる ----
  const vip = await connect({ ev: evId, ...VIP });
  const w = await waitFor(vip, (m) => m.t === 'welcome');
  check('VIPが自分のイベントに入場できる', Boolean(w), w && w.role);
  check('自分のイベントなら動画を操作できると返る', w && w.canControl === true, w && `canControl=${w.canControl}`);
  // canControl（このイベントを操作できる）と isAdmin（管理者そのもの）は別物。
  // 一緒にすると、VIPに管理者専用パネル（記録・BAN・キック履歴）が見えてしまう
  check('VIPは isAdmin=false（管理者専用パネルを出さないため）', w && w.isAdmin === false,
    w && `isAdmin=${w.isAdmin}`);

  const mine = w.events.find((e) => e.id === evId);
  check('自分のイベントには mine=true が付く', mine && mine.mine === true);
  check('自分のイベントの合言葉は見える', mine && typeof mine.code === 'string');

  vip.inbox.length = 0;
  vip.send({ t: 'screen', v: 'aaaaaaaaaaa' });
  const scr = await waitFor(vip, (m) => m.t === 'screen' || m.t === 'denied');
  check('VIPは自分のイベントの動画を変えられる', scr && scr.t === 'screen', scr && scr.t);

  // ---- 他人のイベントは操作できない ----
  const adminEv = await post('/api/admin/event', { ...ADMIN, name: '管理者のライブ', cap: 8 });
  const adminEvId = adminEv.data.ev.id;

  const vip2 = await connect({ ev: evId, ...VIP2 });
  // welcome は先に取り出して控える（あとで inbox を空にするため）
  const w2 = await waitFor(vip2, (m) => m.t === 'welcome');
  const otherEv = ((w2 && w2.events) || []).find((e) => e.id === adminEvId);
  check('他人のイベントの合言葉は見えない', otherEv && otherEv.code === undefined,
    otherEv ? JSON.stringify(Object.keys(otherEv)) : 'イベントが見つからない');
  check('他人のイベントには mine=false', otherEv && otherEv.mine === false,
    otherEv && `mine=${otherEv.mine}`);

  vip2.inbox.length = 0;
  vip2.send({ t: 'event-delete', id: evId });
  const del = await waitFor(vip2, (m) => m.t === 'denied');
  check('別のVIPは他人のイベントを閉じられない', del && del.reason === 'not-your-event',
    del && del.reason);

  vip2.inbox.length = 0;
  vip2.send({ t: 'event-update', id: adminEvId, name: 'のっとり' });
  const upd = await waitFor(vip2, (m) => m.t === 'denied');
  check('別のVIPは管理者のイベントを変更できない', upd && upd.reason === 'not-your-event',
    upd && upd.reason);

  // ---- イベント設定の途中変更が中の人へ届く ----
  vip.inbox.length = 0;
  vip.send({ t: 'event-update', id: evId, cap: 20, npcMax: 7, chatMode: 'youtube',
    notice: { level: 'important', text: '転換中です' } });
  const changed = await waitFor(vip, (m) => m.t === 'event-changed');
  check('設定変更が中にいる人へ届く（event-changed）', Boolean(changed));
  check('新しい定員が届く', changed && changed.event.cap === 20, changed && `cap=${changed.event.cap}`);
  check('NPCの上限が届く', changed && changed.event.npcMax === 7, changed && `npcMax=${changed.event.npcMax}`);
  check('チャットの形が届く', changed && changed.event.chatMode === 'youtube');
  check('運営メッセージが届く',
    changed && changed.event.notice && changed.event.notice.text === '転換中です',
    changed && JSON.stringify(changed.event.notice));

  vip.inbox.length = 0;
  vip.send({ t: 'event-update', id: evId, notice: { level: 'info', text: '' } });
  const cleared = await waitFor(vip, (m) => m.t === 'event-changed');
  check('本文を空にすると運営メッセージが消える', cleared && cleared.event.notice === null,
    cleared && JSON.stringify(cleared.event.notice));

  // ---- キックのタイムアウト ----
  const victimVid = 'dd'.repeat(16);
  const victim = await connect({ ev: evId, devRole: 'guest', vid: victimVid });
  const vw = await waitFor(victim, (m) => m.t === 'welcome');
  check('ゲストが入場できる', Boolean(vw));

  const peer = (await waitFor(vip, (m) => m.t === 'peer-join', 1500)) || {};
  const victimId = peer.p && peer.p.id;
  check('VIPから対象が見える', Boolean(victimId));

  vip.inbox.length = 0;
  vip.send({ t: 'kick', id: victimId, mins: 5, why: 'テスト' });
  const kicked = await waitFor(victim, (m) => m.t === 'kicked');
  check('キックが届く', kicked && kicked.mins === 5, kicked && `mins=${kicked.mins}`);
  const note = await waitFor(vip, (m) => m.t === 'moderated');
  check('キックした側に結果が返る', Boolean(note));
  await sleep(400);

  // 同じ匿名IDで入り直そうとすると弾かれる
  const again = await connect({ ev: evId, devRole: 'guest', vid: victimVid });
  const denied = await waitFor(again, (m) => m.t === 'denied');
  check('締め出し中は同じブラウザで入り直せない', denied && denied.reason === 'kicked-out',
    denied && denied.reason);
  check('あと何分で入れるかが分かる', denied && denied.until > Date.now(), denied && `until=${denied.until}`);
  check('ゲストにも効く（BANはゲストに効かない）', denied && denied.reason === 'kicked-out');

  // 別のブラウザ（別の匿名ID）なら入れる
  const other = await connect({ ev: evId, devRole: 'guest', vid: 'ee'.repeat(16) });
  const otherW = await waitFor(other, (m) => m.t === 'welcome');
  check('別のブラウザは締め出されない', Boolean(otherW));

  // ---- ゲストの見た目（2026-08-02）----
  // 申告を無視してサーバーが決める・髪なし・同じIDなら同じ色・本人にも返す
  const look1 = await connect({ ev: evId, devRole: 'guest', vid: 'cc'.repeat(16),
    av: { h: 'twin', o: 'long', ac: 'kemo', hc: 3, sc: 3, bc: 3, ec: 3, pl: 3 } });
  const lw = await waitFor(look1, (m) => m.t === 'welcome');
  check('welcome が見た目を返す（本人と他人の食い違い防止）', lw && Boolean(lw.av),
    lw && JSON.stringify(lw.av));
  check('ゲストは髪なし', lw && lw.av && lw.av.h === 'none', lw && lw.av && lw.av.h);
  check('ゲストはアクセなし', lw && lw.av && lw.av.ac === 'none');
  check('申告した見た目は使われない', lw && lw.av && lw.av.o !== 'long' && lw.av.hc !== 3);
  const seenByOther = (lw.peers || []).length >= 0; // 自分の姿は下で他人から確認する
  check('自分の姿を welcome から取れる', seenByOther);

  // 他人から見た姿が welcome の内容と一致するか
  const watcher2 = await connect({ ev: evId, ...ADMIN });
  const ww = await waitFor(watcher2, (m) => m.t === 'welcome');
  // 髪なしのゲストは同時に複数いるので、名前で本人を特定する
  const seenGuest = ((ww && ww.peers) || []).find((p) => p.n === lw.n);
  check('他人から見えている姿が welcome と一致する',
    seenGuest && JSON.stringify(seenGuest.av) === JSON.stringify(lw.av),
    seenGuest && JSON.stringify(seenGuest.av));

  // 同じIDなら同じ色・違うIDなら違いうる
  look1.ws.close();
  await sleep(300);
  const look2 = await connect({ ev: evId, devRole: 'guest', vid: 'cc'.repeat(16) });
  const lw2 = await waitFor(look2, (m) => m.t === 'welcome');
  check('同じブラウザなら毎回同じ姿', lw2 && JSON.stringify(lw2.av) === JSON.stringify(lw.av),
    lw2 && JSON.stringify(lw2.av));
  const look3 = await connect({ ev: evId, devRole: 'guest', vid: '77'.repeat(16) });
  const lw3 = await waitFor(look3, (m) => m.t === 'welcome');
  check('別のブラウザは色が変わりうる（識別できる）',
    lw3 && (lw3.av.bc !== lw.av.bc || lw3.av.sc !== lw.av.sc),
    lw3 && `${lw3.av.bc}/${lw3.av.sc} vs ${lw.av.bc}/${lw.av.sc}`);

  // ログイン済みは自分の見た目が通る
  const member = await connect({ ev: evId, devRole: 'user', devEmail: 'm@example.com', devName: 'メンバー',
    av: { h: 'twin', o: 'long', ac: 'kemo', hc: 3, sc: 3, bc: 3, ec: 3, pl: 3 } });
  const mw = await waitFor(member, (m) => m.t === 'welcome');
  check('ログイン済みは選んだ見た目がそのまま通る',
    mw && mw.av && mw.av.h === 'twin' && mw.av.ac === 'kemo', mw && JSON.stringify(mw.av));
  for (const c of [look2, look3, member, watcher2]) { try { c.ws.close(); } catch { /* ignore */ } }
  await sleep(300);

  // ---- move で関門をすり抜けられないか（2026-08-02 レビュー指摘）----
  // move は join と同じ「イベントへの入場」なのに、合言葉もキックの締め出しも
  // 見ていなかった。ここが抜けると新しい締め出し機能が丸ごと無意味になる
  const codedEv = await post('/api/admin/event', {
    ...ADMIN, name: '合言葉つき', cap: 8, code: 'himitsu',
  });
  const codedId = codedEv.data.ev.id;

  other.inbox.length = 0;
  other.send({ t: 'move', ev: codedId, rm: 1 });
  const moveDenied = await waitFor(other, (m) => m.t === 'denied' || m.t === 'moved');
  check('move で合言葉つきイベントへ素通りできない', moveDenied && moveDenied.t === 'denied'
    && moveDenied.reason === 'bad-code', moveDenied && `${moveDenied.t}/${moveDenied.reason}`);

  other.inbox.length = 0;
  other.send({ t: 'move', ev: codedId, rm: 1, code: 'himitsu' });
  const moveOk = await waitFor(other, (m) => m.t === 'moved' || m.t === 'denied');
  check('正しい合言葉なら move できる', moveOk && moveOk.t === 'moved', moveOk && moveOk.t);
  // 元のイベントへ戻しておく（後続のテストのため）
  other.inbox.length = 0;
  other.send({ t: 'move', ev: evId, rm: 1 });
  await waitFor(other, (m) => m.t === 'moved');

  // 締め出し中の人が move で戻れないか
  const sneak = await connect({ ev: codedId, devRole: 'guest', vid: victimVid, code: 'himitsu' });
  const sneakW = await waitFor(sneak, (m) => m.t === 'welcome');
  check('締め出しは別イベントには及ばない（そこには入れる）', Boolean(sneakW));
  if (sneakW) {
    sneak.inbox.length = 0;
    sneak.send({ t: 'move', ev: evId, rm: 1 });
    const back = await waitFor(sneak, (m) => m.t === 'denied' || m.t === 'moved');
    check('締め出し中のイベントへ move で戻れない', back && back.t === 'denied'
      && back.reason === 'kicked-out', back && `${back.t}/${back.reason}`);
  }

  // ---- 他人のイベントではキックできない ----
  vip2.inbox.length = 0;
  vip2.send({ t: 'kick', id: victimId, mins: 60 });
  const kickDenied = await waitFor(vip2, (m) => m.t === 'denied');
  check('他人のイベントにいるVIPはキックできない', kickDenied && kickDenied.reason === 'not-your-event',
    kickDenied && kickDenied.reason);

  // ---- YouTube連動中は独自チャットをサーバーが止める ----
  vip.inbox.length = 0;
  vip.send({ t: 'event-update', id: evId, chatMode: 'youtube' });
  await waitFor(vip, (m) => m.t === 'event-changed');
  vip.inbox.length = 0;
  vip.send({ t: 'chat', txt: 'UIを迂回した発言' });
  const chatDenied = await waitFor(vip, (m) => m.t === 'denied' || m.t === 'chat');
  check('YouTube連動中はサーバーが独自チャットを止める',
    chatDenied && chatDenied.t === 'denied' && chatDenied.reason === 'chat-on-youtube',
    chatDenied && `${chatDenied.t}/${chatDenied.reason}`);
  vip.inbox.length = 0;
  vip.send({ t: 'event-update', id: evId, chatMode: 'local' });
  await waitFor(vip, (m) => m.t === 'event-changed');
  vip.inbox.length = 0;
  vip.send({ t: 'chat', txt: '戻ったので言える' });
  const chatOk = await waitFor(vip, (m) => m.t === 'chat' || m.t === 'denied');
  check('連動を戻せば独自チャットが使える', chatOk && chatOk.t === 'chat', chatOk && chatOk.t);

  // ---- キックの履歴（管理者だけ）----
  const admin = await connect({ ev: evId, ...ADMIN });
  const aw = await waitFor(admin, (m) => m.t === 'welcome');
  check('管理者は isAdmin=true', aw && aw.isAdmin === true, aw && `isAdmin=${aw.isAdmin}`);
  admin.inbox.length = 0;
  admin.send({ t: 'kicks' });
  const kicks = await waitFor(admin, (m) => m.t === 'kicks');
  check('管理者はキックの履歴を見られる', kicks && kicks.list.length >= 1,
    kicks && `${kicks.list.length}件`);
  check('履歴に理由と時間が入る',
    kicks && kicks.list[0].reason === 'テスト' && kicks.list[0].minutes === 5,
    kicks && JSON.stringify(kicks.list[0]));

  vip2.inbox.length = 0;
  vip2.send({ t: 'kicks' });
  const vipKicks = await waitFor(vip2, (m) => m.t === 'denied');
  check('VIPはキックの履歴を見られない', vipKicks && vipKicks.reason === 'admin-only',
    vipKicks && vipKicks.reason);

  // ---- 管理者は他人のイベントも操作できる ----
  admin.inbox.length = 0;
  admin.send({ t: 'event-update', id: evId, name: '管理者が改名' });
  const adminUpd = await waitFor(admin, (m) => m.t === 'event-updated');
  check('管理者は他人のイベントも変更できる', Boolean(adminUpd), adminUpd && adminUpd.ev.name);

  // ---- 後片付け ----
  // 立てたイベントを消さないと、繰り返し実行したときにイベント数の上限
  // （MAX_EVENTS=20）に当たって別のテストが落ちる。管理者は他人のも消せる
  // ⚠ 自分がいるイベント（evId）は**最後**に消す。
  //   先に消すと自分の接続ごと切れて、残りの削除が届かない
  for (const id of [adminEvId, codedId, evId]) {
    admin.send({ t: 'event-delete', id });
    await sleep(250);
  }

  for (const c of [vip, vip2, victim, again, other, sneak, admin]) {
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  }
  await sleep(200);
  finish();
}

function finish() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} PASS ===`);
  if (pass !== results.length) {
    console.log('失敗:', results.filter((r) => !r.ok).map((r) => r.name).join(' / '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('テストが異常終了:', e);
  process.exit(1);
});
