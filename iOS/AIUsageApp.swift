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
        guard let pairing = PairingStore.load() else { message = String(localized: "Pair with your Mac first."); return }
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
                            Text("Your AI limits, at a glance.").font(.system(size: 27, weight: .bold))
                            Text("Claude · Codex · Google AI Pro").font(.subheadline).foregroundStyle(.secondary)
                        }
                        TimelineView(.periodic(from: .now, by: 60)) { context in
                            UsageDashboard(snapshot: model.snapshot, now: context.date, syncFailed: model.message != nil)
                                .padding(22).background(UsagePalette.background, in: RoundedRectangle(cornerRadius: 26))
                        }
                        HStack {
                            Button { Task { await model.refresh() } } label: {
                                Label(model.refreshing ? String(localized: "Refreshing") : String(localized: "Refresh usage"), systemImage: "arrow.clockwise")
                            }.buttonStyle(.borderedProminent).disabled(model.refreshing || !model.paired)
                            Button(model.paired ? String(localized: "Connection settings") : String(localized: "Connect to Mac")) { showPairing = true }
                                .buttonStyle(.bordered)
                        }
                        if let message = model.message { Text(message).font(.footnote).foregroundStyle(.orange) }
                        VStack(alignment: .leading, spacing: 14) {
                            Label("Add it to your Home Screen", systemImage: "rectangle.on.rectangle")
                                .font(.headline)
                            Text("Touch and hold the Home Screen → Edit → Add Widget → “AI Usage”. Medium and Large show every service together.")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Divider()
                            Text("Away from home, keep the Mac and iPhone on your private network (e.g. Tailscale). The Mac must be awake with the Mac app running.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Text("Each Google quota is counted separately. Antigravity and Colab update once their official CLIs are set up on the Mac.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }.padding(20).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 20))
                        Button(model.snapshot.isDemo ? String(localized: "Leave demo") : String(localized: "Preview with sample data")) {
                            model.setDemo(!model.snapshot.isDemo)
                        }.font(.footnote)
                    }.padding(22)
                }
                .navigationTitle("AI Usage").navigationBarTitleDisplayMode(.inline)
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
                Section("Connection details shown on the Mac") {
                    TextField("Mac’s private IP (e.g. Tailscale 100.x.x.x)", text: $host)
                        .keyboardType(.decimalPad).autocorrectionDisabled().textInputAutocapitalization(.never)
                    TextField("Port", text: $port).keyboardType(.numberPad)
                    SecureField("Connection key", text: $key).textContentType(.oneTimeCode)
                        .keyboardType(.asciiCapable).autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button("Import the Mac’s connection file") { importing = true }
                }
                Section {
                    Text("You never enter passwords or cookies for any AI service. The key only works with your own Mac and is stored in the iPhone’s Keychain. Send the connection file by AirDrop and delete it after pairing.")
                        .font(.footnote)
                    if let error { Text(error).foregroundStyle(.orange) }
                    Button("Pair and sync") { save() }.disabled(host.isEmpty || key.isEmpty)
                }
                if model.paired {
                    Section { Button("Disconnect", role: .destructive) { model.disconnect(); dismiss() } }
                }
            }
            .navigationTitle("Connect to Mac")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                do {
                    let url = try result.get()
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let bytes = try Data(contentsOf: url)
                    guard bytes.count < 2048 else { throw UsageError.invalidPairing }
                    let pairing = try JSONDecoder().decode(Pairing.self, from: bytes).validated()
                    host = pairing.host; port = String(pairing.port); key = pairing.key
                } catch { self.error = String(localized: "Couldn’t read the connection file.") }
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
