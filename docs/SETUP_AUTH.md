# セットアップ手順（サービス名の変更 ／ Googleログイン ／ Turso）

loyさんの作業ぶんだけをまとめたもの。**すべて無料**で、クレジットカードは要りません。
所要時間は全部で25分ほど。

**必ずこの順番でやってください。** Aで本番URLを確定しないと、Bの登録をやり直すことになります。

| | 内容 | 目安 |
|---|---|---|
| **A** | RenderのURLを決める（そのまま使うか、作り直すか） | 5分 |
| **B** | Googleログインの設定（Aで決めたURLを登録する） | 10分 |
| **C** | Tursoの設定（イベントを保存する） | 5分 |
| **D** | 動作確認 | 5分 |

---

## 設定しない間はどうなるか

| | 未設定のとき | 設定後 |
|---|---|---|
| Googleログイン | ログインボタンが出ない。**全員が今まで通り何でもできる** | ログインした人だけがコメント・エモート・見た目変更。動画操作は管理者だけ |
| イベントの保存 | メモリのみ。**サーバーが寝ると作ったイベントが消える** | 消えない。前日に仕込んでおける |

急がなくても壊れません。ライブで本格運用する前までに設定すればOKです。

---

## A. RenderのURLをどうするか（5分／やらない選択もあり）

### 重要: 改名してもURLは変わらない

**Renderは、サービス名を変えても `.onrender.com` のURLを変えません。**
サブドメインはサービスを作ったときに決まり、後から変更する機能がありません。

実際に2026-07-29に確認した結果:

| URL | 結果 |
|---|---|
| `https://allverse.onrender.com` | 404（存在しない） |
| `https://verse-city-web.onrender.com` | 200（こちらが本番） |

サービス名は `allverse` になっていますが、URLは `verse-city-web.onrender.com` のままです。

### 選択肢は2つ

**① そのまま使う（おすすめ度: 高）**

- URLは `verse-city-web.onrender.com` のまま
- **画面の表示はすべて ALLVERSE** なので、ユーザーが旧名を見るのはアドレス欄だけ
- Unity側への再共有が不要（共有済みのURLがそのまま生きる）
- 将来 独自ドメイン（例: `allverse.jp`）を取れば、そちらが正式URLになり
  `onrender.com` のURLは裏方になる。Renderは**無料プランでも独自ドメインを使えます**
  （Settings → Custom Domains）

**② 作り直してURLも揃える**

- `allverse.onrender.com` になる
- **今が一番安いタイミング**（環境変数がまだ空／Unity側も本番URL未設定のため）
- 手順:
  1. Settings 最下部 **Delete or suspend** → サービスを削除
  2. ダッシュボードで「New +」→「Blueprint」→ `verse-city-web` リポジトリを選ぶ
  3. サービス名に `allverse` を入れて「Apply」
- 注意: 数分のダウンタイムが出ます。**Renderには消えて困るデータを置いていない**ので、
  データが失われることはありません（イベントはTurso、コードはGitHub）

### どちらを選ぶか

**独自ドメインを取る予定があるなら①**。`onrender.com` のURLは一時的なものなので、
手間をかける価値が薄いです。
**当面 `onrender.com` のまま運用して人に配るなら②**。アドレス欄の見た目が揃います。

### 決めたらClaudeに伝えてください

②を選んだ場合は、こちらで以下を直します。

- `render.yaml` のサービス名
- `docs/DEPLOY_URL.md` の記載
- Unity側チャットへ渡す連絡文（新URLの再共有用）

---

## B. Googleログイン（10分）

### B-1. Google Cloud でプロジェクトを作る

1. https://console.cloud.google.com/ を開いてGoogleアカウントでログイン
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」
3. プロジェクト名は `allverse` など分かるもの →「作成」

### B-2. OAuth同意画面を設定する

1. 左メニュー →「APIとサービス」→「OAuth同意画面」
2. User Type は **「外部」** を選んで「作成」
3. 入力するのは3つだけ
   - アプリ名: **ALLVERSE** ← ログイン時に「ALLVERSEにログイン」と表示されます
   - ユーザーサポートメール: 自分のメール
   - デベロッパーの連絡先情報: 自分のメール
4. 「保存して次へ」を、スコープ・テストユーザーの画面もそのまま進めて完了

