import AppKit
import ChartroomCore
import Sparkle

/// Update checks and installs through Sparkle, which shows its own windows.
/// The page decides when to check: at startup when the setting is on, and from the Help menu.
final class Updates: NSObject, SPUUpdaterDelegate {
    private let version: String
    private let log: BoundedLog
    private let beforeInstall: () -> Void
    private var controller: SPUStandardUpdaterController?

    /// - Parameter beforeInstall: Saves the charts, because the new version opens what is on disk.
    init(version: String, log: BoundedLog, beforeInstall: @escaping () -> Void) {
        self.version = version
        self.log = log
        self.beforeInstall = beforeInstall
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
    }

    func check(background: Bool) {
        guard let controller else { return }
        if background {
            // Silent unless an update is found.
            controller.updater.checkForUpdatesInBackground()
        } else {
            controller.checkForUpdates(nil)
        }
    }

    func allowedChannels(for updater: SPUUpdater) -> Set<String> {
        UpdateChannels.allowed(forVersion: version)
    }

    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        beforeInstall()
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        // "No update found" also arrives here; it is not a failure.
        if (error as NSError).code != 1001 { log.write("Update check stopped: \(error.localizedDescription)") }
    }
}
