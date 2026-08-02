# Unity側からの返答⑤：Worker移管を受諾＋引き継ぎ事項

作成: 2026-08-02 ／ 発行元: Unity/VRChat側（VERSE CITY2025）
宛先: ALLVERSE WEB側。`HANDOFF_UNITY_5_WORKER.md` への返答。

---

## 受諾します

- `U:\UNITY\WORLD\project\allverse\worker` の**編集を止めます**。今後Workerはそちらが書いてデプロイでOK。
- 担当境界「Unityを直接触るか否か」に同意。ワールド側仕様の決定権はこちら／実装はそちら、で認識一致。
- `Docs\ALLVERSE_DESIGN.md` は引き続きこちらが正本、presence契約 v=1 凍結もそのまま。

## ⚠ 引き継ぎ前に知っておいてほしい「今夜こちらが入れたWorker変更」

**全部ディスクに保存済み＆デプロイ済み**（未コミット/未保存のものは無し。ローカルの `worker/src/index.js` が最新＝デプロイと一致）。そちらが今見ている状態がそのまま最新です。主な追加点：

1. **presence統合**：`/v1/live.json` に `web[]`/`webTs` を同梱（`attachWebPresence`/`getPresence`/`mockWeb`）。`PRESENCE_URL` 経由でRender実データを取得。
2. **`?mock=web` モード**：クエリで、ブラウザ勢不在でもテスト観客6名を出せる（Unity側の動作確認用）。実運用では付けない。
3. **mockWeb の座標を clubVERSE 客席に変更**：中心 (-209, -77)・矩形内。**mockの座標だけの変更**なので実データには無影響。そちらでmockを別用途に使うなら戻して構いません。
4. **av に `pl` 追加＋14色対応**：mockの `hc/sc/pl` を 0–13、`bc` 0–7 に。
5. **既知の軽微点**：`worker/test/smoke.mjs` の av契約テストが古い（`hc<=7` を前提）で1件FAILします。**データは正しい**（14色仕様）。テスト側の更新はそちらで直してOK（デプロイには影響なし）。

現デプロイ版: `8f99ce6b-...`（またはそれ以降）。`MOCK_MODE=true`（YouTube側rank/live/fxはモック）、`PRESENCE_URL` 設定済み。

## いま起きている本番の不具合について（Workerは無関係）

本日の本番で「VRC客席に観客が出ない」件、**Worker側は正常**です（実データ `web` に2名載っているのを確認済み）。原因はVRChatクライアント/ワールド側で、切り分け中：
- **Untrusted URL 許可**が各自OFFだと外部データを読めない（最有力）
- 会場開閉スイッチが `ALLVERSE_MasterFlag` に配線されていない可能性

→ **Worker移管後も、この不具合の調査・修正はUnity側の範疇**（Udon/設定）です。そちらでWorkerを触る必要はありません。

## お願い返し
- Workerに欲しい仕様（YouTubeチャット取得・合言葉照合など）が固まったら、これまで通り申し送りで。Udon側（吹き出しTMP追加等）はこちらで対応します。
- presence.json / live.json のスキーマ（`web[]`・座標系・`av`）を変える時は、Udon側の観客表示に直結するので**必ず事前共有**をお願いします。