> **アプリ名は後からいつでも変えられます。** 迷っても止まらなくて大丈夫です。
>
> 「テストユーザー」のままだと、自分で登録した人しかログインできません。
> みんなに使ってもらう段階になったら、同意画面の「公開ステータス」を**本番環境に**してください。
> （メールアドレスと名前しか受け取らないので、Googleの審査は不要です）

### B-3. クライアントIDを作る

1. 「APIとサービス」→「認証情報」→「+ 認証情報を作成」→「OAuth クライアント ID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 名前: `allverse-web`
4. **承認済みの JavaScript 生成元** に次の2つを追加（ここが一番大事）
   ```
   https://<本番URL>.onrender.com
   http://localhost:5179
   ```
   例）そのまま使うなら `https://verse-city-web.onrender.com`
5. 「作成」→ 表示される **クライアントID**（`......apps.googleusercontent.com`）をコピー

> クライアントシークレットは使いません。コピーしなくて大丈夫です。
> 末尾のスラッシュは付けないでください（`https://allverse.onrender.com/` は不可）。

### B-4. Render に登録する

1. Renderのサービス → 左の **Environment**
2. 「Add Environment Variable」で次を追加

   | Key | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | B-3でコピーしたクライアントID |
   | `ADMIN_EMAILS` | 管理者にしたい人のGmail（カンマ区切り） |
   | `VIP_EMAILS` | 全ルームに現れる人のGmail（カンマ区切り） |

   例:
   ```
   ADMIN_EMAILS = loy61loy61@gmail.com
   VIP_EMAILS   = staff1@gmail.com,staff2@gmail.com
   ```
3. 「Save, rebuild, and deploy」で反映（数分）

> **メールアドレスはRenderの設定画面にだけ書きます。** GitHubやNotionには書かないでください。

---

## C. Turso（イベントの保存・5分）

### C-1. アカウントとデータベースを作る

1. https://turso.tech/ →「Start for free」→ GitHubアカウントでサインアップ
2. ダッシュボードで「Create Database」
3. 名前: `allverse` ／ リージョンは `Tokyo (nrt)` など近いところ
4. 作成後の画面で次の2つを取得
   - **Database URL**（`libsql://allverse-xxxx.turso.io` のような文字列）
   - **Auth Token**（「Create Token」を押すと発行される長い文字列）

### C-2. Render に登録する

Bと同じ「Environment」画面で追加します。

| Key | Value |
|---|---|
| `TURSO_DATABASE_URL` | C-1のDatabase URL |
| `TURSO_AUTH_TOKEN` | C-1のAuth Token |

「Save, rebuild, and deploy」で反映。

---

## D. 動作確認

ブラウザで次を開くと、状態がそのまま出ます。

```
https://<本番URL>.onrender.com/api/status
```

- `"login": true` … Googleログインが有効
- `"persistent": true` … イベントが保存されるようになった

そのあとトップページを開いて、

1. 入場画面に「Google でログイン」ボタンが出ている
2. 管理者のメールでログインすると、右下に **📺 動画変更** と **🚪 イベント/ルーム** のボタンが出る
3. ログインせずに入ると、コメント欄に「コメントするにはログインが必要です」と出る

ここまで確認できたら完了です。

---

## つまずいたときは

**ログインボタンが出ない**
`GOOGLE_CLIENT_ID` が入っているか、デプロイが終わっているかを確認。`/api/status` の `login` が `false` なら未反映です。

**ログインしようとするとエラーになる（redirect_uri_mismatch / origin エラー）**
B-3の「承認済みの JavaScript 生成元」が本番URLと一致していないケースがほとんどです。
`https://` から始まっているか、末尾にスラッシュが付いていないかを確認してください。

**自分が管理者にならない**
`ADMIN_EMAILS` のメールと、実際にログインしたGoogleアカウントのメールが一致しているか確認してください（大文字小文字は区別しません）。

**イベントが消える**
`/api/status` の `persistent` が `false` なら、Tursoの2つの環境変数を見直してください。

**古いURLを開いてしまう**
Aで②（作り直し）を選んだ場合のみ起きます。ブックマークとUnity側の設定を新URLに差し替えてください。

---

## 補足: 有料プランの話（今は不要）

Renderの無料プランは15分アクセスがないとスリープし、次のアクセスで起き上がるのに数十秒かかります。
ライブ開始前に管理者が一度URLを開いておけば実用上は問題ありません。
どうしても消したい場合は月$7ほどの有料プランになりますが、**移行前に必ず相談してください**。
