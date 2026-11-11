import Foundation

/// Owns workspace.json on disk: startup read, the per-launch backup, and atomic saves.
/// The same files and behaviour as desktop/WorkspaceStore.cs.
public final class WorkspaceStore {
    public struct LoadResult {
        public let workspace: String?
        public let warnings: [String]
    }

    public struct SaveError: LocalizedError {
        let message: String
        public var errorDescription: String? { message }
    }

    public let folder: URL
    public var workspaceURL: URL { folder.appendingPathComponent("workspace.json") }
    public var backupURL: URL { folder.appendingPathComponent("workspace.previous.json") }

    /// False when an unreadable workspace could not be copied aside, so saving would destroy it.
    public private(set) var canSave = true

    public init(folder: URL) {
        self.folder = folder
    }

    /// Reads the saved workspace and refreshes the backup. A failed backup only warns. An unreadable
    /// workspace is copied aside, then the previous launch's backup takes its place when it is valid.
    public func load() -> LoadResult {
        let files = FileManager.default
        try? files.createDirectory(at: folder, withIntermediateDirectories: true)
        guard files.fileExists(atPath: workspaceURL.path) else { return LoadResult(workspace: nil, warnings: []) }

        let readError: String
        switch Self.readJSON(workspaceURL) {
        case .success(let text):
            var warnings: [String] = []
            do {
                // One copy per launch, so a bad session can always be rolled back by hand.
                try Data(text.utf8).write(to: backupURL, options: .atomic)
            } catch {
                warnings.append("Your charts opened normally, but this launch's backup copy could not be written:\n\(error.localizedDescription)")
            }
            return LoadResult(workspace: text, warnings: warnings)
        case .failure(let error):
            readError = error.localizedDescription
        }

        let stamp = DateFormatter()
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        stamp.locale = Locale(identifier: "en_US_POSIX")
        let unique = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let kept = folder.appendingPathComponent("workspace.unreadable-\(stamp.string(from: Date()))-\(unique).json")
        do {
            try files.copyItem(at: workspaceURL, to: kept)
        } catch {
            canSave = false
            return LoadResult(workspace: nil, warnings: ["Your saved charts could not be read:\n\(readError)\n\nChartroom also could not copy the file aside (\(error.localizedDescription)), so saving is turned off until you restart. Nothing has been changed at\n\(workspaceURL.path)"])
        }

        guard files.fileExists(atPath: backupURL.path), case .success(let backup) = Self.readJSON(backupURL) else {
            return LoadResult(workspace: nil, warnings: ["Your saved charts could not be read:\n\(readError)\n\nChartroom will start with an empty chart. The unreadable file was kept at\n\(kept.path)"])
        }
        var restored = ["Your saved charts could not be read:\n\(readError)\n\nChartroom opened the copy from your previous launch instead. The unreadable file was kept at\n\(kept.path)"]
        do {
            // The backup becomes the workspace again, so the next launch opens it too.
            try save(backup)
        } catch {
            restored.append("The previous launch's copy could not be written back as your charts file:\n\(error.localizedDescription)\n\nYour next change will try again.")
        }
        return LoadResult(workspace: backup, warnings: restored)
    }

    /// Writes through a temporary file so a crash mid-save never truncates the workspace.
    public func save(_ json: String) throws {
        guard canSave else {
            throw SaveError(message: "Saving is turned off because your unreadable charts file could not be copied aside. Restart Chartroom to try again.")
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let temporary = folder.appendingPathComponent("workspace.json.tmp")
        try Data(json.utf8).write(to: temporary)
        guard rename(temporary.path, workspaceURL.path) == 0 else {
            throw SaveError(message: String(cString: strerror(errno)))
        }
    }

    private static func readJSON(_ url: URL) -> Result<String, Error> {
        Result {
            let data = try Data(contentsOf: url)
            _ = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
            guard let text = String(data: data, encoding: .utf8) else { throw SaveError(message: "The file is not UTF-8 text.") }
            return text
        }
    }
}
