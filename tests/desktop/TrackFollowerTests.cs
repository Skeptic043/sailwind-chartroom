using System.Text;

namespace SailwindChartroom.Tests;

public sealed class TrackFollowerTests
{
    private static MemoryStream File(string text) => new(Encoding.UTF8.GetBytes(text));

    [Fact]
    public void ReadsOnlyWhatWasAddedAndLeadsWithTheDay()
    {
        var (first, tail) = TrackTail.ReadNew(File("Day: 3\r\n40.1 0.5 9.5 90\r\n"), TrackTail.Start);
        Assert.Equal("Day: 3\n40.1 0.5 9.5 90\n", first);
        var (second, _) = TrackTail.ReadNew(File("Day: 3\r\n40.1 0.5 9.5 90\r\n40.2 0.6 10 92\r\n"), tail);
        Assert.Equal("Day: 3\n40.2 0.6 10 92\n", second);
    }

    [Fact]
    public void WaitsForAPartlyWrittenLine()
    {
        var (text, tail) = TrackTail.ReadNew(File("40.1 0.5 9.5 90\n40.2 0."), TrackTail.Start);
        Assert.Equal("40.1 0.5 9.5 90\n", text);
        Assert.Equal(16, tail.Offset);
        var (rest, _) = TrackTail.ReadNew(File("40.1 0.5 9.5 90\n40.2 0.6 10 92\n"), tail);
        Assert.Equal("40.2 0.6 10 92\n", rest);
    }

    [Fact]
    public void KeepsANewDayThatStartsPartWay()
    {
        var (text, tail) = TrackTail.ReadNew(File("Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n"), TrackTail.Start);
        Assert.Equal("Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n", text);
        Assert.Equal("Day: 4", tail.Day);
    }

    [Fact]
    public void StartsAgainWhenTheFileIsReplaced()
    {
        var (_, tail) = TrackTail.ReadNew(File("Day: 3\n40.1 0.5 9.5 90\n40.2 0.6 10 92\n"), TrackTail.Start);
        var (text, _) = TrackTail.ReadNew(File("Day: 1\n30 1 8 45\n"), tail);
        Assert.Equal("Day: 1\n30 1 8 45\n", text);
    }

    [Fact]
    public void FollowingStartsFromTheNewestPosition()
    {
        Assert.Equal("Day: 4\n40.2 0.6 0.5 92\n", TrackTail.LastPosition("Day: 3\n40.1 0.5 23.5 90\nDay: 4\n40.2 0.6 0.5 92\n"));
        Assert.Null(TrackTail.LastPosition("Day: 3\n"));
    }

    [Fact]
    public void ReportsLinesTheGameAppends()
    {
        string folder = Directory.CreateTempSubdirectory("chartroom-track-").FullName;
        string path = Path.Combine(folder, "coords_0.txt");
        try
        {
            System.IO.File.WriteAllText(path, "Day: 2\n40.1 0.5 9.5 90\n");
            var received = new List<string>();
            using var arrived = new SemaphoreSlim(0);
            using var follower = new TrackFollower(path, text => { lock (received) received.Add(text); arrived.Release(); });
            Assert.True(arrived.Wait(TimeSpan.FromSeconds(5)));
            System.IO.File.AppendAllText(path, "40.2 0.6 10 92\n");
            Assert.True(arrived.Wait(TimeSpan.FromSeconds(5)));
            lock (received) Assert.Equal(["Day: 2\n40.1 0.5 9.5 90\n", "Day: 2\n40.2 0.6 10 92\n"], received.Distinct());
        }
        finally
        {
            Directory.Delete(folder, true);
        }
    }
}
