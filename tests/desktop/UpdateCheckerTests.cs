using SailwindChartroom.Updates;

namespace SailwindChartroom.Tests;

public sealed class UpdateCheckerTests
{
    private const string Digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static string Release(string tag, string body = "Notes", bool prerelease = false, bool draft = false, string? assets = null) =>
        $$"""{"tag_name":"{{tag}}","body":"{{body}}","prerelease":{{(prerelease ? "true" : "false")}},"draft":{{(draft ? "true" : "false")}},"assets":[{{assets ?? Asset(tag.TrimStart('v'))}}]}""";

    private static string Asset(string version, string? url = null, string digest = Digest) =>
        $$"""{"name":"SailwindChartroom-{{version}}.zip","size":1234,"digest":"{{digest}}","browser_download_url":"{{url ?? $"https://github.com/Skeptic043/sailwind-chartroom/releases/download/v{version}/SailwindChartroom-{version}.zip"}}"}""";

    [Fact]
    public void ReleaseListKeepsFullReleasesNewestFirstWithTheirPackages()
    {
        var releases = UpdateChecker.ParseReleases($"[{Release("v0.5.0")},{Release("v0.6.1", "Fixes")},{Release("v0.7.0", prerelease: true)},{Release("v0.8.0", draft: true)}]")!;
        Assert.Equal(["v0.6.1", "v0.5.0"], releases.Select(release => release.Tag));
        Assert.Equal("Fixes", releases[0].Notes);
        Assert.Equal(1234, releases[0].Package!.Size);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"message":"rate limited"}""")]
    public void UnreadableReleaseListFailsTheCheck(string json) => Assert.Null(UpdateChecker.ParseReleases(json));

    [Theory]
    [InlineData("0.5.0", new[] { "v0.6.0", "v0.5.1" })]
    [InlineData("0.6.0", new string[0])]
    public void NewerThanKeepsOnlyReleasesAfterTheRunningVersion(string current, string[] expected)
    {
        var releases = UpdateChecker.ParseReleases($"[{Release("v0.6.0")},{Release("v0.5.1")},{Release("v0.5.0")},{Release("v0.4.9")}]")!;
        Assert.Equal(expected, UpdateChecker.NewerThan(releases, current).Select(release => release.Tag));
    }

    [Theory]
    [InlineData("https://example.com/SailwindChartroom-0.6.0.zip")]
    [InlineData("http://github.com/Skeptic043/sailwind-chartroom/releases/download/v0.6.0/SailwindChartroom-0.6.0.zip")]
    [InlineData("https://github.com/someone-else/sailwind-chartroom/releases/download/v0.6.0/SailwindChartroom-0.6.0.zip")]
    public void PackagesFromOutsideThisRepositoryOrOverHttpAreRejected(string url)
    {
        var release = UpdateChecker.ParseReleases($"[{Release("v0.6.0", assets: Asset("0.6.0", url))}]")!.Single();
        Assert.Null(release.Package);
    }

    [Fact]
    public void ReleaseWithoutADigestOrWithTwoMatchingAssetsHasNoPackage()
    {
        Assert.Null(UpdateChecker.ParseReleases($"[{Release("v0.6.0", assets: Asset("0.6.0", digest: "md5:abc"))}]")!.Single().Package);
        Assert.Null(UpdateChecker.ParseReleases($"[{Release("v0.6.0", assets: Asset("0.6.0") + "," + Asset("0.6.0"))}]")!.Single().Package);
    }

    [Theory]
    [InlineData("SailwindChartroom-0.6.0.zip", true)]
    [InlineData("SailwindChartroom-0.6.zip", true)]
    [InlineData("SailwindChartroom-0.5.0.zip", false)]
    [InlineData("Sailwind Chartroom 0.6.0.zip", false)]
    public void PackageAssetMustNameTheReleaseVersion(string name, bool expected) =>
        Assert.Equal(expected, UpdateChecker.IsPackageAssetFor(name, new Version(0, 6, 0, 0)));

    [Theory]
    [InlineData("0.5.0", "v0.5.1", true)]
    [InlineData("0.5.0", "v0.5", false)]
    [InlineData("0.5.0", "v0.4.9", false)]
    [InlineData("0.5.0", "nightly", false)]
    [InlineData("0.5.0+abc", "v0.10.0", true)]
    public void OnlyANumericallyNewerReleaseIsAnUpdate(string current, string remote, bool newer) =>
        Assert.Equal(newer, UpdateChecker.IsRemoteVersionNewer(current, remote));

    [Theory]
    [InlineData("v0.6.0", "0.6")]
    [InlineData("v0.6.1", "0.6.1")]
    [InlineData("v1.2.3.4", "1.2.3.4")]
    public void DisplayVersionDropsTrailingZeroComponents(string tag, string expected) =>
        Assert.Equal(expected, UpdateChecker.DisplayVersion(tag));
}
