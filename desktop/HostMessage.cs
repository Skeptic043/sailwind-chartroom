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
    /// <summary>Follow a Coordinate Viewer file into the chart with this id.</summary>
    public sealed record FollowTrack(string ChartId) : HostMessage;
    public sealed record StopTrack : HostMessage;
    public sealed record CopyText(string Contents) : HostMessage;

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
                "follow-track" when Text(root, "chartId") is { Length: > 0 } chartId => new FollowTrack(chartId),
                "stop-track" => new StopTrack(),
                "copy-text" when Text(root, "text") is { Length: > 0 } text => new CopyText(text),
                "open-settings" when root.TryGetProperty("settings", out var settings) && AppSettings.Parse(settings) is { } parsed
                    && root.TryGetProperty("defaults", out var defaults) && AppSettings.Parse(JsonSerializer.SerializeToElement(new { tools = defaults })) is { } fallback
                    => new OpenSettings(parsed, fallback.Tools),
                "set-appearance" when root.TryGetProperty("dark", out var dark) && dark.ValueKind is JsonValueKind.True or JsonValueKind.False => new SetAppearance(dark.GetBoolean()),
                "set-zoom" when root.TryGetProperty("factor", out var factor) && factor.TryGetDouble(out double value) && value is >= 0.5 and <= 3 => new SetZoom(value),
                "export-file" when Text(root, "name") is { Length: > 0 } name && Text(root, "contents") is { } contents => new ExportFile(name, contents),
                "save" when root.TryGetProperty("workspace", out var workspace) && IsWorkspace(workspace) => new Save(workspace.GetRawText()),
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

    private static bool IsWorkspace(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty("charts", out var charts)
        && charts.ValueKind == JsonValueKind.Array;
}
