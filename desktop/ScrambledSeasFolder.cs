using System.Text.Json;
using System.Text.RegularExpressions;

namespace SailwindChartroom;

/// <summary>One importable map or chart file found on this computer.</summary>
internal sealed record DiscoveredImportFile(string Path, string Name, string Place, DateTime ModifiedUtc);

/// <summary>
/// Locates the Scrambled Seas plugin folder (where scramble_&lt;slot&gt;.xml is written) and discovers
/// importable Scrambled Seas worlds and remembered chart files across Sailwind Mod Synchronizer,
/// Thunderstore Mod Manager, r2modman, and Steam installs.
/// </summary>
internal static class ScrambledSeasFolder
{
    private const int MaxDiscoveredFiles = 25;
    private static readonly Regex SteamLibraryPath = new(@"""path""\s+""(?<path>[^""]+)""", RegexOptions.Compiled);
    private static readonly HashSet<string> IgnoredJsonFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "workspace.json", "workspace.previous.json", "devices.json", "window.json", "settings.json", "config.json"
    };

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

        foreach (var (root, _) in pluginRoots)
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

    public static IReadOnlyList<DiscoveredImportFile> DiscoverImportFiles(string? lastImportFolder = null) => DiscoverImportFiles(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        lastImportFolder);

    internal static IReadOnlyList<DiscoveredImportFile> DiscoverImportFiles(
        string localAppData,
        string roamingAppData,
        string programFilesX86,
        string programFiles,
        string? lastImportFolder = null)
    {
        var found = new List<DiscoveredImportFile>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddFile(string filePath, string place)
        {
            try
            {
                var full = Path.GetFullPath(filePath);
                if (!seen.Add(full)) return;
                var info = new FileInfo(full);
                if (!info.Exists) return;
                found.Add(new DiscoveredImportFile(full, info.Name, place, info.LastWriteTimeUtc));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or PathTooLongException)
            {
            }
        }

        foreach (var (root, place) in CollectPluginRoots(localAppData, roamingAppData, programFilesX86, programFiles))
        {
            if (!Directory.Exists(root)) continue;
            foreach (var dir in CandidateDirs(root))
            {
                try
                {
                    foreach (var xml in Directory.GetFiles(dir, "scramble_*.xml", SearchOption.TopDirectoryOnly))
                    {
                        AddFile(xml, place);
                    }
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(lastImportFolder) && Directory.Exists(lastImportFolder))
        {
            var folderName = Path.GetFileName(lastImportFolder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            var place = string.IsNullOrWhiteSpace(folderName) ? "Last folder" : folderName;
            try
            {
                foreach (var xml in Directory.GetFiles(lastImportFolder, "*.xml", SearchOption.TopDirectoryOnly))
                {
                    AddFile(xml, place);
                }
                foreach (var json in Directory.GetFiles(lastImportFolder, "*.json", SearchOption.TopDirectoryOnly))
                {
                    var name = Path.GetFileName(json);
                    if (IgnoredJsonFiles.Contains(name) || name.EndsWith(".meta.json", StringComparison.OrdinalIgnoreCase)) continue;
                    AddFile(json, place);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
            }
        }

        found.Sort((a, b) => b.ModifiedUtc.CompareTo(a.ModifiedUtc));
        return found.Count > MaxDiscoveredFiles ? found.GetRange(0, MaxDiscoveredFiles) : found;
    }

    private static List<(string Root, string Place)> CollectPluginRoots(string localAppData, string roamingAppData, string programFilesX86, string programFiles)
    {
        var roots = new List<(string Root, string Place)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? path, string place)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            try
            {
                var full = Path.GetFullPath(path);
                if (seen.Add(full)) roots.Add((full, place));
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
                : null, "Mod Sync");
            AddProfilePlugins(Path.Combine(modSync, "packs"), "Mod Sync", includeInstanceSubdir: true, Add);
        }

        // 2. Thunderstore Mod Manager and r2modman Sailwind profiles.
        if (!string.IsNullOrWhiteSpace(roamingAppData))
        {
            AddProfilePlugins(Path.Combine(roamingAppData, "Thunderstore Mod Manager", "DataFolder", "Sailwind", "profiles"), "Thunderstore", includeInstanceSubdir: false, Add);
            AddProfilePlugins(Path.Combine(roamingAppData, "r2modmanPlus-local", "Sailwind", "profiles"), "r2modman", includeInstanceSubdir: false, Add);
        }

        // 3. Default Steam installs and any additional libraries listed in libraryfolders.vdf.
        foreach (var programFilesDir in new[] { programFilesX86, programFiles })
        {
            if (string.IsNullOrWhiteSpace(programFilesDir)) continue;
            var steam = Path.Combine(programFilesDir, "Steam");
            Add(Path.Combine(steam, "steamapps", "common", "Sailwind", "BepInEx", "plugins"), "Steam");
            foreach (var library in ReadSteamLibraries(Path.Combine(steam, "steamapps", "libraryfolders.vdf")))
            {
                Add(Path.Combine(library, "steamapps", "common", "Sailwind", "BepInEx", "plugins"), "Steam");
            }
        }

        return roots;
    }

    private static void AddProfilePlugins(string profilesRoot, string manager, bool includeInstanceSubdir, Action<string?, string> add)
    {
        if (!Directory.Exists(profilesRoot)) return;
        try
        {
            foreach (var profile in Directory.GetDirectories(profilesRoot))
            {
                var name = Path.GetFileName(profile);
                var place = string.IsNullOrWhiteSpace(name) ? manager : $"{manager} ({name})";
                if (includeInstanceSubdir)
                {
                    add(Path.Combine(profile, "instance", "BepInEx", "plugins"), place);
                }
                add(Path.Combine(profile, "BepInEx", "plugins"), place);
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
