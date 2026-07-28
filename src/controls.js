import * as THREE from 'three';

// 三人称視点のキャラクター操作
// - WASD / 矢印キー: カメラ基準で移動（アバターは進行方向を向く）
// - ドラッグ: カメラ旋回、ホイール: ズーム
export function initControls(camera, avatar, domElement, { bounds, onJump } = {}) {
  const keys = new Set();
  let yaw = 0; // カメラの水平角（0 = ステージ(-z)方向を向く）
  let pitch = 0.35; // 見下ろし角
  let dist = 6;

  const SPEED = 4.2;

  // ジャンプ（スペースキー）
  const JUMP_SPEED = 5.0; // 初速（m/s）
  const GRAVITY = 14.0; // 重力加速度（キビキビ跳ねるよう実際より強め）
  let velocityY = 0;
  let airborne = false;

  // 外部入力（バーチャルジョイスティック等）。-1〜1 のアナログ値
  const analog = { fw: 0, side: 0 };

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

  function zoom(delta) {
    dist = THREE.MathUtils.clamp(dist + delta, 2.5, 14);
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

  function update(dt) {
    // 入力 → カメラ基準の移動ベクトル（キーボード＋アナログ入力を合成）
    let fw = analog.fw;
    let side = analog.side;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fw += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fw -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) side -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) side += 1;

    const moving = Math.abs(fw) > 0.1 || Math.abs(side) > 0.1;
    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      move.copy(forward).multiplyScalar(fw).addScaledVector(right, side).normalize();

      avatar.position.addScaledVector(move, SPEED * dt);
      avatar.position.x = THREE.MathUtils.clamp(avatar.position.x, bounds.minX, bounds.maxX);
      avatar.position.z = THREE.MathUtils.clamp(avatar.position.z, bounds.minZ, bounds.maxZ);

      // 進行方向へ滑らかに回頭
      const targetRot = Math.atan2(move.x, move.z);
      let d = targetRot - avatar.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      avatar.rotation.y += d * Math.min(1, dt * 12);
    }
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
    // バーチャルジョイスティック等からのアナログ入力（-1〜1）
    setAnalog(fw, side) {
      analog.fw = THREE.MathUtils.clamp(fw, -1, 1);
      analog.side = THREE.MathUtils.clamp(side, -1, 1);
    },
    // アバター変更（再カスタム）時に追従対象を差し替える
    setAvatar(newAvatar) {
      avatar = newAvatar;
    },
  };
}
