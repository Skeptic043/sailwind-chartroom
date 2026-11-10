namespace SailwindChartroom;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Updates.UpdateInstaller.WaitForUpdatingProcess();
        Updates.UpdateInstaller.CleanUpAtStartup();
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
