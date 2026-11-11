import Foundation

/// Finds the chart page's bundled files. The page is served under one private origin and may never leave it.
public struct WebResources {
    public static let scheme = "chartroom"
    public static let host = "app"
    public static let startURL = URL(string: "\(scheme)://\(host)/index.html")!
    /// The same policy as desktop/MainForm.cs.
    public static let contentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

    private static let contentTypes = [
        "html": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "png": "image/png",
        "jpg": "image/jpeg"
    ]

    public let root: URL

    public init(root: URL) {
        self.root = root.standardizedFileURL
    }

    public static func isAppURL(_ url: URL?) -> Bool {
        url?.scheme == scheme && url?.host == host
    }

    /// The file and content type for a page URL, or nil when it is not one of the bundled files.
    public func file(for url: URL) -> (file: URL, contentType: String)? {
        guard Self.isAppURL(url) else { return nil }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.isEmpty, !parts.contains(where: { $0 == ".." || $0 == "." || $0.contains("\\") }) else { return nil }
        let file = parts.reduce(root) { $0.appendingPathComponent(String($1)) }.standardizedFileURL
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(root.path + "/"),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return nil }
        return (file, Self.contentTypes[file.pathExtension.lowercased()] ?? "application/octet-stream")
    }

    public static func headers(contentType: String, length: Int) -> [String: String] {
        [
            "Content-Type": contentType,
            "Content-Length": String(length),
            "Cache-Control": "no-store",
            "Content-Security-Policy": contentSecurityPolicy,
            "X-Content-Type-Options": "nosniff"
        ]
    }
}
