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
