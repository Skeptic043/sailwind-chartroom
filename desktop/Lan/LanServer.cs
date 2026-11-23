using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace SailwindChartroom.Lan;

/// <summary>What the server reports, on worker threads. Calls for one device come in order.</summary>
internal interface ILanEvents
{
    void Joined(string deviceId, string name);
    void Left(string deviceId);
    void Message(string deviceId, string json);
    /// <summary>A pairing attempt failed, which may have used up the code showing.</summary>
    void Denied();
}

/// <summary>
/// Serves the chart page to phones and tablets on the player's network and carries their sync connection.
/// Only private and link-local addresses may connect. Page files need no pairing, since they are the public
/// app; the WebSocket's first message must pair with the code the player is showing or present a device's
/// token, and anything else closes it.
/// </summary>
internal sealed class LanServer(DeviceStore store, ILanEvents events, int port = LanServer.DefaultPort) : IDisposable
{
    public const int DefaultPort = 47821;
    // Marks the page as served to a device, so it connects back here instead of to a desktop window.
    public const string DeviceMarker = "<meta name=\"chartroom-device\" content=\"1\">";
    private const int MaxHeaderBytes = 8192;
    private const int MaxMessageBytes = 16 * 1024 * 1024;
    private const int MaxFirstMessageBytes = 4096;
    // Connections not yet paired or recognized; more wait for a slot, so a flood can't hold much memory.
    private readonly SemaphoreSlim unadmitted = new(16);
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentDictionary<string, Session> sessions = new();
    private TcpListener? listener;

    public int Port => ((IPEndPoint?)listener?.LocalEndpoint)?.Port ?? port;

    /// <summary>Starts listening. Throws <see cref="SocketException"/> when the port is taken.</summary>
    public void Start()
    {
        listener = new TcpListener(IPAddress.Any, port);
        listener.Start();
        _ = AcceptAsync(listener);
    }

    public IReadOnlyCollection<string> Connected => [.. sessions.Keys];

    /// <summary>Sends a JSON message to one device, after anything already queued for it.</summary>
    public void Send(string deviceId, string json)
    {
        if (sessions.TryGetValue(deviceId, out var session)) session.Outgoing.Writer.TryWrite(json);
    }

    public void Broadcast(string json)
    {
        foreach (var session in sessions.Values) session.Outgoing.Writer.TryWrite(json);
    }

    /// <summary>Closes a device's connection, as when the player removes it.</summary>
    public void Disconnect(string deviceId)
    {
        if (sessions.TryGetValue(deviceId, out var session)) session.Close();
    }

    public void Dispose()
    {
        stopping.Cancel();
        listener?.Stop();
        foreach (var session in sessions.Values) session.Close();
    }

    /// <summary>IPv4 loopback, private (10/8, 172.16/12, 192.168/16) and link-local addresses. The server listens on IPv4 only.</summary>
    public static bool IsLocalNetwork(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        if (IPAddress.IsLoopback(address)) return true;
        byte[] b = address.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }

