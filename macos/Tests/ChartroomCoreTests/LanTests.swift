import XCTest
@testable import ChartroomCore

// The same scenarios as tests/desktop/LanTests.cs.
final class DeviceStoreTests: XCTestCase {
    private var folder: URL!
    private let now = Date(timeIntervalSince1970: 1_795_000_000)

    override func setUp() {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("chartroom-tests/\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: folder)
    }

    private func enabled() throws -> DeviceStore {
        let store = DeviceStore(folder: folder)
        store.load()
        try store.setEnabled(true)
        return store
    }

    func testTheShownCodePairsOnceAndTheTokenThenRecognizesTheDevice() throws {
        let store = try enabled()
        let code = store.startPairing(now: now)
        let paired = try XCTUnwrap(store.pair(code: code, name: "iPhone", now: now.addingTimeInterval(60)))
        XCTAssertNil(store.pair(code: code, name: "Second", now: now.addingTimeInterval(60)))
        XCTAssertEqual(store.authenticate(token: paired.token)?.id, paired.device.id)
        XCTAssertNil(store.authenticate(token: "not-a-token"))
        let saved = try String(contentsOf: folder.appendingPathComponent("devices.json"), encoding: .utf8)
        XCTAssertFalse(saved.contains(paired.token))
    }

    func testACodeStopsWorkingAfterFiveWrongTriesOrWhenItExpires() throws {
        let store = try enabled()
        var code = store.startPairing(now: now)
        let wrong = code == "000000" ? "111111" : "000000"
        for _ in 0..<DeviceStore.codeAttempts { XCTAssertNil(store.pair(code: wrong, name: "x", now: now)) }
        XCTAssertNil(store.pair(code: code, name: "x", now: now))
        code = store.startPairing(now: now)
        XCTAssertNil(store.pair(code: code, name: "x", now: now.addingTimeInterval(DeviceStore.codeLifetime + 1)))
    }

    func testPairedDevicesAndTheSwitchSurviveARestart_AndTurningItOffRefusesEveryone() throws {
        let store = try enabled()
        let paired = try XCTUnwrap(store.pair(code: store.startPairing(now: now), name: "  iPad\u{7} ", now: now))
        let reopened = DeviceStore(folder: folder)
        reopened.load()
        XCTAssertTrue(reopened.isEnabled)
        XCTAssertEqual(reopened.allDevices.map(\.name), ["iPad"])
        try reopened.setEnabled(false)
        XCTAssertNil(reopened.authenticate(token: paired.token))
        XCTAssertNil(reopened.pair(code: reopened.startPairing(now: now), name: "x", now: now))
    }

    func testPairingAgainReplacesTheOldEntry_AndARemovedDeviceIsNoLongerRecognized() throws {
        let store = try enabled()
        let first = try XCTUnwrap(store.pair(code: store.startPairing(now: now), name: "Phone", now: now))
        let again = try XCTUnwrap(store.pair(code: store.startPairing(now: now), name: "Phone", previousToken: first.token, now: now))
        XCTAssertEqual(store.allDevices.map(\.id), [again.device.id])
        store.rename(id: again.device.id, to: "Deck phone")
        XCTAssertEqual(store.allDevices.first?.name, "Deck phone")
        XCTAssertTrue(store.remove(id: again.device.id))
        XCTAssertNil(store.authenticate(token: again.token))
    }
}

final class LanProtocolTests: XCTestCase {
    func testOnlyTheLocalNetworkMayConnect() {
        for (address, allowed) in [("192.168.1.20", true), ("10.0.0.5", true), ("172.20.1.1", true), ("169.254.3.3", true), ("127.0.0.1", true),
                                   ("::ffff:192.168.1.2", true), ("172.32.0.1", false), ("8.8.8.8", false), ("100.64.1.1", false), ("fe80::1", false), ("", false)] {
            XCTAssertEqual(LanAddress.isLocalNetwork(address), allowed, address)
        }
        XCTAssertTrue(LanAddress.isAddressHost("192.168.1.20:47821"))
        XCTAssertFalse(LanAddress.isAddressHost("evil.example:47821"))
        XCTAssertFalse(LanAddress.isAddressHost(""))
    }

