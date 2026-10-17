[English](../en/development.md) · **日本語**

# 開発メモ

## フォルダ構成

| パス | 内容 |
|---|---|
| `Scriptable/AI Usage.js` | iPhone のウィジェット本体（Scriptable 用、外部ライブラリなし）。ホーム画面・ロック画面の描画、文字列表、同期ファイルの検証とキャッシュ |
| `Scripts/` | Mac の収集処理（Python 3、標準ライブラリのみ）。`collect_providers.py` が各 CLI を呼び、`sync_once.py` が結果を検証してまとめる |
| `Scripts/usage_io.py` | 共通の解析、`find_cli`、原子的な書き込み |
| `Scripts/colab_history.py` / `colab_grants.py` / `colab_allocation.py` | Colab の残高履歴、付与の検出、確認済み総量 |
| `Scripts/doctor.py` | 読み取り専用の自己診断（`make doctor`） |
| `Scripts/install_*.py` / `sign_local_app.py` | ログイン項目への登録、statusLine の設定、ローカル署名 |
| `Mac/` | Mac のメニューバーアプリ（SwiftUI）。取得の開始・停止、iCloud への書き出し、ウィジェットのプレビュー |
| `Mac/WidgetPreview.html` | Scriptable の描画部品を HTML・SVG で近似する小さな実装。プレビュー・テスト・スクリーンショットで使う |
| `Shared/` | Swift の共通モデルと検証（`UsageModels.swift`）、保存、直接接続 |
| `iOS/`・`Widget/` | ネイティブ版の iPhone アプリと WidgetKit ウィジェット |
| `Resources/` | String Catalog（`Localizable.xcstrings`、`InfoPlist.xcstrings`） |
| `Tests/` | Python（unittest）、JavaScript（node:test）、Swift（XCTest）のテスト |
| `Tools/render-screenshots.cjs` | README の画像を架空データから作る |
| `project.yml` | XcodeGen のプロジェクト定義 |

## テスト

```bash
make test            # すべて
make test-python     # python3 -m unittest discover -s Tests -p 'test_*.py'
make test-js         # node --test Tests/*.test.cjs
make test-swift      # swift test
```

- JavaScript のテストは、Scriptable の部品（`ListWidget`・`Color`・`Font`・`DrawContext` など）を小さな偽物に差し替えて `buildWidget` を実行します。表示される文字、バーの数と幅、色、ロック画面のリング、各言語を確かめます。
- `Tests/preview.test.cjs` は、Mac のプレビューが通信やファイルにアクセスせずに、全サイズを英語と日本語で描けることを確かめます。
- テストはすべて架空のデータで動き、実アカウントには触れません。

CI（`.github/workflows/ci.yml`）では、Ubuntu で Python と JavaScript のテストを、macOS で `swift test` と署名なしの Mac・iOS ビルドを実行します。

## ビルド

```bash
make build           # Mac アプリ
make project         # project.yml を変えたり、ファイルを足したりしたら Xcode プロジェクトを作り直す

# ネイティブ版（シミュレーター）
xcodebuild -project AIUsage.xcodeproj -scheme AIUsage -sdk iphonesimulator -derivedDataPath build CODE_SIGN_IDENTITY=- build
```

`Scripts/` はフォルダごとアプリのリソースに入ります。ただし Xcode プロジェクトは生成物です。**`Scripts/` にファイルを足したら `make project` を実行してください。** 作り直さないと新しいファイルがアプリに入らず、収集がエラーになります。

## ウィジェットの見た目を確かめる

- **Mac アプリ**：**ウィジェット** 画面で小・中・大と、自動・ライト・ダークを切り替えられます。**サンプル表示** にすると架空データで表示します。同梱の `AI Usage.js` の描画関数をそのまま使います。
- **iPhone**：ウィジェットの Parameter に `demo` を入れます。
- **スクリーンショット**：`make screenshots` を実行すると、ヘッドレスの Chrome で全言語分の `docs/images/<言語>/{light,dark,lock,anatomy}.png` を作ります（Chrome の場所は `CHROME=/path/to/chrome` で変更できます）。

近似の描画なので、実機とは文字幅などが少し違います。Scriptable は入りきらない文字を `minimumScaleFactor` に従って縮めるため、実機のほうが詰まりにくくなります。

## レイアウトの考え方

- 幅は、iPhone で最も小さいウィジェット（小 155、中 329×155、大 329×345）に収まる固定値で組みます。大きい機種では、余った幅を間の伸縮スペースが吸収します。
- 時間で回復する枠（Claude・Codex・Antigravity）は行にします。残高（Colab）は区切り線の下に分けます。
- プランにない枠のセルは何も描きません（「—」も出しません）。取得に失敗した枠だけ「—」を出します。
- iOS はロック画面を単色にするので、白と不透明度だけで描きます。

## 言語を足すには

1. **ウィジェット**：`Scriptable/AI Usage.js` の `I18N` に、`en` と同じキーをすべて持つブロックを足し、`resolveLanguage` に言語コードを加えます。キーが欠けているとテストが失敗します。
2. **アプリ**：Xcode で `Resources/Localizable.xcstrings` と `InfoPlist.xcstrings` を開き、言語を足してすべての文字列を翻訳します。`make project` を実行すると、新しい言語がプロジェクトに反映されます。
3. **スクリーンショット**：`Tools/render-screenshots.cjs` の `CALLOUTS` に説明文を、`languages` に言語コードを足し、`make screenshots` を実行します。
4. **README**：`README.md` を `README.<コード>.md` にコピーして翻訳し、すべての README の言語リンクに加えます。

## 新しいサービスを足すには

1. `Scripts/collect_providers.py` に取得処理を足し、許可する項目だけを返す
2. `Scripts/sync_once.py` の `IDS` / `SOURCES` と検証、`Shared/UsageModels.swift` の `ServiceID` / `UsageSource` を更新する
3. `Scriptable/AI Usage.js` の `SERVICE_IDS` / `SOURCES`、検証、描画に足す
4. `Scripts/doctor.py` に点検を足す
5. テストを足し、`make project` を実行する

読み飛ばしに対応しているので、新しいサービスをまだ知らないウィジェットは、そのサービスを無視して動き続けます。

## ネイティブ版

SwiftUI の iPhone アプリ（`iOS/`）と WidgetKit のウィジェット（`Widget/`）です。iOS 17 以降で動き、Mac のアプリと TLS-PSK で直接つなぎます。

1. `project.yml` のバンドル ID、`APP_GROUP`、`KEYCHAIN_GROUP` を自分のチームで使える値にし、`make project` を実行する
2. Xcode の Signing & Capabilities で、アプリとウィジェットに同じ App Group と Keychain Sharing を設定する（使える機能は Apple Developer の契約種別によります）
3. Mac と iPhone を同じプライベートネットワーク（例：Tailscale）につなぐ
4. Mac アプリにその Mac のプライベート IPv4 を入れて **接続を開始** し、**接続ファイルを保存** を押す
5. 接続ファイルを AirDrop で iPhone に渡し、iOS アプリの **Mac と接続** から読み込む。読み込んだら接続ファイルは削除する

Mac は、指定したプライベート IP の TCP 49731 だけで待ち受けます。ポート開放や公開サーバーは要りません。
