using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;

namespace SailwindChartroom.Updates;

/// <summary>A failed update step. Message is plain text for the player.</summary>
internal sealed class UpdateException(string message, Exception? inner = null, bool installUnchanged = true) : Exception(message, inner)
{
    /// <summary>False only when a rollback could not put the previous exe back.</summary>
    internal bool InstallUnchanged { get; } = installUnchanged;
}

/// <summary>
/// Downloads, verifies and swaps in a new Sailwind Chartroom.exe. Work happens in a folder beside the
/// exe so every move is a same-volume rename. The replaced exe stays in that folder until the next start,
/// because Windows lets a running exe be renamed but not deleted.
/// </summary>
internal sealed class UpdateInstaller
{
    internal const string WorkFolderName = ".chartroom-update";
    internal const string ExeName = "Sailwind Chartroom.exe";
    private const string WaitForProcessVariable = "CHARTROOM_UPDATED_FROM_PID";
    private static readonly TimeSpan PreviousProcessExitTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan ReadStallTimeout = TimeSpan.FromSeconds(30);
    private const string CleanupInProgressMessage = "A previous update is still being cleaned up. Try again in a minute.";

    // The startup cleanup retry and a player-started update share one work folder and must never interleave.
    private static readonly SemaphoreSlim WorkGate = new(1, 1);
    private static volatile bool updateStarted;
    private static readonly HttpClient Client = new() { Timeout = Timeout.InfiniteTimeSpan };

    private readonly string installDir;

    internal UpdateInstaller(string installDir) => this.installDir = Path.GetFullPath(installDir);

    internal string ExePath => Path.Combine(installDir, ExeName);
    private string WorkDir => Path.Combine(installDir, WorkFolderName);
    private string StagedExe => Path.Combine(WorkDir, "new.exe");
    private string BackupExe => Path.Combine(WorkDir, "old.exe");

    /// <summary>The folder holding the running Sailwind Chartroom.exe, or null when not running from one.</summary>
    internal static string? CurrentInstallDirectory()
    {
        string? process = Environment.ProcessPath;
        return process is not null && string.Equals(Path.GetFileName(process), ExeName, StringComparison.OrdinalIgnoreCase)
            ? Path.GetDirectoryName(process)
            : null;
    }

