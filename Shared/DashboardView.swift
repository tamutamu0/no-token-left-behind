import SwiftUI

enum UsagePalette {
    static let background = Color(red: 0.055, green: 0.075, blue: 0.11)
    static let muted = Color(red: 0.56, green: 0.62, blue: 0.70)
    static func tint(_ service: ServiceID) -> Color {
        switch service {
        case .claude: return Color(red: 0.91, green: 0.64, blue: 0.48)
        case .codex: return Color(red: 0.49, green: 0.84, blue: 0.72)
        default: return Color(red: 0.56, green: 0.72, blue: 1)
        }
    }
}

struct UsageDashboard: View {
    let snapshot: UsageSnapshot
    var now = Date()
    var compact = false
    var dense = false
    var syncFailed = false

    var body: some View {
        Group {
            if compact { compactBody }
            else { expandedBody }
        }
    }

    private var compactBody: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(snapshot.isDemo ? "AI残量 · DEMO" : "AI残量").font(.system(size: 11, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("5時間").frame(width: 78, alignment: .leading)
                Text("週間").frame(width: 78, alignment: .leading)
            }.font(.system(size: 9)).foregroundStyle(UsagePalette.muted)
            ForEach([ServiceID.claude, .codex, .antigravity]) { id in
                let record = snapshot.record(id)
                HStack(spacing: 4) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(id.title).font(.system(size: 11, weight: .semibold)).foregroundStyle(UsagePalette.tint(id))
                        Text(record.source == .manual && record.observedAt != nil ? "手動 · \(age(record))" : age(record))
                            .font(.system(size: 7)).foregroundStyle(record.observedAt != nil && record.isStale(at: now) ? .orange : UsagePalette.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    compactWindow(record.fiveHour).frame(width: 78, alignment: .leading)
                    compactWindow(record.weekly).frame(width: 78, alignment: .leading)
                }
            }
            HStack(spacing: 8) {
                compactBalance(snapshot.record(.colab))
                Spacer(minLength: 0)
            }.font(.system(size: 10))
            Text(snapshot.isDemo ? "架空の値 · 表示確認用" : syncFailed ? "Mac未接続 · 前回の値" : "残量の観測時刻は各行に表示")
                .font(.system(size: 7)).foregroundStyle(snapshot.isDemo ? .yellow : UsagePalette.muted)
        }.foregroundStyle(.white)
    }

    private func compactWindow(_ window: QuotaWindow?) -> some View {
        let remaining = window?.remaining(at: now)
        return VStack(alignment: .leading, spacing: 1) {
            Text(remaining.map { String(format: "%.0f%%", $0) } ?? "—")
                .font(.system(size: 16, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(remaining.map { $0 <= 20 ? Color.orange : Color.white } ?? UsagePalette.muted)
            Text(resetLabel(window)).font(.system(size: 7)).foregroundStyle(UsagePalette.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
    }

    private func compactBalance(_ record: UsageRecord) -> some View {
        HStack(spacing: 3) {
            Text(record.service == .colab ? "Colab" : "credits").foregroundStyle(UsagePalette.muted)
            Text("残り").foregroundStyle(UsagePalette.muted)
            Text(record.balance.map { String(format: $0.rounded() == $0 ? "%.0f" : "%.1f", $0) } ?? "—")
                .monospacedDigit()
            if record.service == .colab { Text("CU").font(.system(size: 8)).foregroundStyle(UsagePalette.muted) }
            if record.source == .manual && record.balance != nil { Text("手動").font(.system(size: 7)).foregroundStyle(.orange) }
            if record.observedAt != nil && record.isStale(at: now) { Text(age(record)).font(.system(size: 7)).foregroundStyle(.orange) }
        }
    }

    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: dense ? 8 : 16) {
            HStack {
                Image(systemName: "circle.hexagongrid.fill").foregroundStyle(UsagePalette.tint(.codex))
                Text("AI 残量").font(.system(size: dense ? 16 : 19, weight: .semibold))
                Spacer()
                Text(snapshot.isDemo ? "DEMO · 架空の値" : "PRIVATE")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(snapshot.isDemo ? .yellow : UsagePalette.muted)
            }
            HStack {
                Text("残り / 回復まで").frame(maxWidth: .infinity, alignment: .leading)
                Text("5時間").frame(width: compact ? 80 : 105, alignment: .leading)
                Text("週間").frame(width: compact ? 80 : 105, alignment: .leading)
            }
            .font(.system(size: 10, weight: .medium)).foregroundStyle(UsagePalette.muted)

            ForEach([ServiceID.claude, .codex, .antigravity]) { id in
                quotaRow(snapshot.record(id))
            }

            Rectangle().fill(.white.opacity(0.1)).frame(height: 1)
            HStack(spacing: 12) {
                balanceView(snapshot.record(.colab))
            }
            HStack(spacing: 4) {
                Image(systemName: syncFailed ? "wifi.slash" : "clock")
                if snapshot.isDemo { Text("表示確認用。実際の残量ではありません") }
                else if snapshot.records.allSatisfy({ $0.observedAt == nil }) { Text("Macと接続して残量を表示") }
                else {
                    Text(syncFailed ? "Mac未接続 · 前回の値" : "各サービスの取得時刻を保持")
                    Spacer(minLength: 0)
                    Text(snapshot.generatedAt, style: .time)
                }
            }
            .font(.system(size: compact ? 8 : 10)).foregroundStyle(UsagePalette.muted)
        }
        .foregroundStyle(.white)
        .accessibilityElement(children: .contain)
    }

    private func quotaRow(_ record: UsageRecord) -> some View {
        HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Circle().fill(UsagePalette.tint(record.service)).frame(width: 5, height: 5)
                    Text(record.service.title).font(.system(size: dense ? 12 : 14, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Text(record.observedAt == nil ? "未取得" : record.source == .manual ? "手動 · \(age(record))" : age(record))
                    .font(.system(size: dense ? 8 : 10))
                    .foregroundStyle(record.observedAt != nil && record.isStale(at: now) ? .orange : UsagePalette.muted)
            }.frame(maxWidth: .infinity, alignment: .leading)
            windowView(record.fiveHour, service: record.service)
                .frame(width: compact ? 80 : 105, alignment: .leading)
            windowView(record.weekly, service: record.service)
                .frame(width: compact ? 80 : 105, alignment: .leading)
        }
    }

    private func windowView(_ window: QuotaWindow?, service: ServiceID) -> some View {
        let remaining = window?.remaining(at: now)
        return VStack(alignment: .leading, spacing: dense ? 3 : 4) {
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(remaining.map { String(format: "%.0f", $0) } ?? "—")
                    .font(.system(size: dense ? 22 : 25, weight: .semibold, design: .rounded)).monospacedDigit()
                if remaining != nil { Text("%").font(.system(size: compact ? 9 : 12)).foregroundStyle(UsagePalette.muted) }
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.10))
                    if let remaining {
                        Capsule().fill(remaining <= 20 ? .orange : UsagePalette.tint(service))
                            .frame(width: geometry.size.width * remaining / 100)
                    }
                }
            }.frame(height: 3)
            Text(resetLabel(window)).font(.system(size: dense ? 8 : 10)).foregroundStyle(UsagePalette.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(remaining.map { "残り\(Int($0))パーセント、\(resetLabel(window))" } ?? resetLabel(window))
    }

    private func balanceView(_ record: UsageRecord) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text(record.service.title).font(.system(size: compact ? 9 : 12, weight: .medium))
                if record.source == .manual && record.balance != nil {
                    Text("手動").font(.system(size: 8)).foregroundStyle(UsagePalette.muted)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(record.balance.map { String(format: $0.rounded() == $0 ? "%.0f" : "%.1f", $0) } ?? "—")
                    .font(.system(size: compact ? 16 : 22, weight: .semibold, design: .rounded)).monospacedDigit()
                Text(record.balanceUnit).font(.system(size: 9)).foregroundStyle(UsagePalette.muted)
                Spacer(minLength: 0)
            }
            if record.service == .colab {
                Text("残りの計算ユニット").font(.system(size: compact ? 8 : 10)).foregroundStyle(UsagePalette.muted)
            }
            if !compact { Text(age(record)).font(.system(size: 9)).foregroundStyle(record.isStale(at: now) ? .orange : UsagePalette.muted) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func resetLabel(_ window: QuotaWindow?) -> String {
        guard let window else { return "未取得 / 対象外" }
        guard let reset = window.resetsAt else { return "回復時刻は不明" }
        let seconds = reset.timeIntervalSince(now)
        guard seconds > 0 else { return "回復後の再取得待ち" }
        let minutes = Int(ceil(seconds / 60))
        if minutes >= 1440 { return "あと\(minutes / 1440)日\((minutes % 1440) / 60)時間" }
        if minutes >= 60 { return "あと\(minutes / 60)時間\(minutes % 60)分" }
        return "あと\(minutes)分"
    }

    private func age(_ record: UsageRecord) -> String {
        guard let observed = record.observedAt else { return "未取得" }
        let minutes = max(0, Int(now.timeIntervalSince(observed) / 60))
        if minutes < 1 { return "たった今" }
        if minutes < 60 { return "\(minutes)分前" }
        if minutes < 1440 { return "\(minutes / 60)時間前" }
        return "\(minutes / 1440)日前"
    }
}
