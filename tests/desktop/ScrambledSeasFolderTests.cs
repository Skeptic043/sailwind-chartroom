namespace SailwindChartroom.Tests;

public sealed class ScrambledSeasFolderTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"chartroom-ss-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    [Fact]
    public void PrefersNewestScrambleXmlAcrossModManagersAndSteam()
    {
        var local = Path.Combine(root, "local");
        var roaming = Path.Combine(root, "roaming");
        var pf86 = Path.Combine(root, "pf86");
        var pf = Path.Combine(root, "pf");

        var steamDir = Path.Combine(pf86, "Steam", "steamapps", "common", "Sailwind", "BepInEx", "plugins", "ScrambledSeas");
        var r2Dir = Path.Combine(roaming, "r2modmanPlus-local", "Sailwind", "profiles", "Default", "BepInEx", "plugins", "NANDbrew-ScrambledSeas");
        Directory.CreateDirectory(steamDir);
        Directory.CreateDirectory(r2Dir);

        var oldXml = Path.Combine(steamDir, "scramble_1.xml");
        var newXml = Path.Combine(r2Dir, "scramble_2.xml");
        File.WriteAllText(oldXml, "<ScrambledSeasSaveContainer/>");
        File.WriteAllText(newXml, "<ScrambledSeasSaveContainer/>");
        File.SetLastWriteTimeUtc(oldXml, DateTime.UtcNow.AddHours(-2));
        File.SetLastWriteTimeUtc(newXml, DateTime.UtcNow);

        Assert.Equal(r2Dir, ScrambledSeasFolder.Find(local, roaming, pf86, pf));
    }

    [Fact]
    public void FallsBackToModSyncConfiguredGameDirPluginFolder()
    {
        var local = Path.Combine(root, "local");
        var roaming = Path.Combine(root, "roaming");
        var pf86 = Path.Combine(root, "pf86");
        var pf = Path.Combine(root, "pf");

        var gameDir = Path.Combine(root, "Games", "Sailwind");
        var ssDir = Path.Combine(gameDir, "BepInEx", "plugins", "Scrambled_Seas");
        Directory.CreateDirectory(ssDir);
        var modSync = Path.Combine(local, "SailwindModSynchronizer");
        Directory.CreateDirectory(modSync);
        File.WriteAllText(Path.Combine(modSync, "config.json"), $$"""{"game_dir": "{{gameDir.Replace("\\", "\\\\")}}"}""");

        Assert.Equal(ssDir, ScrambledSeasFolder.Find(local, roaming, pf86, pf));
    }

    [Fact]
    public void DiscoversModSyncInstancePacksAndLastImportFolderNewestFirst()
    {
        var local = Path.Combine(root, "local");
        var roaming = Path.Combine(root, "roaming");
        var pf86 = Path.Combine(root, "pf86");
        var pf = Path.Combine(root, "pf");
        var lastFolder = Path.Combine(root, "exports");

        var modSyncDir = Path.Combine(local, "SailwindModSynchronizer", "packs", "default", "instance", "BepInEx", "plugins", "ScrambledSeas");
        Directory.CreateDirectory(modSyncDir);
        Directory.CreateDirectory(lastFolder);

        var xml = Path.Combine(modSyncDir, "scramble_1.xml");
        var chartJson = Path.Combine(lastFolder, "my-world.json");
        var workspaceJson = Path.Combine(lastFolder, "workspace.json");
        File.WriteAllText(xml, "<ScrambledSeasSaveContainer/>");
        File.WriteAllText(chartJson, "{}");
        File.WriteAllText(workspaceJson, "{}");
        File.SetLastWriteTimeUtc(xml, DateTime.UtcNow.AddMinutes(-10));
        File.SetLastWriteTimeUtc(chartJson, DateTime.UtcNow);

        Assert.Equal(modSyncDir, ScrambledSeasFolder.Find(local, roaming, pf86, pf));
        var files = ScrambledSeasFolder.DiscoverImportFiles(local, roaming, pf86, pf, lastFolder);
        Assert.Equal(2, files.Count);
        Assert.Equal("my-world.json", files[0].Name);
        Assert.Equal("exports", files[0].Place);
        Assert.Equal("scramble_1.xml", files[1].Name);
        Assert.Equal("Mod Sync (default)", files[1].Place);
    }

    [Fact]
    public void ReturnsNullWhenNoInstallExists()
    {
        Assert.Null(ScrambledSeasFolder.Find(
            Path.Combine(root, "a"),
            Path.Combine(root, "b"),
            Path.Combine(root, "c"),
            Path.Combine(root, "d")));
    }
}
