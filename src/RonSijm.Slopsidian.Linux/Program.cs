using Avalonia;

namespace RonSijm.Slopsidian.Linux;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--version"))
        {
            Console.WriteLine(NativeVersion.Current);
            return 0;
        }
        if (args.Contains("--help"))
        {
            Console.WriteLine($"Slopsidian Native {NativeVersion.Current} — native Linux workspace\nUsage: slopsidian-native [--vault=/absolute/path] [--profile=/absolute/path] [--version]");
            return 0;
        }
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
