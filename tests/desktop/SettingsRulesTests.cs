using System.Text.Json;

namespace SailwindChartroom.Tests;

public sealed class SettingsRulesTests
{
    private static ToolShortcut[] Tools(string location = "l", string route = "r") =>
        [new("select", "Select & pan", "v"), new("location", "Add location", location), new("route", "Plot route", route)];

    [Fact]
    public void AcceptsSingleUniqueKeys() => Assert.Null(AppSettings.ShortcutProblem(Tools(location: "K")));

    [Theory]
    [InlineData("", "r", "Choose one letter or number for Add location.")]
    [InlineData("lk", "r", "Choose one letter or number for Add location.")]
    [InlineData("f", "r", "F is already used to fit the chart.")]
    [InlineData("i", "r", "I is already used to open the island library.")]
    [InlineData("r", "r", "Add location and Plot route can't share R.")]
    public void ExplainsWhatToFix(string location, string route, string expected) =>
        Assert.Equal(expected, AppSettings.ShortcutProblem(Tools(location, route)));

    [Fact]
    public void ReadsTheSettingsThePageSends()
    {
        var settings = AppSettings.Parse(JsonDocument.Parse("""{"tools":[{"mode":"select","label":"Select & pan","key":"v"}],"checkForUpdates":false,"interfaceSize":150}""").RootElement)!;
        Assert.Equal("v", Assert.Single(settings.Tools).Key);
        Assert.False(settings.CheckForUpdates);
        Assert.Equal(150, settings.InterfaceSize);
    }

    [Fact]
    public void ReadsTheThemeChoicesAndCurrentMode()
    {
        var settings = AppSettings.Parse(JsonDocument.Parse("""{"tools":[{"mode":"select","label":"Select","key":"v"}],"theme":"sailwind","appearance":"light","dark":false,"themes":[{"id":"chartroom","label":"Chartroom"},{"id":"sailwind","label":"Sailwind paper"}],"appearances":[{"id":"system","label":"Match Windows"},{"broken":true}]}""").RootElement)!;
        Assert.Equal(("sailwind", "light", false), (settings.Theme, settings.Appearance, settings.Dark));
        Assert.Equal(["chartroom", "sailwind"], settings.Themes.Select(choice => choice.Id));
        Assert.Equal("Match Windows", Assert.Single(settings.Appearances).Label);
    }

    [Fact]
    public void TitleBarMessagesNeedAYesOrNo()
    {
        Assert.False(Assert.IsType<HostMessage.SetAppearance>(HostMessage.Parse("""{"type":"set-appearance","dark":false}""")).Dark);
        Assert.Null(HostMessage.Parse("""{"type":"set-appearance","dark":"yes"}"""));
    }

    [Fact]
    public void UnknownInterfaceSizesFollowWindows()
    {
        var settings = AppSettings.Parse(JsonDocument.Parse("""{"tools":[{"mode":"select","label":"Select","key":"v"}],"interfaceSize":137}""").RootElement)!;
        Assert.Equal(0, settings.InterfaceSize);
        Assert.True(settings.CheckForUpdates);
    }

    [Theory]
    [InlineData("""{"tools":[]}""")]
    [InlineData("""{"tools":[{"mode":"select"}]}""")]
    [InlineData("""{"checkForUpdates":true}""")]
    public void IncompleteSettingsAreIgnored(string json) => Assert.Null(AppSettings.Parse(JsonDocument.Parse(json).RootElement));

    [Fact]
    public void HostMessagesForSettingsAndZoomAreChecked()
    {
        var open = Assert.IsType<HostMessage.OpenSettings>(HostMessage.Parse("""{"type":"open-settings","settings":{"tools":[{"mode":"select","label":"Select","key":"v"}]},"defaults":[{"mode":"select","label":"Select","key":"v"}]}"""));
        Assert.Single(open.Defaults);
        Assert.Equal(1.25, Assert.IsType<HostMessage.SetZoom>(HostMessage.Parse("""{"type":"set-zoom","factor":1.25}""")).Factor);
        Assert.Null(HostMessage.Parse("""{"type":"set-zoom","factor":9}"""));
        Assert.Null(HostMessage.Parse("""{"type":"open-settings","settings":{"tools":[]}}"""));
    }
}
