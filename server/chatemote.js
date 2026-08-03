// ============================================================
// YouTubeのコメントからエモートを判定する（2026-08-03追加）
//
// loyさんの発案:
//   > YouTubeチャットで絵文字が入力されたらそれに連動してエモート出す、
//   > とかチャットの文字に連動することってできる？
//   > ライブではそのアーティスト独自の弾幕があって、それをみんな連投してくれるんだよね。
//   > 上記指定以外の絵文字の時はペンライト、がいいかもね。
//
// 考え方:
//   弾幕は「何の絵文字か」より **連投されていること自体** に意味がある。
//   なので決めた絵文字以外は全部ペンライトへ倒し、
//   **数だけ数えて繰り返し回数にする**。10個並べれば10回振る。
//
// ⚠ ふつうの会話では何も出さない。絵文字も合言葉も無ければ null を返す。
//   会話のたびにアバターが動くと、会場がうるさくなるだけで意味がない。
// ============================================================

/** 1回の発言で繰り返せる上限。1人が延々と占有しないための歯止め */
export const MAX_REPEAT = 10;

/**
 * 「弾幕」とみなす絵文字の個数の下限（2026-08-03追加）。
 * これ以上あって、かつ2種類以上混ざっていればペンライトへ倒す。
 * 4個は「💙♬💙♬」がちょうど入る数（2種類×2回）
 */
export const BARRAGE_MIN = 4;

/**
 * 弾幕とみなさない「突出」の割合（2026-08-03追加）。
 * いちばん多い絵文字がこの割合以上を占めるなら、混ざっていてもその絵文字を採る。
 * 例: 👏👏👏⭐ は拍手が 3/4 = 0.75 なので拍手のまま。
 *     💙♬💙♬… は 4/8 = 0.5 でどちらも突出せず、弾幕と判定される
 */
export const BARRAGE_TOP_SHARE = 0.6;

/**
 * 決め打ちの絵文字 → エモート。
 * ⚠ 見た目が同じでも符号が違う絵文字がある（❤️ は U+2764 + 異体字セレクタ）ので、
 *   異体字セレクタを外してから比べる。
 */
const EMOJI_MAP = new Map([
  ['\u{1F44F}', 'clap'], // 👏
  ['\u{1F44B}', 'wave'], // 👋
  ['\u{2764}', 'heart'], // ❤
  ['\u{1F497}', 'heart'], // 💗
  ['\u{1F49C}', 'heart'], // 💜
  ['\u{1F499}', 'heart'], // 💙
  ['\u{1F49B}', 'heart'], // 💛
  ['\u{1F49A}', 'heart'], // 💚
  ['\u{2B50}', 'star'], // ⭐
  ['\u{1F31F}', 'star'], // 🌟
  ['\u{1F386}', 'firework'], // 🎆
  ['\u{1F387}', 'firework'], // 🎇
  ['\u{1F389}', 'firework'], // 🎉
  ['\u{1F37A}', 'cheers'], // 🍺
  ['\u{1F37B}', 'cheers'], // 🍻
  ['\u{270A}', 'fist'], // ✊
  ['\u{1F918}', 'headbang'], // 🤘
  ['\u{1F57A}', 'dance'], // 🕺
  ['\u{1F483}', 'dance'], // 💃
  ['\u{1F604}', 'smile'], // 😄
  ['\u{1F606}', 'smile'], // 😆
  ['\u{1F602}', 'smile'], // 😂
  ['\u{1F526}', 'penlight'], // 🔦
]);

/** 異体字セレクタ・肌の色の指定・ゼロ幅接合子を落として比べやすくする */
function normalizeEmoji(ch) {
  return ch.replace(/[\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}]/gu, '');
}

/**
 * 文字列に含まれる絵文字を列挙する。
 * ⚠ 記号（！？など）や漢字を拾わないよう、絵文字の範囲だけに絞る
 */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F0FF}]/gu;

/**
 * 「888」の判定。
 *
 * ⚠ 誤爆を2段で防ぐ:
 *   ① 前後に数字・英字が続くもの（1888 / 888a）は数値や語の一部なので除く
 *   ② 直後が**単位の文字**のもの（888円・8888番地）も数値なので除く
 *
 * 「888ありがとう」は拾えるようにしてある。単位だけを狙って外しているため
 * （かなを丸ごと除くと、この普通の使い方まで落ちてしまう）
 */
