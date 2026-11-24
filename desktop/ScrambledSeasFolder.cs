using System.Text.Json;
using System.Text.RegularExpressions;

namespace SailwindChartroom;

/// <summary>
/// Locates the Scrambled Seas plugin folder (where scramble_&lt;slot&gt;.xml is written) across
/// Sailwind Mod Synchronizer, Thunderstore Mod Manager, r2modman, and default Steam installs.
/// </summary>
internal static class ScrambledSeasFolder
{
    private static readonly Regex SteamLibraryPath = new(@"""path""\s+""(?<path>[^""]+)""", RegexOptions.Compiled);

    public static string? Find() => Find(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));

    internal static string? Find(string localAppData, string roamingAppData, string programFilesX86, string programFiles)
    {
        var pluginRoots = CollectPluginRoots(localAppData, roamingAppData, programFilesX86, programFiles);
        string? bestWithXml = null;
        DateTime bestXmlTime = DateTime.MinValue;
        string? firstPluginFolder = null;

        foreach (var root in pluginRoots)
        {
            if (!Directory.Exists(root)) continue;
            foreach (var dir in CandidateDirs(root))
            {
                try
                {
                    var xmls = Directory.GetFiles(dir, "scramble_*.xml", SearchOption.TopDirectoryOnly);
                    if (xmls.Length > 0)
                    {
                        var newest = xmls.Max(File.GetLastWriteTimeUtc);
                        if (bestWithXml is null || newest > bestXmlTime)
                        {
                            bestWithXml = dir;
                            bestXmlTime = newest;
                        }
                        continue;
                    }
                    if (firstPluginFolder is null && LooksLikeScrambledSeas(Path.GetFileName(dir)))
                    {
                        firstPluginFolder = dir;
                    }
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                }
            }
        }
        return bestWithXml ?? firstPluginFolder;
    }

    private static List<string> CollectPluginRoots(string localAppData, string roamingAppData, string programFilesX86, string programFiles)
    {
        var roots = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            try
            {
                var full = Path.GetFullPath(path);
                if (seen.Add(full)) roots.Add(full);
            }
            catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
            {
            }
        }

        // 1. Sailwind Mod Synchronizer (configured game_dir and managed packs).
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            var modSync = Path.Combine(localAppData, "SailwindModSynchronizer");
            Add(ReadModSyncGameDir(Path.Combine(modSync, "config.json")) is { } gameDir
                ? Path.Combine(gameDir, "BepInEx", "plugins")
                : null);
            AddProfilePlugins(Path.Combine(modSync, "packs"), Add);
        }

        // 2. Thunderstore Mod Manager and r2modman Sailwind profiles.
        if (!string.IsNullOrWhiteSpace(roamingAppData))
        {
            AddProfilePlugins(Path.Combine(roamingAppData, "Thunderstore Mod Manager", "DataFolder", "Sailwind", "profiles"), Add);
            AddProfilePlugins(Path.Combine(roamingAppData, "r2modmanPlus-local", "Sailwind", "profiles"), Add);
        }

        // 3. Default Steam installs and any additional libraries listed in libraryfolders.vdf.
        foreach (var programFilesDir in new[] { programFilesX86, programFiles })
        {
            if (string.IsNullOrWhiteSpace(programFilesDir)) continue;
            var steam = Path.Combine(programFilesDir, "Steam");
            Add(Path.Combine(steam, "steamapps", "common", "Sailwind", "BepInEx", "plugins"));
            foreach (var library in ReadSteamLibraries(Path.Combine(steam, "steamapps", "libraryfolders.vdf")))
            {
                Add(Path.Combine(library, "steamapps", "common", "Sailwind", "BepInEx", "plugins"));
            }
        }

        return roots;
    }

    private static void AddProfilePlugins(string profilesRoot, Action<string?> add)
    {
        if (!Directory.Exists(profilesRoot)) return;
        try
        {
            foreach (var profile in Directory.GetDirectories(profilesRoot))
            {
                add(Path.Combine(profile, "BepInEx", "plugins"));
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static IEnumerable<string> CandidateDirs(string pluginsRoot)
    {
        yield return pluginsRoot;
        string[] subdirs;
        try
        {
            subdirs = Directory.GetDirectories(pluginsRoot);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            yield break;
        }
        foreach (var subdir in subdirs)
        {
            if (LooksLikeScrambledSeas(Path.GetFileName(subdir))) yield return subdir;
        }
    }

    private static bool LooksLikeScrambledSeas(string name)
    {
        var normalized = new string(name.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        return normalized.Contains("scrambledseas", StringComparison.Ordinal);
    }

    private static string? ReadModSyncGameDir(string configPath)
    {
        if (!File.Exists(configPath)) return null;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(configPath));
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            foreach (var prop in new[] { "game_dir", "sailwind_dir", "gameDir" })
            {
                if (doc.RootElement.TryGetProperty(prop, out var value)
                    && value.ValueKind == JsonValueKind.String
                    && value.GetString() is { Length: > 0 } dir)
                {
                    return dir;
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
        }
        return null;
    }

    private static IEnumerable<string> ReadSteamLibraries(string vdfPath)
    {
        if (!File.Exists(vdfPath)) yield break;
        string content;
        try
        {
            content = File.ReadAllText(vdfPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            yield break;
        }
        foreach (Match match in SteamLibraryPath.Matches(content))
        {
            var raw = match.Groups["path"].Value.Replace(@"\\", @"\");
            if (!string.IsNullOrWhiteSpace(raw)) yield return raw;
        }
    }
}
