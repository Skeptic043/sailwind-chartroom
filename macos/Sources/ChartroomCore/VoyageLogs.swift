import Foundation

/// Where Voyage Recorder writes its logs. Sailwind is a Windows game, so on a Mac it usually runs in a
/// compatibility layer, which keeps the game's Windows data folder inside its prefix.
/// The same rules as VoyageLogs in desktop/TrackFollower.cs.
public enum VoyageLogs {
    /// One save slot's log, where it was found and when it was last written.
    public struct Log: Equatable {
        public let url: URL
        public let modified: Date
        /// The compatibility layer's bottle or prefix name, or "Mac" for a native build's folder.
        public let place: String
    }

    private static let gameFolder = "Raw Lion Workshop/Sailwind/Voyage Recorder"

    // Folders that hold compatibility-layer prefixes (CrossOver and Whisky bottles, Heroic prefixes).
    // A prefix's drive_c sits directly inside one of these or one folder deeper.
    private static let prefixRoots = [
        "Library/Application Support/CrossOver/Bottles",
        "Library/Containers/com.isaacmarovitz.Whisky/Bottles",
        "Games/Heroic/Prefixes"
    ]

    /// A native build's data folder first, then the Windows data folder inside each prefix found, each
    /// with the name to show for it.
    public static func candidateFolders(home: URL, fileManager: FileManager = .default) -> [(folder: URL, place: String)] {
        var folders: [(folder: URL, place: String)] = [(home.appendingPathComponent("Library/Application Support/\(gameFolder)", isDirectory: true), "Mac")]
        for root in prefixRoots {
            for prefix in children(of: home.appendingPathComponent(root, isDirectory: true), fileManager) {
                for candidate in [prefix] + children(of: prefix, fileManager) {
                    let users = candidate.appendingPathComponent("drive_c/users", isDirectory: true)
                    for user in children(of: users, fileManager) {
                        folders.append((user.appendingPathComponent("AppData/LocalLow/\(gameFolder)", isDirectory: true), candidate.lastPathComponent))
                    }
                }
            }
        }
        return folders
    }

    /// Every save slot log in `folders`, most recently written first.
    public static func all(in folders: [(folder: URL, place: String)], fileManager: FileManager = .default) -> [Log] {
        var logs: [Log] = []
        for (folder, place) in folders {
            for file in children(of: folder, fileManager)
            where file.lastPathComponent.hasPrefix("slot") && file.pathExtension == "jsonl" {
                guard let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate else { continue }
                logs.append(Log(url: file, modified: date, place: place))
            }
        }
        return logs.sorted { $0.modified > $1.modified }
    }

    private static func children(of folder: URL, _ fileManager: FileManager) -> [URL] {
        (try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])) ?? []
    }
}
