using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using SailwindChartroom.Updates;

namespace SailwindChartroom.Tests;

public sealed class UpdateInstallerTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), "chartroom-update-tests", Guid.NewGuid().ToString("N"));
    private readonly UpdateInstaller installer;
    private string Exe => Path.Combine(folder, UpdateInstaller.ExeName);
    private string Work => Path.Combine(folder, UpdateInstaller.WorkFolderName);

    public UpdateInstallerTests()
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(Exe, "old");
        installer = new UpdateInstaller(folder);
    }

    public void Dispose()
    {
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    private void Stage()
    {
        Directory.CreateDirectory(Work);
        File.WriteAllText(Path.Combine(Work, "new.exe"), "new");
    }

    [Fact]
    public void ApplySwapsInTheNewExeAndTheNextStartCleansUp()
    {
        Stage();
        installer.ApplyStaged();
        Assert.Equal("new", File.ReadAllText(Exe));
        installer.RecoverOrCleanUp();
        Assert.False(Directory.Exists(Work));
        Assert.Equal("new", File.ReadAllText(Exe));
    }

    [Fact]
    public void AFailedSwapPutsTheOldExeBack()
    {
        Stage();
        using (new FileStream(Path.Combine(Work, "new.exe"), FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var failure = Assert.Throws<UpdateException>(installer.ApplyStaged);
            Assert.True(failure.InstallUnchanged);
        }
        Assert.Equal("old", File.ReadAllText(Exe));
    }

    [Fact]
    public void ApplyWithoutAStagedExeChangesNothing()
    {
        Assert.Throws<UpdateException>(installer.ApplyStaged);
        Assert.Equal("old", File.ReadAllText(Exe));
    }

    [Fact]
    public void AnInterruptedSwapIsRestoredOnTheNextStart()
    {
        Directory.CreateDirectory(Work);
        File.Move(Exe, Path.Combine(Work, "old.exe"));
        installer.RecoverOrCleanUp();
        Assert.Equal("old", File.ReadAllText(Exe));
        Assert.False(Directory.Exists(Work));
    }

    [Fact]
    public void ALeftoverDownloadIsDiscardedWithoutTouchingTheExe()
    {
        Stage();
        installer.RecoverOrCleanUp();
        Assert.Equal("old", File.ReadAllText(Exe));
        Assert.False(Directory.Exists(Work));
    }

    [Fact]
    public void OnlyTheExeIsTakenFromThePackage()
    {
        string zip = Path.Combine(folder, "package.zip");
        using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
        {
            archive.CreateEntry("README.md");
            using var writer = new StreamWriter(archive.CreateEntry(UpdateInstaller.ExeName).Open());
            writer.Write("packaged");
        }
        string destination = Path.Combine(folder, "extracted.exe");
        UpdateInstaller.ExtractExe(zip, destination);
        Assert.Equal("packaged", File.ReadAllText(destination));
    }

    [Fact]
    public void APackageWithoutTheExeIsRejected()
    {
        string zip = Path.Combine(folder, "package.zip");
        using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create)) archive.CreateEntry("Other.exe");
        Assert.Throws<UpdateException>(() => UpdateInstaller.ExtractExe(zip, Path.Combine(folder, "extracted.exe")));
    }

    [Fact]
    public async Task OnlyOneHolderAtATimeMayLockTheInstallFolder()
    {
        using (IDisposable? held = UpdateInstaller.TryLockInstallFolder(folder))
        {
            Assert.NotNull(held);
            Assert.Null(await Task.Run(() => UpdateInstaller.TryLockInstallFolder(folder)));
        }
        bool reacquired = await Task.Run(() =>
        {
            using IDisposable? again = UpdateInstaller.TryLockInstallFolder(folder);
            return again is not null;
        });
        Assert.True(reacquired);
    }

    [Fact]
    public async Task ChecksumMustMatchExactly()
    {
        byte[] content = Encoding.UTF8.GetBytes("package");
        byte[] hash = SHA256.HashData(content);
        Assert.True(await UpdateInstaller.MatchesSha256Async(new MemoryStream(content), hash, CancellationToken.None));
        hash[0] ^= 1;
        Assert.False(await UpdateInstaller.MatchesSha256Async(new MemoryStream(content), hash, CancellationToken.None));
    }
}
