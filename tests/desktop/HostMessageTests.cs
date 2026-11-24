namespace SailwindChartroom.Tests;

public sealed class HostMessageTests
{
    [Theory]
    [InlineData("""{"type":"ready"}""", typeof(HostMessage.Ready))]
    [InlineData("""{"type":"pin"}""", typeof(HostMessage.Pin))]
    [InlineData("""{"type":"open-folder"}""", typeof(HostMessage.OpenFolder))]
    [InlineData("""{"type":"pick-import-file"}""", typeof(HostMessage.PickImportFile))]
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
        Assert.Equal(("chart.json", "{}", null, false, null), (export.Name, export.Contents, export.OpenUrl, export.Reveal, export.Id));
        var withNull = Assert.IsType<HostMessage.ExportFile>(HostMessage.Parse("""{"type":"export-file","name":"chart.json","contents":"{}","openUrl":null,"reveal":"true"}"""));
        Assert.Equal((null, false), (withNull.OpenUrl, withNull.Reveal));
    }

    [Fact]
    public void ExportAcceptsSiteOpenUrlAndRevealAndRefusesOtherLinks()
    {
        const string formUrl = "https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml&world=Scrambled+Seas&scrambled_world=https%3A%2F%2Fskeptic043.github.io%2Fscrambled-seas-world-generator%2F%23v%3D1%26seed%3D-77";
        var export = Assert.IsType<HostMessage.ExportFile>(HostMessage.Parse($$"""{"type":"export-file","id":"voyage-1","name":"trip.voyage.json","contents":"{}","openUrl":"{{formUrl}}","reveal":true}"""));
        Assert.Equal(("trip.voyage.json", "{}", formUrl, true, "voyage-1"), (export.Name, export.Contents, export.OpenUrl, export.Reveal, export.Id));
        Assert.Null(HostMessage.Parse("""{"type":"export-file","name":"trip.voyage.json","contents":"{}","openUrl":"https://example.com/evil"}"""));
        Assert.Null(HostMessage.Parse("""{"type":"export-file","name":"trip.voyage.json","contents":"{}","openUrl":""}"""));
        Assert.Null(HostMessage.Parse("""{"type":"export-file","name":"trip.voyage.json","contents":"{}","openUrl":"file:///C:/Windows/System32/calc.exe"}"""));
        Assert.Null(HostMessage.Parse("""{"type":"export-file","name":"trip.voyage.json","contents":"{}","openUrl":123}"""));
        string tooLong = "https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=" + new string('a', 8000);
        Assert.Null(HostMessage.Parse($$"""{"type":"export-file","name":"trip.voyage.json","contents":"{}","openUrl":"{{tooLong}}"}"""));
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
