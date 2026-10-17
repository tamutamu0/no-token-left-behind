import SwiftUI
import CryptoKit
import AppKit
import Darwin

@MainActor
final class MacModel: ObservableObject {
    @Published var snapshot = SnapshotStore.load()
    @Published var message = String(localized: "Start collecting to update Codex, Claude, Antigravity and Colab.")
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
                message = String(localized: "Check the Scriptable iCloud folder or the existing export location. No settings were changed.")
            }
        } else if UserDefaults.standard.bool(forKey: "collectionEnabled"), !snapshot.isDemo {
            startCollection()
        }
        recordHealth(["cloudConfigured": !cloudFolder.isEmpty,
                      "bundleID": Bundle.main.bundleIdentifier ?? "none"])
    }
    deinit { cloudAccessURL?.stopAccessingSecurityScopedResource() }
    func startCollection() {
        guard !snapshot.isDemo else { message = String(localized: "Leave demo mode before collecting."); return }
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
            message = String(localized: "Collecting and syncing every 10 minutes in the background.")
            return
        }
        collecting = true; defer { collecting = false }
        recordHealth(["refreshStartedAt": Date().timeIntervalSince1970])
        importStatuslines()
        guard let script = Bundle.main.url(forResource: "collect_providers", withExtension: "py") else {
            message = String(localized: "The collector script is missing."); return
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
            let names = ListFormatter.localizedString(byJoining: pending.map(\.title))
            message = pending.isEmpty ? String(localized: "Up to date. Checking every 10 minutes.")
                : String(localized: "Needs sign-in or a source: \(names). Keeping the last values.")
        } else {
            recordHealth(["refreshFinishedAt": Date().timeIntervalSince1970, "collectionError": true])
            message = String(localized: "Collection failed. Keeping the last values.")
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
        panel.message = String(localized: "Choose the Scriptable folder in iCloud Drive. Only usage numbers, reset times and sources are saved to ai-usage-snapshot-v2.json — never sign-in details.")
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        var scoped = true
        let bookmark: Data
        do {
            do { bookmark = try folder.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) }
            catch {
                scoped = false
                bookmark = try folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            }
        } catch { message = String(localized: "Couldn’t save access to the chosen folder."); return }
        let destination = folder.appendingPathComponent("ai-usage-snapshot-v2.json")
        if FileManager.default.fileExists(atPath: destination.path) {
            let alert = NSAlert()
            alert.messageText = String(localized: "Replace the existing usage file?")
            alert.informativeText = String(localized: "Only ai-usage-snapshot-v2.json is updated. Other files are left alone.")
            alert.addButton(withTitle: String(localized: "Replace")); alert.addButton(withTitle: String(localized: "Cancel"))
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
        message = String(localized: "Stopped exporting to iCloud. The saved usage file is kept.")
    }

    @discardableResult
    private func exportSnapshot() -> Bool {
        if externalCollector { return true }
        guard !cloudFolder.isEmpty else { return true }
        guard let access = cloudAccessURL else {
            recordHealth(["requiresFolderSelection": true])
            message = String(localized: "Write access to iCloud is needed. Choose the folder again with “Choose Scriptable folder”.")
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
            message = String(localized: "Couldn’t export to iCloud. Check the chosen folder and iCloud Drive."); return false
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
                message = String(localized: "Couldn’t export to iCloud. Check the folder and its access permission.")
            } else {
                recordHealth(["exportedAt": Date().timeIntervalSince1970, "exportError": false])
                recordHealth(["requiresFolderSelection": false])
            }
            drainExport()
        }
    }

    func exportPairing() {
        guard connected, let pairing = PairingStore.load() else { message = String(localized: "Start the connection first."); return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "pairing.private.json"
        panel.message = String(localized: "This file contains this Mac’s connection key. AirDrop it to your own iPhone and delete it after pairing.")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try JSONEncoder().encode(pairing).write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            message = String(localized: "Saved the connection file. AirDrop it to your iPhone.")
        } catch { message = String(localized: "Couldn’t save the connection file.") }
    }

    func stopServer() { server?.stop(); server = nil; connected = false }
    func rotateKey() {
        stopServer()
        do { try PairingStore.delete(); key = nil; message = String(localized: "The connection key was revoked. A new key is created when you reconnect.") }
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
            Button("Refresh usage") { Task { await model.refresh() } }
            Button("Quit") { NSApplication.shared.terminate(nil) }
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
                        Text("Just the numbers, on your own iPhone.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.snapshot.isDemo { Button("Leave demo") { model.setDemo(false) } }
                }
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    WidgetPreviewPanel(snapshot: model.snapshot, now: context.date)
                }
                GroupBox("Collection") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button(model.running ? String(localized: "Stop collecting") : String(localized: "Start collecting")) {
                                if model.running { model.stopCollection() } else { model.startCollection() }
                            }.disabled(model.snapshot.isDemo)
                            Button("Refresh now") { Task { await model.refresh() } }
                                .disabled(model.collecting || model.snapshot.isDemo)
                            Spacer()
                            if model.collecting { ProgressView().controlSize(.small) }
                        }
                        Text("Checks Codex, Claude, Antigravity and Colab every 10 minutes. Each needs its official CLI signed in.")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            ForEach([ServiceID.antigravity, .colab]) { id in
                                Button("Enter \(id.title)") { editing = id }.disabled(model.snapshot.isDemo)
                            }
                        }
                    }.padding(10)
                }
                GroupBox("iCloud sync · Scriptable") {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button("Choose Scriptable folder") { model.selectCloudFolder() }
                            if !model.cloudFolder.isEmpty { Button("Stop export") { model.stopCloudExport() } }
                        }
                        Text(model.cloudFolder.isEmpty ? String(localized: "Not set") : String(localized: "Exporting to: \(model.cloudFolder)"))
                            .font(.caption).textSelection(.enabled)
                        Text("No paid Apple Developer account needed. Only usage numbers are written to iCloud Drive on the same Apple Account, where the Scriptable widget reads them. Collection, iCloud sync and widget refresh each add some delay.")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(10)
                }
                GroupBox("Direct connection · native iPhone app") {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("This Mac’s private IP (e.g. Tailscale 100.x.x.x)", text: $model.host).textFieldStyle(.roundedBorder)
                            .disabled(model.connected)
                        HStack {
                            Button(model.connected ? String(localized: "Stop connection") : String(localized: "Start connection")) {
                                if model.connected { model.stopServer() } else { model.startServer() }
                            }.disabled(model.snapshot.isDemo)
                            Button("Save connection file") { model.exportPairing() }.disabled(!model.connected)
                            Spacer()
                            Button("Revoke key", role: .destructive) { model.rotateKey() }
                        }
                        Text("To use it away from home, keep both devices on your private network (e.g. Tailscale). The Mac must be awake with this app running. Only the private IP you enter is used.")
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
            Text("\(service.title) usage").font(.title2.bold())
            Text("Enter the values shown by the service. Leave a field blank if unknown.")
                .font(.caption).foregroundStyle(.secondary)
            if service == .antigravity {
                TextField("5-hour % left", text: $five)
                Toggle("I know the 5-hour reset time", isOn: $fiveKnown)
                if fiveKnown { DatePicker("Resets", selection: $fiveReset) }
                TextField("Weekly % left", text: $week)
                Toggle("I know the weekly reset time", isOn: $weekKnown)
                if weekKnown { DatePicker("Resets", selection: $weekReset) }
            } else {
                TextField("Compute units left (CU)", text: $balance)
            }
            if let error { Text(error).foregroundStyle(.orange).font(.caption) }
            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Button("Save") { submit() }.buttonStyle(.borderedProminent)
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
        } catch { self.error = String(localized: "Check the numbers and that reset times are in the future.") }
    }
}
