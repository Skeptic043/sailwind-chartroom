import Foundation
import Network

/// What the server reports, on its own queue. Calls for one device come in order.
public protocol LanEvents: AnyObject {
    func joined(deviceId: String, name: String)
    func left(deviceId: String)
    func message(deviceId: String, json: String)
    /// A pairing attempt failed, which may have used up the code showing.
    func denied()
}

/// Serves the chart page to phones and tablets on the player's network and carries their sync connection.
/// Only private and link-local IPv4 addresses may connect. Page files need no pairing, since they are the
/// public app; the WebSocket's first message must pair with the code the player is showing or present a
/// device's token, and anything else closes it. The macOS counterpart of desktop/Lan/LanServer.cs.
public final class LanServer {
    public static let defaultPort: UInt16 = 47821
    /// Marks the page as served to a device, so it connects back here instead of to a desktop window.
    public static let deviceMarker = #"<meta name="chartroom-device" content="1">"#
    private static let maxHeaderBytes = 8192
    private static let maxMessageBytes = 16 * 1024 * 1024
    private static let maxFirstMessageBytes = 4096
    // Connections not yet paired or recognized; more are refused, so a flood can't hold much memory.
    private static let maxUnadmitted = 16
    private static let requestTimeout: TimeInterval = 10
    private static let keepAlive: TimeInterval = 20

    private let queue = DispatchQueue(label: "chartroom.lan")
    private let store: DeviceStore
    private let resources: WebResources
    private weak var events: LanEvents?
    private let requestedPort: UInt16
    private var listener: NWListener?
    // Touched only on the queue.
    private var sessions: [String: Session] = [:]
    private var unadmitted = 0

    public init(store: DeviceStore, resources: WebResources, events: LanEvents, port: UInt16 = LanServer.defaultPort) {
        self.store = store
        self.resources = resources
        self.events = events
        requestedPort = port
    }

    /// The port it listens on, once started.
    public var port: UInt16 { listener?.port?.rawValue ?? requestedPort }

    /// The devices connected now.
    public var connected: [String] { queue.sync { Array(sessions.keys) } }

