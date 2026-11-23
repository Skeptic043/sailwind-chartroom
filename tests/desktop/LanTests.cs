using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using SailwindChartroom.Lan;

namespace SailwindChartroom.Tests;

public sealed class DeviceStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), "chartroom-tests", Guid.NewGuid().ToString("N"));
    private readonly DateTime now = new(2026, 11, 23, 12, 0, 0, DateTimeKind.Utc);

    public void Dispose()
    {
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    private DeviceStore Enabled()
    {
        var store = new DeviceStore(folder);
        store.Load();
        store.SetEnabled(true);
        return store;
    }

    [Fact]
    public void TheShownCodePairsOnceAndTheTokenThenRecognizesTheDevice()
    {
        var store = Enabled();
        string code = store.StartPairing(now);
        var paired = store.TryPair(code, "Android phone", now.AddMinutes(1));
        Assert.NotNull(paired);
        Assert.Null(store.TryPair(code, "Second", now.AddMinutes(1)));
        Assert.Equal(paired.Value.Device.Id, store.Authenticate(paired.Value.Token)?.Id);
        Assert.Null(store.Authenticate("not-a-token"));
        Assert.DoesNotContain(paired.Value.Token, File.ReadAllText(Path.Combine(folder, "devices.json")));
    }

    [Fact]
    public void ACodeStopsWorkingAfterFiveWrongTriesOrWhenItExpires()
    {
        var store = Enabled();
        string code = store.StartPairing(now);
        string wrong = code == "000000" ? "111111" : "000000";
        for (int i = 0; i < DeviceStore.CodeAttempts; i++) Assert.Null(store.TryPair(wrong, "x", now));
        Assert.Null(store.TryPair(code, "x", now));
        code = store.StartPairing(now);
        Assert.Null(store.TryPair(code, "x", now + DeviceStore.CodeLifetime + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void PairedDevicesAndTheSwitchSurviveARestart_AndTurningItOffRefusesEveryone()
    {
        var store = Enabled();
        var paired = store.TryPair(store.StartPairing(now), "  Tablet\u0007 ", now)!.Value;
        var reopened = new DeviceStore(folder);
        reopened.Load();
        Assert.True(reopened.Enabled);
        Assert.Equal("Tablet", Assert.Single(reopened.Devices).Name);
        reopened.SetEnabled(false);
        Assert.Null(reopened.Authenticate(paired.Token));
        string code = reopened.StartPairing(now);
        Assert.Null(reopened.TryPair(code, "x", now));
    }

    [Fact]
    public void PairingAgainReplacesTheDevicesOldEntry()
    {
        var store = Enabled();
        var first = store.TryPair(store.StartPairing(now), "Phone", now)!.Value;
        var again = store.TryPair(store.StartPairing(now), "Phone", now, first.Token)!.Value;
        Assert.Equal(again.Device.Id, Assert.Single(store.Devices).Id);
        Assert.Null(store.Authenticate(first.Token));
    }

    [Fact]
    public void ARemovedDeviceIsNoLongerRecognized()
    {
        var store = Enabled();
        var paired = store.TryPair(store.StartPairing(now), "Phone", now)!.Value;
        store.Rename(paired.Device.Id, "Deck phone");
        Assert.Equal("Deck phone", store.Devices[0].Name);
        Assert.True(store.Remove(paired.Device.Id));
        Assert.Null(store.Authenticate(paired.Token));
    }
}

public sealed class LanServerTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), "chartroom-tests", Guid.NewGuid().ToString("N"));
    private readonly DeviceStore store;
    private readonly Events events = new();
    private readonly LanServer server;

    public LanServerTests()
    {
        store = new DeviceStore(folder);
        store.SetEnabled(true);
        server = new LanServer(store, events, port: 0);
        server.Start();
    }

    public void Dispose()
    {
        server.Dispose();
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    private sealed class Events : ILanEvents
    {
        public readonly BlockingCollection<string> Log = [];
        public void Joined(string deviceId, string name) => Log.Add($"joined {name}");
        public void Left(string deviceId) => Log.Add("left");
        public void Message(string deviceId, string json) => Log.Add($"message {json}");
        public void Denied() { }
        public string Next() => Log.TryTake(out string? entry, TimeSpan.FromSeconds(5)) ? entry : "nothing";
    }

    private Uri Socket => new($"ws://127.0.0.1:{server.Port}/");

    private async Task<ClientWebSocket> ConnectAsync(string? origin = null)
    {
        var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", origin ?? $"http://127.0.0.1:{server.Port}");
        await socket.ConnectAsync(Socket, CancellationToken.None);
        return socket;
    }

    private static Task SendAsync(ClientWebSocket socket, object message) =>
        socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message), WebSocketMessageType.Text, true, CancellationToken.None);

    private static async Task<JsonElement> ReceiveAsync(ClientWebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var result = await socket.ReceiveAsync(buffer, timeout.Token);
        return JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, result.Count)).RootElement.Clone();
    }

    [Fact]
    public async Task ServesThePageMarkedForADevice()
    {
        using var http = new HttpClient();
        string page = await http.GetStringAsync($"http://127.0.0.1:{server.Port}/");
        Assert.Contains(LanServer.DeviceMarker, page);
        var missing = await http.GetAsync($"http://127.0.0.1:{server.Port}/../desktop/devices.json");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task PairsWithTheShownCode_ThenRecognizesTheTokenAndCarriesMessagesBothWays()
    {
        string code = store.StartPairing(DateTime.UtcNow);
        string token;
        using (var socket = await ConnectAsync())
        {
            await SendAsync(socket, new { type = "pair", code, name = "Android phone" });
            var welcome = await ReceiveAsync(socket);
            Assert.Equal("welcome", welcome.GetProperty("type").GetString());
            token = welcome.GetProperty("token").GetString()!;
            Assert.Equal("joined Android phone", events.Next());
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
            Assert.Equal("left", events.Next());
        }
        using var again = await ConnectAsync();
        await SendAsync(again, new { type = "hello", token });
        var hello = await ReceiveAsync(again);
        Assert.False(hello.TryGetProperty("token", out _));
        string deviceId = hello.GetProperty("deviceId").GetString()!;
        Assert.Equal("joined Android phone", events.Next());
        await SendAsync(again, new { type = "ops", batch = 1 });
        Assert.Equal("""message {"type":"ops","batch":1}""", events.Next());
        server.Send(deviceId, """{"type":"ack"}""");
        Assert.Equal("ack", (await ReceiveAsync(again)).GetProperty("type").GetString());
    }

    [Fact]
    public async Task AWrongCodeOrUnknownTokenIsDenied()
    {
        store.StartPairing(DateTime.UtcNow);
        foreach (object first in new object[] { new { type = "pair", code = "abc" }, new { type = "hello", token = "nope" }, new { type = "ops" } })
        {
            using var socket = await ConnectAsync();
            await SendAsync(socket, first);
            Assert.Equal("denied", (await ReceiveAsync(socket)).GetProperty("type").GetString());
        }
        Assert.Empty(events.Log);
    }

    [Fact]
    public async Task ASocketFromAnotherSiteIsRefused()
    {
        await Assert.ThrowsAsync<WebSocketException>(() => ConnectAsync("http://evil.example"));
    }

    [Theory]
    [InlineData("192.168.1.20", true)]
    [InlineData("10.0.0.5", true)]
    [InlineData("172.20.1.1", true)]
    [InlineData("169.254.3.3", true)]
    [InlineData("127.0.0.1", true)]
    [InlineData("172.32.0.1", false)]
    [InlineData("8.8.8.8", false)]
    [InlineData("100.64.1.1", false)]
    [InlineData("fe80::1", false)]
    public void OnlyTheLocalNetworkMayConnect(string address, bool allowed) =>
        Assert.Equal(allowed, LanServer.IsLocalNetwork(IPAddress.Parse(address)));
}
