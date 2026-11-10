namespace SailwindChartroom.Tests;

public sealed class HostMessageTests
{
    [Theory]
    [InlineData("""{"type":"ready"}""", typeof(HostMessage.Ready))]
    [InlineData("""{"type":"pin"}""", typeof(HostMessage.Pin))]
    [InlineData("""{"type":"open-folder"}""", typeof(HostMessage.OpenFolder))]
    public void RecognisesPageRequests(string json, Type expected) =>
        Assert.IsType(expected, HostMessage.Parse(json));

    [Fact]
    public void SaveCarriesTheWorkspaceJson()
    {
        var save = Assert.IsType<HostMessage.Save>(HostMessage.Parse("""{"type":"save","workspace":{"charts":[]}}"""));
        Assert.Equal("""{"charts":[]}""", save.Workspace);
    }

    [Theory]
    [InlineData("""{"type":"save"}""")]
    [InlineData("""{"type":"save","workspace":"text"}""")]
    [InlineData("""{"type":"save","workspace":{"charts":{}}}""")]
    [InlineData("""{"type":42}""")]
    [InlineData("""{"type":"delete-everything"}""")]
    [InlineData("""["ready"]""")]
    [InlineData("""not json""")]
    public void IgnoresAnythingElse(string json) => Assert.Null(HostMessage.Parse(json));
}
