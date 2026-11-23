import CryptoKit
import Foundation

/// An HTTP request's line and headers. The body is never read: only GET is served.
public struct LanRequest: Equatable {
    public let method: String
    public let path: String
    public let headers: [String: String]

    public func header(_ name: String) -> String? { headers[name.lowercased()] }

    /// Parses the bytes up to and including the blank line that ends the headers, or nil when they don't
    /// make a request this server answers.
    public static func parse(_ data: Data) -> LanRequest? {
        guard let text = String(data: data, encoding: .isoLatin1) else { return nil }
        let lines = text.components(separatedBy: "\r\n")
        let start = lines[0].split(separator: " ", omittingEmptySubsequences: false)
        guard start.count == 3, start[1].hasPrefix("/") else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let raw = String(start[1]).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
            .split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)[0]
        guard let path = String(raw).removingPercentEncoding, !path.contains("..") else { return nil }
        return LanRequest(method: String(start[0]), path: path, headers: headers)
    }

    /// The end of the headers in what has arrived so far, if it has.
    public static func headerEnd(in data: Data) -> Int? {
        data.range(of: Data("\r\n\r\n".utf8)).map { $0.upperBound }
    }

    public static func webSocketAccept(key: String) -> String {
        Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
    }
}

/// WebSocket frames as a server reads and writes them (RFC 6455). Browsers mask what they send; the server doesn't.
public enum WebSocketFrame {
    public static let text: UInt8 = 0x1
    public static let continuation: UInt8 = 0x0
    public static let close: UInt8 = 0x8
    public static let ping: UInt8 = 0x9
    public static let pong: UInt8 = 0xA

    /// One frame from the start of the buffer and how many bytes it used, or nil when it hasn't all arrived.
    /// Text split over several frames is joined by the caller; `fin` says whether this frame ends a message.
    public static func read(_ buffer: Data, limit: Int) throws -> (opcode: UInt8, fin: Bool, payload: Data, used: Int)? {
        let bytes = [UInt8](buffer.prefix(14))
        guard bytes.count >= 2 else { return nil }
        let fin = bytes[0] & 0x80 != 0
        let opcode = bytes[0] & 0x0F
        let masked = bytes[1] & 0x80 != 0
        var length = Int(bytes[1] & 0x7F)
        var offset = 2
        if length == 126 {
            guard bytes.count >= 4 else { return nil }
            length = Int(bytes[2]) << 8 | Int(bytes[3])
            offset = 4
        } else if length == 127 {
            guard bytes.count >= 10 else { return nil }
            var value: UInt64 = 0
            for index in 2..<10 { value = value << 8 | UInt64(bytes[index]) }
            guard value <= UInt64(limit) else { throw LanError.tooLarge }
            length = Int(value)
            offset = 10
        }
        guard length <= limit else { throw LanError.tooLarge }
        guard masked else { throw LanError.unmasked }
        guard bytes.count >= offset + 4 else { return nil }
        let mask = Array(bytes[offset..<offset + 4])
        offset += 4
        guard buffer.count >= offset + length else { return nil }
        let start = buffer.startIndex + offset
        var payload = [UInt8](buffer[start..<start + length])
        for index in payload.indices { payload[index] ^= mask[index % 4] }
        return (opcode, fin, Data(payload), offset + length)
    }

    /// An unmasked frame from the server.
    public static func encode(opcode: UInt8, payload: Data) -> Data {
        var frame = Data([0x80 | opcode])
        if payload.count < 126 {
            frame.append(UInt8(payload.count))
        } else if payload.count <= 0xFFFF {
            frame.append(126)
            frame.append(contentsOf: [UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)])
        } else {
            frame.append(127)
            frame.append(contentsOf: (0..<8).reversed().map { UInt8((UInt64(payload.count) >> (UInt64($0) * 8)) & 0xFF) })
        }
        frame.append(payload)
        return frame
    }
}

public enum LanError: Error {
    case tooLarge
    case unmasked
}

/// Which addresses may connect: IPv4 loopback, private (10/8, 172.16/12, 192.168/16) and link-local.
/// The same rule as LanServer.IsLocalNetwork in desktop/Lan/LanServer.cs.
public enum LanAddress {
    public static func isLocalNetwork(_ address: String) -> Bool {
        var text = address
        if text.lowercased().hasPrefix("::ffff:") { text = String(text.dropFirst(7)) }
        let parts = text.split(separator: ".").compactMap { UInt8($0) }
        guard parts.count == 4, text.split(separator: ".").count == 4 else { return false }
        return parts[0] == 127 || parts[0] == 10 || (parts[0] == 172 && (16...31).contains(parts[1]))
            || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 169 && parts[1] == 254)
    }

    /// Whether a Host header names this server by address rather than by a name a site could point here.
    public static func isAddressHost(_ host: String) -> Bool {
        guard let name = host.split(separator: ":", maxSplits: 1).first else { return false }
        return name.split(separator: ".").count == 4 && name.split(separator: ".").allSatisfy { UInt8($0) != nil }
    }
}
