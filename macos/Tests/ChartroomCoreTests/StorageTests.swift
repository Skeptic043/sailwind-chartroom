import XCTest
@testable import ChartroomCore

// The same scenarios as tests/desktop/WorkspaceStoreTests.cs.
final class WorkspaceStoreTests: XCTestCase {
    private let valid = #"{"charts":[{"name":"Kept"}]}"#
    private let older = #"{"charts":[{"name":"Older"}]}"#
    private var folder: URL!
    private var store: WorkspaceStore!

    override func setUp() {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("chartroom-tests/\(UUID().uuidString)")
        store = WorkspaceStore(folder: folder)
    }

    override func tearDown() {
        try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: store.workspaceURL.path)
        try? FileManager.default.removeItem(at: folder)
    }

    private func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }

    private func unreadableCopies() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("workspace.unreadable-") }
    }

    func testFirstLaunchStartsEmptyWithoutWarnings() {
        let result = store.load()
        XCTAssertNil(result.workspace)
        XCTAssertEqual(result.warnings, [])
    }

    func testValidWorkspaceOpensAndRefreshesBackup() throws {
        try store.save(valid)
        let result = store.load()
        XCTAssertEqual(result.workspace, valid)
        XCTAssertEqual(result.warnings, [])
        XCTAssertEqual(read(store.backupURL), valid)
    }

    func testBackupFailureStillOpensTheWorkspace() throws {
        try store.save(valid)
        // A folder with something in it, where the backup file belongs, cannot be replaced by the copy.
        try FileManager.default.createDirectory(at: store.backupURL.appendingPathComponent("occupied"), withIntermediateDirectories: true)
        let result = store.load()
        XCTAssertEqual(result.workspace, valid)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings.first?.contains("backup") == true)
    }

    func testUnreadableWorkspaceIsKeptAndThePreviousLaunchRestored() throws {
        try store.save("{ not json")
        try Data(older.utf8).write(to: store.backupURL)
        let result = store.load()
        XCTAssertEqual(result.workspace, older)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings.first?.contains("previous launch") == true)
        XCTAssertEqual(unreadableCopies().count, 1)
        XCTAssertEqual(unreadableCopies().first.flatMap(read), "{ not json")

        // The next launch opens the restored charts without another warning.
        let next = WorkspaceStore(folder: folder).load()
        XCTAssertEqual(next.workspace, older)
        XCTAssertEqual(next.warnings, [])
    }

    func testUnreadableWorkspaceWithoutBackupStartsEmptyAndKeepsTheFile() throws {
        try store.save("{ not json")
        let result = store.load()
        XCTAssertNil(result.workspace)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings.first?.contains("empty chart") == true)
        XCTAssertEqual(unreadableCopies().first.flatMap(read), "{ not json")
        XCTAssertTrue(store.canSave)
    }

    func testAWorkspaceThatCannotBeCopiedAsideIsNeverOverwritten() throws {
        try store.save(valid)
        // Without read permission the file can be neither opened nor copied.
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: store.workspaceURL.path)
        let result = store.load()
        XCTAssertNil(result.workspace)
        XCTAssertEqual(result.warnings.count, 1)
        XCTAssertTrue(result.warnings.first?.contains("saving is turned off") == true)
        XCTAssertFalse(store.canSave)
        XCTAssertThrowsError(try store.save(older))
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: store.workspaceURL.path)
        XCTAssertEqual(read(store.workspaceURL), valid)
    }

    func testSaveReplacesTheWorkspaceWithoutLeavingTemporaryFiles() throws {
        try store.save(older)
        try store.save(valid)
        XCTAssertEqual(read(store.workspaceURL), valid)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["workspace.json"])
    }
}

final class WebResourcesTests: XCTestCase {
    private var root: URL!
    private var resources: WebResources!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("chartroom-tests/\(UUID().uuidString)/web")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("src"), withIntermediateDirectories: true)
        try Data("page".utf8).write(to: root.appendingPathComponent("index.html"))
        try Data("code".utf8).write(to: root.appendingPathComponent("src/app.mjs"))
        try Data("secret".utf8).write(to: root.deletingLastPathComponent().appendingPathComponent("outside.txt"))
        resources = WebResources(root: root)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root.deletingLastPathComponent())
    }

    private func find(_ address: String) -> (file: URL, contentType: String)? {
        URL(string: address).flatMap(resources.file(for:))
    }

    func testServesBundledFilesWithTheirTypes() {
        XCTAssertEqual(find("chartroom://app/index.html")?.contentType, "text/html; charset=utf-8")
        XCTAssertEqual(find("chartroom://app/src/app.mjs")?.contentType, "text/javascript; charset=utf-8")
        XCTAssertEqual(find("chartroom://app/src/app.mjs")?.file.lastPathComponent, "app.mjs")
    }

    func testRefusesMissingFilesFoldersAndOtherOrigins() {
        XCTAssertNil(find("chartroom://app/missing.html"))
        XCTAssertNil(find("chartroom://app/src"))
        XCTAssertNil(find("chartroom://app/"))
        XCTAssertNil(find("chartroom://elsewhere/index.html"))
        XCTAssertNil(find("https://app/index.html"))
    }

    func testRefusesPathsThatLeaveThePage() {
        XCTAssertNil(find("chartroom://app/../outside.txt"))
        XCTAssertNil(find("chartroom://app/src/../../outside.txt"))
        XCTAssertNil(find("chartroom://app/%2e%2e/outside.txt"))
        XCTAssertNil(find("chartroom://app/src/..%2F..%2Foutside.txt"))
    }

    func testEveryResponseCarriesThePagePolicy() {
        let headers = WebResources.headers(contentType: "text/html; charset=utf-8", length: 4)
        XCTAssertEqual(headers["Content-Security-Policy"], WebResources.contentSecurityPolicy)
        XCTAssertEqual(headers["X-Content-Type-Options"], "nosniff")
    }
}
