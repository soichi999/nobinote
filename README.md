# ノビノート（オンライン家庭教師 管理サイト / PWA）

チューター・生徒・保護者が同じ記録を見られる Web アプリです。ホーム画面に追加して
アプリのように使い、宿題・連絡・指導予定はプッシュ通知で届きます。

## 入口とパスコード

「学生・保護者です」／「チューターです」の2択 → パスコード入力（一度入力すればその端末では以後スキップ）。
学生・保護者は共通の入口ですが、チューターが生徒ごとに設定した**生徒用／保護者用の2種類のパスコード**の
どちらを入力したかによって、自動的に「生徒」「保護者」として区別されます。

- チューターの初期パスコードは **0000**（`config/tutor` に自動作成）。設定タブでいつでも変更可能。
- 生徒・保護者はパスコードで生徒本人が特定されるため、生徒を選ぶ操作は不要です。

> **セキュリティの前提**：パスコードの照合はブラウザ側で行っており、Firestore のルールでは
> 役割までは検証できません（＝URL と DB を直接叩ける相手には効きません）。URL とパスコードは
> 関係者だけに共有してください。

## 機能と役割ごとの権限

| 機能 | チューター | 生徒 | 保護者 |
|---|---|---|---|
| カレンダー（宿題・指導記録・指導予定） | 宿題出題・指導記録/予定の登録可 | 宿題の進度更新のみ可 | 閲覧のみ |
| 勉強時間 | 閲覧のみ | 登録可 | 閲覧のみ |
| 参考書 | 閲覧のみ | 登録可 | 閲覧のみ |
| 成績 | 閲覧のみ | 登録可（順位・志望校判定も編集可） | 閲覧のみ |
| 月謝 | 登録・振込確認 | 非表示 | 閲覧のみ |
| 連絡 | 閲覧・返信可 | 閲覧・返信可 | 閲覧・返信可 |
| 設定：名前 | 編集可 | 編集可 | 閲覧のみ |
| 設定：誕生日・志望校・得意/苦手科目 | 閲覧のみ | 編集可 | 閲覧のみ |
| 設定：パスコード管理 | 可（生徒一覧・パスコード発行） | 非表示 | 非表示 |

### カレンダー（宿題・指導記録・指導予定を統合）
「宿題」と「指導記録」は1つの「カレンダー」タブにまとまっています。

- 上部に宿題の達成度（全体の円形グラフ＋教科別バー）
- カレンダーは○ではなく横長のバッジ（時刻や「指導日」「期限」など）で予定を表示。日付をタップすると
  その日の詳細（指導予定・宿題期限、チューターは月謝も）がポップアップで確認できる
- タブを開くと自動的に今日の日付までスクロールする
- カレンダーの下には、宿題・指導予定・指導記録を**日付ごとにまとめたフィード**（新しい日付が上）を表示
- 宿題は2つの形式に対応
  - **単位ごとにチェック**：単位（問／ページ／回、または自由入力）と開始〜終了番号をチューターが設定し、
    生徒が1つずつチェック。達成度＝チェック済み数 ÷ 全体数（例：「6/10問」）
  - **完了・未完了**：達成度は0%または100%
  - 教科は「なし」も選択可。写真の添付にも対応
- 指導記録（実施済み）と指導予定（Zoom URL・時刻つき）をチューターが登録
- 指導開始1時間前・宿題期限前日にプッシュ通知（要 Cloud Functions）

### 成績
- 模試ごとに教科別の点数（素点／満点／偏差値）を何科目でも追加登録可能
- 模試ごとの合計点・順位（手入力）・志望校判定（設定タブで登録した志望校ごとにA〜E判定）を表示
- 科目別の得点率推移グラフ

### 月謝
- チューターが対象日（複数選択可）と金額を登録。「9/1 9/8 9/15　7,500円」のように表示
- 振込確認をトグルで管理。生徒には非表示、保護者は閲覧のみ

### 連絡
- チューター・生徒・保護者共通のメッセージ欄。**既読状況は送信者のみに表示**（「既読：保護者」など）

### 設定（プロフィール）
- 名前：生徒・チューターが編集可、保護者は閲覧のみ
- 誕生日・志望校（最大10件）・得意/苦手科目（教科は数学/英語/国語/理科/理科基礎/情報/小論文/社会の
  大項目ごとに折りたたみ、チェックボックスで何個でも選択可）：生徒のみ編集可
