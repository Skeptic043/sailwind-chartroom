import Foundation

/// Which update channels a build follows. Release candidates also receive later candidates.
public enum UpdateChannels {
    public static func allowed(forVersion version: String) -> Set<String> {
        version.contains("-rc") ? ["rc"] : []
    }
}

/// A small text log that never grows past a fixed size. It records host and page errors, never chart contents.
public final class BoundedLog {
    private let file: URL
    private let limit: Int

    public init(file: URL, limit: Int = 512 * 1024) {
        self.file = file
        self.limit = limit
    }

    public func write(_ message: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        let line = Data("\(stamp) \(message.prefix(2000))\n".utf8)
        let files = FileManager.default
        try? files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        var contents = (try? Data(contentsOf: file)) ?? Data()
        contents.append(line)
        // Keeps the newer half once the file is full.
        if contents.count > limit { contents = contents.suffix(limit / 2) }
        try? contents.write(to: file, options: .atomic)
    }
}
