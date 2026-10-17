import SwiftUI
import CryptoKit
import AppKit
import Darwin

@MainActor
final class MacModel: ObservableObject {
    @Published var snapshot = SnapshotStore.load()
    @Published var message = "取得を開始すると、CodexとClaudeの残量を更新します。"
    @Published var host = ""
    @Published var connected = false
    @Published var collecting = false
    @Published var running = false
    @Published var cloudFolder = UserDefaults.standard.string(forKey: "snapshotExportFolder") ?? ""
    private var server: SnapshotServer?
    private var timer: Timer?
    private var key: Data?
    private var health: [String: Any] = [:]
    private var exporting = false
    private var pendingExport: (data: Data, url: URL)?
    private var cloudAccessURL: URL?
    private var externalCollector: Bool {
        UserDefaults.standard.string(forKey: "collectorMode") == "headless"
    }

    private func recordHealth(_ fields: [String: Any]) {
        health.merge(fields) { _, new in new }
        guard let data = try? JSONSerialization.data(withJSONObject: health) else { return }
        let url = SnapshotStore.directory.appendingPathComponent("collector-health.json")
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    init() {
        if let bookmark = UserDefaults.standard.data(forKey: "snapshotExportBookmark") {
            var stale = false
            let scoped = UserDefaults.standard.bool(forKey: "snapshotExportBookmarkScoped")
            let options: URL.BookmarkResolutionOptions = scoped ? [.withSecurityScope, .withoutUI] : [.withoutUI]
            if let folder = try? URL(resolvingBookmarkData: bookmark, options: options, relativeTo: nil, bookmarkDataIsStale: &stale),
               folder.path == cloudFolder {
                if !scoped || folder.startAccessingSecurityScopedResource() {
                    cloudAccessURL = folder; cloudFolder = folder.path
                    // A stale bookmark can still grant access to the same selected folder.
                    // Refresh that bookmark only after OS access succeeds; never widen its target.
                    if stale, let renewed = try? folder.bookmarkData(options: scoped ? [.withSecurityScope] : [],
                        includingResourceValuesForKeys: nil, relativeTo: nil) {
                        UserDefaults.standard.set(renewed, forKey: "snapshotExportBookmark")
                    }
                    recordHealth(["bookmarkRestored": true])
                } else {
                    recordHealth(["bookmarkRestored": false, "bookmarkAccessUnavailable": true])
                }
            } else {
                recordHealth(["bookmarkRestored": false, "bookmarkResolutionUnavailable": true])
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--demo") { snapshot = .demo() }
        if let pairing = PairingStore.load() { host = pairing.host; key = Data(base64Encoded: pairing.key) }
        if ProcessInfo.processInfo.arguments.contains("--start-icloud-sync"), !snapshot.isDemo {
            let folder = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents", isDirectory: true)
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue,
               cloudFolder.isEmpty || cloudFolder == folder.path {
                cloudFolder = folder.path
                UserDefaults.standard.set(cloudFolder, forKey: "snapshotExportFolder")
                startCollection()
            } else {
                message = "ScriptableのiCloudフォルダか既存の出力先を確認してください。設定は変更していません。"
            }
        } else if UserDefaults.standard.bool(forKey: "collectionEnabled"), !snapshot.isDemo {
            startCollection()
        }
        recordHealth(["cloudConfigured": !cloudFolder.isEmpty,
                      "bundleID": Bundle.main.bundleIdentifier ?? "none"])
    }
    deinit { cloudAccessURL?.stopAccessingSecurityScopedResource() }
    func startCollection() {
        guard !snapshot.isDemo else { message = "デモを終了してから取得してください。"; return }
        running = true
        UserDefaults.standard.set(true, forKey: "collectionEnabled")
        Task { await refresh() }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.externalCollector { self.snapshot = SnapshotStore.load(); return }
                await self.refresh()
            }
        }
    }
    func stopCollection() {
        timer?.invalidate(); timer = nil; running = false
        UserDefaults.standard.set(false, forKey: "collectionEnabled")
    }

    func refresh() async {
        guard !collecting, !snapshot.isDemo else { return }
        if externalCollector {
            snapshot = SnapshotStore.load()
            message = "バックグラウンドで10分ごとに照会・同期します。"
            return
        }
        collecting = true; defer { collecting = false }
        recordHealth(["refreshStartedAt": Date().timeIntervalSince1970])
        importStatuslines()
        guard let script = Bundle.main.url(forResource: "collect_providers", withExtension: "py") else {
            message = "取得スクリプトが見つかりません。"; return
        }
        struct Collection: Decodable { let records: [UsageRecord]; let status: [String: String] }
        let result: Collection? = await Task.detached {
            let process = Process(); let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [script.path]
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                let bytes = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0, bytes.count <= UsageSnapshot.maxBytes else { return nil }
                let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .secondsSince1970
                return try decoder.decode(Collection.self, from: bytes)
            } catch { return nil }
        }.value
        if let result {
            recordHealth(["refreshFinishedAt": Date().timeIntervalSince1970, "providers": result.status])
            for record in result.records {
                let allowed = record.service == .codex && record.source == .codexAppServer
                    || record.service == .claude && record.source == .claudeCli
                    || record.service == .antigravity && record.source == .codexBar
                    || record.service == .colab && record.source == .colabCli
                if allowed { update(record) }
            }
            let pending = [ServiceID.claude, .codex, .antigravity, .colab].filter { result.status[$0.rawValue] != "ok" }
            message = pending.isEmpty ? "取得済み。10分ごとに照会しています。"
                : "ログイン・取得元の確認待ち: " + pending.map(\.title).joined(separator: "、") + "。前回の値を保持しています。"
        } else {
            recordHealth(["refreshFinishedAt": Date().timeIntervalSince1970, "collectionError": true])
            message = "残量の照会に失敗しました。前回の値を保持しています。"
        }
    }

