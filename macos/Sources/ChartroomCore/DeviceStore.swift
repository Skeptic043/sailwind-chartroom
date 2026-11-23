import CryptoKit
import Foundation
import Security

/// A phone or tablet paired with this Chartroom. Only a hash of its token is kept.
public struct Device: Codable, Equatable {
    public let id: String
    public var name: String
    public let tokenHash: String
    public let pairedAt: Date
    public var lastSeen: Date
}

/// Owns devices.json beside the workspace: whether devices on the player's network may connect, the paired
/// devices, and the one pairing code the player is showing, if any. The same rules as desktop/Lan/DeviceStore.cs.
/// Thread-safe, since connections arrive on the server's queue.
public final class DeviceStore {
    public static let codeAttempts = 5
    public static let codeLifetime: TimeInterval = 5 * 60
    private static let maxNameLength = 40

    private struct Saved: Codable {
        var enabled: Bool
        var devices: [Device]
    }

    private let lock = NSLock()
    private let url: URL
    private var enabled = false
    private var devices: [Device] = []
    private var pairing: (code: String, expires: Date, attempts: Int)?

    public init(folder: URL) {
        url = folder.appendingPathComponent("devices.json")
    }

    public var isEnabled: Bool { locked { enabled } }
    public var allDevices: [Device] { locked { devices } }
    /// Whether a pairing code is still waiting to be used.
    public var isPairing: Bool { locked { pairing != nil } }

    /// Reads devices.json. A missing or unreadable file means nothing is paired and the service is off.
    public func load() {
        locked {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            if let data = try? Data(contentsOf: url), let saved = try? decoder.decode(Saved.self, from: data) {
                enabled = saved.enabled
                devices = saved.devices.filter { !$0.id.isEmpty && $0.tokenHash.count == 64 }
            } else {
                enabled = false
                devices = []
            }
        }
    }

    public func setEnabled(_ value: Bool) throws {
        try locked {
            enabled = value
            if !value { pairing = nil }
            try save()
        }
    }

    /// A new six-digit code, replacing any earlier one.
    public func startPairing(now: Date = Date()) -> String {
        locked {
            let code = String(format: "%06d", Int(randomUInt32() % 1_000_000))
            pairing = (code, now.addingTimeInterval(Self.codeLifetime), 0)
            return code
        }
    }

    public func stopPairing() {
        locked { pairing = nil }
    }

    /// Pairs a new device when the code matches the one showing. The code works once, for its lifetime, and
    /// stops working after `codeAttempts` wrong tries. A device pairing again names its old token, whose entry
    /// it replaces. Returns the device and its token, or nil.
    public func pair(code: String, name: String, previousToken: String? = nil, now: Date = Date()) -> (device: Device, token: String)? {
        locked {
            guard enabled, let current = pairing else { return nil }
            if now > current.expires {
                pairing = nil
                return nil
            }
            guard Self.equal(current.code, code) else {
                pairing = current.attempts + 1 >= Self.codeAttempts ? nil : (current.code, current.expires, current.attempts + 1)
                return nil
            }
            pairing = nil
            if let previousToken, !previousToken.isEmpty {
                let old = Self.hash(previousToken)
                devices.removeAll { $0.tokenHash == old }
            }
            let token = Self.randomToken()
            let device = Device(id: "device-\(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: ""))",
                                name: Self.clean(name), tokenHash: Self.hash(token), pairedAt: now, lastSeen: now)
            devices.append(device)
            try? save()
            return (device, token)
        }
    }

    /// The paired device holding this token, or nil.
    public func authenticate(token: String) -> Device? {
        guard !token.isEmpty else { return nil }
        let hash = Self.hash(token)
        return locked {
            guard enabled else { return nil }
            return devices.first { Self.equal($0.tokenHash, hash) }
        }
    }

    public func rename(id: String, to name: String) {
        update(id) { $0.name = Self.clean(name) }
    }

    public func touch(id: String, now: Date = Date()) {
        update(id) { $0.lastSeen = now }
    }

    @discardableResult
    public func remove(id: String) -> Bool {
        locked {
            let before = devices.count
            devices.removeAll { $0.id == id }
            guard devices.count != before else { return false }
            try? save()
            return true
        }
    }

    private func update(_ id: String, _ change: (inout Device) -> Void) {
        locked {
            guard let index = devices.firstIndex(where: { $0.id == id }) else { return }
            change(&devices[index])
            try? save()
        }
    }

    // Called under the lock. Written atomically, like the workspace.
    private func save() throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(Saved(enabled: enabled, devices: devices)).write(to: url, options: .atomic)
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    static func hash(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02X", $0) }.joined()
    }

    // Compares without stopping at the first difference, so timing says nothing about a code or token.
    private static func equal(_ a: String, _ b: String) -> Bool {
        let left = Array(a.utf8), right = Array(b.utf8)
        guard left.count == right.count else { return false }
        return zip(left, right).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private static func clean(_ name: String) -> String {
        let clean = String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }).trimmingCharacters(in: .whitespaces)
        return clean.isEmpty ? "Device" : String(clean.prefix(maxNameLength))
    }

    private static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    }

    private func randomUInt32() -> UInt32 {
        var value: UInt32 = 0
        _ = withUnsafeMutableBytes(of: &value) { SecRandomCopyBytes(kSecRandomDefault, 4, $0.baseAddress!) }
        return value
    }
}