    internal bool CanWriteInstallFolder()
    {
        try
        {
            using (File.Create(Path.Combine(installDir, $"{WorkFolderName}-{Guid.NewGuid():N}.probe"), 1, FileOptions.DeleteOnClose)) { }
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Downloads the package, checks its size and SHA-256 against the release, extracts the exe and checks
    /// it reports the expected version. The installed exe is not touched. Any failure removes the work
    /// folder and throws UpdateException.
    /// </summary>
    internal async Task StageAsync(ReleasePackage package, Version expectedVersion, IProgress<double>? progress, CancellationToken ct)
    {
        if (!await WorkGate.WaitAsync(0, CancellationToken.None).ConfigureAwait(false)) throw new UpdateException(CleanupInProgressMessage);
        try
        {
            updateStarted = true;
            try
            {
                RecoverOrCleanUpCore();
            }
            catch (Exception error)
            {
                throw new UpdateException(CleanupInProgressMessage, error);
            }
            await StageCoreAsync(package, expectedVersion, progress, ct).ConfigureAwait(false);
        }
        finally
        {
            WorkGate.Release();
        }
    }

    private async Task StageCoreAsync(ReleasePackage package, Version expectedVersion, IProgress<double>? progress, CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(WorkDir);
            string zipPath = Path.Combine(WorkDir, "package.zip");
            await DownloadAsync(package, zipPath, progress, ct).ConfigureAwait(false);
            ct.ThrowIfCancellationRequested();
            await using (FileStream zip = File.OpenRead(zipPath))
            {
                if (!await MatchesSha256Async(zip, package.Sha256, ct).ConfigureAwait(false))
                    throw new UpdateException("The download did not match the published checksum.");
            }
            ct.ThrowIfCancellationRequested();
            ExtractExe(zipPath, StagedExe);
            File.Delete(zipPath);
            string? productVersion = FileVersionInfo.GetVersionInfo(StagedExe).ProductVersion;
            if (UpdateChecker.ParseVersion(productVersion) is not { } packaged || !packaged.Equals(expectedVersion))
                throw new UpdateException("The update package has the wrong version.");
        }
        catch (Exception error) when (error is OperationCanceledException or UpdateException)
        {
            DiscardWorkCore();
            throw;
        }
        catch (Exception error)
        {
            DiscardWorkCore();
            throw new UpdateException("The update could not be downloaded.", error);
        }
    }

    // Only the exe is installed. The ZIP's README and notices are for people downloading by hand, and the
    // license texts also ship inside the exe.
    internal static void ExtractExe(string zipPath, string destination)
    {
        try
        {
            using ZipArchive archive = ZipFile.OpenRead(zipPath);
            ZipArchiveEntry[] exes = archive.Entries.Where(entry => entry.FullName == ExeName).ToArray();
            if (exes.Length != 1) throw new UpdateException("The update package is not a Sailwind Chartroom release.");
            exes[0].ExtractToFile(destination, overwrite: false);
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            throw new UpdateException("The update could not be unpacked.", error);
        }
    }

    /// <summary>Moves the running exe aside and the new one into its place. Any failure puts the old exe back.</summary>
    internal void ApplyStaged()
    {
        if (!WorkGate.Wait(0)) throw new UpdateException(CleanupInProgressMessage);
        try
        {
            if (!File.Exists(StagedExe)) throw new UpdateException("The update was not ready to install.");
            File.Move(ExePath, BackupExe);
            try
            {
                File.Move(StagedExe, ExePath);
            }
            catch (Exception error)
            {
                bool restored = TryRestoreBackup();
                if (restored) DiscardWorkCore();
                throw new UpdateException(restored
                    ? "Chartroom could not replace its exe. Try again."
                    : "The update could not finish. Chartroom will restore the previous version the next time it starts.",
                    error, installUnchanged: restored);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new UpdateException("Chartroom could not replace its exe. Try again.", error);
        }
        finally
        {
            WorkGate.Release();
        }
    }

    private bool TryRestoreBackup()
    {
        try
        {
            File.Move(BackupExe, ExePath);
            return true;
        }
        catch
        {
            try
            {
                File.Copy(BackupExe, ExePath, overwrite: true);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>Removes the work folder. Best effort; the next start retries.</summary>
    internal void DiscardWork()
    {
        WorkGate.Wait();
        try { DiscardWorkCore(); }
        finally { WorkGate.Release(); }
    }

    private void DiscardWorkCore()
    {
        try
        {
            if (Directory.Exists(WorkDir)) Directory.Delete(WorkDir, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    /// <summary>
    /// Finishes or undoes a leftover update. A completed swap is only cleaned up. An interrupted one, where
    /// the exe was moved aside but the new one never arrived, puts the old exe back. Throws while files are
    /// still in use; callers retry.
    /// </summary>
    internal void RecoverOrCleanUp()
    {
        WorkGate.Wait();
        try { RecoverOrCleanUpCore(); }
        finally { WorkGate.Release(); }
    }

    private void RecoverOrCleanUpCore()
    {
        if (!Directory.Exists(WorkDir)) return;
        if (!File.Exists(ExePath) && File.Exists(BackupExe)) File.Move(BackupExe, ExePath);
        // The installed exe always exists past this point, so cleanup can never delete the only copy.
        if (File.Exists(ExePath)) Directory.Delete(WorkDir, recursive: true);
    }

    /// <summary>Cleans up after an update, retrying while the previous process still holds its old exe.</summary>
    internal static void CleanUpAtStartup()
    {
        string? installDir = CurrentInstallDirectory();
        if (installDir is null) return;
        var installer = new UpdateInstaller(installDir);
        if (!Directory.Exists(installer.WorkDir) || installer.TryRecoverOrCleanUp()) return;
        _ = Task.Run(async () =>
        {
            for (int attempt = 0; attempt < 10; attempt++)
            {
                await Task.Delay(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
                if (installer.TryRecoverOrCleanUp()) return;
            }
        });
    }

    /// <summary>
    /// Holds the install folder against other Chartroom processes: an update holds it from download to
    /// swap, and startup cleanup only touches the work folder while it can take it. It is an exclusively
    /// opened file, so Windows releases it if Chartroom exits without closing it. Null when held elsewhere.
    /// </summary>
    internal static IDisposable? TryLockInstallFolder(string installDir)
    {
        try
        {
            return new FileStream(Path.Combine(installDir, WorkFolderName + ".lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private bool TryRecoverOrCleanUp()
    {
        using IDisposable? folderLock = TryLockInstallFolder(installDir);
        if (folderLock is null) return false;
        if (!WorkGate.Wait(0)) return false;
        try
        {
            if (!updateStarted) RecoverOrCleanUpCore();
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
        finally
        {
            WorkGate.Release();
        }
    }

    /// <summary>Starts the installed exe, which waits for this process to exit before reading the charts.</summary>
    internal void LaunchInstalled()
    {
        var start = new ProcessStartInfo(ExePath) { UseShellExecute = false, WorkingDirectory = installDir };
        start.Environment[WaitForProcessVariable] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        Process.Start(start)?.Dispose();
    }

    /// <summary>Called first thing at startup: waits, bounded, for the process that launched this one after an update.</summary>
    internal static void WaitForUpdatingProcess()
    {
        string? value = Environment.GetEnvironmentVariable(WaitForProcessVariable);
        if (value is null) return;
        Environment.SetEnvironmentVariable(WaitForProcessVariable, null);
        if (!int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out int pid)) return;
        try
        {
            using Process previous = Process.GetProcessById(pid);
            // A reused process id belongs to some other program; never wait on it.
            if (string.Equals(previous.ProcessName, Path.GetFileNameWithoutExtension(ExeName), StringComparison.OrdinalIgnoreCase))
                previous.WaitForExit(PreviousProcessExitTimeout);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException)
        {
        }
    }

    internal static async Task<bool> MatchesSha256Async(Stream content, byte[] expected, CancellationToken ct) =>
        CryptographicOperations.FixedTimeEquals(await SHA256.HashDataAsync(content, ct).ConfigureAwait(false), expected);

    private static async Task DownloadAsync(ReleasePackage package, string zipPath, IProgress<double>? progress, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, package.DownloadUri);
        request.Headers.UserAgent.ParseAdd("SailwindChartroom-updater");
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(ct);
        stall.CancelAfter(ReadStallTimeout);
        HttpResponseMessage response;
        try
        {
            response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stall.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new UpdateException("The download timed out.");
        }
        using (response)
        {
            if (!response.IsSuccessStatusCode) throw new UpdateException("The download failed.");
            if (response.RequestMessage?.RequestUri?.Scheme != Uri.UriSchemeHttps) throw new UpdateException("The download was redirected to an insecure address.");
            await using Stream body = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            await using var file = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous);
            byte[] buffer = new byte[81920];
            long total = 0;
            int lastPercent = -1;
            while (true)
            {
                stall.CancelAfter(ReadStallTimeout);
                int read;
                try
                {
                    read = await body.ReadAsync(buffer, stall.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    throw new UpdateException("The download stopped responding.");
                }
                if (read == 0) break;
                total += read;
                if (total > package.Size) throw new UpdateException("The download was larger than expected.");
                await file.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                int percent = (int)(total * 100 / package.Size);
                if (percent != lastPercent)
                {
                    lastPercent = percent;
                    progress?.Report(percent / 100.0);
                }
            }
            if (total != package.Size) throw new UpdateException("The download was incomplete.");
        }
    }
}
