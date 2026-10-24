import Foundation

enum ServiceID: String, Codable, CaseIterable, Identifiable {
    case claude, codex, antigravity, colab
    var id: String { rawValue }
    var title: String {
        switch self {
        case .claude: return "Claude"
        case .codex: return "Codex"
        case .antigravity: return "Antigravity"
        case .colab: return "Colab"
        }
    }
}

enum UsageSource: String, Codable {
    case claudeStatusline, claudeCli, codexAppServer, antigravityStatusline, antigravityCli, codexBar, colabCli, manual, demo
    var title: String {
        switch self {
        case .claudeStatusline: return String(localized: "Official status line")
        case .claudeCli: return String(localized: "Official Claude CLI")
        case .codexAppServer: return String(localized: "Official Codex CLI")
        case .antigravityStatusline: return String(localized: "Official status line")
        case .antigravityCli: return String(localized: "Official Antigravity CLI")
        case .codexBar: return String(localized: "CLI via CodexBar")
        case .colabCli: return String(localized: "Official Colab CLI")
        case .manual: return String(localized: "Manual entry")
        case .demo: return String(localized: "Demo")
        }
    }
}

struct QuotaWindow: Codable, Equatable {
    let usedPercent: Double
    let resetsAt: Date?

    func remaining(at now: Date) -> Double? {
        // Passing a reset time never proves a fresh quota was granted.
        if let resetsAt, resetsAt <= now { return nil }
        return 100 - usedPercent
    }
}

struct BalanceAllocation: Codable, Equatable {
    enum Basis: String, Codable { case confirmedInitialGrant, demo }
    let total: Double
    let basis: Basis
}

/// Banked Codex rate-limit resets: how many are usable and when the earliest one expires.
struct ResetCredits: Codable, Equatable {
    let count: Int
    let nextExpiresAt: Date?
}

struct UsageRecord: Codable, Identifiable, Equatable {
    let service: ServiceID
    let source: UsageSource
    let observedAt: Date?
    let fiveHour: QuotaWindow?
    let weekly: QuotaWindow?
    let balance: Double?
    var balanceAllocation: BalanceAllocation? = nil
    /// First observation showing the latest Colab grant (a balance rise), if one was seen.
    var lastGrantAt: Date? = nil
    var resetCredits: ResetCredits? = nil
    var id: String { service.id }
    var balanceUnit: String { "CU" }

    func isStale(at now: Date) -> Bool {
        guard let observedAt else { return true }
        return now.timeIntervalSince(observedAt) > 15 * 60
    }

    static func empty(_ service: ServiceID) -> UsageRecord {
        UsageRecord(service: service, source: .manual, observedAt: nil,
                    fiveHour: nil, weekly: nil, balance: nil)
    }
}

enum UsageError: LocalizedError {
    case invalidData, invalidPairing, connection, timeout, storage
    var errorDescription: String? {
        switch self {
        case .invalidData: return String(localized: "The usage data could not be verified.")
        case .invalidPairing: return String(localized: "Check the connection details. A private IP address and a 32-byte key are required.")
        case .connection: return String(localized: "Can’t reach the Mac. Check that it is awake and on the same private network (e.g. Tailscale).")
        case .timeout: return String(localized: "The connection timed out. Showing the last values.")
        case .storage: return String(localized: "Can’t save. Check the signing and App Group settings.")
        }
    }
}

struct UsageSnapshot: Codable, Equatable {
    let version: Int
    let generatedAt: Date
    let isDemo: Bool
    let records: [UsageRecord]

    enum CodingKeys: String, CodingKey { case version, generatedAt, isDemo, records }

    static let maxBytes = 16_384
    static var empty: UsageSnapshot {
        UsageSnapshot(version: 1, generatedAt: Date(), isDemo: false,
                      records: ServiceID.allCases.map(UsageRecord.empty))
    }

    static func demo(at now: Date = Date()) -> UsageSnapshot {
        let rows: [UsageRecord] = [
            UsageRecord(service: .claude, source: .demo, observedAt: now,
                        fiveHour: .init(usedPercent: 28, resetsAt: now.addingTimeInterval(7200)),
                        weekly: .init(usedPercent: 62, resetsAt: now.addingTimeInterval(259200)), balance: nil),
            UsageRecord(service: .codex, source: .demo, observedAt: now,
                        fiveHour: .init(usedPercent: 75, resetsAt: now.addingTimeInterval(3600)),
                        weekly: .init(usedPercent: 19, resetsAt: now.addingTimeInterval(432000)), balance: nil,
                        resetCredits: .init(count: 2, nextExpiresAt: now.addingTimeInterval(5 * 86400))),
            UsageRecord(service: .antigravity, source: .demo, observedAt: now,
                        fiveHour: .init(usedPercent: 10, resetsAt: now.addingTimeInterval(14400)),
                        weekly: .init(usedPercent: 36, resetsAt: now.addingTimeInterval(345600)), balance: nil),
            UsageRecord(service: .colab, source: .demo, observedAt: now, fiveHour: nil, weekly: nil, balance: 142.5,
                        balanceAllocation: .init(total: 200, basis: .demo)),
        ]
        return UsageSnapshot(version: 1, generatedAt: now, isDemo: true, records: rows)
    }