    func importStatuslines() {
        let inputs: [(ServiceID, [UsageSource])] = [(.claude, [.claudeStatusline]),
            (.antigravity, [.antigravityStatusline])]
        for (service, sources) in inputs {
            let url = SnapshotStore.directory.appendingPathComponent("\(service.rawValue).json")
            guard let bytes = try? Data(contentsOf: url), bytes.count < 4096 else { continue }
            let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
            guard let r = try? d.decode(UsageRecord.self, from: bytes), r.service == service, sources.contains(r.source) else { continue }
            if r != snapshot.record(service) { update(r) }
        }
    }

    @discardableResult
    func update(_ record: UsageRecord) -> Bool {
        let previous = snapshot.record(record.service)
        if let previousDate = previous.observedAt,
           record.observedAt == nil || record.observedAt! < previousDate { return false }
        guard record != previous else { return true }
        var rows = snapshot.records.filter { $0.service != record.service }
        rows.append(record)
        let next = UsageSnapshot(version: 1, generatedAt: Date(), isDemo: false, records: rows)
        do { try SnapshotStore.save(next); snapshot = next; return exportSnapshot() }
        catch { message = error.localizedDescription; return false }
    }

    func setDemo(_ enabled: Bool) {
        stopCollection(); server?.stop(); server = nil; connected = false
        let next: UsageSnapshot = enabled ? .demo() : .empty
        do { try SnapshotStore.save(next); snapshot = next; exportSnapshot() }
        catch { message = error.localizedDescription }
    }

