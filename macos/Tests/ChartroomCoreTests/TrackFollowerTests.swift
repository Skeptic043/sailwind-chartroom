import XCTest
@testable import ChartroomCore

final class TrackFollowerTests: XCTestCase {
    private func bytes(_ text: String) -> Data { Data(text.utf8) }

    func testReadsOnlyWhatWasAddedAndLeadsWithTheDay() {
        let (first, tail) = TrackTail.lines(in: bytes("Day: 3\r\n40.1 0.5 9.5 90\r\n"), from: .start)
        XCTAssertEqual(first, "Day: 3\n40.1 0.5 9.5 90\n")
        let (second, _) = TrackTail.lines(in: bytes("40.2 0.6 10 92\r\n"), from: tail)
        XCTAssertEqual(second, "Day: 3\n40.2 0.6 10 92\n")
    }

    func testWaitsForAPartlyWrittenLine() {
        let (text, tail) = TrackTail.lines(in: bytes("40.1 0.5 9.5 90\n40.2 0."), from: .start)
        XCTAssertEqual(text, "40.1 0.5 9.5 90\n")
        XCTAssertEqual(tail.offset, 16)
    }

    func testKeepsANewDayThatStartsPartWay() {
        let (text, tail) = TrackTail.lines(in: bytes("Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n"), from: .start)
        XCTAssertEqual(text, "Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n")
        XCTAssertEqual(tail.day, "Day: 4")
    }

    func testFollowingStartsFromTheNewestPosition() {
        XCTAssertEqual(TrackTail.lastPosition("Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n"), "Day: 4\n40.2 0.6 0.5 92\n")
        XCTAssertNil(TrackTail.lastPosition("Day: 3\n"))
    }

    func testReportsLinesTheGameAppends() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("coords_0.txt")
        try Data("Day: 2\n40.1 0.5 9.5 90\n".utf8).write(to: file)

        let received = expectation(description: "both runs of lines")
        received.expectedFulfillmentCount = 2
        var texts: [String] = []
        let lock = NSLock()
        let follower = try TrackFollower(url: file) { text in
            lock.lock(); texts.append(text); lock.unlock()
            received.fulfill()
        }
        defer { follower.stop() }
        let handle = try FileHandle(forWritingTo: file)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("40.2 0.6 10 92\n".utf8))
        try handle.close()

        wait(for: [received], timeout: 5)
        lock.lock(); defer { lock.unlock() }
        XCTAssertEqual(texts, ["Day: 2\n40.1 0.5 9.5 90\n", "Day: 2\n40.2 0.6 10 92\n"])
    }
}
