using System.Text;

namespace SailwindChartroom;

/// <summary>
/// Follows a Coordinate Viewer file while the game appends to it. Windows reports each write, and only
/// the bytes added since the last read are read, so following costs nothing between positions.
/// </summary>
internal sealed class TrackFollower : IDisposable
{
    private readonly string path;
    private readonly Action<string> onText;
    private readonly FileSystemWatcher watcher;
    private readonly object gate = new();
    private TrackTail tail = TrackTail.Start;
    private bool stopped;

    public string FileName => Path.GetFileName(path);

    /// <param name="onText">Called on a worker thread with whole lines, each run led by its Day line.
    /// Calls never overlap and come in file order, and none starts after Dispose returns.</param>
    public TrackFollower(string path, Action<string> onText)
    {
        this.path = Path.GetFullPath(path);
        this.onText = onText;
        // Watching starts before the first read, so a position written meanwhile is read by the next change.
        watcher = new FileSystemWatcher(Path.GetDirectoryName(this.path)!, Path.GetFileName(this.path))
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName
        };
        watcher.Changed += (_, _) => ReadNew();
        watcher.Created += (_, _) => ReadNew();
        watcher.EnableRaisingEvents = true;
        // The newest position shows at once; the rest of the file is already on the chart or was left out.
        lock (gate)
        {
            (string text, tail) = Read(TrackTail.Start);
            if (TrackTail.LastPosition(text) is { } latest) onText(latest);
        }
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
        watcher.Dispose();
        lock (gate) stopped = true;
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

    /// <summary>The last position in <paramref name="text"/> with the day before it, or null.</summary>
    public static string? LastPosition(string text)
    {
        string? day = null;
        string? last = null;
        foreach (string line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            if (IsDayLine(line)) day = line;
            else last = line;
        }
        return last is null ? null : day is null ? last + "\n" : $"{day}\n{last}\n";
    }

    private static bool IsDayLine(string line) => line.TrimStart().StartsWith("Day", StringComparison.OrdinalIgnoreCase);
}
