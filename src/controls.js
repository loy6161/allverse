import * as THREE from 'three';
import { EYE_Y } from './avatar.js';

// キャラクター操作
// - WASD / 矢印キー: カメラ基準で移動（アバターは進行方向を向く）
// - ドラッグ: カメラ旋回、ホイール: ズーム
// - 三人称の最短からさらに寄せると一人称になる（引くと三人称へ戻る）
export function initControls(camera, avatar, domElement, { bounds, onJump, screen } = {}) {
  const keys = new Set();
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
    camera.position.set(avatar.position.x, avatar.position.y + EYE_Y, avatar.position.z);
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

  // ドラッグ視点（ポインタIDを追跡し、ジョイスティック等の別指と混線しないようにする）
  let dragPointerId = null;
  let lastX = 0;
  let lastY = 0;
  domElement.addEventListener('pointerdown', (e) => {
    if (dragPointerId !== null) return;
    dragPointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragPointerId) return;
    orbit(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = (e) => {
    if (e.pointerId === dragPointerId) dragPointerId = null;
  };
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

    const moving = Math.abs(fw) > 0.1 || Math.abs(side) > 0.1;

    // シアターモード中に動こうとしたら、自動的に通常表示へ戻す
    if (theater && moving) {
      theater = false;
      if (onTheaterExit) onTheaterExit();
    }

    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      move.copy(forward).multiplyScalar(fw).addScaledVector(right, side).normalize();

      avatar.position.addScaledVector(move, SPEED * dt);
      avatar.position.x = THREE.MathUtils.clamp(avatar.position.x, bounds.minX, bounds.maxX);
      avatar.position.z = THREE.MathUtils.clamp(avatar.position.z, bounds.minZ, bounds.maxZ);

      // 進行方向へ滑らかに回頭（一人称のときは下で視線方向に合わせるのでここでは触らない）
      if (!firstPerson) turnTowards(Math.atan2(move.x, move.z), dt);
    }

    // 一人称では、体は常に視線の向きに合わせる。
    // 自分には見えないが、他の人の画面では「見ている方を向いている」ことが伝わる
    if (firstPerson) turnTowards(yaw + Math.PI, dt);
    if (avatar.userData.setMoving) avatar.userData.setMoving(moving);

    // ジャンプ（放物線で上下し、着地したら止める）
    if (airborne) {
      velocityY -= GRAVITY * dt;
      avatar.position.y += velocityY * dt;
      if (avatar.position.y <= 0) {
        avatar.position.y = 0;
        velocityY = 0;
        airborne = false;
      }
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
    const target = new THREE.Vector3(avatar.position.x, avatar.position.y + 1.4, avatar.position.z);
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
    setFirstPerson,
    isFirstPerson: () => firstPerson,
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