    private async Task AcceptAsync(TcpListener server)
    {
        while (!stopping.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await server.AcceptTcpClientAsync(stopping.Token); }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException) { return; }
            if (client.Client.RemoteEndPoint is IPEndPoint remote && IsLocalNetwork(remote.Address)) _ = HandleAsync(client);
            else client.Dispose();
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                var stream = client.GetStream();
                Request? request;
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token))
                {
                    timeout.CancelAfter(RequestTimeout);
                    request = await Request.ReadAsync(stream, MaxHeaderBytes, timeout.Token);
                }
                if (request is null) return;
                if (request.Header("Upgrade")?.Equals("websocket", StringComparison.OrdinalIgnoreCase) == true) await AcceptSocketAsync(stream, request);
                else await ServeFileAsync(stream, request);
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or SocketException or WebSocketException or ObjectDisposedException) { }
        }
    }

    private async Task ServeFileAsync(NetworkStream stream, Request request)
    {
        string path = request.Path == "/" ? "/index.html" : request.Path;
        using var file = request.Method == "GET" ? WebResources.Open(path) : null;
        if (file is null)
        {
            await WriteAsync(stream, request.Method == "GET" ? "404 Not Found" : "405 Method Not Allowed", "text/plain", []);
            return;
        }
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, stopping.Token);
        byte[] body = buffer.ToArray();
        if (path == "/index.html") body = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(body).Replace("<head>", "<head>\n  " + DeviceMarker));
        await WriteAsync(stream, "200 OK", WebResources.ContentType(path), body,
            $"Content-Security-Policy: {WebResources.ContentSecurityPolicy.Replace("connect-src 'self'", "connect-src 'self' ws:")}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n");
    }

    private async Task WriteAsync(NetworkStream stream, string status, string type, byte[] body, string headers = "")
    {
        string head = $"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\n{headers}Connection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head), stopping.Token);
        await stream.WriteAsync(body, stopping.Token);
    }

    private async Task AcceptSocketAsync(NetworkStream stream, Request request)
    {
        // A page from anywhere else could open a socket here, so it must come from the page this server sent,
        // by its address: a name could be a site's own name pointed at this PC.
        string? key = request.Header("Sec-WebSocket-Key");
        if (request.Method != "GET" || key is null || request.Header("Host") is not { } host || request.Header("Origin") != $"http://{host}"
            || !IPAddress.TryParse(host.Split(':')[0], out _))
        {
            await WriteAsync(stream, "403 Forbidden", "text/plain", []);
            return;
        }
        string accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"), stopping.Token);
        // A phone that stops answering, as when it sleeps, is let go after the keep-alive goes unanswered.
        using var socket = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions
        {
            IsServer = true,
            KeepAliveInterval = TimeSpan.FromSeconds(20),
            KeepAliveTimeout = TimeSpan.FromSeconds(20)
        });

        string? first = null;
        string? reply = null;
        Device? device = null;
        await unadmitted.WaitAsync(stopping.Token);
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
            timeout.CancelAfter(RequestTimeout);
            first = await ReceiveAsync(socket, timeout.Token, MaxFirstMessageBytes);
            device = first is null ? null : Admit(first, out reply);
        }
        finally
        {
            unadmitted.Release();
        }
        if (device is null)
        {
            events.Denied();
            await SendAsync(socket, """{"type":"denied"}""", stopping.Token);
            await socket.CloseOutputAsync(WebSocketCloseStatus.PolicyViolation, "denied", stopping.Token);
            return;
        }
        await RunSessionAsync(socket, device, reply!);
    }

    // Pairs with the code showing, or recognizes a paired device's token. Returns the device and the welcome.
    private Device? Admit(string json, out string? reply)
    {
        reply = null;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            string? Text(string name) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            switch (Text("type"))
            {
                case "pair" when store.TryPair(Text("code") ?? "", Text("name") ?? "", DateTime.UtcNow, Text("previous")) is { } paired:
                    reply = JsonSerializer.Serialize(new { type = "welcome", deviceId = paired.Device.Id, name = paired.Device.Name, token = paired.Token });
                    return paired.Device;
                case "hello" when store.Authenticate(Text("token") ?? "") is { } known:
                    reply = JsonSerializer.Serialize(new { type = "welcome", deviceId = known.Id, name = known.Name });
                    return known;
                default:
                    return null;
            }
        }
        catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task RunSessionAsync(WebSocket socket, Device device, string welcome)
    {
        using var closing = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
        var session = new Session(closing);
        // A device that connects again replaces its older connection.
        sessions.AddOrUpdate(device.Id, session, (_, older) => { older.Close(); return session; });
        session.Outgoing.Writer.TryWrite(welcome);
        var writer = WriteLoopAsync(socket, session);
        events.Joined(device.Id, device.Name);
        try
        {
            while (await ReceiveAsync(socket, session.Closing.Token) is { } message) events.Message(device.Id, message);
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or WebSocketException) { }
        finally
        {
            session.Closing.Cancel();
            session.Outgoing.Writer.TryComplete();
            await writer;
            if (socket.State == WebSocketState.CloseReceived)
            {
                using var timeout = new CancellationTokenSource(RequestTimeout);
                try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", timeout.Token); }
                catch (Exception error) when (error is IOException or OperationCanceledException or WebSocketException) { }
            }
            if (sessions.TryRemove(new KeyValuePair<string, Session>(device.Id, session))) events.Left(device.Id);
            try { store.Touch(device.Id, DateTime.UtcNow); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }

    private static async Task WriteLoopAsync(WebSocket socket, Session session)
    {
        try
        {
            await foreach (string json in session.Outgoing.Reader.ReadAllAsync(session.Closing.Token)) await SendAsync(socket, json, session.Closing.Token);
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or WebSocketException) { }
        session.Closing.Cancel();
    }

    private static Task SendAsync(WebSocket socket, string json, CancellationToken token) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, endOfMessage: true, token);

    // One whole text message, or null when the device closes. Messages over the limit close the connection.
    private static async Task<string?> ReceiveAsync(WebSocket socket, CancellationToken token, int limit = MaxMessageBytes)
    {
        using var buffer = new MemoryStream();
        byte[] chunk = new byte[16 * 1024];
        while (true)
        {
            var result = await socket.ReceiveAsync(chunk, token);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            buffer.Write(chunk, 0, result.Count);
            if (buffer.Length > limit) throw new WebSocketException("Message too large");
            if (result.EndOfMessage) return result.MessageType == WebSocketMessageType.Text ? Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length) : null;
        }
    }

    private sealed class Session(CancellationTokenSource closing)
    {
        public CancellationTokenSource Closing { get; } = closing;
        public Channel<string> Outgoing { get; } = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

        // Another thread may close a session just as it ends and its token goes away.
        public void Close()
        {
            try { Closing.Cancel(); }
            catch (ObjectDisposedException) { }
        }
    }

    /// <summary>An HTTP request's line and headers. The body is never read: only GET is served.</summary>
    private sealed class Request(string method, string path, Dictionary<string, string> headers)
    {
        public string Method { get; } = method;
        public string Path { get; } = path;
        public string? Header(string name) => headers.GetValueOrDefault(name);

        public static async Task<Request?> ReadAsync(Stream stream, int limit, CancellationToken token)
        {
            var bytes = new List<byte>(1024);
            byte[] one = new byte[1];
            // Read a byte at a time up to the blank line, so nothing after it is consumed.
            while (bytes.Count < limit)
            {
                if (await stream.ReadAsync(one, token) == 0) return null;
                bytes.Add(one[0]);
                int n = bytes.Count;
                if (n >= 4 && bytes[n - 4] == '\r' && bytes[n - 3] == '\n' && bytes[n - 2] == '\r' && bytes[n - 1] == '\n') break;
            }
            if (bytes.Count >= limit) return null;
            string[] lines = Encoding.ASCII.GetString([.. bytes]).Split("\r\n");
            string[] start = lines[0].Split(' ');
            if (start.Length != 3 || !start[1].StartsWith('/')) return null;
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string line in lines.Skip(1))
            {
                int colon = line.IndexOf(':');
                if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
            }
            string path = start[1].Split('?', '#')[0];
            return path.Contains("..", StringComparison.Ordinal) ? null : new Request(start[0], Uri.UnescapeDataString(path), headers);
        }
    }
}
