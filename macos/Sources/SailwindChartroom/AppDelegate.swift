import AppKit
import ChartroomCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var chart: ChartWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let options = LaunchOptions(arguments: CommandLine.arguments)
        let chart = ChartWindow(options: options)
        self.chart = chart
        NSApp.mainMenu = makeMenu()
        chart.open()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        chart?.flushSave()
    }

    @objc private func showSettings() { chart?.requestSettings() }
    @objc private func checkForUpdates() { chart?.checkForUpdates(background: false) }
    @objc private func undoEdit() { chart?.requestEdit("undo") }
    @objc private func redoEdit() { chart?.requestEdit("redo") }

    private func makeMenu() -> NSMenu {
        let name = "Sailwind Chartroom"
        let main = NSMenu()

        let app = NSMenu()
        app.addItem(withTitle: "About \(name)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(item("Settings…", #selector(showSettings), ","))
        app.addItem(item("Check for Updates…", #selector(checkForUpdates), ""))
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit \(name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu(app, title: name))

        // Undo and Redo go to the page, which owns the chart's history.
        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", #selector(undoEdit), "z"))
        let redo = item("Redo", #selector(redoEdit), "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redo)
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu(edit, title: "Edit"))

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu(window, title: "Window"))
        NSApp.windowsMenu = window
        return main
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func submenu(_ menu: NSMenu, title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }
}

/// What the command line asks for. Everything but the data folder exists for the automated package test.
struct LaunchOptions {
    var dataFolder: URL
    /// A script to run in the page once it has loaded, and where to write what it returns.
    var smokeScript: URL?
    var smokeReport: URL?
    /// Exports are written here without asking, so the package test needs no save panel.
    var exportFolder: URL?

    var isSmokeTest: Bool { smokeScript != nil }

    init(arguments: [String]) {
        func value(_ name: String) -> URL? {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
            return URL(fileURLWithPath: arguments[index + 1])
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dataFolder = value("--data-dir") ?? support.appendingPathComponent("Sailwind Chartroom")
        smokeScript = value("--smoke-script")
        smokeReport = value("--smoke-report")
        exportFolder = value("--export-dir")
    }
}
