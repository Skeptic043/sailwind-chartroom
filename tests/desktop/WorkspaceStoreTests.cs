namespace SailwindChartroom.Tests;

public sealed class WorkspaceStoreTests : IDisposable
{
    private const string Valid = """{"charts":[{"name":"Kept"}]}""";
    private const string Older = """{"charts":[{"name":"Older"}]}""";
    private readonly string folder = Path.Combine(Path.GetTempPath(), "chartroom-tests", Guid.NewGuid().ToString("N"));
    private readonly WorkspaceStore store;

    public WorkspaceStoreTests() => store = new WorkspaceStore(folder);

    public void Dispose()
    {
        if (!Directory.Exists(folder)) return;
        foreach (string file in Directory.GetFiles(folder)) File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(folder, recursive: true);
    }

    [Fact]
    public void FirstLaunchStartsEmptyWithoutWarnings()
    {
        var result = store.Load();
        Assert.Null(result.Workspace);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public void ValidWorkspaceOpensAndRefreshesBackup()
    {
        store.Save(Valid);
        var result = store.Load();
        Assert.Equal(Valid, result.Workspace);
        Assert.Empty(result.Warnings);
        Assert.Equal(Valid, File.ReadAllText(store.BackupPath));
    }

    [Fact]
    public void BackupFailureStillOpensTheWorkspace()
    {
        store.Save(Valid);
        Directory.CreateDirectory(store.BackupPath);
        var result = store.Load();
        Assert.Equal(Valid, result.Workspace);
        Assert.Single(result.Warnings);
        Assert.Contains("backup", result.Warnings[0]);
    }

    [Fact]
    public void UnreadableWorkspaceIsKeptAndThePreviousLaunchRestored()
    {
        store.Save("{ not json");
        File.WriteAllText(store.BackupPath, Older);
        var result = store.Load();
        Assert.Equal(Older, result.Workspace);
        Assert.Contains("previous launch", Assert.Single(result.Warnings));
        Assert.Equal("{ not json", File.ReadAllText(Assert.Single(UnreadableCopies())));

        // The next launch opens the restored charts without another warning.
        var next = new WorkspaceStore(folder).Load();
        Assert.Equal(Older, next.Workspace);
        Assert.Empty(next.Warnings);
    }

    [Fact]
    public void UnreadableWorkspaceWithoutBackupStartsEmptyAndKeepsTheFile()
    {
        store.Save("{ not json");
        var result = store.Load();
        Assert.Null(result.Workspace);
        Assert.Contains("empty chart", Assert.Single(result.Warnings));
        Assert.Equal("{ not json", File.ReadAllText(Assert.Single(UnreadableCopies())));
        Assert.True(store.CanSave);
    }

    [Fact]
    public void AWorkspaceThatCannotBeCopiedAsideIsNeverOverwritten()
    {
        store.Save(Valid);
        using (new FileStream(store.WorkspacePath, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var result = store.Load();
            Assert.Null(result.Workspace);
            Assert.Contains("saving is turned off", Assert.Single(result.Warnings));
        }
        Assert.False(store.CanSave);
        Assert.Throws<IOException>(() => store.Save(Older));
        Assert.Equal(Valid, File.ReadAllText(store.WorkspacePath));
    }

    [Fact]
    public void ARestoreThatCannotBeWrittenStillOpensThePreviousLaunch()
    {
        store.Save("{ not json");
        File.WriteAllText(store.BackupPath, Older);
        File.SetAttributes(store.WorkspacePath, FileAttributes.ReadOnly);
        var result = store.Load();
        Assert.Equal(Older, result.Workspace);
        Assert.Equal(2, result.Warnings.Count);
        Assert.Contains("could not be written back", result.Warnings[1]);
        Assert.True(store.CanSave);
    }

    private string[] UnreadableCopies() => Directory.GetFiles(folder, "workspace.unreadable-*.json");

    [Fact]
    public void SaveReplacesTheWorkspaceWithoutLeavingTemporaryFiles()
    {
        store.Save(Older);
        store.Save(Valid);
        Assert.Equal(Valid, File.ReadAllText(store.WorkspacePath));
        Assert.Equal(["workspace.json"], Directory.GetFiles(folder).Select(Path.GetFileName));
    }
}
