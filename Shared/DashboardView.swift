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
                Text(snapshot.isDemo ? String(localized: "AI Usage · DEMO") : String(localized: "AI Usage")).font(.system(size: 11, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("5-hour").frame(width: 78, alignment: .leading)
                Text("Weekly").frame(width: 78, alignment: .leading)
            }.font(.system(size: 9)).foregroundStyle(UsagePalette.muted)
            ForEach([ServiceID.claude, .codex, .antigravity]) { id in
                let record = snapshot.record(id)
                HStack(spacing: 4) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(id.title).font(.system(size: 11, weight: .semibold)).foregroundStyle(UsagePalette.tint(id))
                        Text(record.source == .manual && record.observedAt != nil ? String(localized: "Manual · \(age(record))") : age(record))
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
            Text(snapshot.isDemo ? String(localized: "Sample values for preview") : syncFailed ? String(localized: "Mac offline · last values") : String(localized: "Each row shows when it was observed"))
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
            Text("Left").foregroundStyle(UsagePalette.muted)
            Text(record.balance.map { String(format: $0.rounded() == $0 ? "%.0f" : "%.1f", $0) } ?? "—")
                .monospacedDigit()
            if record.service == .colab { Text("CU").font(.system(size: 8)).foregroundStyle(UsagePalette.muted) }
            if record.source == .manual && record.balance != nil { Text("Manual").font(.system(size: 7)).foregroundStyle(.orange) }
            if record.observedAt != nil && record.isStale(at: now) { Text(age(record)).font(.system(size: 7)).foregroundStyle(.orange) }
        }
    }

    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: dense ? 8 : 16) {
            HStack {
                Image(systemName: "circle.hexagongrid.fill").foregroundStyle(UsagePalette.tint(.codex))
                Text("AI Usage").font(.system(size: dense ? 16 : 19, weight: .semibold))
                Spacer()
                Text(snapshot.isDemo ? String(localized: "DEMO · sample values") : "PRIVATE")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(snapshot.isDemo ? .yellow : UsagePalette.muted)
            }
            HStack {
                Text("Left / resets in").frame(maxWidth: .infinity, alignment: .leading)
                Text("5-hour").frame(width: compact ? 80 : 105, alignment: .leading)
                Text("Weekly").frame(width: compact ? 80 : 105, alignment: .leading)
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
                if snapshot.isDemo { Text("Preview only. These are not your real numbers.") }
                else if snapshot.records.allSatisfy({ $0.observedAt == nil }) { Text("Connect to your Mac to show usage") }
                else {
                    Text(syncFailed ? String(localized: "Mac offline · last values") : String(localized: "Each service keeps its own observation time"))
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
                Text(record.observedAt == nil ? String(localized: "No data") : record.source == .manual ? String(localized: "Manual · \(age(record))") : age(record))
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
        .accessibilityLabel(remaining.map { String(localized: "\(Int($0)) percent left, \(resetLabel(window))") } ?? resetLabel(window))
    }

    private func balanceView(_ record: UsageRecord) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text(record.service.title).font(.system(size: compact ? 9 : 12, weight: .medium))
                if record.source == .manual && record.balance != nil {
                    Text("Manual").font(.system(size: 8)).foregroundStyle(UsagePalette.muted)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(record.balance.map { String(format: $0.rounded() == $0 ? "%.0f" : "%.1f", $0) } ?? "—")
                    .font(.system(size: compact ? 16 : 22, weight: .semibold, design: .rounded)).monospacedDigit()
                Text(record.balanceUnit).font(.system(size: 9)).foregroundStyle(UsagePalette.muted)
                Spacer(minLength: 0)
            }
            if record.service == .colab {
                Text("Compute units left").font(.system(size: compact ? 8 : 10)).foregroundStyle(UsagePalette.muted)
            }
            if !compact { Text(age(record)).font(.system(size: 9)).foregroundStyle(record.isStale(at: now) ? .orange : UsagePalette.muted) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func resetLabel(_ window: QuotaWindow?) -> String {
        guard let window else { return String(localized: "No data / not in plan") }
        guard let reset = window.resetsAt else { return String(localized: "Reset time unknown") }
        let seconds = reset.timeIntervalSince(now)
        guard seconds > 0 else { return String(localized: "Awaiting refresh after reset") }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = seconds >= 86400 ? [.day, .hour] : [.hour, .minute]
        formatter.maximumUnitCount = 2
        let text = formatter.string(from: ceil(seconds / 60) * 60) ?? ""
        return String(localized: "in \(text)")
    }

    private func age(_ record: UsageRecord) -> String {
        guard let observed = record.observedAt else { return String(localized: "No data") }
        if now.timeIntervalSince(observed) < 60 { return String(localized: "just now") }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: observed, relativeTo: now)
    }
}
