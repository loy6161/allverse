import * as THREE from 'three';
import { EYE_Y } from './avatar.js';

// キャラクター操作
// - WASD / 矢印キー: カメラ基準で移動（アバターは進行方向を向く）
// - ドラッグ: カメラ旋回、ホイール: ズーム
// - 三人称の最短からさらに寄せると一人称になる（引くと三人称へ戻る）
export function initControls(
  camera,
  avatar,
  domElement,
  { bounds: initialBounds, onJump, screen, stage, groundYAt: worldGroundYAt, canStandAt: worldCanStandAt } = {},
) {
  // 歩ける範囲は途中で入れ替わる（別会場へ移動したとき・2026-08-06追加）
  let bounds = initialBounds;
  const keys = new Set();

  // ---- ステージ登壇（2026-08-04追加・テストユーザー要望）----
  //
  //   > 管理人+VIPはステージにのれるようにしたい。（イベント設定でON/OFFあり）
  //
  // 許可されている間だけ、歩ける範囲がステージのぶん広がる。
  // ⚠ ステージ天面は床より高いので、**足元の高さも一緒に変える**。
  //   ここを忘れると、ステージの中に埋まって歩くことになる。
  // ⚠ VRChat側にはこの座標がそのまま流れる（高さは送っていない）。
  //   向こうは「その座標の床の高さに置く」対応が要る（申し送り⑧）。
  let stageAllowed = false;
  const STAGE = stage || null;

  /** いまステージに上がってよいか（権限＋イベント設定の両方が要る） */
  function setStageAllowed(on) {
    stageAllowed = Boolean(on) && Boolean(STAGE);
  }

  /**
   * その位置が「ステージの天面の上」か。
   *
   * ⚠ 歩ける範囲(maxZ)とは別に、**天面が始まるz(topFromZ)** で判定する。
   *   maxZ で判定すると、ステージ前端より手前（客席の一番前の床）でも浮いてしまう。
   *   topFromZ が無いワールドでは maxZ に倒す（この判定を持たない会場でも動くように）。
   */
  function onStage(x, z) {
    if (!stageAllowed || !STAGE) return false;
    const topZ = typeof STAGE.topFromZ === 'number' ? STAGE.topFromZ : STAGE.maxZ;
    return x >= STAGE.minX && x <= STAGE.maxX && z >= STAGE.minZ && z <= topZ;
  }

  /**
   * その位置の足元の高さ。
   *
   * ★ ワールドが `groundYAt` を持っていれば**そちらを使う**（2026-08-04）。
   *   clubVERSE は実際のモデルにレイを撃って高さを拾う。ステージは矩形ではないので、
   *   矩形で近似すると天面でない場所でも浮いてしまう（VRChat側の全域実測で判明）。
   *   持っていないワールド用に、矩形＋天面の近似を残してある。
   */
  function groundYAt(x, z) {
    // ⚠ 2026-08-06 まで「登壇できない人は常に床(0)」で早々に返していたが、
    //   入り口側に**下りの階段**ができたので、そこでは誰でも高さを拾う必要がある。
    //   ワールド側が平らな客席ではレイを撃たずに 0 を返すので、値段は変わらない
    if (worldGroundYAt) return worldGroundYAt(x, z);
    if (!stageAllowed) return 0;
    return onStage(x, z) ? STAGE.topY : 0;
  }

  /**
   * 歩ける範囲に丸める。
   *
   * ⚠ 範囲は「客席の矩形」と「ステージの矩形」の**2つの和**なので、
   *   単純な clamp では表せない。xを先に丸めてから、そのxで許される
   *   zの範囲を決める、という順にしている。
   *   （ステージは客席の真正面にあり、xの範囲が客席に含まれるので成り立つ）
   */
  function clampToArea(x, z) {
    const canStage = stageAllowed && STAGE;
    const minX = canStage ? Math.min(bounds.minX, STAGE.minX) : bounds.minX;
    const maxX = canStage ? Math.max(bounds.maxX, STAGE.maxX) : bounds.maxX;
    const cx = THREE.MathUtils.clamp(x, minX, maxX);
    // そのxがステージの幅に入っているときだけ、奥（ステージ側）へ行ける
    const inStageX = canStage && cx >= STAGE.minX && cx <= STAGE.maxX;
    const minZ = inStageX ? Math.min(bounds.minZ, STAGE.minZ) : bounds.minZ;
    const cz = THREE.MathUtils.clamp(z, minZ, bounds.maxZ);
    return { x: cx, z: cz };
  }

  /**
   * 移動先へ実際に足を出す（2026-08-06追加）。
   *
   * 入り口側は縁が斜めで矩形にならないので、矩形に丸めたうえで
   * **そこに床があるか**をワールドに聞く。無ければその一歩を無かったことにする。
   * こうしないと、広げた矩形の角から床の無い所へ出て宙に浮く。
   */
  function stepTo(x, z, prevX, prevZ) {
    const c = clampToArea(x, z);
    if (worldCanStandAt && !worldCanStandAt(c.x, c.z)) {
      // 斜めに進んでいるときに完全に止まると引っかかるので、
      // x だけ・z だけの動きに分けて、通れる方だけ通す
      if (worldCanStandAt(c.x, prevZ)) return { x: c.x, z: prevZ };
      if (worldCanStandAt(prevX, c.z)) return { x: prevX, z: c.z };
      return { x: prevX, z: prevZ };
    }
    return c;
  }
  let yaw = 0; // カメラの水平角（0 = ステージ(-z)方向を向く）
  // 見下ろし角。0.35 だと視線が下を向きすぎて、スクリーンの上側が画面外へ切れていた
  // （clubVERSEのスクリーンは高さ9m・中心 y=6.6 と大きいため。2026-07-30 修正）。
  // 0.15 にすると、PCでも縦画面でもスクリーン全体が入る
  let pitch = 0.15;
  let dist = 6;

  // 一人称視点。ホイール（スマホはピンチ）を三人称の最短より内側へ回すと入る。
  // 自分のアバターは丸ごと隠す（首から下だけ残す作りになっていないので、
  // 中途半端に出すと頭の内側や胴体の断面が見えてしまう。2026-07-30 ユーザー了承）
  let firstPerson = false;
  const DIST_MIN = 2.5;
  const DIST_MAX = 14;
  // 最短で止まった状態から、さらにこの量だけ寄せ続けたら一人称に入る。
  // 「最短に着いた瞬間に切り替わる」ようにすると、トラックパッドの慣性スクロールで
  // 一気に一人称へ飛んでしまうので、ワンクッション置いている（ホイール1ノッチ ≒ 1.0）
  const FIRST_PERSON_PUSH = 1.0;
  let minPush = 0;

  // 見上げ／見下ろし角は視点ごとに別で持つ。
  // 三人称の既定 0.35 は「斜め後ろ上からアバターを見る」ちょうどいい角度だが、
  // 同じ値を一人称に持ち込むと数メートル先の床を見つめる形になってしまう。
  // 切り替えるときに互いの値を退避して、それぞれの自然な角度を保つ
  let pitchThird = pitch;
  let pitchFirst = 0; // 一人称の既定は水平


  const SPEED = 4.2;

  // ---- ダブルクリックでその場所まで歩く（2026-08-03追加） ----
  //
  // loyさんの要望:
  //   > ダブルクリックでその位置まで移動（キーボード使わずにマウスだけでも移動できるように）
  //
  // 床（y=0 の面）へ視線を飛ばして交点を出し、そこへ向かって歩く。
  // ⚠ **キーボード/スティックの入力が入ったら即やめる**。
  //   自動で歩いている最中に操作を奪われると気持ち悪いため
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerNdc = new THREE.Vector2();
  /** 目的地。null なら自動移動していない */
  let moveTarget = null;
  /** 目的地に着いたとみなす距離。小さすぎると目的地の周りで細かく往復する */
  const ARRIVE_DIST = 0.25;
  /** 目的地の目印（床に置く輪） */
  let targetMark = null;

  function ensureTargetMark() {
    if (targetMark || !avatar || !avatar.parent) return;
    const geo = new THREE.RingGeometry(0.28, 0.38, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ffea,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false, // 床に埋まって見えなくならないように
    });
    targetMark = new THREE.Mesh(geo, mat);
    targetMark.rotation.x = -Math.PI / 2;
    targetMark.renderOrder = 5;
    targetMark.visible = false;
    avatar.parent.add(targetMark);
  }

  function setMoveTarget(point) {
    if (!point) return;
    const p = clampToArea(point.x, point.z);
    moveTarget = new THREE.Vector3(p.x, 0, p.z);
    ensureTargetMark();
    if (targetMark) {
      // 床のわずかに上に置く（同じ高さだとちらつく）。ステージの上なら天面の上
      targetMark.position.set(moveTarget.x, groundYAt(p.x, p.z) + 0.02, moveTarget.z);
      targetMark.visible = true;
    }
  }

  function cancelMoveTarget() {
    moveTarget = null;
    if (targetMark) targetMark.visible = false;
  }

  // ジャンプ（スペースキー）
  const JUMP_SPEED = 5.0; // 初速（m/s）
  const GRAVITY = 14.0; // 重力加速度（キビキビ跳ねるよう実際より強め）
  let velocityY = 0;
  let airborne = false;

  // 外部入力（バーチャルジョイスティック等）。-1〜1 のアナログ値
  const analog = { fw: 0, side: 0 };

  // シアターモード: スクリーンを正面から見て画面いっぱいに映す
  // （OSの全画面ではなく「ウィンドウ内でスクリーンだけを大きく見る」ためのもの）
  //
  // スクリーンの位置と大きさはワールドごとに違うので、外から受け取る。
  // ここに仮ワールドの値を直接書いていたため、clubVERSE では見当違いの場所へ
  // カメラが飛んで「押しても何も起きない」ように見えていた（2026-07-30 修正）。
  // 既定値は仮ワールドの値（world.js / world_club.js のどちらも screen を返す）
  const SCREEN_CENTER = new THREE.Vector3(
    screen?.x ?? 0,
    screen?.y ?? 5.4,
    screen?.z ?? -18.95
  );
  const SCREEN_W = screen?.width ?? 14;
  const SCREEN_H = screen?.height ?? 7;
  let theater = false;
  let onTheaterExit = null;

  function setTheater(on, exitCallback) {
    theater = !!on;
    onTheaterExit = exitCallback || null;
    return theater;
  }

  function applyTheaterCamera() {
    // 画面の縦横それぞれに収まる距離を求め、大きい方を採用する
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distV = SCREEN_H / 2 / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distH = SCREEN_W / 2 / Math.tan(hFov / 2);
    const d = Math.max(distV, distH) * 1.02; // 端が切れないよう少し余裕を持たせる

    camera.position.set(SCREEN_CENTER.x, SCREEN_CENTER.y, SCREEN_CENTER.z + d);
    camera.lookAt(SCREEN_CENTER);
  }

  // 一人称のカメラ。目の位置に置いて、三人称と同じ yaw / pitch の向きへ向ける
  function applyFirstPersonCamera() {
    // viewHeight ぶん目線を上げる（アバターが小さいので、見やすい高さに調整できる）
    camera.position.set(avatar.position.x, avatar.position.y + EYE_Y + viewHeight, avatar.position.z);
    const cp = Math.cos(pitch);
    camera.lookAt(
      camera.position.x - Math.sin(yaw) * cp,
      camera.position.y - Math.sin(pitch), // pitch 正 = 見下ろす（三人称と同じ定義）
      camera.position.z - Math.cos(yaw) * cp
    );
  }

  function jump() {
    if (airborne) return false;
    airborne = true;
    velocityY = JUMP_SPEED;
    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' && !e.repeat) {
      if (jump() && onJump) onJump();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // pitch: 負=見上げる / 正=見下ろす
  // 月やモノリスの上部まで見上げられるよう、負の側を広く取っている
  const PITCH_MIN = -1.0;
  const PITCH_MAX = 1.2;
  const CAMERA_MIN_Y = 0.5; // カメラが床に潜らないようにする下限

  function orbit(dx, dy) {
    yaw -= dx * 0.005;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, PITCH_MIN, PITCH_MAX);
  }

  function setFirstPerson(on) {
    const next = !!on;
    if (next !== firstPerson) {
      // 切り替わるときだけ、いまの角度を退避して相手側の角度を復元する
      if (next) {
        pitchThird = pitch;
        pitch = pitchFirst;
      } else {
        pitchFirst = pitch;
        pitch = pitchThird;
      }
    }
    firstPerson = next;
    // 自分のアバター（名札も子なので一緒に消える）
    avatar.visible = !firstPerson;
    minPush = 0;
    if (!firstPerson) dist = DIST_MIN;
    return firstPerson;
  }

  function zoom(delta) {
    if (firstPerson) {
      // 一人称から引いたら三人称の最短へ戻る。寄せる方向は無視する
      if (delta > 0) setFirstPerson(false);
      return;
    }
    // 最短で止まっている状態から、さらに寄せ続けたら一人称へ入る
    if (delta < 0 && dist <= DIST_MIN + 1e-6) {
      minPush -= delta;
      if (minPush >= FIRST_PERSON_PUSH) setFirstPerson(true);
      return;
    }
    minPush = 0;
    dist = THREE.MathUtils.clamp(dist + delta, DIST_MIN, DIST_MAX);
  }

  // ---- 視点の高さ（2026-08-06追加）----
  //
  // loyさん「中ボタンドラッグで視点の高さかえれるといいかも。
  //          アバターみんなちっちゃいから視点だけあげたりできるとべんり。」
  //
  // アバターの背丈は変えず、**カメラの高さだけ**を上下する。
  // 中ボタンを押したまま上下にドラッグ、押しただけ（動かさない）で元に戻す。
  let viewHeight = 0;
  const VIEW_H_MIN = -0.6; // 少し下げて見上げるのも許す
  const VIEW_H_MAX = 4.0; // 大人の目線〜少し見下ろすくらいまで
  /** ドラッグとみなす移動量（これ未満は「押しただけ」＝リセット） */
  const VIEW_H_CLICK_PX = 4;

  function setViewHeight(v) {
    viewHeight = THREE.MathUtils.clamp(v, VIEW_H_MIN, VIEW_H_MAX);
    return viewHeight;
  }

  // ドラッグ視点（ポインタIDを追跡し、ジョイスティック等の別指と混線しないようにする）
  let dragPointerId = null;
  let lastX = 0;
  let lastY = 0;
  // 中ボタンでの高さ調整。上のドラッグ視点とは別に持つ（同時に起きてよい）
  let heightPointerId = null;
  let heightLastY = 0;
  let heightMoved = 0;

  domElement.addEventListener('pointerdown', (e) => {
    // 中ボタン（button===1）は視点の高さ。ブラウザの自動スクロールも止める
    if (e.button === 1) {
      e.preventDefault();
      heightPointerId = e.pointerId;
      heightLastY = e.clientY;
      heightMoved = 0;
      return;
    }
    if (dragPointerId !== null) return;
    dragPointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  // 中クリックの既定動作（自動スクロール）を殺す。押した瞬間にも出るので両方で止める
  domElement.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === heightPointerId) {
      const dy = e.clientY - heightLastY;
      heightLastY = e.clientY;
      heightMoved += Math.abs(dy);
      // 上へドラッグ＝視点が上がる（画面の動きと手の動きを合わせる）
      setViewHeight(viewHeight - dy * 0.012);
      return;
    }
    if (e.pointerId !== dragPointerId) return;
    orbit(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = (e) => {
    if (e.pointerId === heightPointerId) {
      heightPointerId = null;
      // 動かさずに押しただけなら元の高さへ戻す（迷子になったときの逃げ道）
      if (heightMoved < VIEW_H_CLICK_PX) setViewHeight(0);
    }
    if (e.pointerId === dragPointerId) dragPointerId = null;
  };
  // ダブルクリックした床の位置まで歩く。
  // ⚠ UI（チャット・パネル等）の上でのダブルクリックは拾わない。
  //   canvas に付けているので、その上に乗っている要素のクリックはここへ来ない
  domElement.addEventListener('dblclick', (e) => {
    const rect = domElement.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = new THREE.Vector3();
    // 床の面と交わらない（空を指した）場合は何もしない
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
    setMoveTarget(hit);
  });

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  domElement.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(e.deltaY * 0.01);
    },
    { passive: false }
  );

  const move = new THREE.Vector3();

  /** アバターを targetRot へ滑らかに回頭させる */
  function turnTowards(targetRot, dt) {
    let d = targetRot - avatar.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // -π〜π に畳む
    avatar.rotation.y += d * Math.min(1, dt * 12);
  }

  function update(dt) {
    // 入力 → カメラ基準の移動ベクトル（キーボード＋アナログ入力を合成）
    let fw = analog.fw;
    let side = analog.side;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fw += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fw -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) side -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) side += 1;

    const manual = Math.abs(fw) > 0.1 || Math.abs(side) > 0.1;
    // 自分で動かしたら自動移動はやめる（操作を奪われる感じを出さない）
    if (manual && moveTarget) cancelMoveTarget();

    // ---- ダブルクリックで指した場所へ歩く ----
    let autoMoving = false;
    if (!manual && moveTarget) {
      const dx = moveTarget.x - avatar.position.x;
      const dz = moveTarget.z - avatar.position.z;
      const dist2 = Math.hypot(dx, dz);
      if (dist2 <= ARRIVE_DIST) {
        cancelMoveTarget();
      } else {
        autoMoving = true;
        const step = Math.min(SPEED * dt, dist2); // 行き過ぎて往復しないよう残り距離で頭打ち
        const prevX = avatar.position.x;
        const prevZ = avatar.position.z;
        avatar.position.x += (dx / dist2) * step;
        avatar.position.z += (dz / dist2) * step;
        const c = stepTo(avatar.position.x, avatar.position.z, prevX, prevZ);
        avatar.position.x = c.x;
        avatar.position.z = c.z;
        if (!firstPerson) turnTowards(Math.atan2(dx, dz), dt);
      }
    }

    const moving = manual || autoMoving;

    // シアターモード中に動こうとしたら、自動的に通常表示へ戻す
    if (theater && moving) {
      theater = false;
      if (onTheaterExit) onTheaterExit();
    }

    if (manual) {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      move.copy(forward).multiplyScalar(fw).addScaledVector(right, side).normalize();

      const prevX = avatar.position.x;
      const prevZ = avatar.position.z;
      avatar.position.addScaledVector(move, SPEED * dt);
      const c = stepTo(avatar.position.x, avatar.position.z, prevX, prevZ);
      avatar.position.x = c.x;
      avatar.position.z = c.z;

      // 進行方向へ滑らかに回頭（一人称のときは下で視線方向に合わせるのでここでは触らない）
      if (!firstPerson) turnTowards(Math.atan2(move.x, move.z), dt);
    }

    // 一人称では、体は常に視線の向きに合わせる。
    // 自分には見えないが、他の人の画面では「見ている方を向いている」ことが伝わる
    if (firstPerson) turnTowards(yaw + Math.PI, dt);
    if (avatar.userData.setMoving) avatar.userData.setMoving(moving);

    // 足元の高さ。ステージの上に乗ったらその天面が地面になる（2026-08-04追加）
    const groundY = groundYAt(avatar.position.x, avatar.position.z);

    // ジャンプ（放物線で上下し、着地したら止める）
    if (airborne) {
      velocityY -= GRAVITY * dt;
      avatar.position.y += velocityY * dt;
      if (avatar.position.y <= groundY) {
        avatar.position.y = groundY;
        velocityY = 0;
        airborne = false;
      }
    } else if (avatar.position.y !== groundY) {
      // 歩いてステージへ上がった／降りたとき。
      // ⚠ 段差を一瞬で移動させると視点が飛ぶので、少しずつ寄せる。
      //   降りるときは落下に見えるよう、上がるときより速くする
      const up = groundY > avatar.position.y;
      const speed = up ? 6 : 12;
      const diff = groundY - avatar.position.y;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
      avatar.position.y += step;
    }

    // シアターモード中はアバター追従をやめ、スクリーン正面に固定する
    if (theater) {
      applyTheaterCamera();
      return;
    }

    if (firstPerson) {
      applyFirstPersonCamera();
      return;
    }

    // カメラ追従
    // 1.4 = 見る点のふだんの高さ。viewHeight で本人が上下できる（2026-08-06追加）
    const target = new THREE.Vector3(
      avatar.position.x,
      avatar.position.y + 1.4 + viewHeight,
      avatar.position.z,
    );
    const offset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).multiplyScalar(dist);
    camera.position.copy(target).add(offset);

    // 見上げるとカメラは床下へ行こうとする。床で止めるだけだと視線が上を向かないので、
    // 押し戻した分だけ「見る点」を上へずらして、実際に空（月）を見上げられるようにする。
    const lookAt = target.clone();
    if (camera.position.y < CAMERA_MIN_Y) {
      const pushedUp = CAMERA_MIN_Y - camera.position.y;
      camera.position.y = CAMERA_MIN_Y;
      lookAt.y = target.y + pushedUp * 2.2;
    }
    camera.lookAt(lookAt);
  }

  return {
    update,
    orbit,
    zoom,
    jump,
    setTheater,
    isTheater: () => theater,
    /** ステージに上がってよいかを切り替える（権限＋イベント設定で決まる） */
    setStageAllowed,
    isOnStage: () => onStage(avatar.position.x, avatar.position.z),
    setFirstPerson,
    isFirstPerson: () => firstPerson,
    /**
     * 歩ける範囲を入れ替える（2026-08-06追加）。
     * 別会場（ラウンジ）へ移動したときに、その部屋の範囲へ差し替える。
     */
    setBounds(b) {
      if (b) bounds = b;
    },
    /** 視点の高さ（中ボタンドラッグ）。0が既定の高さ */
    setViewHeight,
    getViewHeight: () => viewHeight,
    // バーチャルジョイスティック等からのアナログ入力（-1〜1）
    setAnalog(fw, side) {
      analog.fw = THREE.MathUtils.clamp(fw, -1, 1);
      analog.side = THREE.MathUtils.clamp(side, -1, 1);
    },
    // アバター変更（再カスタム）時に追従対象を差し替える
    setAvatar(newAvatar) {
      avatar.visible = true; // 差し替え前のものは元に戻しておく
      avatar = newAvatar;
      avatar.visible = !firstPerson; // 一人称中に作り直しても隠れたままにする
    },
  };
}
