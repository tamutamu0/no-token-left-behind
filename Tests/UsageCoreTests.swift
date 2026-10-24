import XCTest
@testable import UsageCore

final class UsageCoreTests: XCTestCase {
    func testConfirmedAllocationSurvivesSyncAndInvalidBasisIsRejected() throws {
        let now = Date()
        let record = UsageRecord(service: .colab, source: .colabCli, observedAt: now, fiveHour: nil, weekly: nil,
                                 balance: 160.5, balanceAllocation: .init(total: 200, basis: .confirmedInitialGrant))
        let snapshot = UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [record])
        XCTAssertEqual(try UsageSnapshot.decode(snapshot.encoded()).record(.colab).balanceAllocation?.total, 200)
        for total in [0.0, 150, Double.nan] {
            var invalid = record; invalid.balanceAllocation = .init(total: total, basis: .confirmedInitialGrant)
            XCTAssertThrowsError(try UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [invalid]).validated())
        }
        var invalid = record; invalid.balanceAllocation = .init(total: 200, basis: .demo)
        XCTAssertThrowsError(try UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [invalid]).validated())
    }

    func testUnknownQuotaNeverBecomesFull() throws {
        let snapshot = UsageSnapshot.empty
        XCTAssertNil(snapshot.record(.claude).fiveHour)
        XCTAssertNil(snapshot.record(.antigravity).weekly)
        XCTAssertNil(snapshot.record(.colab).balance)
    }

    func testPassingResetDoesNotFabricate100Percent() {
        let now = Date()
        let window = QuotaWindow(usedPercent: 100, resetsAt: now.addingTimeInterval(-1))
        XCTAssertNil(window.remaining(at: now))
        XCTAssertEqual(QuotaWindow(usedPercent: 0, resetsAt: nil).remaining(at: now), 100)
    }

    func testRejectsInvalidPercentDuplicateServicesAndMissingObservation() throws {
        let now = Date()
        func snapshot(_ rows: [UsageRecord]) -> UsageSnapshot {
            UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: rows)
        }
        let invalid = UsageRecord(service: .claude, source: .claudeStatusline, observedAt: now,
                                  fiveHour: .init(usedPercent: 101, resetsAt: nil), weekly: nil, balance: nil)
        XCTAssertThrowsError(try snapshot([invalid]).validated())
        let duplicate = UsageRecord.empty(.claude)
        XCTAssertThrowsError(try snapshot([duplicate, duplicate]).validated())
        let missing = UsageRecord(service: .claude, source: .claudeStatusline, observedAt: nil,
                                  fiveHour: .init(usedPercent: 10, resetsAt: nil), weekly: nil, balance: nil)
        XCTAssertThrowsError(try snapshot([missing]).validated())
    }

    func testRejectsFutureObservationAndMixingCreditsWithRateWindows() {
        let now = Date()
        let future = UsageRecord(service: .codex, source: .codexAppServer, observedAt: now.addingTimeInterval(3600),
                                 fiveHour: nil, weekly: nil, balance: nil)
        XCTAssertThrowsError(try UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [future]).validated())
        let colab = UsageRecord(service: .colab, source: .manual, observedAt: now,
                                fiveHour: .init(usedPercent: 10, resetsAt: nil), weekly: nil, balance: 100)
        XCTAssertThrowsError(try UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [colab]).validated())
    }

    func testRejectsMixingDemoAndLive() {
        let demo = UsageSnapshot.demo()
        XCTAssertThrowsError(try UsageSnapshot(version: 1, generatedAt: Date(), isDemo: false, records: demo.records).validated())
    }

    func testReencodingDropsUnrecognizedPayloadFields() throws {
        let now = Date().timeIntervalSince1970
        let input = """
        {"version":1,"generatedAt":\(now),"isDemo":false,"accessToken":"fixture-secret",
         "records":[{"service":"claude","source":"manual","observedAt":\(now),"fiveHour":null,
         "weekly":null,"balance":null,"email":"fixture@example.invalid"}]}
        """
        let data = try UsageSnapshot.decode(Data(input.utf8)).encoded()
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("fixture-secret"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("email"))
    }

    func testResetCreditsSurviveOnlyOnTheOfficialCodexRecord() throws {
        let now = Date().timeIntervalSince1970
        func snapshot(_ service: String, _ source: String, _ credits: String) -> Data {
            Data("""
            {"version":1,"generatedAt":\(now),"isDemo":false,"records":[{"service":"\(service)","source":"\(source)",
             "observedAt":\(now),"weekly":{"usedPercent":10,"resetsAt":\(now + 60)},"resetCredits":\(credits)}]}
            """.utf8)
        }
        let ok = try UsageSnapshot.decode(snapshot("codex", "codexAppServer", #"{"count":2,"nextExpiresAt":\#(now + 86400),"id":"fixture-secret"}"#))
        XCTAssertEqual(ok.record(.codex).resetCredits?.count, 2)
        XCTAssertFalse(String(decoding: try ok.encoded(), as: UTF8.self).contains("fixture-secret"))
        XCTAssertThrowsError(try UsageSnapshot.decode(snapshot("claude", "claudeCli", #"{"count":1,"nextExpiresAt":null}"#)))
        XCTAssertThrowsError(try UsageSnapshot.decode(snapshot("codex", "codexAppServer", #"{"count":100,"nextExpiresAt":null}"#)))
        XCTAssertThrowsError(try UsageSnapshot.decode(snapshot("codex", "codexAppServer", #"{"count":0,"nextExpiresAt":\#(now + 10)}"#)))
        XCTAssertNotNil(UsageSnapshot.demo().record(.codex).resetCredits)
    }

    func testRejectsPublicPairingAndWeakKeys() {
        let key = Data(repeating: 17, count: 32).base64EncodedString()
        for host in ["8.8.8.8", "example.com", "100.63.1.1", "192.168.1.256", "127.0.0.1", "10.1.2.3/", "10.1.2.3\n"] {
            XCTAssertThrowsError(try Pairing(host: host, port: 49731, key: key).validated(), host)
        }
        for host in ["100.64.0.1", "100.127.255.254", "192.168.1.2", "172.16.0.1", "10.0.0.1"] {
            XCTAssertNoThrow(try Pairing(host: host, port: 49731, key: key).validated())
        }
        XCTAssertThrowsError(try Pairing(host: "10.0.0.1", port: 49731, key: "short").validated())
    }

    func testRejectsOversizedPayload() {
        XCTAssertThrowsError(try UsageSnapshot.decode(Data(repeating: 32, count: UsageSnapshot.maxBytes + 1)))
    }

    func testAgeUsesObservationRatherThanLastSync() throws {
        let now = Date()
        let old = UsageRecord(service: .colab, source: .manual, observedAt: now.addingTimeInterval(-3600),
                              fiveHour: nil, weekly: nil, balance: 12)
        let recentlySynced = UsageSnapshot(version: 1, generatedAt: now, isDemo: false, records: [old])
        XCTAssertTrue(recentlySynced.record(.colab).isStale(at: now))
    }

    func testTLSAcceptsMatchingKeyAndRejectsDifferentKey() async throws {
        let ready = expectation(description: "private listener ready")
        let key = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
        let port = UInt16.random(in: 52000...58000)
        let snapshot = UsageSnapshot.demo(at: Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970)))
        let server = SnapshotServer { try snapshot.encoded() }
        server.stateChanged = { text in if text == String(localized: "Waiting for connections") { ready.fulfill() } }
        try server.start(host: "127.0.0.1", port: port, key: key)
        defer { server.stop() }
        await fulfillment(of: [ready], timeout: 5)
        let pairing = Pairing(host: "127.0.0.1", port: port, key: key.base64EncodedString())
        let result = try await SnapshotClient().fetch(pairing, allowLoopback: true)
        XCTAssertEqual(result.records, snapshot.records)
        let wrongKey = Data(repeating: 0, count: 32)
        do {
            _ = try await SnapshotClient().fetch(Pairing(host: "127.0.0.1", port: port, key: wrongKey.base64EncodedString()), allowLoopback: true)
            XCTFail("wrong key must not receive quota data")
        } catch { /* Expected: no plaintext or unauthenticated fallback. */ }
    }
}
