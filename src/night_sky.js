import * as THREE from 'three';

// ------------------------------------------------------------------
// 夜空の共通パーツ（月とソフトグロー）
//
// 仮ワールド（world.js）で作った夜空を clubVERSE（world_club.js）でも
// 使うために切り出したもの。「サンプルの時の夜空と月は残す」方針（2026-07-30）。
// 見た目を変えると両方に効くので、片方だけ変えたいときは引数で渡すこと。
// ------------------------------------------------------------------

/**
 * 汎用ソフトグロー（放射グラデーション）。月のハロー・ネオンの光芒・
 * パーティクルの粒に共用する。post-processing のブルームが無いための代替表現。
 */
export function makeGlowTexture(innerColor, outerColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.4, outerColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 月面のクレーター模様を手続き的に描く */
export function makeMoonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // ベースの地色（温白〜淡いグレー）
  const base = ctx.createRadialGradient(200, 190, 20, 256, 256, 300);
  base.addColorStop(0, '#fdf3e2');
  base.addColorStop(0.55, '#e9dcc6');
  base.addColorStop(1, '#c9b99e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 簡易乱数（固定シードで再現性を持たせる）
  let s = 918273;
  function rand() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }

  // クレーターを陰影付きで描く
  const craterCount = 46;
  for (let i = 0; i < craterCount; i++) {
    const cx = rand() * canvas.width;
    const cy = rand() * canvas.height;
    const r = 8 + rand() * 42;

    const shade = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r);
    shade.addColorStop(0, 'rgba(120, 100, 80, 0.35)');
    shade.addColorStop(0.7, 'rgba(150, 130, 105, 0.18)');
    shade.addColorStop(1, 'rgba(150, 130, 105, 0)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // クレーター縁のハイライト
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.25)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.arc(cx + r * 0.12, cy + r * 0.12, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 巨大な月＋ハローを parent に足す。背景色と霧は呼び出し側が決める。
 *
 * @param {THREE.Object3D} parent
 * @param {{position?: [number,number,number], radius?: number, glowScale?: number}} opts
 * @returns {{moon: THREE.Mesh, glow: THREE.Sprite}}
 */
export function addMoon(parent, opts = {}) {
  const [px, py, pz] = opts.position || [18, 68, -210];
  const radius = opts.radius ?? 24;
  const glowScale = opts.glowScale ?? 90;

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.MeshBasicMaterial({
      map: makeMoonTexture(),
      fog: false, // 遠景でも霧に埋もれず存在感を保つ
      toneMapped: false,
    }),
  );
  moon.position.set(px, py, pz);
  parent.add(moon);

  // 月のハロー（ビルボードのソフトグロー。ブルーム代替）
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,244,224,0.9)', 'rgba(255,220,170,0.35)'),
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.scale.set(glowScale, glowScale, 1);
  glow.position.copy(moon.position);
  parent.add(glow);

  return { moon, glow };
}
