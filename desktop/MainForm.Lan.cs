using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using QRCoder;
using SailwindChartroom.Lan;

namespace SailwindChartroom;

// Phones and tablets on the player's network. The server runs while the player allows devices; the page's
// Devices dialog shows its state, and the page applies and sends out chart changes (src/hub.mjs). The host
// relays sync messages without reading them, and runs following for a device as it does for the page.
internal sealed partial class MainForm : ILanEvents
{
    private DeviceStore? devices;
    private LanServer? lan;
    private string? lanError;
    private (string Code, string Url, string Address, DateTime Expires, string Qr)? pairingShown;
    // The logs offered to each device, apart from the page's own, so one can't change what another picks from.
    private readonly Dictionary<string, List<string>> deviceLogs = [];

    private void StartDevices()
    {
        devices = new DeviceStore(store.Folder);
        devices.Load();
        if (devices.Enabled) StartLan();
    }

    private void StartLan()
    {
        lanError = null;
        var server = new LanServer(devices!, this);
        try
        {
            server.Start();
            lan = server;
        }
        catch (SocketException)
        {
            server.Dispose();
            lanError = $"Another program is using port {LanServer.DefaultPort}, so devices can't connect. Close that program, then turn Allow mobile devices on this network off and on again.";
        }
    }

    private void StopLan()
    {
        lan?.Dispose();
        lan = null;
        pairingShown = null;
    }

    private void HandleDevicesMessage(HostMessage message)
    {
        if (devices is null) return;
        switch (message)
        {
            case HostMessage.DevicesOpen:
                break;
            case HostMessage.DevicesEnable enable:
                devices.SetEnabled(enable.Enabled);
                if (enable.Enabled && lan is null) StartLan();
                if (!enable.Enabled) StopLan();
                break;
            case HostMessage.DevicesPair pair when lan is not null:
                var addresses = LocalAddresses();
                string address = addresses.Contains(pair.Address) ? pair.Address : addresses.FirstOrDefault() ?? "";
                if (address.Length == 0) break;
                string code = devices.StartPairing(DateTime.UtcNow);
                string url = $"http://{address}:{lan.Port}/#pair={code}";
                pairingShown = (code, url, address, DateTime.UtcNow + DeviceStore.CodeLifetime, QrImage(url));
                break;
            case HostMessage.DevicesPairStop:
                devices.StopPairing();
                pairingShown = null;
                break;
            case HostMessage.DevicesRename rename:
                devices.Rename(rename.Id, rename.Name);
                break;
            case HostMessage.DevicesRemove remove:
                devices.Remove(remove.Id);
                lan?.Disconnect(remove.Id);
                break;
            case HostMessage.SyncSend send:
                lan?.Send(send.DeviceId, send.Message);
                return;
            case HostMessage.SyncBroadcast broadcast:
                lan?.Broadcast($$"""{"type":"ops","ops":{{broadcast.Ops}}}""");
                return;
        }
        PostDevicesState();
    }

    private void PostDevicesState()
    {
        if (devices is null) return;
        // A pairing code shows until it is used, expires or is replaced.
        if (pairingShown is { } shown && (DateTime.UtcNow > shown.Expires || lan is null || !devices.Pairing)) pairingShown = null;
        var connected = lan?.Connected ?? [];
        Post(new
        {
            type = "devices-state",
            enabled = devices.Enabled,
            running = lan is not null,
            error = lanError,
            port = LanServer.DefaultPort,
            addresses = LocalAddresses(),
            devices = devices.Devices.Select(device => new { id = device.Id, name = device.Name, lastSeen = device.LastSeen.ToString("o"), connected = connected.Contains(device.Id) }),
            pairing = pairingShown is { } pairing ? new { code = pairing.Code, url = pairing.Url, address = pairing.Address, expires = pairing.Expires.ToString("o"), qr = pairing.Qr } : null
        });
    }

    // The IPv4 addresses a device on the same network could reach, those with a gateway first.
    private static List<string> LocalAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up && adapter.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .Select(adapter => adapter.GetIPProperties())
            .OrderByDescending(properties => properties.GatewayAddresses.Any(gateway => gateway.Address.AddressFamily == AddressFamily.InterNetwork))
            .SelectMany(properties => properties.UnicastAddresses)
            .Select(unicast => unicast.Address)
            .Where(address => address.AddressFamily == AddressFamily.InterNetwork && LanServer.IsLocalNetwork(address) && !System.Net.IPAddress.IsLoopback(address) && address.GetAddressBytes()[0] != 169)
            .Select(address => address.ToString())
            .Distinct()
            .ToList();

    private static string QrImage(string text)
    {
        byte[] png = PngByteQRCodeHelper.GetQRCode(text, QRCodeGenerator.ECCLevel.M, 8);
        return "data:image/png;base64," + Convert.ToBase64String(png);
    }

    // After a reload the page learns of every connected device again, and so sends each of them the charts.
    private void ReplayDevices()
    {
        foreach (string deviceId in lan?.Connected ?? []) Post(new { type = "device-joined", deviceId });
    }

    // Following is shared: every connected device hears when it starts and stops.
    private void TellDevicesFollowing() =>
        lan?.Broadcast(follower is null
            ? """{"type":"track-stopped"}"""
            : JsonSerializer.Serialize(new { type = "track-following", name = follower.FileName, chartId = followedChartId }));

    private void HandleDeviceMessage(string deviceId, string json)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(json);
            root = document.RootElement.Clone();
        }
        catch (JsonException) { return; }
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return;
        switch (type.GetString())
        {
            case "ops" or "missing-answer":
                Post(new { type = "device-message", deviceId, message = root });
                break;
            // A device may follow one of Voyage Recorder's logs; picking another file needs the desktop.
            case "follow-track" when root.TryGetProperty("chartId", out var chart) && chart.ValueKind == JsonValueKind.String:
                if (root.TryGetProperty("log", out var log) && log.TryGetInt32(out int index))
                {
                    if (deviceLogs.TryGetValue(deviceId, out var offered) && index >= 0 && index < offered.Count) StartFollowing(offered[index], chart.GetString()!);
                    break;
                }
                var found = VoyageLogs.All(VoyageLogs.Folder(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))).Select(file => file.FullName).ToList();
                deviceLogs[deviceId] = found;
                var logs = found.Select((path, id) => new { id, name = Path.GetFileName(path), place = "", modified = File.GetLastWriteTimeUtc(path).ToString("o") });
                lan?.Send(deviceId, JsonSerializer.Serialize(new { type = "track-choices", chartId = chart.GetString(), logs }));
                break;
            case "stop-track":
                StopFollowing();
                break;
        }
    }

    // Server events arrive on worker threads; the window handles them on its own, unless it is closing.
    private void OnWindowThread(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { }
    }

    void ILanEvents.Joined(string deviceId, string name) => OnWindowThread(() =>
    {
        Post(new { type = "device-joined", deviceId });
        if (follower is not null) lan?.Send(deviceId, JsonSerializer.Serialize(new { type = "track-following", name = follower.FileName, chartId = followedChartId, resumed = true }));
        PostDevicesState();
    });

    void ILanEvents.Left(string deviceId) => OnWindowThread(() =>
    {
        Post(new { type = "device-left", deviceId });
        PostDevicesState();
    });

    void ILanEvents.Message(string deviceId, string json) => OnWindowThread(() => HandleDeviceMessage(deviceId, json));

    // A wrong guess may have used up the code showing, which the dialog then stops showing.
    void ILanEvents.Denied() => OnWindowThread(PostDevicesState);
}
