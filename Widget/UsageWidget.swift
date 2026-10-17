import SwiftUI
import WidgetKit
import AppIntents

struct UsageEntry: TimelineEntry {
    let date: Date
    let snapshot: UsageSnapshot
    var syncFailed = false
}

struct UsageProvider: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry { UsageEntry(date: Date(), snapshot: .demo()) }
    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        completion(UsageEntry(date: Date(), snapshot: context.isPreview ? .demo() : SnapshotStore.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        Task {
            var snapshot = SnapshotStore.load()
            var failed = false
            if let pairing = PairingStore.load(), !snapshot.isDemo {
                do {
                    snapshot = try await SnapshotClient().fetch(pairing)
                    try SnapshotStore.save(snapshot)
                } catch { failed = true }
            }
            let now = Date()
            // Local timeline entries keep ages and reset expiry honest without a network request per minute.
            let entries = (0...15).map { minute in
                UsageEntry(date: now.addingTimeInterval(Double(minute) * 60), snapshot: snapshot, syncFailed: failed)
            }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(10 * 60))))
        }
    }
}

struct RefreshUsageIntent: AppIntent {
    static var title: LocalizedStringResource = "AI残量を更新"
    static var description = IntentDescription("自分のMacから残量だけを取得します。")
    func perform() async throws -> some IntentResult {
        guard let pairing = PairingStore.load() else { throw UsageError.invalidPairing }
        let snapshot = try await SnapshotClient().fetch(pairing)
        try SnapshotStore.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct UsageWidgetView: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        VStack(spacing: 8) {
            UsageDashboard(snapshot: entry.snapshot, now: entry.date, compact: family == .systemMedium,
                           dense: true, syncFailed: entry.syncFailed)
            if family == .systemLarge {
                HStack {
                    Text("Googleの各枠は別の残量です").font(.system(size: 9)).foregroundStyle(UsagePalette.muted)
                    Spacer()
                    Button(intent: RefreshUsageIntent()) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold))
                    }.buttonStyle(.plain).foregroundStyle(.white).disabled(entry.snapshot.isDemo)
                }
            }
        }.padding(family == .systemMedium ? 12 : 16)
            .containerBackground(UsagePalette.background, for: .widget)
    }
}

@main
struct AIUsageWidget: Widget {
    let kind = "AIUsage.combined"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UsageProvider()) { UsageWidgetView(entry: $0) }
            .configurationDisplayName("Usage")
            .description("Claude・Codex・Antigravityの5時間と週間枠、Colabの残り計算ユニットを1枚に。")
            .supportedFamilies([.systemMedium, .systemLarge])
            .contentMarginsDisabled()
    }
}
