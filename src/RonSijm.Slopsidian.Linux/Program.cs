using Avalonia;

namespace RonSijm.Slopsidian.Linux;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--help"))
        {
            Console.WriteLine("Slopsidian Native — standalone Linux Markdown editor\nUsage: slopsidian-native [--vault=/absolute/path]");
            return 0;
        }
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
