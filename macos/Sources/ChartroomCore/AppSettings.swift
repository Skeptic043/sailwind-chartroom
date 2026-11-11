import Foundation

/// One chart tool's shortcut as the page sends it to the Settings window.
public struct ToolShortcut: Equatable {
    public var mode: String
    public var label: String
    public var key: String

    public init(mode: String, label: String, key: String) {
        self.mode = mode
        self.label = label
        self.key = key
    }
}

/// One choice in a Settings list, such as a theme, as the page names it.
public struct SettingChoice: Equatable {
    public var id: String
    public var label: String
}

/// What the Settings window edits. The page owns and saves these; the window only shows them.
/// The same rules as desktop/SettingsRules.cs.
public struct AppSettings: Equatable {
    public var tools: [ToolShortcut]
    public var checkForUpdates: Bool
    public var interfaceSize: Int
    public var theme: String
    public var appearance: String
    /// The theme and appearance choices the page offers, and whether the page is dark now.
    public var themes: [SettingChoice] = []
    public var appearances: [SettingChoice] = []
    public var dark = true

    public init(tools: [ToolShortcut], checkForUpdates: Bool, interfaceSize: Int, theme: String = "chartroom", appearance: String = "system") {
        self.tools = tools
        self.checkForUpdates = checkForUpdates
        self.interfaceSize = interfaceSize
        self.theme = theme
        self.appearance = appearance
    }

    /// Interface sizes offered, in percent. 0 means the default size.
    public static let interfaceSizes = [0, 100, 125, 150, 175, 200]

    // F fits the chart and I opens the island library; neither can be reassigned.
    private static let fixedKeys = ["f": "fit the chart", "i": "open the island library"]

    public static func parse(_ value: Any?) -> AppSettings? {
        guard let object = value as? [String: Any], let tools = object["tools"] as? [Any], !tools.isEmpty else { return nil }
        var list: [ToolShortcut] = []
        for tool in tools {
            guard let entry = tool as? [String: Any], let mode = entry["mode"] as? String,
                  let label = entry["label"] as? String, let key = entry["key"] as? String else { return nil }
            list.append(ToolShortcut(mode: mode, label: label, key: key))
        }
        var size = 0
        if let number = JSONValue.number(object["interfaceSize"]), let whole = Int(exactly: number), interfaceSizes.contains(whole) { size = whole }
        var settings = AppSettings(tools: list, checkForUpdates: JSONValue.bool(object["checkForUpdates"]) != false, interfaceSize: size,
                                   theme: object["theme"] as? String ?? "chartroom", appearance: object["appearance"] as? String ?? "system")
        settings.themes = choices(object["themes"])
        settings.appearances = choices(object["appearances"])
        settings.dark = JSONValue.bool(object["dark"]) != false
        return settings
    }

    private static func choices(_ value: Any?) -> [SettingChoice] {
        (value as? [Any] ?? []).compactMap { choice in
            guard let entry = choice as? [String: Any], let id = entry["id"] as? String, let label = entry["label"] as? String else { return nil }
            return SettingChoice(id: id, label: label)
        }
    }

    /// Nil when every key is one letter or number, unique, and not a fixed key; otherwise what to fix.
    public static func shortcutProblem(_ tools: [ToolShortcut]) -> String? {
        var owners: [String: String] = [:]
        for tool in tools {
            let key = tool.key.trimmingCharacters(in: .whitespaces).lowercased()
            guard key.count == 1, let character = key.unicodeScalars.first, character.isASCII,
                  CharacterSet.alphanumerics.contains(character) else { return "Choose one letter or number for \(tool.label)." }
            if let use = fixedKeys[key] { return "\(key.uppercased()) is already used to \(use)." }
            if let other = owners[key] { return "\(other) and \(tool.label) can't share \(key.uppercased())." }
            owners[key] = tool.label
        }
        return nil
    }
}
