using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Styling;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow
{
    private async Task<string?> AskTextAsync(string title, string label, string value, string action)
    {
        var dialog = CreateDialog(title, out var content, out var actions);
        content.Spacing = 10;
        content.Children.Add(new TextBlock { Text = label });
        var input = new TextBox { Text = value, MinWidth = 380 };
        content.Children.Add(input);
        var accept = new Button { Content = action, IsDefault = true };
        if (action.StartsWith("Create", StringComparison.Ordinal)) { accept.Classes.Add("create"); }
        accept.Click += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(input.Text)) { dialog.Close(input.Text.Trim()); }
        };
        actions.Children.Add(accept);
        dialog.Opened += (_, _) => { input.Focus(); input.SelectAll(); };
        return await dialog.ShowDialog<string?>(this);
    }

    private async Task<string?> ConfirmAsync(string title, string message, params string[] choices)
    {
        var dialog = CreateDialog(title, out var content, out var actions);
        content.Children.Add(new TextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap });
        foreach (var choice in choices)
        {
            var button = new Button { Content = choice };
            button.Click += (_, _) => dialog.Close(choice);
            actions.Children.Add(button);
        }
        return await dialog.ShowDialog<string?>(this);
    }

    private static Window CreateDialog(string title, out StackPanel content, out StackPanel actions)
    {
        var dialog = new Window { Title = title, Width = 520, SizeToContent = SizeToContent.Height, CanResize = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        var layout = new StackPanel { Margin = new Thickness(24), Spacing = 24 };
        content = new StackPanel();
        actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        var cancel = new Button { Content = "Cancel", IsCancel = true };
        cancel.Click += (_, _) => dialog.Close();
        actions.Children.Add(cancel);
        layout.Children.Add(content);
        layout.Children.Add(actions);
        dialog.Content = layout;
        return dialog;
    }

    private async void OpenGraph(object? sender, RoutedEventArgs args) => await OpenGraphAsync();

    private Task OpenGraphAsync() => RunAsync(async () =>
    {
        if (Workspace.Snapshot.Root is null) { return; }
        await Workspace.IndexAsync(CancellationToken.None);
        var root = Workspace.Snapshot.Root;
        var nodes = Workspace.Notes.Select(note => new NativeGraphNode(note.Path, note.Basename)).ToArray();
        var edges = Workspace.Notes.SelectMany(note => Workspace.MetadataFor(note.Path).Links.Select(link => new { Source = note.Path, Target = Workspace.ResolveLinkTarget(note.Path, link.Target) }))
            .Where(link => link.Target is not null).Select(link => new NativeGraphEdge(link.Source, link.Target!)).Distinct().ToArray();
        var graph = new NativeGraphView(nodes, edges, path =>
        {
            if (Workspace.Snapshot.Root == root) { Navigate(path); }
        });
        new Window { Title = "Graph view — Slopsidian", Width = 1050, Height = 760, MinWidth = 600, MinHeight = 420, Content = graph }.Show(this);
    });

    private async void OpenSettings(object? sender, RoutedEventArgs args) => await OpenSettingsAsync();

    private async Task OpenSettingsAsync()
    {
        if (busy) { return; }
        var window = new NativeSettingsWindow(profile.State.Preferences, Workspace.Snapshot.Root is null ? null : Workspace.Vault);
        var preferences = await window.ShowDialog<NativePreferences?>(this);
        if (preferences is null) { return; }
        profile.State = profile.State with { Preferences = preferences };
        ApplyPreferences();
        await PersistProfileSafelyAsync();
    }

    private void ApplyPreferences()
    {
        var preferences = profile.State.Preferences;
        if (Application.Current is not null)
        {
            Application.Current.RequestedThemeVariant = preferences.Theme switch { "light" => ThemeVariant.Light, "system" => ThemeVariant.Default, _ => ThemeVariant.Dark };
        }
        Editor.FontSize = Math.Clamp(preferences.FontSize, 10, 32);
        Editor.ShowLineNumbers = preferences.LineNumbers;
        Editor.WordWrap = preferences.WordWrap;
        WorkspaceGrid.ColumnDefinitions[1].Width = new GridLength(Math.Clamp(preferences.LeftWidth, 160, 600));
        WorkspaceGrid.ColumnDefinitions[5].Width = new GridLength(Math.Clamp(preferences.RightWidth, 180, 600));
        LeftSidebar.IsVisible = true;
        RightSidebar.IsVisible = true;
        AdaptSidebars();
        if (EditorTabs.SelectedIndex == 1) { RenderReading(); }
        if (SplitPane.IsVisible) { RenderSplit(); }
    }
}
