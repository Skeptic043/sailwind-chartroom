import AppKit
import WebKit

/// The automated package test: runs a script in the loaded page, writes what happened to a report
/// file with a picture of the window beside it, and quits. Warnings are recorded instead of shown.
final class SmokeTest {
    var warnings: [String] = []
    var pageErrors: [String] = []
    var saves = 0

    private let options: LaunchOptions
    private weak var web: WKWebView?
    private let flushSave: () -> Void
    private var started = false
    private var finished = false

    init(options: LaunchOptions, web: WKWebView, flushSave: @escaping () -> Void) {
        self.options = options
        self.web = web
        self.flushSave = flushSave
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in self?.fail("The test did not finish in 90 seconds.") }
    }

    /// The page has completed the host handshake; the script takes over from here.
    func pageIsReady() {
        guard !started, let web, let script = options.smokeScript.flatMap({ try? String(contentsOf: $0, encoding: .utf8) }) else {
            if !started { fail("The test script could not be read.") }
            return
        }
        started = true
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value): self?.finish(result: value as? String, error: value is String ? nil : "The test script must return text.")
            case .failure(let error): self?.finish(result: nil, error: "The test script failed: \(error.localizedDescription)")
            }
        }
    }

    func fail(_ message: String) {
        finish(result: nil, error: message)
    }

    private func finish(result: String?, error: String?) {
        guard !finished else { return }
        finished = true
        flushSave()
        let report: [String: Any] = [
            "ok": error == nil,
            "error": error ?? NSNull(),
            "handshake": started,
            "result": result ?? NSNull(),
            "saves": saves,
            "warnings": warnings,
            "pageErrors": pageErrors,
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        ]
        let write = { [options] in
            if let url = options.smokeReport, let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: url, options: .atomic)
            }
            NSApp.terminate(nil)
        }
        guard let web, let reportURL = options.smokeReport else { return write() }
        web.takeSnapshot(with: nil) { image, _ in
            if let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: reportURL.deletingPathExtension().appendingPathExtension("png"))
            }
            write()
        }
    }
}
