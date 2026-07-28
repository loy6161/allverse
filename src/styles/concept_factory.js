import * as THREE from 'three';

const PROFILES = {
  soft: { height: 1.55, head: 0.29, torso: 0.5, leg: 0.48, round: true },
  neon: { height: 1.62, head: 0.27, torso: 0.52, leg: 0.56, round: false },
  mellow: { height: 1.68, head: 0.25, torso: 0.55, leg: 0.62, round: true },
};

function mat(color, glow = 0) {
  const material = new THREE.MeshToonMaterial({ color });
  if (glow) material.emissive.set(color).multiplyScalar(glow);
  return material;
}

function mesh(geometry, material, position, scale) {
  const value = new THREE.Mesh(geometry, material);
  if (position) value.position.set(...position);
  if (scale) value.scale.set(...scale);
  return value;
}

function addFace(head, radius, profile) {
  const dark = mat('#17131d');
  const white = mat('#fffaf4');
  const iris = mat(profile === 'neon' ? '#7352e8' : '#51392d');
  [-1, 1].forEach((side) => {
    head.add(mesh(new THREE.SphereGeometry(radius * 0.13, 10, 8), white,
      [side * radius * 0.33, radius * 0.04, radius * 0.9], [0.88, 1.15, 0.28]));
    head.add(mesh(new THREE.SphereGeometry(radius * 0.078, 9, 7), iris,
      [side * radius * 0.33, radius * 0.035, radius * 0.976], [0.85, 1.05, 0.25]));
    head.add(mesh(new THREE.SphereGeometry(radius * 0.038, 8, 6), dark,
      [side * radius * 0.33, radius * 0.03, radius * 1.005], [0.8, 1, 0.22]));
    head.add(mesh(new THREE.SphereGeometry(radius * 0.015, 6, 5), white,
      [side * radius * 0.31, radius * 0.075, radius * 1.025]));
  });
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.13, radius * 0.018, 5, 12, Math.PI),
    mat('#713e45'),
  );
  smile.position.set(0, -radius * 0.17, radius * 0.91);
  smile.rotation.z = Math.PI;
  head.add(smile);
}

function addHair(head, radius, style, color) {
  const hairMat = mat(color, 0.025);
  const cap = mesh(
    new THREE.SphereGeometry(radius * 1.04, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat,
    [0, radius * 0.04, 0],
  );
  head.add(cap);

  [-1, 0, 1].forEach((side) => {
    const fringe = mesh(new THREE.ConeGeometry(radius * 0.21, radius * 0.48, 5), hairMat,
      [side * radius * 0.3, radius * 0.24 - Math.abs(side) * radius * 0.03, radius * 0.83]);
    fringe.rotation.z = side * -0.22;
    head.add(fringe);
  });

  if (style === 'long') {
    head.add(mesh(new THREE.BoxGeometry(radius * 1.75, radius * 1.55, radius * 0.42), hairMat,
      [0, -radius * 0.45, -radius * 0.72], [1, 1, 1]));
  } else if (style === 'twin') {
    [-1, 1].forEach((side) => {
      const tail = mesh(new THREE.CapsuleGeometry(radius * 0.18, radius * 0.68, 3, 7), hairMat,
        [side * radius * 1.08, -radius * 0.24, -radius * 0.05]);
      tail.rotation.z = side * 0.36;
      head.add(tail);
    });
  } else if (style === 'hat') {
    head.add(mesh(new THREE.CylinderGeometry(radius * 1.14, radius * 1.14, radius * 0.12, 12), hairMat,
      [0, radius * 0.62, 0]));
    head.add(mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.98, radius * 0.48, 12), hairMat,
      [0, radius * 0.84, 0]));
  } else {
    [-1, 1].forEach((side) => {
      const tuft = mesh(new THREE.ConeGeometry(radius * 0.18, radius * 0.42, 5), hairMat,
        [side * radius * 0.68, radius * 0.52, 0]);
      tuft.rotation.z = side * -0.55;
      head.add(tuft);
    });
  }
}

