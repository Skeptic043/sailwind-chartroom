import Foundation

/// Discovers importable Scrambled Seas worlds and remembered chart files on macOS, including inside
/// CrossOver, Whisky and Heroic prefixes where Sailwind runs.
public enum ImportFiles {
    public struct Entry: Equatable {
        public let url: URL
        public let name: String
        public let place: String
        public let modified: Date
    }

    private static let maxEntries = 25
    private static let ignoredJson: Set<String> = [
        "workspace.json", "workspace.previous.json", "devices.json", "window.json", "settings.json", "config.json"
    ]
    private static let prefixRoots = [
        "Library/Application Support/CrossOver/Bottles",
        "Library/Containers/com.isaacmarovitz.Whisky/Bottles",
        "Games/Heroic/Prefixes"
    ]

    public static func discover(home: URL, lastImportFolder: URL? = nil, fileManager: FileManager = .default) -> [Entry] {
        var found: [Entry] = []
        var seen: Set<String> = []

        func add(_ file: URL, place: String) {
            let key = file.standardizedFileURL.path
            guard seen.insert(key).inserted else { return }
            guard let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  let date = values.contentModificationDate else { return }
            found.append(Entry(url: file, name: file.lastPathComponent, place: place, modified: date))
        }

        for (pluginsRoot, place) in pluginRoots(home: home, fileManager: fileManager) {
            for dir in candidateDirs(in: pluginsRoot, fileManager: fileManager) {
                for file in children(of: dir, fileManager)
                where file.lastPathComponent.lowercased().hasPrefix("scramble_") && file.pathExtension.lowercased() == "xml" {
                    add(file, place: place)
                }
            }
        }

        if let folder = lastImportFolder {
            let place = folder.lastPathComponent.isEmpty ? "Last folder" : folder.lastPathComponent
            for file in children(of: folder, fileManager) {
                let ext = file.pathExtension.lowercased()
                let lower = file.lastPathComponent.lowercased()
                if ext == "xml" {
                    add(file, place: place)
                } else if ext == "json", !ignoredJson.contains(lower), !lower.hasSuffix(".meta.json") {
                    add(file, place: place)
                }
            }
        }

        found.sort { $0.modified > $1.modified }
        return Array(found.prefix(maxEntries))
    }

    private static func pluginRoots(home: URL, fileManager: FileManager) -> [(URL, String)] {
        var roots: [(URL, String)] = []
        for root in prefixRoots {
            for prefix in children(of: home.appendingPathComponent(root, isDirectory: true), fileManager) {
                for candidate in [prefix] + children(of: prefix, fileManager) {
                    let place = candidate.lastPathComponent
                    let driveC = candidate.appendingPathComponent("drive_c", isDirectory: true)
                    roots.append((driveC.appendingPathComponent("Program Files (x86)/Steam/steamapps/common/Sailwind/BepInEx/plugins", isDirectory: true), place))
                    roots.append((driveC.appendingPathComponent("Program Files/Steam/steamapps/common/Sailwind/BepInEx/plugins", isDirectory: true), place))
                    let users = driveC.appendingPathComponent("users", isDirectory: true)
                    for user in children(of: users, fileManager) {
                        let packs = user.appendingPathComponent("AppData/Local/SailwindModSynchronizer/packs", isDirectory: true)
                        for pack in children(of: packs, fileManager) {
                            roots.append((pack.appendingPathComponent("instance/BepInEx/plugins", isDirectory: true), "\(place) · \(pack.lastPathComponent)"))
                            roots.append((pack.appendingPathComponent("BepInEx/plugins", isDirectory: true), "\(place) · \(pack.lastPathComponent)"))
                        }
                        for manager in ["Thunderstore Mod Manager/DataFolder/Sailwind/profiles", "r2modmanPlus-local/Sailwind/profiles"] {
                            let profiles = user.appendingPathComponent("AppData/Roaming/\(manager)", isDirectory: true)
                            for profile in children(of: profiles, fileManager) {
                                roots.append((profile.appendingPathComponent("BepInEx/plugins", isDirectory: true), "\(place) · \(profile.lastPathComponent)"))
                            }
                        }
                    }
                }
            }
        }
        return roots
    }

    private static func candidateDirs(in pluginsRoot: URL, fileManager: FileManager) -> [URL] {
        var dirs = [pluginsRoot]
        for child in children(of: pluginsRoot, fileManager) {
            let normalized = child.lastPathComponent.lowercased().filter { $0.isLetter || $0.isNumber }
            if normalized.contains("scrambledseas") { dirs.append(child) }
        }
        return dirs
    }

    private static func children(of folder: URL, _ fileManager: FileManager) -> [URL] {
        (try? fileManager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey], options: [.skipsHiddenFiles])) ?? []
    }
}
