# 申し送り⑤: ALLVERSE Worker の担当を WEB 側へ移します

発行: 2026-08-02 ／ 送り先: `U:\UNITY\WORLD\project\VERSE CITY2025`（Unity側チャット）
件名: **Cloudflare Worker（`allverse-worker`）の担当をこちらに移す。Unity側は編集を止めてください**

---

## 一言でいうと

**`U:\UNITY\WORLD\project\allverse\worker` を、今後は ALLVERSE WEB 側（`L:\企画用\WEB\verse_city_web` のチャット）が
書いてデプロイします。** Unity側はもうこのフォルダを触らないでください。

**Unity側の作業が減るだけで、失うものはありません。** 仕様の決定権も奪いません（下記）。

---

## なぜ移すのか

loyさんの判断（2026-08-02）:

> ここがいつもめんどくさいんだけど、UNITYは基本的にUNITYを直接触る作業をしてるから、
> 裏側はこっちが担当したほうが効率よくない？

調べたところ、**その通りでした**。

| 確認したこと | 実態 |
|---|---|
| Workerの中身 | **JavaScript 255行 + wrangler.toml だけ**。Unityのファイルは1つも無い |
| 置き場所 | `U:\UNITY\WORLD\project\allverse\worker`。**Unityプロジェクトの外**（隣に置いてあるだけ） |
| 種類 | Cloudflare Workers（ただのバックエンド） |

**Unityと無関係なものが、作った人の都合でUnityフォルダの隣にある**、という状態でした。

いまフェイズ2（YouTubeチャットとアバターの連動）を進めていますが、
この設計では **Worker側とWEB側を1つの流れとして書く必要があり**、
2つのチャットで申し送りを往復させると、そのたびに数日止まります。

---

## 新しい担当の線引き

境界は「**Unityを直接触るかどうか**」です。

| 担当 | 範囲 |
|---|---|
| **ALLVERSE WEB 側（こちら）** | Worker / harvester / API / DB / presence — **画面の外側すべて** |
| **Unity側（そちら）** | Udon / シーン / プレハブ / アバター配置 / ワールドの見た目 — **Unityを開く作業** |

### 変わらないこと

- **ワールド側の仕様の決定権はそちらにあります。** 「Workerに何を出してほしいか」はそちらが決めてください。
  こちらはそれを実装する側になります
- **`Docs\ALLVERSE_DESIGN.md` は引き続きそちらが正本**です。SYNCの設計思想はそちらのものです
- **presence.json の契約（v=1凍結）はそのまま**。勝手に壊しません

### 変わること

- Worker の**コードを書く・デプロイする**のはこちらになります
- Worker の環境変数・シークレットの設定もこちらで行います
  （Cloudflareの認証はloyさんのアカウントで既に通っており、こちらから `wrangler deploy` できる状態です）

---

## そちらにお願いしたいこと

1. **`U:\UNITY\WORLD\project\allverse\worker` の編集を止めてください。**
   二重に編集するとデプロイが上書き合戦になります
2. **未コミットの変更があれば、先に教えてください。** こちらが触る前に取り込みます
3. **Workerに欲しいものがあれば、これまで通り申し送りで伝えてください。** 実装はこちらでやります

---

## いまのWorkerの状態（こちらで確認した内容）

| 項目 | 状態 |
|---|---|
| 本番URL | `https://allverse-worker.loy61loy61.workers.dev` |
| `MOCK_MODE` | **`true`**（YouTube側の rank/live/fx はモックのまま） |
| `PRESENCE_URL` | `https://allverse.onrender.com/api/presence.json` ← **設定済み・実データが流れています** |
| `/v1/live.json` | 稼働中。`web[]` にブラウザ勢が実データで載っていることを確認済み |
| `/v1/wallets.json` | 空を返すだけ（Phase 3待ち） |
| `/v1/ingest` | トークン検証だけ実装済み。受領数を返すのみ（Phase 3待ち） |
| D1（DB） | **未作成**（wrangler.toml でコメントアウト） |
| シークレット | `INGEST_TOKEN` / `YT_API_KEY` は**未設定** |

---

## 次にこちらがやろうとしていること（フェイズ2の 2c）

**YouTubeチャットで喋った人を、ブラウザ会場とVRC客席の本人アバターに吹き出しで出す。**

そのために Worker 側で必要になるのは:

1. YouTubeライブチャットの取得（`MOCK_MODE` を外す）
2. **合言葉によるチャンネル照合** — 会場で出した合言葉をチャットに送ってもらい、
   その発言の `authorChannelId` を本人と結びつける
   （OAuthを使わない方式。理由は `verse_city_web/docs/WHY.md` §29）
3. 照合結果を ALLVERSE WEB へ返す経路

**②③はチャットを読んでいるWorkerでしかできない**ので、移管しないと進みません。
これが今回の移管を急いだ理由です。

⚠ **Udon側で必要になる作業は、決まったら改めて申し送ります。**
現時点で分かっているのは「プロキシアバターに吹き出し（TextMeshPro）を足す」ことです。

---

## 参考

- こちら側の仕様: `L:\企画用\WEB\verse_city_web\docs\SPEC.md`（フェイズ2の節）
- 判断の経緯: 同 `docs\WHY.md` §29
- 過去の申し送り: `HANDOFF_UNITY.md` / `_2` / `_3_AVATAR` / `_4`
