import Foundation
import Network
import Security

enum PrivateTLS {
    static func parameters(key: Data) -> NWParameters {
        precondition(key.count == 32)
        let tls = NWProtocolTLS.Options()
        let psk = key.withUnsafeBytes { DispatchData(bytes: $0) }
        let identity = Data("ai-usage-v1".utf8).withUnsafeBytes { DispatchData(bytes: $0) }
        sec_protocol_options_add_pre_shared_key(tls.securityProtocolOptions, psk as __DispatchData, identity as __DispatchData)
        sec_protocol_options_append_tls_ciphersuite(tls.securityProtocolOptions,
            tls_ciphersuite_t(rawValue: TLS_PSK_WITH_AES_128_GCM_SHA256)!)
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        // No trust-bypass callback and no plaintext fallback.
        return parameters
    }
}

final class SnapshotClient: @unchecked Sendable {
    private let queue = DispatchQueue(label: "AIUsage.client")
    private var connection: NWConnection?
    private var timeout: DispatchWorkItem?
    private var continuation: CheckedContinuation<UsageSnapshot, Error>?
    private var received = Data()

    func fetch(_ pairing: Pairing, allowLoopback: Bool = false) async throws -> UsageSnapshot {
        _ = try pairing.validated(allowLoopback: allowLoopback)
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard self.continuation == nil else { continuation.resume(throwing: UsageError.connection); return }
                self.continuation = continuation; self.received = Data()
                let c = NWConnection(host: NWEndpoint.Host(pairing.host), port: NWEndpoint.Port(rawValue: pairing.port)!,
                                     using: PrivateTLS.parameters(key: Data(base64Encoded: pairing.key)!))
                self.connection = c
                c.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        c.send(content: Data("snapshot-v1\n".utf8), completion: .contentProcessed { error in
                            if error != nil { self.finish(.failure(UsageError.connection)) }
                            else { self.receive(c) }
                        })
                    case .failed, .cancelled: self.finish(.failure(UsageError.connection))
                    default: break
                    }
                }
                let deadline = DispatchWorkItem { self.finish(.failure(UsageError.timeout)) }
                self.timeout = deadline; self.queue.asyncAfter(deadline: .now() + 8, execute: deadline)
                c.start(queue: self.queue)
            }
        }
    }

    private func receive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: UsageSnapshot.maxBytes + 1) { data, _, complete, error in
            if let data { self.received.append(data) }
            if self.received.count > UsageSnapshot.maxBytes { self.finish(.failure(UsageError.invalidData)); return }
            if error != nil { self.finish(.failure(UsageError.connection)); return }
            if complete {
                do { self.finish(.success(try UsageSnapshot.decode(self.received))) }
                catch { self.finish(.failure(UsageError.invalidData)) }
            } else { self.receive(c) }
        }
    }

    private func finish(_ result: Result<UsageSnapshot, Error>) {
        guard let continuation else { return }
        self.continuation = nil; timeout?.cancel(); timeout = nil
        connection?.stateUpdateHandler = nil; connection?.cancel(); connection = nil
        continuation.resume(with: result)
    }
}

final class SnapshotServer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "AIUsage.server")
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private let payload: () throws -> Data
    var stateChanged: ((String) -> Void)?

    init(payload: @escaping () throws -> Data) { self.payload = payload }
    func start(host: String, port: UInt16, key: Data) throws {
        let parameters = PrivateTLS.parameters(key: key)
        // Bind only to the chosen private interface (Tailscale IP for remote use).
        parameters.requiredLocalEndpoint = .hostPort(host: .init(host), port: .init(rawValue: port)!)
        let l = try NWListener(using: parameters)
        listener = l
        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: self?.stateChanged?(String(localized: "Waiting for connections"))
            case .failed: self?.stateChanged?(String(localized: "Can’t start listening. Check the IP address and your private network (e.g. Tailscale)."))
            default: break
            }
        }
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.start(queue: queue)
    }
    func stop() {
        queue.async {
            self.listener?.cancel(); self.listener = nil
            for c in self.connections.values { c.cancel() }
            self.connections.removeAll()
        }
    }
    private func accept(_ c: NWConnection) {
        guard connections.count < 4 else { c.cancel(); return }
        let id = UUID(); connections[id] = c
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in self?.close(id) }
        var request = Data()
        func receive() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 64) { [weak self] data, _, complete, error in
                guard let self else { c.cancel(); return }
                if let data { request.append(data) }
                guard error == nil, request.count <= 32 else { self.close(id); return }
                if request == Data("snapshot-v1\n".utf8) {
                    guard let bytes = try? self.payload(), bytes.count <= UsageSnapshot.maxBytes else { self.close(id); return }
                    c.send(content: bytes, contentContext: .finalMessage, isComplete: true,
                           completion: .contentProcessed { _ in self.close(id) })
                } else if request.contains(10) || complete { self.close(id) }
                else { receive() }
            }
        }
        c.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: receive()
            case .failed, .cancelled: self?.close(id)
            default: break
            }
        }
        c.start(queue: queue)
    }
    private func close(_ id: UUID) {
        connections[id]?.stateUpdateHandler = nil
        connections[id]?.cancel(); connections[id] = nil
    }
}
