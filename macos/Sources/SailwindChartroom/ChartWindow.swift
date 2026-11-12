import AppKit
import ChartroomCore
import UniformTypeIdentifiers
import WebKit

/// The app's one window: the chart page in a web view, and everything the page asks its host to do.
/// The macOS counterpart of desktop/MainForm.cs.
final class ChartWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private static let releasesPage = URL(string: "https://github.com/Skeptic043/sailwind-chartroom/releases")!
    // Sent before any page script runs: page errors reach the log, and the browser's own menus stay off.
    private static let pageScript = """
        window.addEventListener("error", (event) => webkit.messageHandlers.chartroomLog.postMessage(`${event.message} (${event.filename}:${event.lineno})`));
        window.addEventListener("unhandledrejection", (event) => webkit.messageHandlers.chartroomLog.postMessage(`Unhandled: ${event.reason?.message ?? event.reason}`));
        window.addEventListener("contextmenu", (event) => event.preventDefault());
        """

    private let options: LaunchOptions
    private let store: WorkspaceStore
    private let log: BoundedLog
    private let window: NSWindow
    private let web: WKWebView
    private let relay = MessageRelay()
    private var updates: Updates?
    private var smoke: SmokeTest?
    private var settings: SettingsWindow?
    private var currentWorkspace: String?
    private var pendingWorkspace: String?
    private var saveTimer: Timer?
    private var follower: TrackFollower?
    // The chart the followed positions go to, kept here so a reloaded page sends them to the same one.
    private var followedChartId = ""
    // Counts follows, so lines from one that has since been stopped or replaced are dropped.
    private var followSession = 0

    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    init(options: LaunchOptions) {
        self.options = options
        store = WorkspaceStore(folder: options.dataFolder)
        let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Sailwind Chartroom/chartroom.log")
        log = BoundedLog(file: logs)

        let configuration = WKWebViewConfiguration()
        let pages = SchemeHandler(resources: WebResources(root: Bundle.main.resourceURL!.appendingPathComponent("web")))
        configuration.setURLSchemeHandler(pages, forURLScheme: WebResources.scheme)
        // The web view copies its configuration, so the message handlers must be in place before it exists.
        configuration.userContentController.add(relay, name: "chartroom")
        configuration.userContentController.add(relay, name: "chartroomLog")
        // The page keeps nothing in the web view; the workspace file is the only storage.
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(source: Self.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: configuration)

        // Opens centred on the main screen, fitted to it; later launches reopen where the window was left.
        let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, area.width), height: min(900, area.height))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()

        window.title = "Sailwind Chartroom"
        window.isReleasedWhenClosed = false
        window.contentMinSize = NSSize(width: min(900, area.width), height: min(560, area.height))
        window.backgroundColor = NSColor(srgbRed: 16 / 255, green: 28 / 255, blue: 33 / 255, alpha: 1)
        window.contentView = web
        window.delegate = self
        window.center()
        if !options.isSmokeTest { window.setFrameAutosaveName("ChartroomMain") }

        relay.target = self
        web.navigationDelegate = self
        web.uiDelegate = self

        if options.isSmokeTest {
            smoke = SmokeTest(options: options, web: web) { [weak self] in self?.flushSave() }
        } else {
            updates = Updates(version: version, log: log) { [weak self] in self?.flushSave() }
        }
    }

    func open() {
        let loaded = store.load()
        currentWorkspace = loaded.workspace
        loaded.warnings.forEach { warn($0) }
        window.makeKeyAndOrderFront(nil)
        web.load(URLRequest(url: WebResources.startURL))
    }

    // MARK: Requests from the app menu

    /// The page owns the settings, so the menu asks it to open them.
    func requestSettings() { post(["type": "show-settings"]) }

    /// Undo and Redo belong to the page: it applies them to the chart, or to the text field being edited.
    func requestEdit(_ command: String) { post(["type": "edit-command", "command": command]) }

    func checkForUpdates(background: Bool) { updates?.check(background: background) }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, WebResources.isAppURL(message.frameInfo.request.url), let body = message.body as? String else { return }
        if message.name == "chartroomLog" {
            log.write("Page: \(body)")
            smoke?.pageErrors.append(body)
            return
        }
        switch HostMessage.parse(body) {
        case .ready:
            // Sent on every page load, so a reload always receives the latest charts.
            // The workspace goes in as its own JSON text, exactly as it was saved.
            let workspace = currentWorkspace ?? "null"
            let folder = Self.jsonString(store.folder.path)
            postJSON(#"{"type":"init","platform":"mac","workspace":\#(workspace),"dataFolder":\#(folder),"version":\#(Self.jsonString(version)),"textScale":100,"liveTrack":true}"#)
            // A reloaded page learns that a file is still being followed.
            if let follower { post(["type": "track-following", "name": follower.url.lastPathComponent, "chartId": followedChartId, "resumed": true]) }
            smoke?.pageIsReady()
        case .save(let workspace):
            currentWorkspace = workspace
            pendingWorkspace = workspace
            saveTimer?.invalidate()
            saveTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in self?.flushSave() }
        case .pin:
            window.level = window.level == .floating ? .normal : .floating
            post(["type": "pinned", "value": window.level == .floating])
        case .openFolder:
            NSWorkspace.shared.open(store.folder)
        case .checkUpdates(let background):
            checkForUpdates(background: background)
        case .openReleases:
            NSWorkspace.shared.open(Self.releasesPage)
        case .openSettings(let current, let defaults):
            showSettings(current, defaults: defaults)
        case .setZoom(let factor):
            web.pageZoom = factor
        case .setAppearance(let dark, let followsSystem):
            // Leaving the appearance unset lets the page keep following the system setting.
            let appearance = followsSystem ? nil : NSAppearance(named: dark ? .darkAqua : .aqua)
            window.appearance = appearance
            settings?.window.appearance = appearance
        case .exportFile(let name, let contents):
            export(name: name, contents: contents)
        case .followTrack(let chartId):
            chooseTrackFile(chartId: chartId)
        case .stopTrack:
            stopFollowing()
        case .copyText(let text):
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        case nil:
            break
        }
    }

    private func post(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        postJSON(json)
    }

    private func postJSON(_ json: String) {
        web.evaluateJavaScript("window.chartroomReceive?.(\(json))") { [weak self] _, error in
            if let error { self?.log.write("Could not reach the page: \(error.localizedDescription)") }
        }
    }

    private static func jsonString(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: text, options: .fragmentsAllowed)) ?? Data("\"\"".utf8)
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    // MARK: Saving

    /// Writes any pending charts now.
    func flushSave() {
        saveTimer?.invalidate()
        saveTimer = nil
        guard let workspace = pendingWorkspace else { return }
        do {
            try store.save(workspace)
            pendingWorkspace = nil
            smoke?.saves += 1
            post(["type": "saved", "ok": true])
        } catch {
            log.write("Save failed: \(error.localizedDescription)")
            post(["type": "saved", "ok": false, "error": error.localizedDescription])
        }
    }

    func windowWillClose(_ notification: Notification) {
        follower?.stop()
        follower = nil
        followSession += 1
        flushSave()
    }

    // MARK: Following Coordinate Viewer

    // The player picks the coords_<slot>.txt file Coordinate Viewer writes beside itself while recording.
    private func chooseTrackFile(chartId: String) {
        let panel = NSOpenPanel()
        panel.title = "Follow a Coordinate Viewer file"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.plainText]
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.startFollowing(url, chartId: chartId)
        }
    }

    private func startFollowing(_ url: URL, chartId: String) {
        stopFollowing()
        do {
            followSession += 1
            let session = followSession
            follower = try TrackFollower(url: url) { [weak self] text in
                DispatchQueue.main.async {
                    guard let self, session == self.followSession, self.follower != nil else { return }
                    self.post(["type": "track-lines", "text": text])
                }
            }
            followedChartId = chartId
            post(["type": "track-following", "name": url.lastPathComponent, "chartId": chartId, "resumed": false])
        } catch {
            log.write("Could not follow \(url.lastPathComponent): \(error.localizedDescription)")
            warn("Chartroom could not follow that file:\n\(error.localizedDescription)")
        }
    }

    private func stopFollowing() {
        guard let follower else { return }
        follower.stop()
        self.follower = nil
        followSession += 1
        post(["type": "track-stopped"])
    }

    // MARK: Exports and settings

    // The page supplies the file; the player chooses where it goes.
    private func export(name: String, contents: String) {
        let fileName = URL(fileURLWithPath: name).lastPathComponent
        if let folder = options.exportFolder {
            write(contents, to: folder.appendingPathComponent(fileName))
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK, let url = panel.url { self?.write(contents, to: url) }
        }
    }

    private func write(_ contents: String, to url: URL) {
        do {
            try Data(contents.utf8).write(to: url, options: .atomic)
        } catch {
            log.write("Export failed: \(error.localizedDescription)")
            warn("The file could not be saved:\n\(error.localizedDescription)")
        }
    }

    private func showSettings(_ current: AppSettings, defaults: [ToolShortcut]) {
        guard settings == nil else { return }
        let sheet = SettingsWindow(settings: current, defaults: defaults) { [weak self] applied in
            self?.post(["type": "settings-changed", "settings": [
                "shortcuts": Dictionary(uniqueKeysWithValues: applied.tools.map { ($0.mode, $0.key) }),
                "checkForUpdates": applied.checkForUpdates,
                "interfaceSize": applied.interfaceSize,
                "theme": applied.theme,
                "appearance": applied.appearance
            ] as [String: Any]])
        }
        sheet.window.appearance = window.appearance
        settings = sheet
        window.beginSheet(sheet.window) { [weak self] _ in self?.settings = nil }
    }

    // MARK: Warnings

    private func warn(_ message: String) {
        log.write("Warning shown: \(message.components(separatedBy: "\n")[0])")
        if let smoke {
            smoke.warnings.append(message)
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Sailwind Chartroom"
        alert.informativeText = message
        alert.runModal()
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Only the app's own page, and only in the main frame.
        decisionHandler(action.targetFrame?.isMainFrame == true && WebResources.isAppURL(action.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        pageFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pageFailed(error)
    }

    private func pageFailed(_ error: Error) {
        log.write("The chart page did not load: \(error.localizedDescription)")
        smoke?.fail("The chart page did not load: \(error.localizedDescription)")
        warn("Sailwind Chartroom could not open its chart page:\n\(error.localizedDescription)\n\nDownload Chartroom again if this keeps happening.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page reloads and receives the latest charts again.
        log.write("The web content process stopped; reloading the page.")
        web.load(URLRequest(url: WebResources.startURL))
    }

    // MARK: Panels the page asks for

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        nil
    }

    // Imports use the page's own file inputs.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }
}

/// Passes the page's messages to the window without the web view keeping the window alive.
final class MessageRelay: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Serves the bundled chart page to the web view.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let resources: WebResources

    init(resources: WebResources) {
        self.resources = resources
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        guard let found = resources.file(for: url), let data = try? Data(contentsOf: found.file) else {
            respond(task, url: url, status: 404, headers: WebResources.headers(contentType: "text/plain; charset=utf-8", length: 0), data: Data())
            return
        }
        respond(task, url: url, status: 200, headers: WebResources.headers(contentType: found.contentType, length: data.count), data: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], data: Data) {
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
