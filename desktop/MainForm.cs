using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using SailwindChartroom.Updates;

namespace SailwindChartroom;

internal sealed partial class MainForm : Form
{
    // The chart page is served from the exe under this private origin and may never leave it.
    private const string AppOrigin = "https://chartroom.app";

    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly WorkspaceStore store = new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Sailwind Chartroom"));
    private readonly System.Windows.Forms.Timer saveTimer = new() { Interval = 400 };
    private string WindowPath => Path.Combine(store.Folder, "window.json");
    private string? currentWorkspace;
    private string? pendingWorkspace;
    private IReadOnlyList<GitHubRelease>? newerReleases;
    private CancellationTokenSource? updateCancel;
    private SettingsForm? openSettings;
    private TrackFollower? follower;
    // The Voyage Recorder logs last offered to the page, which may follow only these.
    private List<string> offeredLogs = [];
    // The chart the followed positions go to, kept here so a reloaded page sends them to the same one.
    private string followedChartId = "";

    public MainForm()
    {
        Text = "Sailwind Chartroom";
        // Sizes are in 96-dpi pixels and scale with the monitor, as in other Windows apps.
        MinimumSize = LogicalToDeviceUnits(new Size(900, 560));
        // Opens centred on the screen under the pointer, fitted to it.
        Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size size = LogicalToDeviceUnits(new Size(1440, 900));
        StartPosition = FormStartPosition.Manual;
        PlaceWindow(new Rectangle(area.X + (area.Width - size.Width) / 2, area.Y + (area.Height - size.Height) / 2, size.Width, size.Height));
        BackColor = Color.FromArgb(16, 28, 33);
        using (var icon = Assembly.GetExecutingAssembly().GetManifestResourceStream("chartroom.ico"))
        {
            if (icon is not null) Icon = new Icon(icon);
        }
        Controls.Add(web);
        saveTimer.Tick += (_, _) => FlushSave();
        RestoreWindow();
        Load += async (_, _) =>
        {
            StartDevices();
            await InitializeWebAsync();
        };
        FormClosing += (_, _) =>
        {
            StopLan();
            follower?.Dispose();
            FlushSave();
            SaveWindow();
        };
    }

    // The page owns the settings; the window shows them and sends back what the player applies.
    private void ShowSettings(HostMessage.OpenSettings open)
    {
        using var settings = new SettingsForm(open.Settings, open.Defaults, WindowsTextScale(), applied => Post(new
        {
            type = "settings-changed",
            settings = new
            {
                shortcuts = applied.Tools.ToDictionary(tool => tool.Mode, tool => tool.Key),
                checkForUpdates = applied.CheckForUpdates,
                clearReachedAreas = applied.ClearReachedAreas,
                shareViewSettings = applied.ShareViewSettings,
                interfaceSize = applied.InterfaceSize,
                theme = applied.Theme,
                appearance = applied.Appearance,
                iconSize = applied.IconSize
            }
        }));
        openSettings = settings;
        try { settings.ShowDialog(this); }
        finally { openSettings = null; }
    }

