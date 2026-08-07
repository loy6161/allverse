import * as THREE from 'three';

// ============================================================
// clubVERSE の中のバーカウンター（2026-08-08・loyさん指定）
//
// > スクショ2の位置にバーカウンターを置いて。
//
// スクショは客席の中ほどからステージ側を向いた絵で、囲われていたのは**西の壁沿い**。
// 会場の床は x -13〜25 で、x<-13 は一段高い台なので、壁から少し離した x=-11.2 に置く。
//
// ★ 作りの方針（world_lounge.js / shops3d.js と同じ）
//   ・**ライトを足さない**（MeshBasicMaterial だけで組む）。
//     loyさんの環境はGPUを使わない設定で、ライトの数がそのまま重さになる
//   ・カウンター・背面の棚・ボトル・ネオンだけ。椅子は置かない
//     （座る仕組みがまだ無いので、置くと「座れない椅子」になる）
//   ・**近づくと既存のバーの画面（shopui.js の bar タブ）が開く**。
//     飲み物の中身は増やさない（同じ商品を、街のカジノ内バーと会場内バーの両方で買える）
// ============================================================

/** カウンターの中心（会場の西の壁沿い・客席のまん中あたり） */
export const BAR_POS = { x: -11.2, z: -2 };
/** カウンターの長さ（z方向）と奥行き（x方向） */
const LEN = 8;
const DEPTH = 0.9;
const TOP_Y = 1.1;

/**
 * バーカウンターを建てる。
 *
 * @param {THREE.Scene} scene
 * @returns {{ spot: object, group: THREE.Group, update:(x:number,z:number)=>void, dispose:()=>void }}
 */
export function createBar(scene) {
  const root = new THREE.Group();
  root.name = 'clubBar';
  root.position.set(BAR_POS.x, 0, BAR_POS.z);
  scene.add(root);

  const mat = (c, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: c, fog: true, side });
  const box = (w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  // カウンター本体（天板は明るい木目色、下は暗い箱）
  box(DEPTH, TOP_Y - 0.06, LEN, 0x1d1726, 0, (TOP_Y - 0.06) / 2, 0);
  box(DEPTH + 0.14, 0.08, LEN + 0.14, 0xc9a36a, 0, TOP_Y - 0.02, 0);
  // 足元の帯（光らせて位置を分かりやすく）
  box(DEPTH + 0.16, 0.05, LEN + 0.16, 0x00ffea, 0, 0.09, 0);

  // 背面の棚（壁側）。棚板2枚とボトルを並べる
  const shelfX = -0.95;
  for (const y of [1.35, 1.85]) {
    box(0.34, 0.06, LEN - 0.6, 0x2a2233, shelfX, y, 0);
  }
  const BOTTLE = [0x8ae6ff, 0xffd86b, 0xff6fd8, 0x9be34a, 0xffa14a];
  for (let i = 0; i < 14; i += 1) {
    const z = -LEN / 2 + 0.7 + i * ((LEN - 1.4) / 13);
    const y = i % 2 === 0 ? 1.38 : 1.88;
    box(0.14, 0.34, 0.14, BOTTLE[i % BOTTLE.length], shelfX, y + 0.17, z);
  }

  // ネオンの「BAR」看板がわりの帯（文字は作らない。テクスチャを増やさないため）
  box(0.06, 0.5, 2.2, 0xff00e5, shelfX - 0.2, 2.5, 0);

  /**
   * 近づいたときに開くもの。shops3d.js の spot と同じ形にしてある
   * （main.js が同じ仕組みで扱えるように）
   */
  const spot = {
    id: 'clubbar',
    // shopui.js の openShop(kind, {tab}) にそのまま渡る形
    shop: 'clubbar',
    tab: 'bar',
    label: 'バー',
    // カウンターの東側（客席側）に立つ位置
    x: BAR_POS.x + 1.4,
    z: BAR_POS.z,
  };

  // クリックでも開けるように印を付ける（キーだけだと初見が気づかない。2026-08-08 loyさん指摘）
  const pickables = root.children.slice();
  for (const m of pickables) m.userData.spot = spot;

  return {
    spot,
    pickables,
    group: root,
    /** 遠いときは丸ごと消す（描画を増やさない） */
    update(px, pz) {
      root.visible = Math.hypot(BAR_POS.x - px, BAR_POS.z - pz) < 60;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      scene.remove(root);
    },
  };
}
