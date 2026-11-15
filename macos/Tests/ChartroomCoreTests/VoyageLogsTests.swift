import XCTest
@testable import ChartroomCore

final class VoyageLogsTests: XCTestCase {
    private var home: URL!

    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("chartroom-voyage/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: home)
    }

    private func log(_ path: String, hoursAgo: Double) throws -> URL {
        let url = home.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{}\n".utf8).write(to: url)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-hoursAgo * 3600)], ofItemAtPath: url.path)
        return url
    }

    func testFindsNothingWithoutLogs() {
        XCTAssertTrue(VoyageLogs.all(in: VoyageLogs.candidateFolders(home: home)).isEmpty)
    }

    func testListsLogsNewestFirstAcrossNativeAndCompatibilityLayerFolders() throws {
        let game = "AppData/LocalLow/Raw Lion Workshop/Sailwind/Voyage Recorder"
        let native = try log("Library/Application Support/Raw Lion Workshop/Sailwind/Voyage Recorder/slot1.jsonl", hoursAgo: 3)
        let bottle = try log("Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/\(game)/slot2.jsonl", hoursAgo: 2)
        let prefix = try log("Games/Heroic/Prefixes/default/Steam/drive_c/users/steamuser/\(game)/slot3.jsonl", hoursAgo: 1)
        _ = try log("Games/Heroic/Prefixes/default/Steam/drive_c/users/steamuser/\(game)/notes.jsonl", hoursAgo: 0)
        let logs = VoyageLogs.all(in: VoyageLogs.candidateFolders(home: home))
        XCTAssertEqual(logs.map { $0.url.resolvingSymlinksInPath() }, [prefix, bottle, native].map { $0.resolvingSymlinksInPath() })
        XCTAssertEqual(logs.map(\.place), ["Steam", "Steam", "Mac"])
    }
}
