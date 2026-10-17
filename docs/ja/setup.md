[English](../en/setup.md) · **日本語**

# 導入ガイド

Mac で残量を集めて iCloud Drive に書き出し、iPhone の Scriptable で表示するまでの全手順です。全体像は[仕組み](how-it-works.md)を参照してください。

- [0. 先に用意するもの](#0-先に用意するもの)
- [1. Mac アプリを入れる](#1-mac-アプリを入れる)
- [2. 取得元をつなぐ](#2-取得元をつなぐ)
- [3. 取得を始める](#3-取得を始める)
- [4. iCloud への書き出しを設定する](#4-icloud-への書き出しを設定する)
- [5. ウィジェットを置く](#5-ウィジェットを置く)
- [6. Colab の付与日を設定する（任意）](#6-colab-の付与日を設定する任意)
- [7. 全体を点検する](#7-全体を点検する)
- [更新](#更新) · [アンインストール](#アンインストール) · [困ったときは](#困ったときは)

## 0. 先に用意するもの

- 同じ Apple アカウントでサインインした Mac と iPhone。両方で iCloud Drive を有効にしておきます。
- Mac：macOS 14 以降と Xcode 16 以降。有料の Apple Developer 登録は不要です。
- iPhone：[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)（無料）。ロック画面ウィジェットには iOS 16 以降が必要です。
- 表示したいサービスの公式 CLI へのログイン。使わないサービスは飛ばして構いません。

## 1. Mac アプリを入れる

```bash
git clone https://github.com/tamutamu0/no-token-left-behind.git
cd no-token-left-behind
make install
```

`make install` はアプリをビルドしてから `Scripts/install_mac_startup.py` を実行します。このスクリプトがすることは次の 3 つです。

- この Mac だけで使う署名用の鍵を専用のキーチェーンに作り、アプリに署名します。アプリの同一性が保たれるので、更新のたびに iCloud フォルダを選び直す必要がなくなります。
- アプリを `~/Library/Application Support/AIUsage/AIUsageMac.app` に置き、収集スクリプトを同じ場所の `Collector/` に置きます。
- `~/Library/LaunchAgents/jp.local.aiusage.collector.plist` をログイン項目として登録します。

システムの信頼設定、Gatekeeper、スリープ設定は変更しません。

<details>
<summary>make を使わない場合</summary>

```bash
xcodebuild -project AIUsage.xcodeproj -scheme AIUsageMac -derivedDataPath build-mac CODE_SIGN_IDENTITY=- build
python3 Scripts/install_mac_startup.py
```

Xcode で `AIUsage.xcodeproj` を開き、スキーム `AIUsageMac` を Run しても構いません。
</details>

## 2. 取得元をつなぐ

### Codex

公式 [Codex CLI](https://github.com/openai/codex) にログイン（`codex login`）していれば、それだけで取得できます。送るのは接続時の `initialize` と `account/rateLimits/read` だけです。

### Claude

1. 公式 [Claude Code](https://code.claude.com/) CLI を入れ、一度起動してテーマ選択とログインを済ませます。初回セットアップが終わっていないと `/usage` が応答しません。
2. CLI の起動と出力の解析に使う [CodexBar](https://codexbar.app/) を入れます。

   ```bash
   brew install --cask codexbar
   ```

3. 公式 statusLine からも残量を取り込むよう設定します。既存の statusLine があれば上書きしません。変更前の設定はローカルにバックアップされます。

   ```bash
   python3 Scripts/install_statuslines.py
   ```

<details>
<summary>statusLine を手動で設定する場合</summary>

Claude Code の設定に次を加えます（パスは自分の環境に合わせます）。

```json
{
  "statusLine": {
    "type": "command",
    "command": "/usr/bin/python3 \"/absolute/path/no-token-left-behind/Scripts/claude_statusline.py\""
  }
}
```
</details>

### Antigravity

1. 公式 Antigravity CLI にログインします。
2. Claude と同じく CodexBar と statusLine を使います。上の `install_statuslines.py` で両方が設定されます。

取り込むのは Gemini モデル枠の 5 時間・週間（`quota.gemini-5h`、`quota.gemini-weekly`）です。コンテキスト容量の値は利用枠として扱いません。

### Google Colab

公式 [google-colab-cli](https://github.com/googlecolab/google-colab-cli) を、アプリが最初に探す場所に入れます。

```bash
python3 -m venv "$HOME/Library/Application Support/AIUsage/ColabRuntime"
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/pip" install google-colab-cli
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/colab" --auth oauth2 usage
```

最後のコマンドで初回の OAuth 認可を行います。認可画面で要求される権限を確認してください。認可コードをチャットなどに貼らないでください。以後の照会で実行するのは `usage`（残高の読み取り）だけです。VM の割り当てやコードの実行はしません。

別の場所に入れた場合は `AIUSAGE_COLAB_PATH` を設定します（[CLI の場所](#cli-の場所)）。

### CLI の場所

各 CLI は次の順で探します。

1. `$AIUSAGE_<名前>_PATH`
2. `PATH`
3. よく使われる場所：`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/bin`、`~/.npm-global/bin`、`~/.bun/bin`、`~/.volta/bin`、CodexBar アプリ内

ログイン項目はシェルの設定ファイルを読みません。変わった場所に入れた CLI は、launchd に場所を教えてからアプリを再起動します。

```bash
launchctl setenv AIUSAGE_CLAUDE_PATH /path/to/claude   # 名前: CODEX, CLAUDE, CODEXBAR, AGY, COLAB
launchctl kickstart -k gui/$(id -u)/jp.local.aiusage.collector
```

## 3. 取得を始める

Mac アプリで **取得を開始** を押します。10 分ごとに 4 サービスを照会します。**今すぐ更新** を押すとすぐに照会します。取得できなかったサービスには、ログインや取得元など何を待っているかが表示されます。

**Claude を入力** などのボタンで値を手入力することもできます。手入力した値は、ウィジェットで「手動」と表示されます。

## 4. iCloud への書き出しを設定する

1. iPhone で Scriptable を一度開きます。少し待つと、Mac の Finder の **iCloud Drive** に `Scriptable` フォルダができます。
2. ウィジェットのスクリプトをそこにコピーします。

   ```bash
   make widget
   ```

   [`Scriptable/AI Usage.js`](../../Scriptable/AI%20Usage.js) を手でそのフォルダにコピーしても同じです。
3. Mac アプリの **Scriptable フォルダを選ぶ** で、**iCloud Drive の中の** `Scriptable` フォルダを選びます。以後、残量が変わるたびに `ai-usage-snapshot-v2.json` を更新します。

ローカルのフォルダを選ぶと iPhone には届きません。共有フォルダも選ばないでください。

## 5. ウィジェットを置く

### ホーム画面

1. ホーム画面の何もないところを長押しし、**編集** → **ウィジェットを追加** を押します。
2. **Scriptable** を選び、小・中・大のどれかを追加します。
3. 追加したウィジェットを長押し → **ウィジェットを編集** → **Script** を **AI Usage** にします。**Parameter** は空欄のままにします。

### ロック画面（iOS 16 以降）

1. ロック画面を長押しして **カスタマイズ** → **ロック画面** を選びます。
2. 時計の上（1 行）か、時計の下のウィジェット欄をタップし、**Scriptable** を追加します。
3. 追加したウィジェットをタップし、**Script** を **AI Usage** にします。

Parameter が空なら、円形と 1 行は「いちばん残りが少ないサービス」を自動で表示します。サービスを固定したいときは `claude`・`codex`・`antigravity`・`colab` のどれかを入れます。たとえば円形を 3 つ並べて、それぞれ別のサービスに固定できます。

### Mac のデスクトップにも置く（任意）

macOS 14 以降は、iPhone のウィジェットを Mac のデスクトップにも置けます。デスクトップを右クリック → **ウィジェットを編集** → **Scriptable（iPhone から）** を選びます。システム設定 › デスクトップと Dock の **iPhone ウィジェットを使用** が有効になっている必要があります。

### 表示言語

ウィジェットは iPhone の言語（英語・日本語・中国語（簡体字）・韓国語）に従い、それ以外の言語では英語になります。ウィジェットごとに固定したいときは、Parameter に `lang=ja`（または `en`・`zh`・`ko`）を加えます。

## 6. Colab の付与日を設定する（任意）

iCloud Drive › Scriptable に `ai-usage-settings.json` を作ります。

```json
{ "colabGrantDay": 4 }
```

Google AI プランの場合は、Google One の「次回のお支払い」の日を目安にします。付与を一度観測すると、以後は実際に付与された日が優先されます（[Colab の付与の検出](how-it-works.md#colab-の付与の検出)）。

## 7. 全体を点検する

```bash
make doctor
```

各 CLI とログイン、最後の取得、Mac アプリとログイン項目、ウィジェットのスクリプト、iCloud のファイルの鮮度を点検します。問題があれば `→` の行に直し方を表示します。`python3 Scripts/doctor.py --json` を使うと同じ結果を JSON で出力します。直すべき点があると終了コード 1 を返します。

## 更新

```bash
git pull
make install     # ビルド・署名し直してアプリを再起動
make widget      # 新しいウィジェットスクリプトをコピー
```

## アンインストール

```bash
launchctl bootout gui/$(id -u)/jp.local.aiusage.collector
rm ~/Library/LaunchAgents/jp.local.aiusage.collector.plist
rm -rf ~/Library/Application\ Support/AIUsage
```

続けて、iCloud Drive › Scriptable の `AI Usage.js`、`ai-usage-snapshot-v2.json`、`ai-usage-settings.json` を削除します。`~/Library/Application Support/AIUsage` を消すと、ローカル署名用のキーチェーンと Colab の venv も消えます。

## 困ったときは

まず `make doctor` を実行してください。多くの場合、原因を特定できます。

| 症状 | 確認すること |
|---|---|
| ウィジェットが「—」だけ | Mac アプリで取得が始まっているか、Scriptable フォルダを選んだか、iCloud Drive の同期が終わっているか |
| 値がオレンジ | 15 分以上更新されていません。Mac がスリープしていないか、ネットにつながっているか |
| 一部のサービスだけ「—」 | そのサービスの公式 CLI にログインしているか。Claude は初回セットアップが終わっているか |
| 「再取得待ち」と出る | 回復時刻を過ぎたが、まだ新しい値を受け取っていません。次の取得で解消します |
| Mac アプリを更新したら書き出しが止まった | `make install` をもう一度。初回だけ Scriptable フォルダの選び直しが要ることがあります |
| ウィジェットがなかなか変わらない | 再描画のタイミングは iOS が決めます。ウィジェットをタップすると Scriptable が開いて読み直します |
| ターミナルでは CLI が動くのにアプリが見つけられない | ログイン項目はシェルの設定を読みません。`launchctl setenv AIUSAGE_<名前>_PATH …` を使います |
| Colab が「付与待ち」 | 予定日を過ぎても付与を観測していません。Google の付与は遅れることがあります。残高が増えれば自動で切り替わります |
