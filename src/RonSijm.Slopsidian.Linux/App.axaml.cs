using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace RonSijm.Slopsidian.Linux;

public partial class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var profileArgument = desktop.Args?.FirstOrDefault(value => value.StartsWith("--profile=", StringComparison.Ordinal));
            var profilePath = profileArgument is null ? NativeProfile.DefaultDirectory : Path.GetFullPath(profileArgument["--profile=".Length..]);
            var window = new MainWindow(new NativeProfile(profilePath));
            desktop.MainWindow = window;
            window.Opened += async (_, _) =>
            {
                var argument = desktop.Args?.FirstOrDefault(value => value.StartsWith("--vault=", StringComparison.Ordinal));
                await window.InitializeAsync(argument?["--vault=".Length..]);
            };
        }
        base.OnFrameworkInitializationCompleted();
    }
}
