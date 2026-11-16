using System.Text.Json;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeSettingsWindow : Window
{
    private static readonly string[] NoteLocationKeys = ["root", "current", "folder"];
    private static readonly string[] LinkFormatKeys = ["shortest", "relative", "absolute"];
    private readonly VaultService? vault;
    private NativePreferences preferences;
    private CorePluginSnapshot? core;
    private readonly StackPanel page = new() { Spacing = 20, Margin = new Thickness(28) };
    private readonly ListBox navigation = new() { ItemsSource = new[] { "Editor", "Appearance", "Files and links", "Core plugins", "Hotkeys", "About" }, Margin = new Thickness(12, 16) };
    private readonly TextBlock error = new() { Classes = { "error" }, TextWrapping = TextWrapping.Wrap };

    public NativeSettingsWindow(NativePreferences current, VaultService? selectedVault)
    {
        preferences = current;
        vault = selectedVault;
        Title = "Settings — Slopsidian";
        Width = 900;
        Height = 700;
        MinWidth = 700;
        MinHeight = 520;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var layout = new Grid { ColumnDefinitions = new ColumnDefinitions("200,*"), RowDefinitions = new RowDefinitions("*,Auto") };
        layout.Children.Add(navigation);
        var scroll = new ScrollViewer { Content = page };
        Grid.SetColumn(scroll, 1);
        layout.Children.Add(scroll);
        var done = new Button { Content = "Done", IsDefault = true, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(20) };
        done.Click += (_, _) => Close(preferences);
        Grid.SetRow(done, 1);
        Grid.SetColumn(done, 1);
        layout.Children.Add(done);
        Content = layout;
        navigation.SelectionChanged += async (_, _) => await ShowPageAsync();
        navigation.SelectedIndex = 0;
    }

    private async Task ShowPageAsync()
    {
        page.Children.Clear();
        error.Text = "";
        var section = navigation.SelectedItem as string ?? "Editor";
        page.Children.Add(new TextBlock { Text = section, FontSize = 24, FontWeight = FontWeight.SemiBold });
        switch (section)
        {
            case "Editor": EditorPage(); break;
            case "Appearance": AppearancePage(); break;
            case "Files and links": await FilesPageAsync(); break;
            case "Core plugins": await CorePageAsync(); break;
            case "Hotkeys": HotkeysPage(); break;
            case "About": AboutPage(); break;
        }
        page.Children.Add(error);
    }

    private void EditorPage()
    {
        AddToggle("Show line numbers", preferences.LineNumbers, value => preferences = preferences with { LineNumbers = value });
        AddToggle("Wrap long lines", preferences.WordWrap, value => preferences = preferences with { WordWrap = value });
        AddToggle("Autosave Markdown", preferences.Autosave, value => preferences = preferences with { Autosave = value });
        var size = new NumericUpDown { Minimum = 10, Maximum = 32, Value = (decimal)preferences.FontSize, Increment = 1, Width = 110, HorizontalAlignment = HorizontalAlignment.Left };
        size.ValueChanged += (_, _) => preferences = preferences with { FontSize = (double)(size.Value ?? 16) };
        AddField("Editor font size", size);
        page.Children.Add(new TextBlock { Text = "Drafts are also retained in the private native app profile. A conflicting external edit is never silently overwritten.", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
    }

    private void AppearancePage()
    {
        var theme = new ComboBox { ItemsSource = new[] { "dark", "light", "system" }, SelectedItem = preferences.Theme, Width = 200 };
        theme.SelectionChanged += (_, _) => preferences = preferences with { Theme = theme.SelectedItem as string ?? "dark" };
        AddField("Base color scheme", theme);
        page.Children.Add(new TextBlock { Text = "The native interface uses the same neutral surfaces, violet accent and icon source as Slopsidian. Browser CSS themes do not style native widgets.", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
    }

    private async Task FilesPageAsync()
    {
        if (vault is null) { page.Children.Add(new TextBlock { Text = "Open a vault to configure files and links." }); return; }
        try
        {
            var document = await vault.ReadConfigurationAsync("app", (await vault.GetSnapshotAsync()).Root);
            var settings = NativeFileSettings.Read(document.Data);
            var location = Choice("Default location for new notes", ["Vault root", "Same folder as the current note", "Specified folder"], Array.IndexOf(NoteLocationKeys, settings.NewFileLocation));
            var folder = new TextBox { Text = settings.NewFileFolderPath, PlaceholderText = "/" };
            AddField("New note folder", folder);
            var link = Choice("New link format", ["Shortest path when possible", "Relative path to file", "Absolute path in vault"], Array.IndexOf(LinkFormatKeys, settings.NewLinkFormat));
            var markdown = new CheckBox { Content = "Use Markdown links", IsChecked = settings.UseMarkdownLinks };
            page.Children.Add(markdown);
            var attachment = new TextBox { Text = settings.AttachmentFolderPath, PlaceholderText = "/, ./, ./Attachments or a vault folder" };
            AddField("Attachment folder", attachment);
            var trash = Choice("Deleted files", ["Move to vault trash", "System trash (requires a supported host)"], settings.TrashOption == "system" ? 1 : 0);
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            var save = new Button { Content = "Save settings" };
            save.Click += async (_, _) =>
            {
                save.IsEnabled = false;
                try
                {
                    var updated = new NativeFileSettings(NoteLocationKeys[location.SelectedIndex], folder.Text ?? "/",
                        LinkFormatKeys[link.SelectedIndex], markdown.IsChecked == true, attachment.Text ?? "/", trash.SelectedIndex == 1 ? "system" : "local");
                    document = await vault.WriteConfigurationAsync("app", new WriteConfigurationRequest(document.Root, document.Version, updated.Apply(document.Data)));
                    error.Text = "";
                }
                catch (Exception exception) { error.Text = exception.Message; }
                finally { save.IsEnabled = true; }
            };
            var reload = new Button { Content = "Reload settings" };
            reload.Click += async (_, _) => await ShowPageAsync();
            actions.Children.Add(save);
            actions.Children.Add(reload);
            page.Children.Add(actions);
        }
        catch (Exception exception) { error.Text = exception.Message; }
    }

    private ComboBox Choice(string label, string[] options, int selected)
    {
        var input = new ComboBox { ItemsSource = options, SelectedIndex = Math.Max(0, selected), MinWidth = 240 };
        AddField(label, input);
        return input;
    }

    private async Task CorePageAsync()
    {
        if (vault is null) { page.Children.Add(new TextBlock { Text = "Open a vault to configure core plugins." }); return; }
        try
        {
            core = await vault.ReadCorePluginsAsync();
            foreach (var plugin in core.Plugins) { AddCorePlugin(plugin); }
        }
        catch (Exception exception) { error.Text = exception.Message; }
    }

    private void AddCorePlugin(CorePluginState plugin)
    {
        var section = new StackPanel { Spacing = 10, Margin = new Thickness(0, 0, 0, 12) };
        var toggle = new CheckBox { Content = plugin.Name, IsChecked = plugin.ConfiguredEnabled };
        toggle.IsCheckedChanged += async (_, _) =>
        {
            try { core = await vault!.SetCoreEnabledAsync(plugin.Id, new CoreEnableRequest(core!.Root, toggle.IsChecked == true)); error.Text = ""; }
            catch (Exception exception) { error.Text = exception.Message; }
        };
        section.Children.Add(toggle);
        if (plugin.Fields.Count > 0) { AddCoreSettings(section, plugin); }
        page.Children.Add(section);
    }

    private void AddCoreSettings(StackPanel section, CorePluginState plugin)
    {
        var inputs = new Dictionary<string, Control>(StringComparer.Ordinal);
        foreach (var field in plugin.Fields.Where(field => field.Visible))
        {
            var input = CoreInput(field, plugin.Settings[field.Key]);
            inputs.Add(field.Key, input);
            var row = new StackPanel { Spacing = 8, Margin = new Thickness(24, 0, 0, 6) };
            row.Children.Add(new TextBlock { Text = field.Label, Classes = { "muted" }, FontSize = 12 });
            row.Children.Add(input);
            section.Children.Add(row);
        }
        var apply = new Button { Content = "Apply " + plugin.Name + " settings", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(24, 0, 0, 0) };
        apply.Click += async (_, _) =>
        {
            try
            {
                var values = new JsonObject();
                foreach (var field in plugin.Fields.Where(field => field.Visible)) { values[field.Key] = CoreValue(field, inputs[field.Key]); }
                var current = core!.Plugins.Single(item => item.Id == plugin.Id);
                core = await vault!.WriteCoreSettingsAsync(plugin.Id, new CoreSettingsRequest(core.Root, JsonSerializer.SerializeToElement(values), current.SettingsVersion));
                error.Text = "";
            }
            catch (Exception exception) { error.Text = exception.Message; }
        };
        section.Children.Add(apply);
    }

    private static Control CoreInput(CoreSettingField field, JsonNode? value) => field.Type switch
    {
        "checkbox" => new CheckBox { IsChecked = value?.GetValue<bool>() ?? false },
        "select" => new ComboBox { ItemsSource = field.Options, SelectedItem = value?.ToString(), MinWidth = 180 },
        "number" or "range" => new NumericUpDown { Value = value is null ? 0 : decimal.Parse(value.ToString(), System.Globalization.CultureInfo.InvariantCulture), Minimum = (decimal)(field.Minimum ?? -1_000_000), Maximum = (decimal)(field.Maximum ?? 1_000_000), Increment = (decimal)(field.Step ?? 1), MinWidth = 140 },
        _ => new TextBox { Text = value?.ToString() ?? "" }
    };

    private static JsonNode? CoreValue(CoreSettingField field, Control control) => control switch
    {
        CheckBox checkbox => JsonValue.Create(checkbox.IsChecked == true),
        ComboBox choice => JsonValue.Create(choice.SelectedItem as string),
        NumericUpDown number => JsonValue.Create(number.Value ?? 0),
        TextBox text when field.Type == "commands" => JsonSerializer.SerializeToNode((text.Text ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)),
        TextBox text => JsonValue.Create(text.Text ?? ""),
        _ => null
    };

    private void AddToggle(string label, bool value, Action<bool> set)
    {
        var checkbox = new CheckBox { Content = label, IsChecked = value };
        checkbox.IsCheckedChanged += (_, _) => set(checkbox.IsChecked == true);
        page.Children.Add(checkbox);
    }

    private void AddField(string label, Control control)
    {
        var row = new StackPanel { Spacing = 10 };
        row.Children.Add(new TextBlock { Text = label });
        row.Children.Add(control);
        page.Children.Add(row);
    }

    private void HotkeysPage()
    {
        foreach (var text in new[] { "Ctrl+O — Quick switcher", "Ctrl+P — Command palette", "Ctrl+N — New note", "Ctrl+S — Save", "Ctrl+Shift+O — Open or create vault", "Ctrl+, — Settings", "Alt+Left / Alt+Right — Back / Forward", "F5 — Refresh files" })
        {
            page.Children.Add(new TextBlock { Text = text });
        }
    }

    private void AboutPage()
    {
        page.Children.Add(new TextBlock { Text = "Slopsidian Native", FontSize = 20, FontWeight = FontWeight.SemiBold });
        page.Children.Add(new TextBlock { Text = "Linux client version " + NativeVersion.Current, Classes = { "muted" } });
        page.Children.Add(new TextBlock { Text = "A native .NET/Avalonia port of Slopsidian. The interface uses native widgets, with no Electron, Blazor or WebView.", TextWrapping = TextWrapping.Wrap });
        page.Children.Add(new TextBlock { Text = "The full native port is in progress. Settings from the shared core catalog do not establish that a native workflow has been ported or verified.", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
    }
}