    func startServer() {
        do {
            if key == nil { key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) } }
            let pairing = try Pairing(host: host, port: 49731, key: key!.base64EncodedString()).validated()
            try PairingStore.save(pairing)
            server?.stop()
            let next = SnapshotServer { try SnapshotStore.load().encoded() }
            next.stateChanged = { [weak self] text in Task { @MainActor in self?.message = text } }
            try next.start(host: pairing.host, port: pairing.port, key: key!)
            server = next; connected = true
        } catch { message = error.localizedDescription; connected = false }
    }

    func selectCloudFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = false
        panel.message = "iCloud Drive内のScriptableフォルダを選んでください。残量・回復時刻・取得元だけをai-usage-snapshot-v2.jsonへ保存します。ログイン情報は含みません。"
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        var scoped = true
        let bookmark: Data
        do {
            do { bookmark = try folder.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) }
            catch {
                scoped = false
                bookmark = try folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            }
        } catch { message = "選んだフォルダのアクセス許可を保存できませんでした。"; return }
        let destination = folder.appendingPathComponent("ai-usage-snapshot-v2.json")
        if FileManager.default.fileExists(atPath: destination.path) {
            let alert = NSAlert()
            alert.messageText = "既存の残量ファイルを置き換えますか？"
            alert.informativeText = "ai-usage-snapshot-v2.jsonだけを更新します。他のファイルは変更しません。"
            alert.addButton(withTitle: "置き換える"); alert.addButton(withTitle: "キャンセル")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        cloudFolder = folder.path
        cloudAccessURL?.stopAccessingSecurityScopedResource()
        if scoped { _ = folder.startAccessingSecurityScopedResource() }
        cloudAccessURL = folder
        UserDefaults.standard.set(cloudFolder, forKey: "snapshotExportFolder")
        UserDefaults.standard.set(bookmark, forKey: "snapshotExportBookmark")
        UserDefaults.standard.set(scoped, forKey: "snapshotExportBookmarkScoped")
        exportSnapshot()
    }

    func stopCloudExport() {
        cloudFolder = ""; UserDefaults.standard.removeObject(forKey: "snapshotExportFolder")
        pendingExport = nil
        cloudAccessURL?.stopAccessingSecurityScopedResource(); cloudAccessURL = nil
        UserDefaults.standard.removeObject(forKey: "snapshotExportBookmark")
        message = "iCloudへの出力を停止しました。保存済みの残量ファイルは保持します。"
    }

    @discardableResult
    private func exportSnapshot() -> Bool {
        if externalCollector { return true }
        guard !cloudFolder.isEmpty else { return true }
        guard let access = cloudAccessURL else {
            recordHealth(["requiresFolderSelection": true])
            message = "iCloudへの書き込み許可が必要です。「Scriptableフォルダを選ぶ」から同期先を選び直してください。"
            return false
        }
        do {
            let url = access.appendingPathComponent("ai-usage-snapshot-v2.json")
            // Coalesce pending snapshots, and never block the UI/provider timer on iCloud I/O.
            pendingExport = (try snapshot.encoded(), url)
            drainExport()
            return true
        } catch {
            recordHealth(["exportError": true, "exportErrorCode": (error as NSError).code,
                         "exportErrorDomain": (error as NSError).domain])
            message = "iCloud出力に失敗しました。選択したフォルダとiCloud Driveの状態を確認してください。"; return false
        }
    }

    private func drainExport() {
        guard !exporting, let job = pendingExport else { return }
        exporting = true; pendingExport = nil
        recordHealth(["exportStartedAt": Date().timeIntervalSince1970])
        Task {
            let errorCode: Int32? = await Task.detached {
                // User-selected folder access is required. Keep atomic snapshots and private mode.
                let temporary = job.url.deletingLastPathComponent().appendingPathComponent(".usage-\(UUID().uuidString)").path
                let fd = Darwin.open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
                guard fd >= 0 else { return errno }
                defer { Darwin.close(fd); Darwin.unlink(temporary) }
                guard Darwin.fchmod(fd, mode_t(0o600)) == 0 else { return errno }
                var failed: Int32?
                job.data.withUnsafeBytes { bytes in
                    var offset = 0
                    while offset < bytes.count {
                        let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                        if count < 0 {
                            if errno == EINTR { continue }
                            failed = errno; break
                        }
                        if count == 0 { failed = EIO; break }
                        offset += count
                    }
                }
                if let failed { return failed }
                guard Darwin.fsync(fd) == 0 else { return errno }
                guard Darwin.rename(temporary, job.url.path) == 0 else { return errno }
                return nil
            }.value
            exporting = false
            if let errorCode {
                recordHealth(["exportError": true, "exportErrorCode": errorCode, "exportErrorDomain": "NSPOSIXErrorDomain"])
                message = "iCloud出力に失敗しました。同期先とアクセス許可を確認してください。"
            } else {
                recordHealth(["exportedAt": Date().timeIntervalSince1970, "exportError": false])
                recordHealth(["requiresFolderSelection": false])
            }
            drainExport()
        }
    }

    func exportPairing() {
        guard connected, let pairing = PairingStore.load() else { message = "先に接続を開始してください。"; return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "pairing.private.json"
        panel.message = "このファイルはMac専用の接続キーを含みます。AirDropで自分のiPhoneへ渡し、登録後に削除してください。"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try JSONEncoder().encode(pairing).write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            message = "接続ファイルを保存しました。AirDropでiPhoneへ渡してください。"
        } catch { message = "接続ファイルを保存できません。" }
    }

    func stopServer() { server?.stop(); server = nil; connected = false }
    func rotateKey() {
        stopServer()
        do { try PairingStore.delete(); key = nil; message = "接続キーを無効にしました。再接続時に新しいキーを作ります。" }
        catch { message = error.localizedDescription }
    }
}

