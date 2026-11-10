using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SailwindChartroom.Updates;

/// <summary>The installable ZIP of a release, with the checksum GitHub published for it.</summary>
internal sealed record ReleasePackage(string AssetName, Uri DownloadUri, long Size, byte[] Sha256);

/// <summary>A full release and its notes. Package is null when no asset can be installed safely.</summary>
internal sealed record GitHubRelease(string Tag, Version Version, string Notes, ReleasePackage? Package);

internal static class ProjectLinks
{
    internal const string Repo = "https://github.com/Skeptic043/sailwind-chartroom";
    internal const string LatestReleasePage = Repo + "/releases/latest";
    internal const string ReleaseDownloadPrefix = Repo + "/releases/download/";
    internal const string ReleasesApi = "https://api.github.com/repos/Skeptic043/sailwind-chartroom/releases?per_page=100";
}

/// <summary>Fail-silent lookup of full releases and numeric version comparison.</summary>
internal static class UpdateChecker
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);
    private static readonly HttpClient Client = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly Regex PackageAssetName = new(@"^SailwindChartroom-(?<version>[^/\\]+)\.zip$", RegexOptions.CultureInvariant);

    /// <summary>One anonymous request for the full releases, newest first. Null means the check failed.</summary>
    internal static async Task<IReadOnlyList<GitHubRelease>?> GetReleasesAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(RequestTimeout);
            using var request = new HttpRequestMessage(HttpMethod.Get, ProjectLinks.ReleasesApi);
            request.Headers.UserAgent.ParseAdd("SailwindChartroom-update-check");
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;
            return ParseReleases(await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false));
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Reads a GitHub release list. Null when it is not a list.</summary>
    internal static IReadOnlyList<GitHubRelease>? ParseReleases(string json)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array) return null;
            return document.RootElement.EnumerateArray()
                .Select(ReadRelease)
                .OfType<GitHubRelease>()
                .OrderByDescending(release => release.Version)
                .ToList();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The releases numerically newer than the running version, in the given order.</summary>
    internal static IReadOnlyList<GitHubRelease> NewerThan(IEnumerable<GitHubRelease> releases, string? current) =>
        releases.Where(release => IsRemoteVersionNewer(current, release.Tag)).ToList();

    /// <summary>
    /// Drafts, prereleases and unparseable tags yield null. The package is kept only when exactly one
    /// asset is named for the tag's version, downloads over HTTPS from this repository, and carries a
    /// SHA-256 digest.
    /// </summary>
    private static GitHubRelease? ReadRelease(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || IsTrue(root, "draft") || IsTrue(root, "prerelease")) return null;
        string? tag = GetString(root, "tag_name");
        Version? version = ParseVersion(tag);
        if (tag is null || version is null) return null;

        ReleasePackage? package = null;
        int matches = 0;
        if (root.TryGetProperty("assets", out JsonElement assets) && assets.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement asset in assets.EnumerateArray())
            {
                if (!IsPackageAssetFor(GetString(asset, "name"), version)) continue;
                matches++;
                package = ReadPackage(asset);
            }
        }
        return new GitHubRelease(tag, version, GetString(root, "body") ?? "", matches == 1 ? package : null);
    }

    /// <summary>True when the asset is SailwindChartroom-X.Y.Z.zip for exactly this version.</summary>
    internal static bool IsPackageAssetFor(string? assetName, Version version)
    {
        if (assetName is null) return false;
        Match match = PackageAssetName.Match(assetName);
        return match.Success && ParseVersion(match.Groups["version"].Value) is { } assetVersion && assetVersion.Equals(version);
    }

    /// <summary>Accepts only "sha256:" followed by 64 hex digits.</summary>
    internal static byte[]? ParseSha256Digest(string? digest)
    {
        const string prefix = "sha256:";
        if (digest is null || !digest.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
        string hex = digest[prefix.Length..];
        return hex.Length == 64 && hex.All(Uri.IsHexDigit) ? Convert.FromHexString(hex) : null;
    }

    private static ReleasePackage? ReadPackage(JsonElement asset)
    {
        string? name = GetString(asset, "name");
        string? url = GetString(asset, "browser_download_url");
        byte[]? sha256 = ParseSha256Digest(GetString(asset, "digest"));
        long size = asset.TryGetProperty("size", out JsonElement sizeElement) && sizeElement.ValueKind == JsonValueKind.Number
            && sizeElement.TryGetInt64(out long parsed) ? parsed : 0;
        if (name is null || sha256 is null || size <= 0
            || url is null || !url.StartsWith(ProjectLinks.ReleaseDownloadPrefix, StringComparison.OrdinalIgnoreCase)
            || !Uri.TryCreate(url, UriKind.Absolute, out Uri? uri) || uri.Scheme != Uri.UriSchemeHttps)
            return null;
        return new ReleasePackage(name, uri, size, sha256);
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool IsTrue(JsonElement element, string property) =>
        element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.True;

    /// <summary>Two to four numeric components; missing ones are zero. A leading v and build metadata are ignored.</summary>
    internal static Version? ParseVersion(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        string numeric = value.Trim();
        if (numeric.StartsWith('v')) numeric = numeric[1..];
        int metadata = numeric.IndexOf('+');
        if (metadata >= 0)
        {
            if (metadata == 0 || metadata == numeric.Length - 1 || numeric.IndexOf('+', metadata + 1) >= 0) return null;
            numeric = numeric[..metadata];
        }
        string[] parts = numeric.Split('.');
        if (parts.Length is < 2 or > 4) return null;
        int[] components = new int[4];
        for (int i = 0; i < parts.Length; i++)
        {
            if (!int.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out components[i])) return null;
        }
        return new Version(components[0], components[1], components[2], components[3]);
    }

    /// <summary>True only when both inputs parse and remote is numerically newer.</summary>
    internal static bool IsRemoteVersionNewer(string? current, string? remote) =>
        ParseVersion(current) is { } currentVersion && ParseVersion(remote) is { } remoteVersion && remoteVersion.CompareTo(currentVersion) > 0;

    /// <summary>Short form such as 0.6 or 0.6.1, used to show versions and to remember a skipped one.</summary>
    internal static string? DisplayVersion(string? value)
    {
        Version? version = ParseVersion(value);
        if (version is null) return null;
        int parts = version.Revision != 0 ? 4 : version.Build != 0 ? 3 : 2;
        return version.ToString(parts);
    }
}
