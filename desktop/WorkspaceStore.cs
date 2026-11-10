using System.Text.Json;

namespace SailwindChartroom;

/// <summary>Owns workspace.json on disk: startup read, the per-launch backup, and atomic saves.</summary>
internal sealed class WorkspaceStore(string folder)
{
    public string Folder { get; } = folder;
    public string WorkspacePath => Path.Combine(Folder, "workspace.json");
    public string BackupPath => Path.Combine(Folder, "workspace.previous.json");

    /// <summary>False when an unreadable workspace could not be copied aside, so saving would destroy it.</summary>
    public bool CanSave { get; private set; } = true;

    /// <summary>
    /// Reads the saved workspace and refreshes the backup. A failed backup only warns. An unreadable
    /// workspace is copied aside, then the previous launch's backup takes its place when it is valid.
    /// </summary>
    public LoadResult Load()
    {
        Directory.CreateDirectory(Folder);
        if (!File.Exists(WorkspacePath)) return new LoadResult(null, []);

        string? text = TryReadJson(WorkspacePath, out string? readError);
        if (text is not null)
        {
            var warnings = new List<string>();
            try
            {
                // One copy per launch, so a bad session can always be rolled back by hand.
                File.Copy(WorkspacePath, BackupPath, overwrite: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                warnings.Add($"Your charts opened normally, but this launch's backup copy could not be written:\n{error.Message}");
            }
            return new LoadResult(text, warnings);
        }

        string kept = Path.Combine(Folder, $"workspace.unreadable-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.json");
        try
        {
            File.Copy(WorkspacePath, kept, overwrite: false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            CanSave = false;
            return new LoadResult(null, [$"Your saved charts could not be read:\n{readError}\n\nChartroom also could not copy the file aside ({error.Message}), so saving is turned off until you restart. Nothing has been changed at\n{WorkspacePath}"]);
        }

        string? backup = File.Exists(BackupPath) ? TryReadJson(BackupPath, out _) : null;
        if (backup is null)
        {
            return new LoadResult(null, [$"Your saved charts could not be read:\n{readError}\n\nChartroom will start with an empty chart. The unreadable file was kept at\n{kept}"]);
        }
        var restored = new List<string> { $"Your saved charts could not be read:\n{readError}\n\nChartroom opened the copy from your previous launch instead. The unreadable file was kept at\n{kept}" };
        try
        {
            // The backup becomes the workspace again, so the next launch opens it too.
            Save(backup);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            restored.Add($"The previous launch's copy could not be written back as your charts file:\n{error.Message}\n\nYour next change will try again.");
        }
        return new LoadResult(backup, restored);
    }

    /// <summary>Writes through a temporary file so a crash mid-save never truncates the workspace.</summary>
    public void Save(string json)
    {
        if (!CanSave) throw new IOException("Saving is turned off because your unreadable charts file could not be copied aside. Restart Chartroom to try again.");
        Directory.CreateDirectory(Folder);
        string temporary = WorkspacePath + ".tmp";
        File.WriteAllText(temporary, json);
        File.Move(temporary, WorkspacePath, overwrite: true);
    }

    private static string? TryReadJson(string path, out string? error)
    {
        try
        {
            string text = File.ReadAllText(path);
            using (JsonDocument.Parse(text)) { }
            error = null;
            return text;
        }
        catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
        {
            error = exception.Message;
            return null;
        }
    }

    public sealed record LoadResult(string? Workspace, IReadOnlyList<string> Warnings);
}
