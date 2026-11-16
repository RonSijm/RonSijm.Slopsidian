using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using AvaloniaEdit;
using Xunit;

[assembly: AvaloniaTestApplication(typeof(RonSijm.Slopsidian.Linux.Tests.TestAppBuilder))]

namespace RonSijm.Slopsidian.Linux.Tests;

public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions());
}

public sealed class WindowTests
{
    [AvaloniaFact]
    public async Task NativeEditorInputUpdatesDirtyStateAndSavesThroughSharedService()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "Welcome.md"), "# Welcome\n");
        var window = new MainWindow();
        try
        {
            window.Show();
            await window.OpenVaultAsync(directory);
            Avalonia.Threading.Dispatcher.UIThread.RunJobs();
            window.UpdateLayout();
            var tree = window.FindControl<TreeView>("FileTree")!;
            tree.SelectedItem = tree.ItemsSource!.Cast<NativeFileNode>().Single();
            await WaitForAsync(() => window.Workspace.Document is not null);
            var editor = window.FindControl<TextEditor>("Editor")!;
            window.UpdateLayout();
            Assert.True(editor.TextArea.Focus());
            Avalonia.Threading.Dispatcher.UIThread.RunJobs();
            editor.CaretOffset = editor.Text.Length;
            window.KeyTextInput("Native input");
            Assert.True(window.Workspace.IsDirty);
            Assert.Contains("Native input", window.Workspace.Text);
            await window.RunAsync(window.Workspace.SaveAsync);
            Assert.Equal(editor.Text, await File.ReadAllTextAsync(Path.Combine(directory, "Welcome.md")));
            Assert.False(window.Workspace.IsDirty);
            window.Width = 760;
            window.Height = 520;
            window.UpdateLayout();
            Assert.True(window.FindControl<Button>("NewNoteButton")!.Bounds.Width > 0);
        }
        finally { window.Workspace.DiscardEdits(); window.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task SwitchingNativeDocumentTabsRetainsUndoCaretAndIndependentDrafts()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-tabs-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "First.md"), "First saved");
        await File.WriteAllTextAsync(Path.Combine(directory, "Second.md"), "Second saved");
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            window.Show();
            await window.OpenVaultAsync(directory);
            var tree = window.FindControl<TreeView>("FileTree")!;
            var files = tree.ItemsSource!.Cast<NativeFileNode>().ToArray();
            tree.SelectedItem = files.Single(file => file.Path == "First.md");
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "First.md");
            var editor = window.FindControl<TextEditor>("Editor")!;
            var firstBuffer = editor.Document;
            editor.Document.Insert(editor.Document.TextLength, " draft");
            editor.CaretOffset = 3;
            tree.SelectedItem = files.Single(file => file.Path == "Second.md");
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "Second.md");
            editor.Document.Insert(editor.Document.TextLength, " second draft");
            var tabs = window.FindControl<ListBox>("DocumentTabs")!;
            tabs.SelectedItem = window.Workspace.Tabs.Single(tab => tab.Path == "First.md");
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "First.md");
            Assert.Same(firstBuffer, editor.Document);
            Assert.Equal("First saved draft", editor.Text);
            Assert.Equal(3, editor.CaretOffset);
            editor.Undo();
            Assert.Equal("First saved", editor.Text);
            Assert.Equal("Second saved second draft", window.Workspace.Tabs.Single(tab => tab.Path == "Second.md").Text);
            Assert.Equal("First saved", await File.ReadAllTextAsync(Path.Combine(directory, "First.md")));
            Assert.Equal("Second saved", await File.ReadAllTextAsync(Path.Combine(directory, "Second.md")));
        }
        finally
        {
            foreach (var tab in window.Workspace.Tabs) { tab.Reload(tab.Document); }
            window.Close();
            Directory.Delete(directory, true);
        }
    }

    [AvaloniaFact]
    public async Task EditingAnInactiveNativeBufferUpdatesItsOwnDraftAndRetainsTheActiveEditor()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-inactive-buffer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "First.md"), "First saved");
        await File.WriteAllTextAsync(Path.Combine(directory, "Second.md"), "Second saved");
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            window.Show();
            await window.OpenVaultAsync(directory);
            var tree = window.FindControl<TreeView>("FileTree")!;
            var files = tree.ItemsSource!.Cast<NativeFileNode>().ToArray();
            tree.SelectedItem = files.Single(file => file.Path == "First.md");
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "First.md");
            var editor = window.FindControl<TextEditor>("Editor")!;
            var firstBuffer = editor.Document;
            tree.SelectedItem = files.Single(file => file.Path == "Second.md");
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "Second.md");
            firstBuffer.Insert(firstBuffer.TextLength, " changed by its native view");
            Assert.Equal("First saved changed by its native view", window.Workspace.Tabs.Single(tab => tab.Path == "First.md").Text);
            Assert.Equal("Second saved", window.Workspace.Text);
            Assert.Equal("Second saved", editor.Text);
            Assert.Equal("First saved", await File.ReadAllTextAsync(Path.Combine(directory, "First.md")));
        }
        finally
        {
            foreach (var tab in window.Workspace.Tabs) { tab.Reload(tab.Document); }
            window.Close();
            Directory.Delete(directory, true);
        }
    }

    [AvaloniaFact]
    public void NativeIconButtonsExposeAccessibleNames()
    {
        var window = new MainWindow();
        try
        {
            window.Show();
            window.UpdateLayout();
            var buttons = window.GetVisualDescendants().OfType<Button>().Where(button => button.Content is NativeIcon).ToArray();
            Assert.True(buttons.Length > 5);
            Assert.All(buttons, button => Assert.False(string.IsNullOrWhiteSpace(Avalonia.Automation.AutomationProperties.GetName(button))));
        }
        finally { window.Close(); }
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; !condition() && attempt < 500; attempt++) { await Task.Delay(10); }
        Assert.True(condition());
    }

    [AvaloniaFact]
    public void ReadingViewUsesNativeControlsAndDoesNotExecuteHtml()
    {
        var content = new StackPanel();
        NativeMarkdown.Render(content, "# Heading\n\nA **bold** paragraph.\n\n<script>alert('no')</script>\n\n- Item\n", _ => throw new Exception("Links must require a click."));
        Assert.Contains(content.Children, control => control is SelectableTextBlock text && text.FontSize == 30);
        Assert.Contains(content.Children, control => control is SelectableTextBlock text && text.Text?.Contains("<script>") == true);
        Assert.DoesNotContain(content.GetVisualDescendants(), control => control.GetType().Name.Contains("WebView"));
    }

    [AvaloniaFact]
    public void ReadingRendersTheBodyWithoutTurningYamlPropertiesIntoMarkdown()
    {
        var content = new StackPanel();
        NativeMarkdown.Render(content, "---\nstatus: Draft\npriority: 3\n---\n# Visible body\n", _ => { });
        var heading = Assert.IsType<SelectableTextBlock>(Assert.Single(content.Children));
        Assert.Equal("Visible body", Assert.IsType<Run>(Assert.Single(heading.Inlines!)).Text);
        Assert.Equal(30, heading.FontSize);
    }

    [AvaloniaTheory]
    [InlineData("[Note](Folder/Note%2520name.md)", "Folder/Note%2520name.md", true)]
    [InlineData("[[Folder/Note%20name]]", "Folder/Note%20name", false)]
    [InlineData("[Web](https://example.test/?q=a%26b)", "https://example.test/?q=a%26b", true)]
    public void ReadingKeepsLinkKindsAndEncodedTargetsForTheNavigator(string markdown, string expected, bool markdownLink)
    {
        string? target = null;
        var fromMarkdown = false;
        var content = new StackPanel();
        NativeMarkdown.Render(content, markdown, link => target = link, link => { target = link; fromMarkdown = true; });
        var paragraph = Assert.IsType<SelectableTextBlock>(Assert.Single(content.Children));
        var link = Assert.Single(paragraph.Inlines!.OfType<InlineUIContainer>());
        Assert.IsType<Button>(link.Child).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Equal(expected, target);
        Assert.Equal(markdownLink, fromMarkdown);
    }

    [AvaloniaFact]
    public void WikiLinksAreClickableNativeControlsAndCodeRemainsLiteral()
    {
        string? target = null;
        var content = new StackPanel();
        NativeMarkdown.Render(content, "Open [[Project notes|the project]]. `[[code]]`", link => target = link);
        var paragraph = Assert.IsType<SelectableTextBlock>(Assert.Single(content.Children));
        var link = Assert.Single(paragraph.Inlines!.OfType<InlineUIContainer>());
        var button = Assert.IsType<Button>(link.Child);
        Assert.Equal("the project", button.Content);
        Assert.Null(target);
        button.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Equal("Project notes", target);
    }
}