    /// <summary>The Windows Accessibility text size, in percent (100 to 225).</summary>
    private static int WindowsTextScale()
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Accessibility");
        return key?.GetValue("TextScaleFactor") is int value ? Math.Clamp(value, 100, 225) : 100;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        SettingsForm.UseDarkTitleBar(Handle, true);
    }

    private static string AppVersion =>
        Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "";

    private async Task InitializeWebAsync()
    {
        var loaded = store.Load();
        currentWorkspace = loaded.Workspace;
        foreach (string warning in loaded.Warnings)
        {
            MessageBox.Show(this, warning, "Sailwind Chartroom", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        try
        {
            string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sailwind Chartroom", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await web.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Sailwind Chartroom needs the Microsoft Edge WebView2 Runtime, which is normally part of Windows 11.\n\nInstall it from https://developer.microsoft.com/microsoft-edge/webview2/ and start the Chartroom again.",
                "WebView2 Runtime missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
        core.Settings.AreBrowserAcceleratorKeysEnabled = Debugger.IsAttached;
        core.Settings.IsZoomControlEnabled = false;
        core.AddWebResourceRequestedFilter($"{AppOrigin}/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeEmbeddedFile;
        core.NavigationStarting += (_, e) => e.Cancel = !IsAppUri(e.Uri);
        core.FrameNavigationStarting += (_, e) => e.Cancel = true;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.WebMessageReceived += OnWebMessage;
        core.Navigate($"{AppOrigin}/index.html");
    }

    private static bool IsAppUri(string uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
        && parsed.Scheme == Uri.UriSchemeHttps
        && parsed.Authority == "chartroom.app";

    private void ServeEmbeddedFile(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        string path = new Uri(e.Request.Uri).AbsolutePath;
        var stream = WebResources.Open(path);
        var environment = web.CoreWebView2.Environment;
        if (stream is null)
        {
            e.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        e.Response = environment.CreateWebResourceResponse(stream, 200, "OK",
            $"Content-Type: {WebResources.ContentType(path)}\r\nCache-Control: no-store\r\nContent-Security-Policy: {WebResources.ContentSecurityPolicy}\r\nX-Content-Type-Options: nosniff");
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsAppUri(e.Source)) return;
        var message = HostMessage.Parse(e.WebMessageAsJson);
        switch (message)
        {
            case HostMessage.Ready:
                // Sent on every page load, so a reload always receives the latest charts.
                using (var workspace = currentWorkspace is null ? null : JsonDocument.Parse(currentWorkspace))
                {
                    Post(new { type = "init", workspace = workspace?.RootElement, dataFolder = store.Folder, version = AppVersion, textScale = WindowsTextScale(), liveTrack = true, devices = true });
                }
                // A reloaded page learns that a file is still being followed.
                if (follower is not null) Post(new { type = "track-following", name = follower.FileName, chartId = followedChartId, resumed = true });
                ReplayDevices();
                break;
            case HostMessage.Save save:
                currentWorkspace = save.Workspace;
                pendingWorkspace = save.Workspace;
                saveTimer.Stop();
                saveTimer.Start();
                break;
            case HostMessage.Pin:
                TopMost = !TopMost;
                Post(new { type = "pinned", value = TopMost });
                break;
            case HostMessage.OpenFolder:
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{store.Folder}\"") { UseShellExecute = true });
                break;
            case HostMessage.CheckUpdates:
                _ = CheckUpdatesAsync();
                break;
            case HostMessage.InstallUpdate:
                _ = InstallUpdateAsync();
                break;
            case HostMessage.CancelUpdate:
                updateCancel?.Cancel();
                break;
            case HostMessage.OpenReleases:
                OpenReleasePage();
                break;
            case HostMessage.OpenLink link:
                Process.Start(new ProcessStartInfo(link.Url) { UseShellExecute = true })?.Dispose();
                break;
            case HostMessage.OpenSettings open:
                // Shown after this handler returns, so the modal window never runs inside a WebView2 event.
                BeginInvoke(() => ShowSettings(open));
                break;
            case HostMessage.SetZoom zoom:
                web.ZoomFactor = zoom.Factor;
                break;
            case HostMessage.ExportFile export:
                // Shown after this handler returns, so the dialog never runs inside a WebView2 event.
                BeginInvoke(() => SaveExport(export));
                break;
            case HostMessage.FollowTrack follow:
                // Shown after this handler returns, so the dialog never runs inside a WebView2 event.
                BeginInvoke(() => ChooseTrack(follow));
                break;
            case HostMessage.StopTrack:
                StopFollowing();
                break;
            case HostMessage.CopyText copy:
                Clipboard.SetText(copy.Contents);
                break;
            case HostMessage.DevicesOpen or HostMessage.DevicesEnable or HostMessage.DevicesPair or HostMessage.DevicesPairStop
                or HostMessage.DevicesRename or HostMessage.DevicesRemove or HostMessage.SyncSend or HostMessage.SyncBroadcast:
                HandleDevicesMessage(message!);
                break;
            case HostMessage.SetAppearance appearance:
                SettingsForm.UseDarkTitleBar(Handle, appearance.Dark);
                openSettings?.UseAppearance(appearance.Dark);
                break;
        }
    }

    // The page decides what to show; the host only fetches releases and installs the newest one it found.
    private async Task CheckUpdatesAsync()
    {
        var releases = await UpdateChecker.GetReleasesAsync(CancellationToken.None);
        if (IsDisposed) return;
        if (releases is null)
        {
            Post(new { type = "updates", ok = false });
            return;
        }
        newerReleases = UpdateChecker.NewerThan(releases, AppVersion);
        Post(new { type = "updates", ok = true, current = AppVersion, newer = newerReleases.Select(Describe), all = releases.Select(Describe) });
    }

    private static object Describe(GitHubRelease release) =>
        new { version = UpdateChecker.DisplayVersion(release.Tag), notes = release.Notes, installable = release.Package is not null };

    private async Task InstallUpdateAsync()
    {
        if (updateCancel is not null || newerReleases is not { Count: > 0 }) return;
        GitHubRelease release = newerReleases[0];
        string version = UpdateChecker.DisplayVersion(release.Tag) ?? release.Tag;
        if (release.Package is not { } package)
        {
            UpdateFailed($"Chartroom {version} can't be installed from inside the app. The release page will open so you can download it.", openReleasePage: true);
            return;
        }
        string? folder = UpdateInstaller.CurrentInstallDirectory();
        var installer = folder is null ? null : new UpdateInstaller(folder);
        if (installer is null || !installer.CanWriteInstallFolder())
        {
            UpdateFailed($"Chartroom can't update itself in this folder. The release page will open so you can download {version}.", openReleasePage: true);
            return;
        }

        // One update per install folder at a time, across every open Chartroom window.
        using IDisposable? installLock = UpdateInstaller.TryLockInstallFolder(folder!);
        if (installLock is null)
        {
            UpdateFailed("Another Chartroom window is updating. Try again in a minute.");
            return;
        }

        updateCancel = new CancellationTokenSource();
        try
        {
            Post(new { type = "update-progress", status = "Downloading…", fraction = 0.0, cancelable = true });
            var progress = new Progress<double>(fraction =>
                Post(new { type = "update-progress", status = $"Downloading… {(int)(fraction * 100)}%", fraction, cancelable = true }));
            await installer.StageAsync(package, release.Version, progress, updateCancel.Token);
            if (updateCancel.IsCancellationRequested)
            {
                installer.DiscardWork();
                throw new OperationCanceledException();
            }
            Post(new { type = "update-progress", status = "Installing…", fraction = 1.0, cancelable = false });
            // The new version opens what is on disk, so the charts must be saved before the swap.
            if (!FlushSave())
            {
                installer.DiscardWork();
                throw new UpdateException("Your charts couldn't be saved, so the update wasn't installed.");
            }
            installer.ApplyStaged();
        }
        catch (OperationCanceledException)
        {
            UpdateFailed($"Update canceled. Chartroom {AppVersion} is still installed.");
            return;
        }
        catch (UpdateException failure)
        {
            UpdateFailed(failure.InstallUnchanged
                ? $"The update didn't install. {failure.Message} Chartroom {AppVersion} is still installed."
                : $"The update didn't install. {failure.Message}");
            return;
        }
        finally
        {
            updateCancel.Dispose();
            updateCancel = null;
        }

        try
        {
            installer.LaunchInstalled();
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
        {
            UpdateFailed($"Chartroom {version} is installed. Close Chartroom and open it again to use it.");
            return;
        }
        Close();
    }

    private void UpdateFailed(string message, bool openReleasePage = false)
    {
        Post(new { type = "update-failed", message });
        if (openReleasePage) OpenReleasePage();
    }

    private static void OpenReleasePage() =>
        Process.Start(new ProcessStartInfo(ProjectLinks.LatestReleasePage) { UseShellExecute = true })?.Dispose();

    private void Post(object message) => web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    /// <summary>Writes any pending charts now. False when they could not be saved.</summary>
    private bool FlushSave()
    {
        saveTimer.Stop();
        if (pendingWorkspace is null) return true;
        try
        {
            store.Save(pendingWorkspace);
            pendingWorkspace = null;
            Post(new { type = "saved", ok = true });
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Post(new { type = "saved", ok = false, error = error.Message });
            return false;
        }
    }

    // The page first asks with no choice: the host offers Voyage Recorder's logs, newest first, and the page
    // lets the player pick one or ask for a file. Without any logs the file picker opens at once, as for the
    // coords_<slot>.txt file Coordinate Viewer writes beside itself. Only a log the host offered is followed.
    private void ChooseTrack(HostMessage.FollowTrack follow)
    {
        if (follow.Log is int index)
        {
            if (index < offeredLogs.Count) StartFollowing(offeredLogs[index], follow.ChartId);
            return;
        }
        if (!follow.Pick)
        {
            offeredLogs = VoyageLogs.All(VoyageLogs.Folder(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))).Select(file => file.FullName).ToList();
            if (offeredLogs.Count > 0)
            {
                var logs = offeredLogs.Select((path, id) => new { id, name = Path.GetFileName(path), place = "", modified = File.GetLastWriteTimeUtc(path).ToString("o") });
                Post(new { type = "track-choices", chartId = follow.ChartId, logs });
                return;
            }
        }
        using var dialog = new OpenFileDialog
        {
            Title = "Follow a recording",
            Filter = "Recordings|slot*.jsonl;coords_*.txt|Voyage Recorder logs|*.jsonl|Coordinate Viewer files|coords_*.txt|All files|*.*"
        };
        if (dialog.ShowDialog(this) == DialogResult.OK) StartFollowing(dialog.FileName, follow.ChartId);
    }

    private void StartFollowing(string path, string chartId)
    {
        StopFollowing();
        try
        {
            // New lines arrive on a worker thread and are posted from the window's thread.
            TrackFollower? created = null;
            created = new TrackFollower(path, text => PostFromFollower(() => created, text));
            follower = created;
            followedChartId = chartId;
            Post(new { type = "track-following", name = follower.FileName, chartId, resumed = false });
            TellDevicesFollowing();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            MessageBox.Show(this, $"Chartroom could not follow that file:\n{error.Message}", "Sailwind Chartroom", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    // Lines from a follower that has since been stopped or replaced, or that arrive while the window
    // closes, are dropped.
    private void PostFromFollower(Func<TrackFollower?> source, string text)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try
        {
            BeginInvoke(() =>
            {
                if (source() is { } sender && ReferenceEquals(sender, follower)) Post(new { type = "track-lines", text });
            });
        }
        catch (InvalidOperationException)
        {
        }
    }

    private void StopFollowing()
    {
        if (follower is null) return;
        follower.Dispose();
        follower = null;
        Post(new { type = "track-stopped" });
        TellDevicesFollowing();
    }

    // The page supplies the file; the player chooses where it goes.
    private void SaveExport(HostMessage.ExportFile export)
    {
        string fileName = Path.GetFileName(export.Name);
        string extension = Path.GetExtension(fileName);
        using var dialog = new SaveFileDialog { FileName = fileName, Filter = $"{extension.TrimStart('.').ToUpperInvariant()} file|*{extension}|All files|*.*" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            File.WriteAllText(dialog.FileName, export.Contents);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show(this, $"The file could not be saved:\n{error.Message}", "Sailwind Chartroom", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void RestoreWindow()
    {
        try
        {
            var saved = JsonSerializer.Deserialize<SavedWindow>(File.ReadAllText(WindowPath));
            if (saved is null) return;
            var bounds = new Rectangle(saved.X, saved.Y, saved.Width, saved.Height);
            if (!Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds))) return;
            StartPosition = FormStartPosition.Manual;
            PlaceWindow(bounds);
            if (saved.Maximized) WindowState = FormWindowState.Maximized;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
        }
    }

    private void SaveWindow()
    {
        var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        var state = new SavedWindow(bounds.X, bounds.Y, bounds.Width, bounds.Height, WindowState == FormWindowState.Maximized);
        try
        {
            Directory.CreateDirectory(store.Folder);
            File.WriteAllText(WindowPath, JsonSerializer.Serialize(state));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    // Keeps the window, and its minimum size, inside the working area of the screen it is mostly on,
    // after scaling, resolution or monitor changes.
    private void PlaceWindow(Rectangle bounds)
    {
        Rectangle area = Screen.FromRectangle(bounds).WorkingArea;
        MinimumSize = new Size(Math.Min(MinimumSize.Width, area.Width), Math.Min(MinimumSize.Height, area.Height));
        int width = Math.Clamp(bounds.Width, MinimumSize.Width, area.Width);
        int height = Math.Clamp(bounds.Height, MinimumSize.Height, area.Height);
        Bounds = new Rectangle(Math.Clamp(bounds.X, area.Left, area.Right - width), Math.Clamp(bounds.Y, area.Top, area.Bottom - height), width, height);
    }

    private sealed record SavedWindow(int X, int Y, int Width, int Height, bool Maximized);
}
