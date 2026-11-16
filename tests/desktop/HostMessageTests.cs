namespace SailwindChartroom.Tests;

public sealed class HostMessageTests
{
    [Theory]
    [InlineData("""{"type":"ready"}""", typeof(HostMessage.Ready))]
    [InlineData("""{"type":"pin"}""", typeof(HostMessage.Pin))]
    [InlineData("""{"type":"open-folder"}""", typeof(HostMessage.OpenFolder))]
    [InlineData("""{"type":"follow-track","chartId":"chart-1"}""", typeof(HostMessage.FollowTrack))]
    [InlineData("""{"type":"stop-track"}""", typeof(HostMessage.StopTrack))]
    [InlineData("""{"type":"copy-text","text":"route"}""", typeof(HostMessage.CopyText))]
    public void RecognisesPageRequests(string json, Type expected) =>
        Assert.IsType(expected, HostMessage.Parse(json));

    [Fact]
    public void FollowTrackCarriesTheChosenLogOrAFileRequest()
    {
        Assert.Equal(new HostMessage.FollowTrack("chart-1"), HostMessage.Parse("""{"type":"follow-track","chartId":"chart-1"}"""));
        Assert.Equal(new HostMessage.FollowTrack("chart-1", 2), HostMessage.Parse("""{"type":"follow-track","chartId":"chart-1","log":2}"""));
        Assert.Equal(new HostMessage.FollowTrack("chart-1", null, true), HostMessage.Parse("""{"type":"follow-track","chartId":"chart-1","pick":true}"""));
        Assert.Equal(new HostMessage.FollowTrack("chart-1"), HostMessage.Parse("""{"type":"follow-track","chartId":"chart-1","log":-1}"""));
    }

    [Fact]
    public void SaveCarriesTheWorkspaceJson()
    {
        var save = Assert.IsType<HostMessage.Save>(HostMessage.Parse("""{"type":"save","workspace":{"charts":[]}}"""));
        Assert.Equal("""{"charts":[]}""", save.Workspace);
    }

    [Fact]
    public void ExportCarriesTheFileNameAndContents()
    {
        var export = Assert.IsType<HostMessage.ExportFile>(HostMessage.Parse("""{"type":"export-file","name":"chart.json","contents":"{}"}"""));
        Assert.Equal(("chart.json", "{}"), (export.Name, export.Contents));
    }

    [Theory]
    [InlineData("https://skeptic043.github.io/sailwind-chartroom-voyages/#world/vanilla")]
    [InlineData("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml")]
    public void OpenLinkAcceptsChartroomVoyagesLinks(string url) =>
        Assert.Equal(new HostMessage.OpenLink(url), HostMessage.Parse($$"""{"type":"open-link","url":"{{url}}"}"""));

    [Theory]
    [InlineData("https://example.com/sailwind-chartroom-voyages/")]
    [InlineData("http://skeptic043.github.io/sailwind-chartroom-voyages/")]
    [InlineData("https://github.com/Skeptic043/sailwind-chartroom/releases")]
    [InlineData("https://github.com/Skeptic043/sailwind-chartroom-voyages/actions")]
    [InlineData("https://skeptic043.github.io.example.com/sailwind-chartroom-voyages/")]
    [InlineData("https://user@github.com/Skeptic043/sailwind-chartroom-voyages/issues")]
    [InlineData("file:///C:/Windows/System32/calc.exe")]
    [InlineData("C:/Windows/System32/calc.exe")]
    public void OpenLinkRefusesAnyOtherAddress(string url) =>
        Assert.Null(HostMessage.Parse($$"""{"type":"open-link","url":"{{url}}"}"""));

    [Theory]
    [InlineData("""{"type":"export-file","name":"chart.json"}""")]
    [InlineData("""{"type":"export-file","name":"","contents":"{}"}""")]
    [InlineData("""{"type":"save"}""")]
    [InlineData("""{"type":"follow-track"}""")]
    [InlineData("""{"type":"save","workspace":"text"}""")]
    [InlineData("""{"type":"save","workspace":{"charts":{}}}""")]
    [InlineData("""{"type":42}""")]
    [InlineData("""{"type":"delete-everything"}""")]
    [InlineData("""["ready"]""")]
    [InlineData("""not json""")]
    public void IgnoresAnythingElse(string json) => Assert.Null(HostMessage.Parse(json));
}