- 変更を加えると保存ボタンが青く変わる（未変更時はグレーで無効ではないが操作不要なことが分かる表示）

教科は大項目ごとに色相を固定し、抽象度が上がるほど淡く表示することで、宿題・指導記録・参考書・成績すべてで
共通の色分けバッジとして扱われます。

## セットアップ

### 1. Firebase プロジェクト
[Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成し、
- **Authentication → Sign-in method → 匿名** を有効化
- **Firestore Database** を作成
- **Cloud Messaging → ウェブプッシュ証明書** で鍵ペアを生成（VAPID キー）

### 2. 設定値を貼る
「プロジェクトの設定 → マイアプリ → ウェブアプリ」の値を **2か所** に貼ります。
- `firebase-config.js`（アプリ本体。VAPID キーもここ）
- `firebase-config-sw.js`（Service Worker 用。同じ値）

### 3. Firestore ルールと公開
`firestore.rules` の内容を Firestore コンソールの「ルール」タブに貼って公開するか、CLIで:
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore
```
※ 通知には **HTTPS** が必須なので、Firebase Hosting や GitHub Pages などに公開して使ってください。

### 4. 通知（プッシュ）を有効にする
サーバー側から送るため Cloud Functions を使います（**Blaze プラン**が必要）。
```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:indexes
```
`functions/index.js` が、宿題・指導記録・連絡の追加を検知して、その生徒に紐づく端末
（書いた本人以外）へ通知を送ります。あわせて以下の定期リマインドを送ります。
- `homeworkReminder`：毎朝8時（日本時間）に、翌日が期限の未提出宿題をチェック
- `lessonReminder`：5分おきに、1時間以内に始まる指導予定をチェック

いずれも複数の生徒をまたいで検索する（collectionGroup クエリ）ため、`firestore:indexes` の
デプロイ（複合インデックスの作成）が必要です。

### 5. ホーム画面に追加
- **iPhone/iPad**：Safari で開く → 共有 →「ホーム画面に追加」→
  ホーム画面のアイコンから起動 → 「通知をオンにする」
  （iOS はホーム画面に追加したアプリからでないと通知を許可できません）
- **Android/PC**：Chrome のインストールボタン →「通知をオンにする」

### 6. 初回の準備
チューターとして 0000 で入り、「設定」タブで生徒を追加し、生徒用・保護者用のパスコードを決めて
それぞれに伝えてください。あわせてチューターのパスコードも変更しておくと安全です。

## データ構造

```
config/tutor                        { passcode }
students/{sid}                      { name, studentPasscode, parentPasscode,
                                       birthday, targetSchools[], goodSubjects[], weakSubjects[] }
students/{sid}/lessons/{id}         { date, subject, range, content, notes }
students/{sid}/schedule/{id}        { date, time, zoomUrl, memo, reminded }
students/{sid}/homework/{id}        { title, subject, type, detail, dueDate, photo,
                                       done,                              // type: tf
                                       unit, countFrom, countTo, clearedCounts[] } // type: count
students/{sid}/books/{id}           { name, subject, image }
students/{sid}/studyLogs/{id}       { bookId, date, minutes }
students/{sid}/tests/{id}           { examName, date, subject, score, max, deviation }
students/{sid}/examMeta/{examSlug}  { rank, judgments: [{ school, rank }] }
students/{sid}/tuition/{id}         { dates[], amount, paid }
students/{sid}/messages/{id}        { text, authorRole, readBy: { tutor, student, parent }, createdAt }
students/{sid}/tokens/{fcmToken}    { role, updatedAt }   ← 通知の送り先
```

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` / `style.css` / `app.js` | アプリ本体 |
| `subjects.js` | 教科マスタ（グループ・色・選択UI生成） |
| `firebase-config.js` / `firebase-config-sw.js` | Firebase の設定値（要編集） |
| `manifest.json` / `icon-*.png` | PWA（ホーム画面追加） |
| `sw.js` | オフラインキャッシュ |
| `firebase-messaging-sw.js` | プッシュ通知の受信 |
| `functions/index.js` | 通知の送信・定期リマインド（Cloud Functions） |
| `firestore.rules` / `firestore.indexes.json` / `firebase.json` | ルール・インデックス・デプロイ設定 |
