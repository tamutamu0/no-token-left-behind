# 開発メモ

## フォルダ構成

| パス | 内容 |
|---|---|
| `Scriptable/AI Usage.js` | iPhone のウィジェット本体（Scriptable 用、外部ライブラリなし）。ホーム画面・ロック画面の描画と、同期ファイルの検証・キャッシュ |
| `Scripts/` | Mac の収集処理（Python 3、標準ライブラリのみ）。`collect_providers.py` が各 CLI を呼び、`sync_once.py` が結果を検証してまとめる |
| `Scripts/colab_history.py` / `colab_grants.py` / `colab_allocation.py` | Colab の残高履歴、付与の検出、確認済み総量 |
| `Scripts/install_*.py` / `sign_local_app.py` | ログイン項目への登録、statusLine の設定、ローカル署名 |
| `Mac/` | Mac の常駐アプリ（SwiftUI）。取得の開始・停止、iCloud への書き出し、ウィジェットのプレビュー |
| `Mac/WidgetPreview.html` | Scriptable の描画部品をブラウザで近似する小さな実装。プレビューとテストで使う |
| `Shared/` | Swift の共通モデルと検証（`UsageModels.swift`）、保存、直接接続 |
| `iOS/`・`Widget/` | ネイティブ版の iPhone アプリと WidgetKit ウィジェット |
| `Tests/` | Python（unittest）、JavaScript（node:test）、Swift（XCTest）のテスト |
| `Tools/render-screenshots.cjs` | README のスクリーンショットを架空データから作る |
| `project.yml` | XcodeGen のプロジェクト定義 |

## テスト

```bash
python3 -m unittest discover -s Tests -p 'test_*.py'
node --test Tests/*.test.cjs
swift test
```

- JavaScript のテストは、Scriptable の部品（`ListWidget`、`Color`、`Font` など）を最小限の偽物に差し替えて `buildWidget` を実行し、表示される文字・バーの数と幅・色の扱いを確かめます。
- `Tests/preview.test.cjs` は、Mac のプレビューが通信やファイルにアクセスせずに全サイズを描けることを確かめます。
- テストはすべて架空のデータで動き、実アカウントには触れません。

## ビルド

```bash
# Mac アプリ
xcodebuild -project AIUsage.xcodeproj -scheme AIUsageMac -derivedDataPath build-mac CODE_SIGN_IDENTITY=- build

# ネイティブ版（シミュレーター）
xcodebuild -project AIUsage.xcodeproj -scheme AIUsage -sdk iphonesimulator -derivedDataPath build CODE_SIGN_IDENTITY=- build
```

`Scripts/` はフォルダごとアプリのリソースに入ります。ただし Xcode プロジェクトは生成物なので、**`Scripts/` にファイルを足したら `xcodegen generate` で作り直してください**。作り直さないと新しいファイルがアプリに入らず、収集がエラーになります。

## ウィジェットの見た目を確かめる

- **Mac アプリ**：「ウィジェット」画面で小・中・大、自動・ライト・ダークを切り替えられます。「サンプル表示」で架空データにできます。同梱の `AI Usage.js` の描画関数をそのまま使います。
- **iPhone**：ウィジェットの Parameter に `demo` を入れると架空データで表示します。
- **スクリーンショット**：

  ```bash
  node Tools/render-screenshots.cjs . /tmp/showcase.html
  # Chrome（ヘッドレス）で撮る例
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1000,455 \
    --screenshot=docs/images/light.png "file:///tmp/showcase.html?m=light"
  ```

  `m=light`・`m=dark`・`m=lock` の 3 種類です。

近似の描画なので、実機とは文字幅などが少し違います。Scriptable は入りきらない文字を `minimumScaleFactor` に従って縮めるため、実機の方が詰まりにくくなります。

## レイアウトの考え方

- 幅は iPhone で最も小さいウィジェット（小 155、中 329×155、大 329×345）に収まる固定値で組み、大きい機種では余った幅を間の伸縮スペースが吸収します。
- 時間で回復する枠（Claude・Codex・Antigravity）は行、残高（Colab）は区切り線の下に分けます。
- 枠がないセルは何も描きません（「—」も出さない）。取得に失敗した枠だけ「—」を出します。
- ロック画面は iOS が単色にするので、白と不透明度だけで描きます。

## 新しいサービスを足すには

1. `Scripts/collect_providers.py` に取得処理を足し、許可する項目だけを返す
2. `Scripts/sync_once.py` の `IDS` / `SOURCES` と検証、`Shared/UsageModels.swift` の `ServiceID` / `UsageSource` を更新する
3. `Scriptable/AI Usage.js` の `SERVICE_IDS` / `SOURCES`、検証、描画に足す
4. 各テストを足し、`xcodegen generate` で作り直す

## ネイティブ版

SwiftUI の iPhone アプリ（`iOS/`）と WidgetKit のウィジェット（`Widget/`）です。iOS 17 以降。Mac のアプリと TLS-PSK で直接つなぎます。

1. `project.yml` のバンドル ID、`APP_GROUP`、`KEYCHAIN_GROUP` を自分のチームで使える値にし、`xcodegen generate` を実行する
2. Xcode の Signing & Capabilities で、アプリとウィジェットに同じ App Group と Keychain Sharing を設定する（利用できる機能は Apple Developer の契約種別によります）
3. Mac と iPhone を同じプライベートネットワーク（例：Tailscale）につなぐ
4. Mac アプリでその Mac のプライベート IPv4 を入れて「接続を開始」し、「接続ファイルを保存」
5. 接続ファイルを AirDrop で iPhone に渡し、iOS アプリの「Mac と接続」から読み込む。読み込んだら接続ファイルは削除する

Mac は指定したプライベート IP の TCP 49731 だけで待ち受けます。ポート開放や公開サーバーは要りません。