    /// Starts listening, waiting briefly to hear whether it could. Throws when the port is taken.
    public func start() throws {
        let parameters = NWParameters.tcp
        // Turning devices off and on again reuses the port while closed connections linger on it.
        parameters.allowLocalEndpointReuse = true
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
        let listener = requestedPort == 0
            ? try NWListener(using: parameters)
            : try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: requestedPort)!)
        let settled = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed, .waiting: settled.signal()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
        _ = settled.wait(timeout: .now() + 5)
        listener.stateUpdateHandler = nil
        switch listener.state {
        case .ready:
            self.listener = listener
        case .failed(let error), .waiting(let error):
            listener.cancel()
            throw error
        default:
            listener.cancel()
            throw NWError.posix(.ETIMEDOUT)
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
        queue.async { for session in self.sessions.values { session.close() } }
    }

    /// Sends a JSON message to one device, after anything already sent to it.
    public func send(deviceId: String, json: String) {
        queue.async { self.sessions[deviceId]?.send(text: json) }
    }

    public func broadcast(json: String) {
        queue.async { for session in self.sessions.values { session.send(text: json) } }
    }

    /// Closes a device's connection, as when the player removes it.
    public func disconnect(deviceId: String) {
        queue.async { self.sessions[deviceId]?.close() }
    }

    // MARK: Connections

    private func accept(_ connection: NWConnection) {
        guard case let .hostPort(host, _) = connection.endpoint, LanAddress.isLocalNetwork(Self.text(of: host)) else {
            connection.cancel()
            return
        }
        connection.start(queue: queue)
        let timeout = DispatchWorkItem { connection.cancel() }
        queue.asyncAfter(deadline: .now() + Self.requestTimeout, execute: timeout)
        readHeaders(connection, buffer: Data()) { [weak self] request in
            timeout.cancel()
            guard let self, let request else { return connection.cancel() }
            if request.header("Upgrade")?.lowercased() == "websocket" { self.upgrade(connection, request) }
            else { self.serve(connection, request) }
        }
    }

    private static func text(of host: NWEndpoint.Host) -> String {
        let text: String
        switch host {
        case .ipv4(let address): text = "\(address)"
        case .ipv6(let address): text = "\(address)"
        case .name(let name, _): text = name
        @unknown default: text = ""
        }
        return String(text.split(separator: "%", maxSplits: 1).first ?? "")
    }

    // Reads up to the blank line that ends the headers, and no further.
    private func readHeaders(_ connection: NWConnection, buffer: Data, done: @escaping (LanRequest?) -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: Self.maxHeaderBytes) { [weak self] data, _, complete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = LanRequest.headerEnd(in: buffer) { return done(LanRequest.parse(buffer.prefix(end))) }
            guard let self, error == nil, !complete, buffer.count < LanServer.maxHeaderBytes else { return done(nil) }
            self.readHeaders(connection, buffer: buffer, done: done)
        }
    }

    private func serve(_ connection: NWConnection, _ request: LanRequest) {
        let path = request.path == "/" ? "/index.html" : request.path
        guard request.method == "GET", let found = resources.file(atPath: path), var body = try? Data(contentsOf: found.file) else {
            return respond(connection, status: request.method == "GET" ? "404 Not Found" : "405 Method Not Allowed", type: "text/plain", body: Data())
        }
        if path == "/index.html", let page = String(data: body, encoding: .utf8) {
            body = Data(page.replacingOccurrences(of: "<head>", with: "<head>\n  " + Self.deviceMarker).utf8)
        }
        let policy = WebResources.contentSecurityPolicy.replacingOccurrences(of: "connect-src 'self'", with: "connect-src 'self' ws:")
        respond(connection, status: "200 OK", type: found.contentType, body: body,
                headers: "Content-Security-Policy: \(policy)\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n")
    }

    private func respond(_ connection: NWConnection, status: String, type: String, body: Data, headers: String = "") {
        var response = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n\(headers)Connection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func upgrade(_ connection: NWConnection, _ request: LanRequest) {
        // A page from anywhere else could open a socket here, so it must come from the page this server sent,
        // by its address: a name could be a site's own name pointed at this PC.
        guard request.method == "GET", let key = request.header("Sec-WebSocket-Key"), let host = request.header("Host"),
              request.header("Origin") == "http://\(host)", LanAddress.isAddressHost(host), unadmitted < Self.maxUnadmitted else {
            return respond(connection, status: "403 Forbidden", type: "text/plain", body: Data())
        }
        unadmitted += 1
        let accept = LanRequest.webSocketAccept(key: key)
        connection.send(content: Data("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n".utf8),
                        completion: .contentProcessed { _ in })
        let session = Session(connection: connection, queue: queue)
        session.limit = Self.maxFirstMessageBytes
        // Counted once, however the wait ends: a first message, the connection closing, or time running out.
        let settle: (Session) -> Bool = { [weak self] session in
            guard !session.admitted else { return false }
            session.admitted = true
            self?.unadmitted -= 1
            return true
        }
        let timeout = DispatchWorkItem { [weak self, weak session] in
            guard let session, settle(session) else { return }
            self?.events?.denied()
            session.close()
        }
        queue.asyncAfter(deadline: .now() + Self.requestTimeout, execute: timeout)
        session.onText = { [weak self, weak session] first in
            guard let self, let session, settle(session) else { return }
            timeout.cancel()
            guard let entry = self.admit(first) else {
                self.events?.denied()
                session.send(text: #"{"type":"denied"}"#)
                session.close()
                return
            }
            self.run(session, device: entry.device, welcome: entry.welcome)
        }
        session.onEnd = { [weak self, weak session] in
            guard let session, settle(session) else { return }
            timeout.cancel()
            self?.events?.denied()
        }
        session.read()
    }

    // Pairs with the code showing, or recognizes a paired device's token. Returns the device and the welcome.
    private func admit(_ json: String) -> (device: Device, welcome: String)? {
        guard let data = json.data(using: .utf8), let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        let text = { (name: String) in root[name] as? String ?? "" }
        switch text("type") {
        case "pair":
            guard let paired = store.pair(code: text("code"), name: text("name"), previousToken: root["previous"] as? String) else { return nil }
            return (paired.device, Self.json(["type": "welcome", "deviceId": paired.device.id, "name": paired.device.name, "token": paired.token]))
        case "hello":
            guard let known = store.authenticate(token: text("token")) else { return nil }
            return (known, Self.json(["type": "welcome", "deviceId": known.id, "name": known.name]))
        default:
            return nil
        }
    }

    private func run(_ session: Session, device: Device, welcome: String) {
        // A device that connects again replaces its older connection.
        sessions[device.id]?.close()
        sessions[device.id] = session
        session.limit = Self.maxMessageBytes
        session.send(text: welcome)
        events?.joined(deviceId: device.id, name: device.name)
        session.onText = { [weak self] json in self?.events?.message(deviceId: device.id, json: json) }
        session.onEnd = { [weak self, weak session] in
            guard let self, let session, self.sessions[device.id] === session else { return }
            self.sessions[device.id] = nil
            self.events?.left(deviceId: device.id)
            self.store.touch(id: device.id)
        }
        session.keepAlive(every: Self.keepAlive)
    }

    private static func json(_ object: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: object)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

/// One WebSocket connection: reads frames into whole text messages, answers pings, and lets go of a
/// device that stops answering, as when a phone sleeps. Used only on the server's queue.
final class Session {
    private let connection: NWConnection
    private let queue: DispatchQueue
    private var buffer = Data()
    private var message = Data()
    private var lastHeard = Date()
    private var ended = false
    private var fragmented = false
    // Whether the first message has been dealt with (LanServer.upgrade).
    var admitted = false
    var limit = 4096
    var onText: (String) -> Void = { _ in }
    var onEnd: () -> Void = {}

    init(connection: NWConnection, queue: DispatchQueue) {
        self.connection = connection
        self.queue = queue
    }

    func read() {
        // Holds the session until its connection ends, which completes this read.
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] data, _, complete, error in
            guard !self.ended else { return }
            if let data, !data.isEmpty {
                self.lastHeard = Date()
                self.buffer.append(data)
                do {
                    while let frame = try WebSocketFrame.read(self.buffer, limit: self.limit) {
                        self.buffer.removeFirst(frame.used)
                        self.handle(opcode: frame.opcode, fin: frame.fin, payload: frame.payload)
                        if self.ended { return }
                    }
                } catch {
                    return self.close()
                }
            }
            if complete || error != nil { return self.close() }
            self.read()
        }
    }

    private func handle(opcode: UInt8, fin: Bool, payload: Data) {
        switch opcode {
        case WebSocketFrame.text, WebSocketFrame.continuation:
            // A new message can't start inside another, and a continuation needs one to continue.
            guard (opcode == WebSocketFrame.text) != fragmented else { return close() }
            fragmented = !fin
            message.append(payload)
            if message.count > limit { return close() }
            guard fin else { return }
            let text = String(data: message, encoding: .utf8)
            message = Data()
            if let text { onText(text) }
        case WebSocketFrame.ping:
            write(WebSocketFrame.encode(opcode: WebSocketFrame.pong, payload: payload))
        case WebSocketFrame.close:
            close()
        case WebSocketFrame.pong:
            break
        default:
            // Binary frames mean something other than the chart page is talking.
            close()
        }
    }

    func send(text: String) {
        write(WebSocketFrame.encode(opcode: WebSocketFrame.text, payload: Data(text.utf8)))
    }

    private func write(_ frame: Data) {
        guard !ended else { return }
        // Completions run on the server's queue, where the session lives.
        connection.send(content: frame, completion: .contentProcessed { [weak self] error in
            if error != nil { self?.close() }
        })
    }

    /// Pings now and then; a device silent for two rounds is let go.
    func keepAlive(every interval: TimeInterval) {
        queue.asyncAfter(deadline: .now() + interval) { [weak self] in
            guard let self, !self.ended else { return }
            if Date().timeIntervalSince(self.lastHeard) > interval * 2 { return self.close() }
            self.write(WebSocketFrame.encode(opcode: WebSocketFrame.ping, payload: Data()))
            self.keepAlive(every: interval)
        }
    }

    func close() {
        guard !ended else { return }
        connection.send(content: WebSocketFrame.encode(opcode: WebSocketFrame.close, payload: Data()), completion: .contentProcessed { [connection] _ in connection.cancel() })
        ended = true
        onEnd()
    }
}