function addAccessory(root, type, profile, accent, shoulderY, headY) {
  if (type === 'none') return;
  const accentMat = mat(accent, profile === 'neon' ? 0.35 : 0.04);
  if (type === 'headphones') {
    const band = mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20, Math.PI), accentMat,
      [0, headY + 0.06, 0]);
    root.add(band);
    [-1, 1].forEach((side) => {
      const cup = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10), accentMat,
        [side * 0.29, headY - 0.02, 0]);
      cup.rotation.z = Math.PI / 2;
      root.add(cup);
    });
  } else if (type === 'bag') {
    const strap = mesh(new THREE.TorusGeometry(0.34, 0.025, 5, 18, Math.PI * 1.18), accentMat,
      [0, shoulderY - 0.2, 0.13]);
    strap.rotation.z = -0.7;
    root.add(strap);
    root.add(mesh(new THREE.BoxGeometry(0.25, 0.17, 0.11), accentMat, [0.2, shoulderY - 0.42, 0.18]));
  } else {
    root.add(mesh(new THREE.TorusGeometry(0.075, 0.026, 6, 12), accentMat,
      [0.28, shoulderY - 0.37, 0]));
  }
}

export function createConceptAvatar(profileName, config = {}) {
  const profile = PROFILES[profileName];
  const skin = mat(config.bodyColor || '#d79a72');
  const top = mat(config.shirtColor || '#4fd8ff', profileName === 'neon' ? 0.08 : 0.02);
  const bottomColor = config.bottomColor || (profileName === 'neon' ? '#17192d' : '#39445b');
  const bottom = mat(bottomColor);
  const shoe = mat(profileName === 'soft' ? '#f2eee8' : '#20212b');
  const accent = config.accentColor || (profileName === 'neon' ? '#ff4fd8' : '#e7b84b');
  const root = new THREE.Group();
  root.name = `avatar_${profileName}`;

  const headR = profile.head;
  const hipY = profile.leg + 0.13;
  const shoulderY = hipY + profile.torso * 0.72;
  const neckY = hipY + profile.torso;
  const limbSides = [-1, 1];

  limbSides.forEach((side) => {
    root.add(mesh(new THREE.CapsuleGeometry(0.085, profile.leg - 0.17, 3, profile.round ? 8 : 5), bottom,
      [side * 0.105, hipY - profile.leg * 0.52, 0]));
    root.add(mesh(new THREE.BoxGeometry(0.18, 0.1, 0.28), shoe,
      [side * 0.105, 0.06, 0.07]));
  });

  const torsoGeo = profileName === 'soft'
    ? new THREE.CapsuleGeometry(0.25, profile.torso - 0.28, 5, 10)
    : new THREE.CylinderGeometry(0.255, 0.19, profile.torso, profile.round ? 10 : 6);
  root.add(mesh(torsoGeo, top, [0, hipY + profile.torso * 0.48, 0]));
  root.add(mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.13, profile.round ? 10 : 6), bottom,
    [0, hipY + 0.04, 0]));

  limbSides.forEach((side) => {
    const arm = mesh(new THREE.CapsuleGeometry(0.055, profile.torso * 0.62, 3, profile.round ? 8 : 5), top,
      [side * 0.285, shoulderY - 0.17, 0]);
    arm.rotation.z = side * 0.08;
    root.add(arm);
    root.add(mesh(new THREE.SphereGeometry(0.065, profile.round ? 9 : 6, 6), skin,
      [side * 0.31, shoulderY - 0.42, 0]));
  });

  root.add(mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.11, 8), skin, [0, neckY + 0.02, 0]));
  const head = new THREE.Group();
  head.position.set(0, neckY + headR * 0.92, 0);
  head.add(mesh(new THREE.SphereGeometry(headR, profile.round ? 14 : 9, profile.round ? 10 : 7), skin));
  addFace(head, headR, profileName);
  addHair(head, headR, config.hairStyle || 'short', config.hairColor || '#25202c');
  root.add(head);

  if (profileName === 'soft') {
    const hood = mesh(new THREE.TorusGeometry(0.23, 0.055, 7, 18, Math.PI * 1.35), top,
      [0, neckY + 0.02, -0.03]);
    hood.rotation.z = -Math.PI * 0.17;
    root.add(hood);
    root.add(mesh(new THREE.BoxGeometry(0.22, 0.13, 0.035), top,
      [0, hipY + profile.torso * 0.35, 0.25]));
  } else if (profileName === 'neon') {
    const stripeMat = mat(accent, 0.35);
    const stripe = mesh(new THREE.BoxGeometry(0.33, 0.07, 0.025), stripeMat,
      [0, hipY + profile.torso * 0.58, 0.235]);
    stripe.rotation.z = -0.35;
    root.add(stripe);
  } else {
    root.add(mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.055, 10), mat(accent, 0.02),
      [0, hipY + profile.torso * 0.05, 0]));
  }

  addAccessory(root, config.accessory || 'headphones', profileName, accent, shoulderY, neckY + headR * 0.92);

  const scale = profile.height / (neckY + headR * 1.95);
  root.scale.setScalar(scale);
  root.userData.update = () => {};
  return root;
}