@main
struct AIUsageMacApp: App {
    @StateObject private var model = MacModel()
    var body: some Scene {
        WindowGroup {
            MacDashboard(model: model).frame(minWidth: 620, minHeight: 740)
        }
        MenuBarExtra("Usage", systemImage: "circle.hexagongrid.fill") {
            Text("Usage")
            Button("残量を更新") { Task { await model.refresh() } }
            Button("終了") { NSApplication.shared.terminate(nil) }
        }
    }
}

struct MacDashboard: View {
    @ObservedObject var model: MacModel
    @State private var editing: ServiceID?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Usage").font(.largeTitle.bold())
                        Text("残量だけを、自分のiPhoneへ。").foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.snapshot.isDemo { Button("デモを終了") { model.setDemo(false) } }
                }
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    WidgetPreviewPanel(snapshot: model.snapshot, now: context.date)
                }
                GroupBox("残量の取得") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button(model.running ? "自動取得を停止" : "取得を開始") {
                                if model.running { model.stopCollection() } else { model.startCollection() }
                            }.disabled(model.snapshot.isDemo)
                            Button("今すぐ更新") { Task { await model.refresh() } }
                                .disabled(model.collecting || model.snapshot.isDemo)
                            Spacer()
                            if model.collecting { ProgressView().controlSize(.small) }
                        }
                        Text("Codex・Claude・Antigravity・Colabを10分ごとに照会します。各サービスへのログインが必要です。")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            ForEach([ServiceID.antigravity, .colab]) { id in
                                Button("\(id.title)を入力") { editing = id }.disabled(model.snapshot.isDemo)
                            }
                        }
                    }.padding(10)
                }
                GroupBox("iCloud同期 · Scriptable版") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button("Scriptableフォルダを選ぶ") { model.selectCloudFolder() }
                            if !model.cloudFolder.isEmpty { Button("出力を停止") { model.stopCloudExport() } }
                        }
                        Text(model.cloudFolder.isEmpty ? "未設定" : "出力先: \(model.cloudFolder)")
                            .font(.caption).textSelection(.enabled)
                        Text("有料Apple Developer登録なしで使う経路です。同じApple AccountのiCloud Driveへ残量だけを出力し、iPhoneの自作Scriptableウィジェットが読みます。AppleのiCloudに残量を保存します。Macの取得とiCloud同期、iOSの更新には遅延があります。")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(10)
                }
                GroupBox("直接接続 · ネイティブiPhoneアプリ版") {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("このMacのTailscale IP（100.x.x.x）", text: $model.host).textFieldStyle(.roundedBorder)
                            .disabled(model.connected)
                        HStack {
                            Button(model.connected ? "接続を停止" : "接続を開始") {
                                if model.connected { model.stopServer() } else { model.startServer() }
                            }.disabled(model.snapshot.isDemo)
                            Button("接続ファイルを保存") { model.exportPairing() }.disabled(!model.connected)
                            Spacer()
                            Button("キーを無効化", role: .destructive) { model.rotateKey() }
                        }
                        Text("外出先でも使うには、両端末のTailscaleを有効にしてください。Macの起動とこのアプリの常駐が必要です。接続先は指定した非公開IPのみです。")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(10)
                }
                Text(model.message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }.padding(26)
        }.sheet(item: $editing) { id in
            ManualUsageForm(service: id, existing: model.snapshot.record(id)) { _ = model.update($0) }
        }
    }
}

