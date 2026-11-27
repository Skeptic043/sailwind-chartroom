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
    /// Import a map or chart file. Without a choice the host offers discovered files; file imports one of
    /// those offered, and pick opens the native file picker instead.
    case pickImportFile(file: Int? = nil, pick: Bool = false)
    /// Follow a recording into the chart with this id. Without a choice the host offers the recordings it
    /// finds; log follows one of those it offered, and pick asks for a file instead.
    case followTrack(chartId: String, log: Int? = nil, pick: Bool = false)
    case stopTrack
    case copyText(String)
    /// A Chartroom Voyages page or submission form to open in the player's browser.
    case openLink(URL)
    // Phones and tablets on the player's network: the page's Mobile device link dialog, and sync messages to relay.
    case devicesOpen
    case devicesEnable(Bool)
    /// Show a pairing code for the page at this address, or the first one found when empty.
    case devicesPair(address: String)
    case devicesPairStop
    case devicesRename(id: String, name: String)
    case devicesRemove(id: String)
    /// A message for one device, as JSON the host passes on unread.
    case syncSend(deviceId: String, message: String)
    /// Chart changes for every connected device, as a JSON array.
    case syncBroadcast(ops: String)

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
        case "pick-import-file":
            let file = JSONValue.number(root["file"]).flatMap(Int.init(exactly:)).flatMap { $0 >= 0 ? $0 : nil }
            return .pickImportFile(file: file, pick: JSONValue.bool(root["pick"]) ?? false)
        case "stop-track": return .stopTrack
        case "follow-track":
            guard let chartId = root["chartId"] as? String, !chartId.isEmpty else { return nil }
            let log = JSONValue.number(root["log"]).flatMap { $0 >= 0 && $0 == $0.rounded() ? Int($0) : nil }
            return .followTrack(chartId: chartId, log: log, pick: JSONValue.bool(root["pick"]) ?? false)
        case "copy-text":
            guard let text = root["text"] as? String, !text.isEmpty else { return nil }
            return .copyText(text)
        case "open-link":
            guard let text = root["url"] as? String, let url = siteLink(text) else { return nil }
            return .openLink(url)
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
        case "devices-open": return .devicesOpen
        case "devices-enable":
            guard let enabled = JSONValue.bool(root["enabled"]) else { return nil }
            return .devicesEnable(enabled)
        case "devices-pair": return .devicesPair(address: root["address"] as? String ?? "")
        case "devices-pair-stop": return .devicesPairStop
        case "devices-rename":
            guard let id = root["id"] as? String, !id.isEmpty, let name = root["name"] as? String else { return nil }
            return .devicesRename(id: id, name: name)
        case "devices-remove":
            guard let id = root["id"] as? String, !id.isEmpty else { return nil }
            return .devicesRemove(id: id)
        case "sync-send":
            guard let deviceId = root["deviceId"] as? String, !deviceId.isEmpty, let message = root["message"] as? [String: Any],
                  let text = JSONValue.text(message) else { return nil }
            return .syncSend(deviceId: deviceId, message: text)
        case "sync-broadcast":
            guard let ops = root["ops"] as? [Any], let text = JSONValue.text(ops) else { return nil }
            return .syncBroadcast(ops: text)
        case "save":
            guard let workspace = root["workspace"] as? [String: Any], workspace["charts"] is [Any],
                  json.hasPrefix(savePrefix), json.hasSuffix("}") else { return nil }
            return .save(workspace: String(json.dropFirst(savePrefix.count).dropLast()))
        default: return nil
        }
    }
}

extension HostMessage {
    /// Only Chartroom Voyages: its pages on GitHub Pages and its repository's issue forms.
    /// The same rule as IsSiteLink in desktop/HostMessage.cs.
    static func siteLink(_ text: String) -> URL? {
        guard text.count <= 8000, let parts = URLComponents(string: text), parts.scheme == "https",
              parts.user == nil, parts.password == nil, parts.port == nil, let host = parts.host,
              let url = parts.url else { return nil }
        let path = parts.percentEncodedPath
        let allowed = (host == "skeptic043.github.io" && path.hasPrefix("/sailwind-chartroom-voyages/"))
            || (host == "github.com" && path == "/Skeptic043/sailwind-chartroom-voyages/issues/new")
        return allowed ? url : nil
    }
}

/// Strict readers for parsed JSON, where a true/false is never mistaken for a number.
enum JSONValue {
    static func bool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    /// A parsed object or array as JSON text again.
    static func text(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
}
