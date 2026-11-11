import AppKit
import ChartroomCore

/// The Settings sheet: tool shortcuts, display choices and the update check, with OK, Cancel and Apply.
/// The macOS counterpart of desktop/SettingsForm.cs.
final class SettingsWindow: NSObject, NSTextFieldDelegate {
    let window: NSWindow
    private let current: AppSettings
    private let defaults: [ToolShortcut]
    private let apply: (AppSettings) -> Void
    private var shortcutFields: [(tool: ToolShortcut, field: NSTextField)] = []
    private let theme = NSPopUpButton()
    private let appearance = NSPopUpButton()
    private let interfaceSize = NSPopUpButton()
    private let checkUpdates = NSButton(checkboxWithTitle: "Check for updates when Chartroom starts", target: nil, action: nil)

    /// - Parameter apply: Receives the settings on OK and Apply, after they have been checked.
    init(settings: AppSettings, defaults: [ToolShortcut], apply: @escaping (AppSettings) -> Void) {
        current = settings
        self.defaults = defaults
        self.apply = apply
        window = NSWindow(contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: false)
        super.init()
        window.title = "Settings"
        window.isReleasedWhenClosed = false

        var shortcutRows: [[NSView]] = []
        for tool in settings.tools {
            let field = NSTextField(string: tool.key.uppercased())
            field.alignment = .center
            field.delegate = self
            field.widthAnchor.constraint(equalToConstant: 40).isActive = true
            shortcutFields.append((tool, field))
            shortcutRows.append([NSTextField(labelWithString: tool.label), field])
        }
        let restore = NSButton(title: "Restore defaults", target: self, action: #selector(restoreDefaults))

        fill(theme, settings.themes.map(\.label), selected: settings.themes.firstIndex { $0.id == settings.theme })
        fill(appearance, settings.appearances.map(\.label), selected: settings.appearances.firstIndex { $0.id == settings.appearance })
        fill(interfaceSize, AppSettings.interfaceSizes.map { $0 == 0 ? "Default (100%)" : "\($0)%" }, selected: AppSettings.interfaceSizes.firstIndex(of: settings.interfaceSize))
        let displayRows: [[NSView]] = [
            [NSTextField(labelWithString: "Theme"), theme],
            [NSTextField(labelWithString: "Light or dark"), appearance],
            [NSTextField(labelWithString: "Text and interface size"), interfaceSize]
        ]
        checkUpdates.state = settings.checkForUpdates ? .on : .off

        let ok = NSButton(title: "OK", target: self, action: #selector(confirm))
        ok.keyEquivalent = "\r"
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(close))
        cancel.keyEquivalent = "\u{1b}"
        let applyButton = NSButton(title: "Apply", target: self, action: #selector(applyNow))
        // The empty view takes the spare width, keeping the buttons at the right.
        let buttons = NSStackView(views: [NSView(), applyButton, cancel, ok])
        buttons.orientation = .horizontal
        buttons.distribution = .fill

        let layout = NSStackView(views: [
            heading("Tool shortcuts"), grid(shortcutRows), restore,
            heading("Display"), grid(displayRows),
            heading("Updates"), checkUpdates,
            buttons
        ])
        layout.orientation = .vertical
        layout.alignment = .leading
        layout.spacing = 10
        layout.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        layout.setCustomSpacing(18, after: restore)
        layout.setCustomSpacing(18, after: layout.views[4])
        layout.setCustomSpacing(18, after: checkUpdates)
        buttons.trailingAnchor.constraint(equalTo: layout.trailingAnchor, constant: -20).isActive = true
        window.contentView = layout
        window.setContentSize(layout.fittingSize)
    }

    private func heading(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .boldSystemFont(ofSize: NSFont.systemFontSize)
        return label
    }

    private func grid(_ rows: [[NSView]]) -> NSGridView {
        let grid = NSGridView(views: rows)
        grid.rowSpacing = 6
        grid.columnSpacing = 12
        grid.rowAlignment = .firstBaseline
        return grid
    }

    private func fill(_ popup: NSPopUpButton, _ titles: [String], selected: Int?) {
        popup.addItems(withTitles: titles)
        if !titles.isEmpty { popup.selectItem(at: selected ?? 0) }
    }

    // Each shortcut is one key, shown in capitals: typing replaces what was there.
    func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        field.stringValue = String(field.stringValue.suffix(1)).uppercased()
    }

    @objc private func restoreDefaults() {
        for (tool, field) in shortcutFields {
            if let original = defaults.first(where: { $0.mode == tool.mode }) { field.stringValue = original.key.uppercased() }
        }
    }

    @objc private func confirm() {
        if tryApply() { close() }
    }

    @objc private func applyNow() {
        _ = tryApply()
    }

    @objc private func close() {
        window.sheetParent?.endSheet(window)
    }

    private func tryApply() -> Bool {
        let tools = shortcutFields.map { entry in
            ToolShortcut(mode: entry.tool.mode, label: entry.tool.label, key: entry.field.stringValue.trimmingCharacters(in: .whitespaces).lowercased())
        }
        if let problem = AppSettings.shortcutProblem(tools) {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Settings"
            alert.informativeText = problem
            alert.runModal()
            return false
        }
        func pick(_ popup: NSPopUpButton, _ choices: [SettingChoice], _ fallback: String) -> String {
            choices.indices.contains(popup.indexOfSelectedItem) ? choices[popup.indexOfSelectedItem].id : fallback
        }
        let applied = AppSettings(tools: tools, checkForUpdates: checkUpdates.state == .on,
                                  interfaceSize: AppSettings.interfaceSizes[max(0, interfaceSize.indexOfSelectedItem)],
                                  theme: pick(theme, current.themes, current.theme), appearance: pick(appearance, current.appearances, current.appearance))
        apply(applied)
        return true
    }
}