    func testReadsARequestAndRefusesLeavingThePage() throws {
        let request = try XCTUnwrap(LanRequest.parse(Data("GET /src/app.mjs?x=1 HTTP/1.1\r\nHost: 192.168.1.2:47821\r\nUpgrade: websocket\r\n\r\n".utf8)))
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.path, "/src/app.mjs")
        XCTAssertEqual(request.header("upgrade"), "websocket")
        XCTAssertNil(LanRequest.parse(Data("GET /../devices.json HTTP/1.1\r\n\r\n".utf8)))
        XCTAssertNil(LanRequest.parse(Data("GET /%2e%2e/devices.json HTTP/1.1\r\n\r\n".utf8)))
        // The example from RFC 6455.
        XCTAssertEqual(LanRequest.webSocketAccept(key: "dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRrxMppo=")
    }

    // A frame as a browser sends it: masked.
    private func masked(_ text: String, fin: Bool = true, opcode: UInt8 = 0x1) -> Data {
        let payload = [UInt8](text.utf8)
        let mask: [UInt8] = [1, 2, 3, 4]
        var frame = [UInt8]([(fin ? 0x80 : 0) | opcode])
        if payload.count < 126 { frame.append(0x80 | UInt8(payload.count)) }
        else { frame += [0x80 | 126, UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)] }
        frame += mask
        frame += payload.enumerated().map { $0.element ^ mask[$0.offset % 4] }
        return Data(frame)
    }

    func testReadsMaskedFramesWholeOrInPartsAndRefusesTooLarge() throws {
        let long = String(repeating: "a", count: 300)
        let frame = masked(long)
        XCTAssertNil(try WebSocketFrame.read(frame.prefix(5), limit: 4096))
        let read = try XCTUnwrap(try WebSocketFrame.read(frame, limit: 4096))
        XCTAssertEqual(String(data: read.payload, encoding: .utf8), long)
        XCTAssertEqual(read.used, frame.count)
        XCTAssertThrowsError(try WebSocketFrame.read(frame, limit: 100))
        let unmasked = WebSocketFrame.encode(opcode: WebSocketFrame.text, payload: Data("hi".utf8))
        XCTAssertEqual([UInt8](unmasked), [0x81, 2, 0x68, 0x69])
        XCTAssertThrowsError(try WebSocketFrame.read(unmasked, limit: 4096))
    }

    func testDrawsTheCodeToScan() {
        XCTAssertTrue(QRImage.dataURL(for: "http://192.168.1.20:47821/#pair=123456")?.hasPrefix("data:image/png;base64,") == true)
    }

