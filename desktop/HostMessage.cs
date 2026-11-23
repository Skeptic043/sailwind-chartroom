using System.Text.Json;

namespace SailwindChartroom;

/// <summary>Messages the chart page may send to the desktop host. Anything else is ignored.</summary>
internal abstract record HostMessage
{
    public sealed record Ready : HostMessage;
    public sealed record Save(string Workspace) : HostMessage;
    public sealed record Pin : HostMessage;
    public sealed record OpenFolder : HostMessage;
    public sealed record CheckUpdates : HostMessage;
    public sealed record InstallUpdate : HostMessage;
    public sealed record CancelUpdate : HostMessage;
    public sealed record OpenReleases : HostMessage;
    public sealed record OpenSettings(AppSettings Settings, IReadOnlyList<ToolShortcut> Defaults) : HostMessage;
    public sealed record SetZoom(double Factor) : HostMessage;
    public sealed record SetAppearance(bool Dark) : HostMessage;
    public sealed record ExportFile(string Name, string Contents) : HostMessage;
    /// <summary>
    /// Follow a recording into the chart with this id. Without a choice the host offers the recordings it
    /// finds; Log follows one of those it offered, and Pick asks for a file instead.
    /// </summary>
    public sealed record FollowTrack(string ChartId, int? Log = null, bool Pick = false) : HostMessage;
    public sealed record StopTrack : HostMessage;
    public sealed record CopyText(string Contents) : HostMessage;
    /// <summary>A Chartroom Voyages page or submission form to open in the player's browser.</summary>
    public sealed record OpenLink(string Url) : HostMessage;
    // Phones and tablets on the player's network: the page's Devices dialog, and sync messages to relay.
    public sealed record DevicesOpen : HostMessage;
    public sealed record DevicesEnable(bool Enabled) : HostMessage;
    /// <summary>Show a pairing code for the page at this address, or the first one found when empty.</summary>
    public sealed record DevicesPair(string Address) : HostMessage;
    public sealed record DevicesPairStop : HostMessage;
    public sealed record DevicesRename(string Id, string Name) : HostMessage;
    public sealed record DevicesRemove(string Id) : HostMessage;
    /// <summary>A message for one device, as raw JSON the host passes on unread.</summary>
    public sealed record SyncSend(string DeviceId, string Message) : HostMessage;
    /// <summary>Chart changes for every connected device, as a raw JSON array.</summary>
    public sealed record SyncBroadcast(string Ops) : HostMessage;

    public static HostMessage? Parse(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("type", out var type)
                || type.ValueKind != JsonValueKind.String) return null;
            return type.GetString() switch
            {
                "ready" => new Ready(),
                "pin" => new Pin(),
                "open-folder" => new OpenFolder(),
                "check-updates" => new CheckUpdates(),
                "install-update" => new InstallUpdate(),
                "cancel-update" => new CancelUpdate(),
                "open-releases" => new OpenReleases(),
                "follow-track" when Text(root, "chartId") is { Length: > 0 } chartId => new FollowTrack(chartId,
                    root.TryGetProperty("log", out var log) && log.TryGetInt32(out int index) && index >= 0 ? index : null,
                    root.TryGetProperty("pick", out var pick) && pick.ValueKind == JsonValueKind.True),
                "stop-track" => new StopTrack(),
                "copy-text" when Text(root, "text") is { Length: > 0 } text => new CopyText(text),
                "open-link" when Text(root, "url") is { } url && IsSiteLink(url) => new OpenLink(url),
                "open-settings" when root.TryGetProperty("settings", out var settings) && AppSettings.Parse(settings) is { } parsed
                    && root.TryGetProperty("defaults", out var defaults) && AppSettings.Parse(JsonSerializer.SerializeToElement(new { tools = defaults })) is { } fallback
                    => new OpenSettings(parsed, fallback.Tools),
                "set-appearance" when root.TryGetProperty("dark", out var dark) && dark.ValueKind is JsonValueKind.True or JsonValueKind.False => new SetAppearance(dark.GetBoolean()),
                "set-zoom" when root.TryGetProperty("factor", out var factor) && factor.TryGetDouble(out double value) && value is >= 0.5 and <= 3 => new SetZoom(value),
                "export-file" when Text(root, "name") is { Length: > 0 } name && Text(root, "contents") is { } contents => new ExportFile(name, contents),
                "save" when root.TryGetProperty("workspace", out var workspace) && IsWorkspace(workspace) => new Save(workspace.GetRawText()),
                "devices-open" => new DevicesOpen(),
                "devices-enable" when root.TryGetProperty("enabled", out var enabled) && enabled.ValueKind is JsonValueKind.True or JsonValueKind.False => new DevicesEnable(enabled.GetBoolean()),
                "devices-pair" => new DevicesPair(Text(root, "address") ?? ""),
                "devices-pair-stop" => new DevicesPairStop(),
                "devices-rename" when Text(root, "id") is { Length: > 0 } id && Text(root, "name") is { } name => new DevicesRename(id, name),
                "devices-remove" when Text(root, "id") is { Length: > 0 } id => new DevicesRemove(id),
                "sync-send" when Text(root, "deviceId") is { Length: > 0 } deviceId && root.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.Object
                    => new SyncSend(deviceId, message.GetRawText()),
                "sync-broadcast" when root.TryGetProperty("ops", out var ops) && ops.ValueKind == JsonValueKind.Array => new SyncBroadcast(ops.GetRawText()),
                _ => null
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    // Only Chartroom Voyages: its pages on GitHub Pages and new issues on its repository, as isSiteLink in src/site.mjs.
    private static bool IsSiteLink(string url) =>
        url.Length <= 8000
        && Uri.TryCreate(url, UriKind.Absolute, out var parsed)
        && parsed.Scheme == Uri.UriSchemeHttps
        && parsed.UserInfo.Length == 0
        && parsed.IsDefaultPort
        && ((parsed.Host == "skeptic043.github.io" && parsed.AbsolutePath.StartsWith("/sailwind-chartroom-voyages/", StringComparison.Ordinal))
            || (parsed.Host == "github.com" && parsed.AbsolutePath == "/Skeptic043/sailwind-chartroom-voyages/issues/new"));

    private static bool IsWorkspace(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty("charts", out var charts)
        && charts.ValueKind == JsonValueKind.Array;
}
