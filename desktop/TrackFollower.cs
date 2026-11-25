using System.Text;

namespace SailwindChartroom;

/// <summary>
/// Follows a Coordinate Viewer file while the game appends to it. Windows reports each write, and only
/// the bytes added since the last read are read, so following costs nothing between positions.
/// </summary>
internal sealed class TrackFollower : IDisposable
{
    // Sync clients such as Google Drive can stop Windows reporting changes to a file they watch too, so the file
    // is also checked this often: one open and a length check, with nothing read when nothing was added.
    private static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(5);

    private readonly string path;
    private readonly Action<string> onText;
    private readonly bool watchChanges;
    private readonly System.Threading.Timer check;
    private readonly object gate = new();
    private FileSystemWatcher? watcher;
    private TrackTail tail = TrackTail.Start;
    private bool stopped;

    public string FileName => Path.GetFileName(path);

    /// <param name="onText">Called on a worker thread with whole lines, each run led by its Day line.
    /// Calls never overlap and come in file order, and none starts after Dispose returns.</param>
    public TrackFollower(string path, Action<string> onText) : this(path, onText, CheckEvery, watchChanges: true) { }

    internal TrackFollower(string path, Action<string> onText, TimeSpan checkEvery, bool watchChanges)
    {
        this.path = Path.GetFullPath(path);
        this.onText = onText;
        this.watchChanges = watchChanges;
        check = new System.Threading.Timer(_ => ReadNew(), null, checkEvery, checkEvery);
        // Watching starts before the first read, so a position written meanwhile is read by the next change.
        // The whole file goes first, so the page can join it to the chart's track and offer what it missed.
        lock (gate)
        {
            Watch();
            (string text, tail) = Read(TrackTail.Start);
            if (text.Length > 0) onText(text);
        }
    }

    // Called holding the lock, so an error raised as soon as watching starts waits to replace this watcher.
    private void Watch()
    {
        if (!watchChanges) return;
        var created = new FileSystemWatcher(Path.GetDirectoryName(path)!, Path.GetFileName(path))
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName
        };
        created.Changed += (_, _) => ReadNew();
        created.Created += (_, _) => ReadNew();
        // A sync client may put a new copy of the file in place by renaming it.
        created.Renamed += (_, _) => ReadNew();
        // After an error Windows reports nothing more, so watching starts again.
        created.Error += (_, _) => Rewatch();
        watcher = created;
        created.EnableRaisingEvents = true;
    }

    private void Rewatch()
    {
        lock (gate)
        {
            if (stopped) return;
            watcher?.Dispose();
            try
            {
                Watch();
            }
            catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException)
            {
                // The folder may be briefly unavailable; the timed check keeps following meanwhile.
                watcher = null;
            }
        }
        ReadNew();
    }

    // Reading and reporting share one lock, so two changes close together report in order.
    private void ReadNew()
    {
        lock (gate)
        {
            if (stopped) return;
            (string text, tail) = Read(tail);
            if (text.Length > 0) onText(text);
        }
    }

    private (string Text, TrackTail Next) Read(TrackTail from)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return TrackTail.ReadNew(stream, from);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // The game may be writing; its next write raises another change.
            return ("", from);
        }
    }

    public void Dispose()
    {
        check.Dispose();
        lock (gate)
        {
            stopped = true;
            watcher?.Dispose();
        }
    }
}

/// <summary>Where reading a Coordinate Viewer file stopped, and the day in force there.</summary>
internal readonly record struct TrackTail(long Offset, string? Day)
{
    public static readonly TrackTail Start = new(0, null);

    /// <summary>
    /// The whole lines added after <paramref name="from"/>, led by the day in force if they do not start
    /// with one. A partly written last line waits for the next read. A shorter file, as when a save slot's
    /// file is replaced, is read again from the start.
    /// </summary>
    public static (string Text, TrackTail Next) ReadNew(Stream stream, TrackTail from)
    {
        if (stream.Length < from.Offset) from = Start;
        stream.Seek(from.Offset, SeekOrigin.Begin);
        var bytes = new byte[stream.Length - from.Offset];
        int read = 0;
        while (read < bytes.Length)
        {
            int count = stream.Read(bytes, read, bytes.Length - read);
            if (count == 0) break;
            read += count;
        }
        int end = Array.LastIndexOf(bytes, (byte)'\n', read - 1) + 1;
        if (end <= 0) return ("", from);
        string lines = Encoding.UTF8.GetString(bytes, 0, end);
        string? day = from.Day;
        var text = new StringBuilder();
        foreach (string raw in lines.Split('\n'))
        {
            string line = raw.Trim();
            if (line.Length == 0) continue;
            if (IsDayLine(line)) day = line;
            else if (text.Length == 0 && day is not null) text.Append(day).Append('\n');
            text.Append(line).Append('\n');
        }
        return (text.ToString(), new TrackTail(from.Offset + end, day));
    }

    private static bool IsDayLine(string line) => line.TrimStart().StartsWith("Day", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Where Voyage Recorder writes its logs, beside the game's saves, and the newest of them.</summary>
internal static class VoyageLogs
{
    public static string Folder(string userProfile) =>
        Path.Combine(userProfile, "AppData", "LocalLow", "Raw Lion Workshop", "Sailwind", "Voyage Recorder");

    /// <summary>The save slot logs in the folder, most recently written first.</summary>
    public static IReadOnlyList<FileInfo> All(string folder)
    {
        try
        {
            var directory = new DirectoryInfo(folder);
            if (!directory.Exists) return [];
            return directory.EnumerateFiles("slot*.jsonl").OrderByDescending(file => file.LastWriteTimeUtc).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
