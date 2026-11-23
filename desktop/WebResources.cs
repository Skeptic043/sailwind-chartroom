using System.Reflection;

namespace SailwindChartroom;

/// <summary>The chart page's files, embedded in the exe and served to WebView2 and to devices on the player's network.</summary>
internal static class WebResources
{
    // The page may only reach its own origin and Chartroom Voyages; served to devices it also reaches the
    // desktop's sync connection.
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
        "connect-src 'self' https://skeptic043.github.io; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".txt"] = "text/plain; charset=utf-8",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg"
    };

    /// <summary>The file at this path below the page's root, or null when there is none.</summary>
    public static Stream? Open(string path) =>
        Assembly.GetExecutingAssembly().GetManifestResourceStream($"web/{path.TrimStart('/')}");

    public static string ContentType(string path) =>
        ContentTypes.GetValueOrDefault(Path.GetExtension(path), "application/octet-stream");
}
