import SwiftUI
import WidgetKit
import UniformTypeIdentifiers

@MainActor
final class PhoneModel: ObservableObject {
    @Published var snapshot = SnapshotStore.load()
    @Published var message: String?
    @Published var refreshing = false
    @Published var paired = PairingStore.load() != nil

    func refresh() async {
        guard !refreshing else { return }
        guard let pairing = PairingStore.load() else { message = "Macの接続情報を登録してください。"; return }
        refreshing = true; defer { refreshing = false }
        do {
            let fetched = try await SnapshotClient().fetch(pairing)
            try SnapshotStore.save(fetched)
            snapshot = fetched; message = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch { message = error.localizedDescription }
    }
    func setDemo(_ enabled: Bool) {
        do {
            snapshot = enabled ? .demo() : .empty
            try SnapshotStore.save(snapshot); message = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch { message = error.localizedDescription }
    }
    func disconnect() {
        do {
            try PairingStore.delete(); try SnapshotStore.save(.empty)
            paired = false; snapshot = .empty; message = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch { message = error.localizedDescription }
    }
}

@main
struct AIUsageApp: App {
    @StateObject private var model = PhoneModel()
    @State private var showPairing = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("使えるAIを、ひと目で。").font(.system(size: 27, weight: .bold))
                            Text("Claude · Codex · Google AI Pro").font(.subheadline).foregroundStyle(.secondary)
                        }
                        TimelineView(.periodic(from: .now, by: 60)) { context in
                            UsageDashboard(snapshot: model.snapshot, now: context.date, syncFailed: model.message != nil)
                                .padding(22).background(UsagePalette.background, in: RoundedRectangle(cornerRadius: 26))
                        }
                        HStack {
                            Button { Task { await model.refresh() } } label: {
                                Label(model.refreshing ? "更新中" : "残量を更新", systemImage: "arrow.clockwise")
                            }.buttonStyle(.borderedProminent).disabled(model.refreshing || !model.paired)
                            Button(model.paired ? "接続設定" : "Macと接続") { showPairing = true }
                                .buttonStyle(.bordered)
                        }
                        if let message = model.message { Text(message).font(.footnote).foregroundStyle(.orange) }
                        VStack(alignment: .leading, spacing: 14) {
                            Label("ホーム画面に1枚追加", systemImage: "rectangle.on.rectangle")
                                .font(.headline)
                            Text("ホーム画面を長押し → 編集 → ウィジェットを追加 →「AI残量」。中サイズ・大サイズで全サービスをまとめて見られます。")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Divider()
                            Text("外出先ではMacとiPhoneのTailscaleを接続してください。Macの起動とMacアプリの常駐が必要です。")
                                .font(.footnote).foregroundStyle(.secondary)
                            Text("Googleの各枠は別の残量です。Antigravityは公式CLIの設定後に更新。ColabとAIクレジットはMacで入力した値を同期します。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }.padding(20).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 20))
                        Button(model.snapshot.isDemo ? "デモを終了" : "架空データで表示を確認") {
                            model.setDemo(!model.snapshot.isDemo)
                        }.font(.footnote)
                    }.padding(22)
                }
                .navigationTitle("AI残量").navigationBarTitleDisplayMode(.inline)
                .sheet(isPresented: $showPairing) {
                    PairingForm(model: model)
                }
                .task {
                    if ProcessInfo.processInfo.arguments.contains("--demo") { model.setDemo(true) }
                    else if model.paired { await model.refresh() }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active && model.paired && !model.snapshot.isDemo { Task { await model.refresh() } }
                }
            }
        }
    }
}

struct PairingForm: View {
    @ObservedObject var model: PhoneModel
    @Environment(\.dismiss) private var dismiss
    @State private var host = ""
    @State private var key = ""
    @State private var port = "49731"
    @State private var error: String?
    @State private var importing = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Macに表示された接続情報") {
                    TextField("MacのTailscale IP（100.x.x.x）", text: $host)
                        .keyboardType(.decimalPad).autocorrectionDisabled().textInputAutocapitalization(.never)
                    TextField("ポート", text: $port).keyboardType(.numberPad)
                    SecureField("接続キー", text: $key).textContentType(.oneTimeCode)
                        .keyboardType(.asciiCapable).autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button("Macの接続ファイルを読み込む") { importing = true }
                }
                Section {
                    Text("各AIのパスワードやCookieは入力しません。接続キーは自分のMac専用で、iPhoneのKeychainに保存します。接続ファイルはAirDropで渡し、登録後に削除してください。")
                        .font(.footnote)
                    if let error { Text(error).foregroundStyle(.orange) }
                    Button("登録して同期") { save() }.disabled(host.isEmpty || key.isEmpty)
                }
                if model.paired {
                    Section { Button("接続を解除", role: .destructive) { model.disconnect(); dismiss() } }
                }
            }
            .navigationTitle("Macと接続")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                do {
                    let url = try result.get()
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let bytes = try Data(contentsOf: url)
                    guard bytes.count < 2048 else { throw UsageError.invalidPairing }
                    let pairing = try JSONDecoder().decode(Pairing.self, from: bytes).validated()
                    host = pairing.host; port = String(pairing.port); key = pairing.key
                } catch { self.error = "接続ファイルを読み込めません。" }
            }
        }
    }
    private func save() {
        do {
            guard let port = UInt16(port) else { throw UsageError.invalidPairing }
            try PairingStore.save(Pairing(host: host.trimmingCharacters(in: .whitespaces), port: port, key: key.trimmingCharacters(in: .whitespacesAndNewlines)))
            model.paired = true; dismiss()
            Task { await model.refresh() }
        } catch { self.error = error.localizedDescription }
    }
}
