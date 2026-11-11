import Foundation

/// Messages the chart page may send to the macOS host. Anything else is ignored.
/// The same protocol as desktop/HostMessage.cs.
public enum HostMessage: Equatable {
    case ready
    /// The workspace exactly as the page wrote it.
    case save(workspace: String)
    case pin
    case openFolder
    case checkUpdates(background: Bool)
    case openReleases
    case openSettings(AppSettings, defaults: [ToolShortcut])
    case setZoom(Double)
    case setAppearance(dark: Bool, followsSystem: Bool)
    case exportFile(name: String, contents: String)

    // src/host.mjs sends a save as JSON.stringify({ type: "save", workspace }), so the workspace's own
    // text is everything between this prefix and the closing brace.
    private static let savePrefix = #"{"type":"save","workspace":"#

    public static func parse(_ json: String) -> HostMessage? {
        guard let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = root["type"] as? String else { return nil }
        switch type {
        case "ready": return .ready
        case "pin": return .pin
        case "open-folder": return .openFolder
        case "open-releases": return .openReleases
        case "check-updates": return .checkUpdates(background: JSONValue.bool(root["background"]) ?? false)
        case "open-settings":
            guard let settings = AppSettings.parse(root["settings"]),
                  let defaults = AppSettings.parse(["tools": root["defaults"] as Any]) else { return nil }
            return .openSettings(settings, defaults: defaults.tools)
        case "set-appearance":
            guard let dark = JSONValue.bool(root["dark"]) else { return nil }
            return .setAppearance(dark: dark, followsSystem: JSONValue.bool(root["followsSystem"]) ?? false)
        case "set-zoom":
            guard let factor = JSONValue.number(root["factor"]), factor >= 0.5, factor <= 3 else { return nil }
            return .setZoom(factor)
        case "export-file":
            guard let name = root["name"] as? String, !name.isEmpty, let contents = root["contents"] as? String else { return nil }
            return .exportFile(name: name, contents: contents)
        case "save":
            guard let workspace = root["workspace"] as? [String: Any], workspace["charts"] is [Any],
                  json.hasPrefix(savePrefix), json.hasSuffix("}") else { return nil }
            return .save(workspace: String(json.dropFirst(savePrefix.count).dropLast()))
        default: return nil
        }
    }
}

/// Strict readers for parsed JSON, where a true/false is never mistaken for a number.
enum JSONValue {
    static func bool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
}