    func testReadsTheDialogAndSyncMessages() {
        XCTAssertEqual(HostMessage.parse(#"{"type":"devices-open"}"#), .devicesOpen)
        XCTAssertEqual(HostMessage.parse(#"{"type":"devices-enable","enabled":true}"#), .devicesEnable(true))
        XCTAssertNil(HostMessage.parse(#"{"type":"devices-enable","enabled":1}"#))
        XCTAssertEqual(HostMessage.parse(#"{"type":"devices-pair","address":"192.168.1.2"}"#), .devicesPair(address: "192.168.1.2"))
        XCTAssertEqual(HostMessage.parse(#"{"type":"devices-rename","id":"device-1","name":"Phone"}"#), .devicesRename(id: "device-1", name: "Phone"))
        XCTAssertEqual(HostMessage.parse(#"{"type":"devices-remove","id":"device-1"}"#), .devicesRemove(id: "device-1"))
        XCTAssertEqual(HostMessage.parse(#"{"type":"sync-send","deviceId":"device-1","message":{"type":"ack"}}"#), .syncSend(deviceId: "device-1", message: #"{"type":"ack"}"#))
        XCTAssertEqual(HostMessage.parse(#"{"type":"sync-broadcast","ops":[]}"#), .syncBroadcast(ops: "[]"))
        XCTAssertNil(HostMessage.parse(#"{"type":"sync-broadcast","ops":{}}"#))
    }
}

final class LanServerTests: XCTestCase, LanEvents {
    private var folder: URL!
    private var store: DeviceStore!
    private var server: LanServer!
    private var log: [String] = []
    private let logLock = NSLock()

    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("chartroom-tests/\(UUID().uuidString)")
        let web = folder.appendingPathComponent("web")
        try FileManager.default.createDirectory(at: web, withIntermediateDirectories: true)
        try Data("<html><head><title>Chartroom</title></head></html>".utf8).write(to: web.appendingPathComponent("index.html"))
        store = DeviceStore(folder: folder)
        try store.setEnabled(true)
        server = LanServer(store: store, resources: WebResources(root: web), events: self, port: 0)
        try server.start()
    }

    override func tearDown() {
        server.stop()
        try? FileManager.default.removeItem(at: folder)
    }

    func joined(deviceId: String, name: String) { record("joined \(name)") }
    func left(deviceId: String) { record("left") }
    func message(deviceId: String, json: String) { record("message \(json)") }
    func denied() { record("denied") }

    private func record(_ entry: String) {
        logLock.lock()
        log.append(entry)
        logLock.unlock()
    }

    private func waitForLog(_ entry: String) {
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            logLock.lock()
            let found = log.contains(entry)
            logLock.unlock()
            if found { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        XCTFail("Never logged: \(entry)")
    }

    private func socket(origin: String? = nil) -> URLSessionWebSocketTask {
        var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(server.port)/")!)
        request.setValue(origin ?? "http://127.0.0.1:\(server.port)", forHTTPHeaderField: "Origin")
        let task = URLSession.shared.webSocketTask(with: request)
        task.resume()
        return task
    }

    private func receive(_ task: URLSessionWebSocketTask) async throws -> [String: Any] {
        guard case .string(let text) = try await task.receive() else { return [:] }
        return (try JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
    }

    func testServesThePageMarkedForADevice() async throws {
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(server.port)/")!)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains(LanServer.deviceMarker))
        let (_, missing) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(server.port)/devices.json")!)
        XCTAssertEqual((missing as? HTTPURLResponse)?.statusCode, 404)
    }

    func testPairsWithTheShownCode_ThenRecognizesTheTokenAndCarriesMessagesBothWays() async throws {
        let code = store.startPairing()
        let first = socket()
        try await first.send(.string(#"{"type":"pair","code":"\#(code)","name":"iPhone"}"#))
        let welcome = try await receive(first)
        XCTAssertEqual(welcome["type"] as? String, "welcome")
        let token = try XCTUnwrap(welcome["token"] as? String)
        waitForLog("joined iPhone")
        first.cancel(with: .normalClosure, reason: nil)
        waitForLog("left")

        let again = socket()
        try await again.send(.string(#"{"type":"hello","token":"\#(token)"}"#))
        let hello = try await receive(again)
        XCTAssertNil(hello["token"])
        let deviceId = try XCTUnwrap(hello["deviceId"] as? String)
        try await again.send(.string(#"{"type":"ops","batch":1}"#))
        waitForLog(#"message {"type":"ops","batch":1}"#)
        server.send(deviceId: deviceId, json: #"{"type":"ack"}"#)
        let ack = try await receive(again)
        XCTAssertEqual(ack["type"] as? String, "ack")
        again.cancel(with: .normalClosure, reason: nil)
    }

    func testAWrongCodeIsDenied() async throws {
        _ = store.startPairing()
        let task = socket()
        try await task.send(.string(#"{"type":"pair","code":"abc"}"#))
        let reply = try await receive(task)
        XCTAssertEqual(reply["type"] as? String, "denied")
        waitForLog("denied")
    }

    func testASocketFromAnotherSiteIsRefused() async {
        let task = socket(origin: "http://evil.example")
        do {
            _ = try await task.receive()
            XCTFail("A socket from another site was accepted")
        } catch {}
    }
}