const CLAP_UNITS = '円|人|個|番|回|年|月|日|時|分|秒|件|台|本|枚|万|千|億|度|位|名|階|話|杯|曲|票';
const CLAP_RE = new RegExp(
  `(?<![0-9０-９a-zA-Z])[8８]{3,}(?![0-9０-９a-zA-Z]|${CLAP_UNITS})`,
  'gu',
);

/** 「w」「www」「ｗｗｗ」。1文字だけの w は普通の英単語に混ざるので2個以上 */
const WARA_RE = /(?<![a-zA-Z])[wｗ]{2,}(?![a-zA-Z])/gu;

/** 乾杯の言葉 */
const CHEERS_RE = /(乾杯|かんぱい|カンパイ|kanpai)/giu;

function countMatches(text, re) {
  const m = text.match(re);
  if (!m) return 0;
  // 「8888」は1回の弾幕とみなす。回数は**出現した塊の数**で数える
  return m.length;
}

/**
 * コメント1件からエモートを決める。
 *
 * @param {string} text コメント本文
 * @returns {{id:string, n:number}|null} 出すエモートと繰り返し回数。無反応なら null
 */
export function emoteFromText(text) {
  const s = String(text || '');
  if (!s) return null;

  // ---- ① 文字の合図（絵文字より先に見る） ----
  // ライブでは 888 や www が絵文字より使われるので、こちらを優先する
  const claps = countMatches(s, CLAP_RE);
  if (claps > 0) return { id: 'clap', n: Math.min(MAX_REPEAT, claps) };

  const waras = countMatches(s, WARA_RE);
  if (waras > 0) return { id: 'smile', n: 1 }; // ニコニコは繰り返さない（何かが出るもの）

  if (CHEERS_RE.test(s)) {
    CHEERS_RE.lastIndex = 0; // /g 付きなので位置を戻す
    return { id: 'cheers', n: 1 };
  }
  CHEERS_RE.lastIndex = 0;

  // ---- ② 絵文字 ----
  const found = s.match(EMOJI_RE);
  if (!found || !found.length) return null;

  // 決め打ちの絵文字が入っていれば、いちばん多いものを採る
  const tally = new Map();
  let others = 0;
  for (const raw of found) {
    const id = EMOJI_MAP.get(normalizeEmoji(raw));
    if (id) tally.set(id, (tally.get(id) || 0) + 1);
    else others++;
  }

  // ---- 混ざった弾幕はペンライトにする（2026-08-03 loyさん指摘） ----
  //
  //   > アーティスト指定の弾幕で 💙♬💙♬💙♬💙♬ や 🚀⭐️🚀⭐️🚀⭐️ などがあって、
  //   > その場合ペンライトじゃなくてハートや🌟が優先されちゃう
  //
  // 弾幕は「2種類以上の絵文字を交互にたくさん並べる」形が多い。
  // 一方、素直な反応（❤️❤️❤️ / 👏👏👏）は**同じ絵文字の繰り返し**になる。
  // そこで **種類が2つ以上 かつ 合計が4個以上** なら弾幕とみなしてペンライトへ倒す。
  //
  // ⚠ 「👏⭐」のような軽い混ぜ方まで弾幕にしないため、個数の下限を置いている。
  //   ここを外すと、ふつうの反応までペンライトになってしまう
  const kinds = new Set([...tally.keys()]);
  if (others > 0) kinds.add('_other');

  // いちばん多い絵文字が全体の何割を占めるか
  let best = null;
  let bestN = 0;
  for (const [id, n] of tally) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  const topShare = Math.max(bestN, others) / found.length;

  // ⚠ 「突出して多いものがある」ときは弾幕とみなさない。
  //   👏👏👏⭐ は拍手が3/4を占めるので拍手のまま。
  //   💙♬💙♬… は half-half なのでどちらも突出せず、弾幕と判定される
  if (kinds.size >= 2 && found.length >= BARRAGE_MIN && topShare < BARRAGE_TOP_SHARE) {
    return { id: 'penlight', n: Math.min(MAX_REPEAT, found.length) };
  }

  if (tally.size) {
    return { id: best, n: Math.min(MAX_REPEAT, bestN) };
  }

  // ---- ③ 決めていない絵文字＝弾幕とみなしてペンライト ----
  // アーティストごとの独自の絵文字がここに落ちる（loyさんの意図）
  return { id: 'penlight', n: Math.min(MAX_REPEAT, others) };
}
