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
            var notes = window.FindControl<ListBox>("NoteList")!;
            for (var attempt = 0; notes.ItemCount == 0 && attempt < 500; attempt++) await Task.Delay(10);
            Assert.True(notes.ItemCount > 0, window.FindControl<TextBlock>("ErrorText")!.Text + " files=" + window.Workspace.Snapshot.Files.Count + " status=" + window.FindControl<TextBlock>("SearchStatus")!.Text);
            notes.SelectedIndex = 0;
            // The async selection handler completes via the dispatcher.
            for (var attempt = 0; window.Workspace.Document is null && attempt < 500; attempt++) await Task.Delay(10);
            Assert.True(window.Workspace.Document is not null, window.FindControl<TextBlock>("ErrorText")!.Text + " selected=" + notes.SelectedIndex);
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
    public void ReadingViewUsesNativeControlsAndDoesNotExecuteHtml()
    {
        var content = new StackPanel();
        NativeMarkdown.Render(content, "# Heading\n\nA **bold** paragraph.\n\n<script>alert('no')</script>\n\n- Item\n", _ => throw new Exception("Links must require a click."));
        Assert.Contains(content.Children, control => control is SelectableTextBlock text && text.FontSize == 30);
        Assert.Contains(content.Children, control => control is SelectableTextBlock text && text.Text?.Contains("<script>") == true);
        Assert.DoesNotContain(content.GetVisualDescendants(), control => control.GetType().Name.Contains("WebView"));
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
