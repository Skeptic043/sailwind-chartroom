import Foundation

/// Where reading a Coordinate Viewer file stopped, and the day in force there.
/// The same rules as TrackTail in desktop/TrackFollower.cs.
public struct TrackTail: Equatable {
    public var offset: UInt64
    public var day: String?

    public static let start = TrackTail(offset: 0, day: nil)

    public init(offset: UInt64, day: String?) {
        self.offset = offset
        self.day = day
    }

    /// The whole lines in `bytes`, which are the file from `from.offset` on, led by the day in force if
    /// they do not start with one. A partly written last line waits for the next read.
    public static func lines(in bytes: Data, from: TrackTail) -> (text: String, next: TrackTail) {
        guard let last = bytes.lastIndex(of: UInt8(ascii: "\n")) else { return ("", from) }
        let end = bytes.distance(from: bytes.startIndex, to: last) + 1
        let whole = String(decoding: bytes.prefix(end), as: UTF8.self)
        var day = from.day
        var text = ""
        // isNewline, as a Windows line end is one Character in Swift and never equals "\n".
        for raw in whole.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            if isDayLine(line) {
                day = line
            } else if text.isEmpty, let day {
                text += day + "\n"
            }
            text += line + "\n"
        }
        return (text, TrackTail(offset: from.offset + UInt64(end), day: day))
    }

    /// The last position in `text` with the day before it, or nil.
    public static func lastPosition(_ text: String) -> String? {
        var day: String?
        var last: String?
        for line in text.split(whereSeparator: \.isNewline).map(String.init) {
            if isDayLine(line) { day = line } else { last = line }
        }
        guard let last else { return nil }
        return day.map { "\($0)\n\(last)\n" } ?? "\(last)\n"
    }

    private static func isDayLine(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("day")
    }
}

/// Follows a Coordinate Viewer file while the game appends to it. The system reports each write and
/// only the bytes added since the last read are read, so following costs nothing between positions.
/// The macOS counterpart of TrackFollower in desktop/TrackFollower.cs.
public final class TrackFollower {
    public let url: URL
    private let onText: (String) -> Void
    // One queue reads and reports, so runs of lines arrive in file order and never overlap.
    private let queue = DispatchQueue(label: "Sailwind Chartroom track")
    private var source: DispatchSourceFileSystemObject?
    private var tail = TrackTail.start
    private var stopped = false

    /// `onText` is called on a background queue with whole lines, each run led by its Day line, and
    /// never after `stop()` returns.
    public init(url: URL, onText: @escaping (String) -> Void) throws {
        self.url = url
        self.onText = onText
        try queue.sync {
            // Watching starts before the first read, so a position written meanwhile is read next.
            try watch()
            // The newest position shows at once; the rest of the file is already on the chart or was left out.
            if let latest = TrackTail.lastPosition(readNew()) { onText(latest) }
        }
    }

    public func stop() {
        queue.sync {
            stopped = true
            source?.cancel()
            source = nil
        }
    }

    private func watch() throws {
        let descriptor = open(url.path, O_EVTONLY)
        guard descriptor >= 0 else { throw CocoaError(.fileReadNoSuchFile, userInfo: [NSFilePathErrorKey: url.path]) }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .extend, .delete, .rename], queue: queue)
        source.setEventHandler { [weak self] in self?.changed() }
        source.setCancelHandler { close(descriptor) }
        self.source = source
        source.resume()
    }

    private func changed() {
        guard !stopped, let source else { return }
        // A file that was replaced is watched again by its name.
        if !source.data.intersection([.delete, .rename]).isEmpty {
            source.cancel()
            self.source = nil
            try? watch()
        }
        let text = readNew()
        if !text.isEmpty { onText(text) }
    }

    // A shorter file, as when a save slot's file is replaced, is read again from the start.
    private func readNew() -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
        defer { try? handle.close() }
        var from = tail
        if let size = try? handle.seekToEnd(), size < from.offset { from = .start }
        guard (try? handle.seek(toOffset: from.offset)) != nil else { return "" }
        let bytes = (try? handle.readToEnd()) ?? Data()
        let (text, next) = TrackTail.lines(in: bytes, from: from)
        tail = next
        return text
    }
}