struct ManualUsageForm: View {
    let service: ServiceID
    let existing: UsageRecord
    let save: (UsageRecord) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var five = ""
    @State private var week = ""
    @State private var balance = ""
    @State private var fiveReset = Date().addingTimeInterval(3600)
    @State private var weekReset = Date().addingTimeInterval(86400)
    @State private var fiveKnown = false
    @State private var weekKnown = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("\(service.title)の残量").font(.title2.bold())
            Text("公式画面の表示値を入力します。空欄は未取得として扱います。")
                .font(.caption).foregroundStyle(.secondary)
            if service == .antigravity {
                TextField("5時間の残り %", text: $five)
                Toggle("5時間の回復時刻が分かる", isOn: $fiveKnown)
                if fiveKnown { DatePicker("回復", selection: $fiveReset) }
                TextField("週間の残り %", text: $week)
                Toggle("週間の回復時刻が分かる", isOn: $weekKnown)
                if weekKnown { DatePicker("回復", selection: $weekReset) }
            } else {
                TextField(service == .colab ? "残りの計算ユニット（CU）" : "残りのAIクレジット", text: $balance)
            }
            if let error { Text(error).foregroundStyle(.orange).font(.caption) }
            HStack {
                Button("キャンセル") { dismiss() }
                Spacer()
                Button("保存") { submit() }.buttonStyle(.borderedProminent)
            }
        }.padding(26).frame(width: 450)
        .onAppear {
            if let v = existing.fiveHour { five = String(100 - v.usedPercent); if let d = v.resetsAt { fiveReset = d; fiveKnown = true } }
            if let v = existing.weekly { week = String(100 - v.usedPercent); if let d = v.resetsAt { weekReset = d; weekKnown = true } }
            if let b = existing.balance { balance = String(b) }
        }
    }

    private func submit() {
        func parse(_ text: String, maximum: Double) throws -> Double? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return nil }
            guard let value = Double(trimmed), value.isFinite, (0...maximum).contains(value) else { throw UsageError.invalidData }
            return value
        }
        do {
            let f = try parse(five, maximum: 100), w = try parse(week, maximum: 100)
            let b = try parse(balance, maximum: 1e9)
            if (f != nil && fiveKnown && fiveReset <= Date()) || (w != nil && weekKnown && weekReset <= Date()) { throw UsageError.invalidData }
            save(UsageRecord(service: service, source: .manual, observedAt: Date(),
                fiveHour: f.map { .init(usedPercent: 100 - $0, resetsAt: fiveKnown ? fiveReset : nil) },
                weekly: w.map { .init(usedPercent: 100 - $0, resetsAt: weekKnown ? weekReset : nil) }, balance: b))
            dismiss()
        } catch { self.error = "数値と未来の回復時刻を確認してください。" }
    }
}