    func record(_ id: ServiceID) -> UsageRecord { records.first { $0.service == id } ?? .empty(id) }

    func validated(at now: Date = Date()) throws -> UsageSnapshot {
        guard version == 1, records.count <= ServiceID.allCases.count,
              Set(records.map(\.service)).count == records.count,
              generatedAt.timeIntervalSince1970.isFinite,
              generatedAt <= now.addingTimeInterval(60) else { throw UsageError.invalidData }
        for r in records {
            guard (r.source == .demo) == isDemo,
                  r.observedAt.map({ $0.timeIntervalSince1970.isFinite && $0 <= now.addingTimeInterval(60) }) ?? true,
                  r.balance.map({ $0.isFinite && $0 >= 0 && $0 <= 1e9 }) ?? true else { throw UsageError.invalidData }
            let isBalance = r.service == .colab
            guard !isBalance || (r.fiveHour == nil && r.weekly == nil),
                  isBalance || r.balance == nil else { throw UsageError.invalidData }
            if let allocation = r.balanceAllocation {
                guard r.service == .colab, allocation.total.isFinite, allocation.total > 0, allocation.total <= 1e9,
                      let balance = r.balance, balance <= allocation.total,
                      (allocation.basis == .demo) == isDemo,
                      r.source == (isDemo ? .demo : .colabCli) else { throw UsageError.invalidData }
            }
            if let grant = r.lastGrantAt {
                guard r.service == .colab, r.source == (isDemo ? .demo : .colabCli),
                      grant.timeIntervalSince1970.isFinite, grant.timeIntervalSince1970 > 0,
                      grant <= now.addingTimeInterval(60) else { throw UsageError.invalidData }
            }
            if let credits = r.resetCredits {
                guard r.service == .codex, r.source == (isDemo ? .demo : .codexAppServer), r.observedAt != nil,
                      (0...99).contains(credits.count), credits.count > 0 || credits.nextExpiresAt == nil,
                      credits.nextExpiresAt.map({ $0.timeIntervalSince1970.isFinite && $0.timeIntervalSince1970 > 0
                          && $0 <= now.addingTimeInterval(400 * 86400) }) ?? true else { throw UsageError.invalidData }
            }
            if r.fiveHour != nil || r.weekly != nil || r.balance != nil {
                guard r.observedAt != nil else { throw UsageError.invalidData }
            }
            for w in [r.fiveHour, r.weekly].compactMap({ $0 }) {
                guard w.usedPercent.isFinite, (0...100).contains(w.usedPercent),
                      w.resetsAt.map({ $0.timeIntervalSince1970.isFinite && $0.timeIntervalSince1970 > 0 }) ?? true else { throw UsageError.invalidData }
            }
        }
        return self
    }

    static func decode(_ data: Data) throws -> UsageSnapshot {
        guard data.count <= maxBytes else { throw UsageError.invalidData }
        let d = JSONDecoder(); d.dateDecodingStrategy = .secondsSince1970
        return try d.decode(UsageSnapshot.self, from: data).validated()
    }

    func encoded() throws -> Data {
        _ = try validated()
        let e = JSONEncoder(); e.dateEncodingStrategy = .secondsSince1970
        return try e.encode(self)
    }
}

struct Pairing: Codable, Equatable {
    let host: String
    let port: UInt16
    let key: String

    func validated(allowLoopback: Bool = false) throws -> Pairing {
        // IP literals avoid sending a PSK to a DNS-rebound/public endpoint.
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let a = UInt8(parts[0]), let b = UInt8(parts[1]),
              UInt8(parts[2]) != nil, UInt8(parts[3]) != nil,
              (a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168)
               || (a == 100 && (64...127).contains(b)) || (allowLoopback && a == 127)),
              port >= 1024, let bytes = Data(base64Encoded: key), bytes.count == 32 else { throw UsageError.invalidPairing }
        return self
    }
}

/// Records for services this build does not know (older or newer collectors) are skipped,
/// so a retired or future service never makes the whole snapshot unreadable.
private struct KnownServiceRecord: Decodable {
    let record: UsageRecord?
    private enum Key: String, CodingKey { case service }
    init(from decoder: Decoder) throws {
        let service = try decoder.container(keyedBy: Key.self).decode(String.self, forKey: .service)
        record = ServiceID(rawValue: service) == nil ? nil : try UsageRecord(from: decoder)
    }
}

extension UsageSnapshot {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(version: try c.decode(Int.self, forKey: .version),
                  generatedAt: try c.decode(Date.self, forKey: .generatedAt),
                  isDemo: try c.decode(Bool.self, forKey: .isDemo),
                  records: try c.decode([KnownServiceRecord].self, forKey: .records).compactMap(\.record))
    }
}
