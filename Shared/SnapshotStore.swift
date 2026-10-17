import Foundation
import Security

enum SnapshotStore {
    static var directory: URL {
        #if os(iOS)
        let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupIdentifier") as? String ?? "group.jp.local.aiusage"
        // A missing App Group must fail when saving; never silently use unshared storage.
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
            ?? URL(fileURLWithPath: "/missing-app-group", isDirectory: true)
        #else
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AIUsage", isDirectory: true)
        #endif
    }
    static var snapshotURL: URL { directory.appendingPathComponent("snapshot.json") }
    static func load() -> UsageSnapshot {
        guard let data = try? Data(contentsOf: snapshotURL), let snapshot = try? UsageSnapshot.decode(data) else { return .empty }
        return snapshot
    }
    static func save(_ snapshot: UsageSnapshot) throws {
        let data = try snapshot.encoded()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        #if os(iOS)
        try data.write(to: snapshotURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: snapshotURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: snapshotURL.path)
        #endif
    }
}

enum PairingStore {
    static var query: [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                              kSecAttrService as String: "AIUsage.private-bridge",
                              kSecAttrAccount as String: "pairing",
                              kSecAttrSynchronizable as String: false]
        #if os(iOS)
        if let group = Bundle.main.object(forInfoDictionaryKey: "SharedKeychainGroup") as? String {
            q[kSecAttrAccessGroup as String] = group
        }
        #endif
        return q
    }
    static func load() -> Pairing? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data).validated()
    }
    static func save(_ pairing: Pairing) throws {
        _ = try pairing.validated()
        let data = try JSONEncoder().encode(pairing)
        let update: [String: Any] = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if result == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw UsageError.storage }
        } else if result != errSecSuccess { throw UsageError.storage }
    }
    static func delete() throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw UsageError.storage }
    }
}
