using System.Text.Json;

namespace SailwindChartroom;

/// <summary>One chart tool's shortcut as the page sends it to the Settings window.</summary>
internal sealed record ToolShortcut(string Mode, string Label, string Key);

/// <summary>One choice in a Settings list, such as a theme, as the page names it.</summary>
internal sealed record SettingChoice(string Id, string Label);

/// <summary>What the Settings window edits. The page owns and saves these; the window only shows them.</summary>
internal sealed record AppSettings(IReadOnlyList<ToolShortcut> Tools, bool CheckForUpdates, int InterfaceSize,
    string Theme = "chartroom", string Appearance = "system")
{
    /// <summary>The theme and appearance choices the page offers, and whether the page is dark now.</summary>
    internal IReadOnlyList<SettingChoice> Themes { get; init; } = [];
    internal IReadOnlyList<SettingChoice> Appearances { get; init; } = [];
    internal bool Dark { get; init; } = true;

    /// <summary>Interface sizes offered, in percent. 0 means follow the Windows text size.</summary>
    internal static readonly int[] InterfaceSizes = [0, 100, 125, 150, 175, 200];

    // F fits the chart and I opens the island library; neither can be reassigned.
    private static readonly Dictionary<string, string> FixedKeys = new() { ["f"] = "fit the chart", ["i"] = "open the island library" };

    internal static AppSettings? Parse(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("tools", out var tools) || tools.ValueKind != JsonValueKind.Array) return null;
        var list = new List<ToolShortcut>();
        foreach (var tool in tools.EnumerateArray())
        {
            string? mode = Text(tool, "mode"), label = Text(tool, "label"), key = Text(tool, "key");
            if (mode is null || label is null || key is null) return null;
            list.Add(new ToolShortcut(mode, label, key));
        }
        bool check = !value.TryGetProperty("checkForUpdates", out var flag) || flag.ValueKind != JsonValueKind.False;
        int size = value.TryGetProperty("interfaceSize", out var number) && number.TryGetInt32(out int parsed) && InterfaceSizes.Contains(parsed) ? parsed : 0;
        if (list.Count == 0) return null;
        return new AppSettings(list, check, size, Text(value, "theme") ?? "chartroom", Text(value, "appearance") ?? "system")
        {
            Themes = Choices(value, "themes"),
            Appearances = Choices(value, "appearances"),
            Dark = !value.TryGetProperty("dark", out var dark) || dark.ValueKind != JsonValueKind.False
        };
    }

    private static IReadOnlyList<SettingChoice> Choices(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var list) || list.ValueKind != JsonValueKind.Array) return [];
        return list.EnumerateArray()
            .Select(choice => Text(choice, "id") is { } id && Text(choice, "label") is { } label ? new SettingChoice(id, label) : null)
            .OfType<SettingChoice>()
            .ToList();
    }

    /// <summary>Null when every key is one letter or number, unique, and not a fixed key; otherwise what to fix.</summary>
    internal static string? ShortcutProblem(IEnumerable<ToolShortcut> tools)
    {
        var owners = new Dictionary<string, string>();
        foreach (var tool in tools)
        {
            string key = tool.Key.Trim().ToLowerInvariant();
            if (key.Length != 1 || !char.IsAsciiLetterOrDigit(key[0])) return $"Choose one letter or number for {tool.Label}.";
            if (FixedKeys.TryGetValue(key, out string? use)) return $"{key.ToUpperInvariant()} is already used to {use}.";
            if (owners.TryGetValue(key, out string? other)) return $"{other} and {tool.Label} can't share {key.ToUpperInvariant()}.";
            owners[key] = tool.Label;
        }
        return null;
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
