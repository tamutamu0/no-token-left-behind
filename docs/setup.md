# セットアップ

Mac で残量を集めて iCloud Drive に書き出し、iPhone の Scriptable で表示するまでの手順です。全体像は [README](../README.md#仕組み) を参照してください。

## 0. 先に用意するもの

- 同じ Apple アカウントでサインインした Mac と iPhone。両方で iCloud Drive を有効にしておきます。
- Mac：macOS 14 以降と Xcode。
- iPhone：[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)（無料）。ロック画面ウィジェットには iOS 16 以降が必要です。
- 表示したいサービスの公式 CLI へのログイン（後述）。使わないサービスは飛ばして構いません。

## 1. Mac アプリをビルドする

```bash
git clone https://github.com/tamutamu0/ai-usage-widget.git
cd ai-usage-widget
xcodebuild -project AIUsage.xcodeproj -scheme AIUsageMac -derivedDataPath build-mac CODE_SIGN_IDENTITY=- build
open build-mac/Build/Products/Debug/AIUsageMac.app
```

Xcode で `AIUsage.xcodeproj` を開き、スキーム `AIUsageMac` を選んで Run しても構いません。有料の Apple Developer 登録は要りません。

### ログイン時に自動で起動させる

```bash
python3 Scripts/install_mac_startup.py
```

このスクリプトは次のことをします。

- このMacだけで使うローカル署名用の鍵を専用のキーチェーンに作り、アプリに署名する（更新のたびに iCloud フォルダの選び直しが要らなくなります）
- アプリを `~/Library/Application Support/AIUsage/AIUsageMac.app` に置き、収集スクリプトを同じ場所の `Collector/` に置く
- `~/Library/LaunchAgents/jp.local.aiusage.collector.plist` をログイン項目として登録する

システムの信頼設定、Gatekeeper、スリープ設定は変更しません。アプリを更新したときは、ビルドし直してから同じコマンドをもう一度実行します。

## 2. 取得元をつなぐ

### Codex

公式 [Codex CLI](https://github.com/openai/codex) にログインしていれば、それだけで取得できます。送るのは `account/rateLimits/read`（残量の読み取り）だけです。

### Claude

1. 公式 [Claude Code](https://code.claude.com/) CLI をインストールし、一度起動してテーマ選択とログインを済ませます（初回セットアップが終わっていないと `/usage` に届きません）。
2. CLI の起動・解析補助として [CodexBar](https://codexbar.app/) を入れます。

   ```bash
   brew install --cask codexbar
   ```

3. 公式 statusLine からも残量を取り込むよう設定します。既存の statusLine があれば上書きせず、変更前の設定はローカルにバックアップされます。

   ```bash
   python3 Scripts/install_statuslines.py
   ```

手動で設定する場合は、Claude Code の設定に次を加えます（パスは自分の環境に合わせます）。

```json
{
  "statusLine": {
    "type": "command",
    "command": "/usr/bin/python3 \"/absolute/path/ai-usage-widget/Scripts/claude_statusline.py\""
  }
}
```

### Antigravity

1. 公式 Antigravity CLI にログインします。
2. Claude と同じく CodexBar と statusLine を使います（上の `install_statuslines.py` で両方設定されます）。

取り込むのは Gemini モデル枠の 5 時間・週間（`quota.gemini-5h`、`quota.gemini-weekly`）です。コンテキスト容量の値は利用枠として扱いません。

### Google Colab

公式 [google-colab-cli](https://github.com/googlecolab/google-colab-cli) を、アプリが探す決まった場所に入れます。

```bash
python3 -m venv "$HOME/Library/Application Support/AIUsage/ColabRuntime"
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/pip" install google-colab-cli
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/colab" --auth oauth2 usage
```

最後のコマンドで初回の OAuth 認可を行います。認可画面で要求される権限を確認してください。認可コードをチャットなどに貼らないでください。以後は 10 分ごとの照会で `usage`（残高の読み取り）だけを実行します。VM の割り当てやコードの実行はしません。

## 3. 取得を始める

Mac アプリで「取得を開始」を押します。10 分ごとに 4 サービスを照会します。取得できなかったサービスは画面に「ログイン・取得元の確認待ち」と出ます。

## 4. iCloud への書き出しを設定する

1. iPhone で Scriptable を一度開きます。少し待つと、Mac の Finder の **iCloud Drive** に `Scriptable` フォルダができます。
2. このリポジトリの [`Scriptable/AI Usage.js`](../Scriptable/AI%20Usage.js) を、その `Scriptable` フォルダにコピーします。
3. Mac アプリの「Scriptable フォルダを選ぶ」で、**iCloud Drive の中の** `Scriptable` フォルダを選びます。以後、残量が変わるたびに `ai-usage-snapshot-v2.json` を更新します。

ローカルのフォルダを選ぶと iPhone には届きません。共有フォルダも選ばないでください。

## 5. iPhone にウィジェットを置く

### ホーム画面

1. ホーム画面の何もないところを長押しし、左上の「編集」→「ウィジェットを追加」を押します。
2. Scriptable を選び、小・中・大のどれかを追加します。
3. 追加したウィジェットを長押し →「ウィジェットを編集」→ Script を「AI Usage」にします。Parameter は空欄のままにします。

### ロック画面（iOS 16 以降）

1. ロック画面を長押しして「カスタマイズ」→ ロック画面を選びます。
2. 時計の上（1 行）か、時計の下のウィジェット欄をタップし、Scriptable を追加します。
3. 追加したウィジェットをタップし、Script を「AI Usage」にします。円形・1 行に出すサービスを選ぶときは Parameter に `claude`・`codex`・`antigravity`・`colab` のどれかを入れます。

### Mac のデスクトップにも置く（任意）

macOS 14 以降は iPhone のウィジェットを Mac のデスクトップにも置けます。デスクトップを右クリック →「ウィジェットを編集」→ Scriptable（iPhone から）を選びます。システム設定 › デスクトップと Dock の「iPhone ウィジェットを使用」が有効になっている必要があります。

## 6. Colab の付与日を設定する（任意）

iCloud Drive の `Scriptable` フォルダに `ai-usage-settings.json` を作ります。

```json
{ "colabGrantDay": 4 }
```

Google AI プランの場合は、Google One の「次回のお支払い」の日を目安にします。付与を一度観測すると、以後は実際に付与された日が優先されます（[仕組み](how-it-works.md#colab-の付与の検出)）。

## うまくいかないとき

| 症状 | 確認すること |
|---|---|
| ウィジェットが「—」だけ | Mac アプリで取得が始まっているか、Scriptable フォルダを選んだか、iCloud Drive の同期が終わっているか |
| 値がオレンジ | 15 分以上更新されていません。Mac がスリープしていないか、ネットにつながっているか |
| 一部のサービスだけ「—」 | そのサービスの公式 CLI にログインしているか。Claude は初回セットアップが終わっているか |
| 「再取得待ち」と出る | 回復時刻を過ぎたが、まだ新しい値を受け取っていません。次の取得で戻ります |
| Mac アプリを更新したら書き出しが止まった | `install_mac_startup.py` で入れ直したか。初回だけ Scriptable フォルダの選び直しが要ることがあります |
| ウィジェットがなかなか変わらない | 再描画のタイミングは iOS が決めます。ウィジェットをタップすると Scriptable が開いて読み直します |
