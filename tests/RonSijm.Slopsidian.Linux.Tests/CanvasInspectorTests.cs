using System.Text.Json.Nodes;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class CanvasInspectorTests
{
    private const string Scene = """
        {"custom":{"keep":true},"nodes":[
          {"id":"a","type":"text","x":10,"y":20,"width":400,"height":240,"text":"First"},
          {"id":"b","type":"text","x":600,"y":20,"width":400,"height":240,"text":"Second"}
        ],"edges":[{"id":"edge","fromNode":"a","toNode":"b","custom":{"keep":true}}]}
        """;

    [AvaloniaFact]
    public async Task NativeInspectorEditsConnectionPropertiesPreservesUnknownDataAndSharesUndoAndSave()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-canvas-inspector-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "Board.canvas"), Scene, TestContext.Current.CancellationToken);
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            await OpenAsync(window, directory);
            var surface = window.GetVisualDescendants().OfType<NativeCanvasSurface>().Single();
            Find<ComboBox>(window, "CanvasConnectionPicker").SelectedIndex = 0;
            Avalonia.Threading.Dispatcher.UIThread.RunJobs();
            Assert.Equal(Scene, window.Workspace.Text);
            Assert.False(window.Workspace.IsDirty);
            Assert.Equal("edge", surface.SelectedConnectionId);
            Assert.Empty(surface.GetSelection());
            var label = Find<TextBox>(window, "CanvasField_label");
            Assert.True(label.Focus()); label.Text = "Reviewed connection";
            Find<ComboBox>(window, "CanvasField_fromSide").SelectedItem = "bottom";
            Find<ComboBox>(window, "CanvasField_toSide").SelectedItem = "top";
            Find<ComboBox>(window, "CanvasField_fromEnd").SelectedItem = "arrow";
            Find<ComboBox>(window, "CanvasField_toEnd").SelectedItem = "none";
            var color = Find<TextBox>(window, "CanvasField_color");
            Assert.True(color.Focus()); color.Text = "#4f8";
            var edge = new NativeCanvasDocument(window.Workspace.Text).GetConnections().Single();
            Assert.Equal("Reviewed connection", edge.Label);
            Assert.Equal("bottom", edge.FromSide); Assert.Equal("top", edge.ToSide);
            Assert.Equal("arrow", edge.FromEnd); Assert.Equal("none", edge.ToEnd);
            Assert.Equal("#4f8", edge.Color);
            var accepted = window.Workspace.Text;
            color.Text = "invalid";
            Assert.Equal(accepted, window.Workspace.Text);
            Assert.Equal("invalid", color.Text);
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), block => block.Text?.Contains("Canvas colors", StringComparison.Ordinal) == true);
            color.Text = "#4f8";
            Assert.True(surface.Focus());
            window.KeyPressQwerty(PhysicalKey.Z, RawInputModifiers.Control); window.KeyReleaseQwerty(PhysicalKey.Z, RawInputModifiers.Control);
            Assert.Null(new NativeCanvasDocument(window.Workspace.Text).GetConnections().Single().Color);
            window.KeyPressQwerty(PhysicalKey.Y, RawInputModifiers.Control); window.KeyReleaseQwerty(PhysicalKey.Y, RawInputModifiers.Control);
            await window.RunAsync(window.Workspace.SaveAsync);
            var saved = await File.ReadAllTextAsync(Path.Combine(directory, "Board.canvas"), TestContext.Current.CancellationToken);
            Assert.Equal(accepted, saved);
            var json = JsonNode.Parse(saved)!;
            Assert.True(json["custom"]!["keep"]!.GetValue<bool>());
            Assert.True(json["edges"]![0]!["custom"]!["keep"]!.GetValue<bool>());
            window.Width = 760;
            Avalonia.Threading.Dispatcher.UIThread.RunJobs(); window.UpdateLayout();
            var toggle = Find<Button>(window, "CanvasInspector");
            Assert.NotNull(toggle.Flyout); Assert.False(toggle.Flyout.IsOpen);
            Assert.True(toggle.Focus());
            window.KeyPressQwerty(PhysicalKey.Enter, RawInputModifiers.None); window.KeyReleaseQwerty(PhysicalKey.Enter, RawInputModifiers.None);
            Assert.True(toggle.Flyout.IsOpen);
            toggle.Flyout.Hide();
            window.Width = 1400;
            Avalonia.Threading.Dispatcher.UIThread.RunJobs(); window.UpdateLayout();
            window.Activate();
            Assert.Equal("edge", surface.SelectedConnectionId);
            Assert.True(surface.Focus());
            window.KeyPressQwerty(PhysicalKey.Delete, RawInputModifiers.None); window.KeyReleaseQwerty(PhysicalKey.Delete, RawInputModifiers.None);
            var deleted = new NativeCanvasDocument(window.Workspace.Text);
            Assert.Empty(deleted.GetConnections()); Assert.Equal(2, deleted.GetCards().Count);
        }
        finally { window.Workspace.DiscardEdits(); window.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task InlineCardFieldsRetainFocusedInputAndRefuseEditsAfterTheirVaultSessionEnds()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-canvas-inspector-stale-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "Board.canvas"), Scene, TestContext.Current.CancellationToken);
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            await OpenAsync(window, directory);
            var surface = window.GetVisualDescendants().OfType<NativeCanvasSurface>().Single();
            surface.Select(["a"]);
            var text = Find<TextBox>(window, "CanvasField_text");
            Assert.True(text.Focus()); text.Text = "First native edit"; text.Text += " with continued typing";
            Assert.Same(text, Find<TextBox>(window, "CanvasField_text"));
            Assert.True(text.IsFocused);
            Assert.Equal(text.Text, new NativeCanvasDocument(window.Workspace.Text).GetCards()[0].Text);
            var before = window.Workspace.Text;
            window.Workspace.DiscardEdits();
            await window.Workspace.OpenVaultAsync(directory);
            text.Text = "Stale edit must stay in its old field";
            Assert.Equal("Stale edit must stay in its old field", text.Text);
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), block => block.Text?.Contains("no longer open", StringComparison.Ordinal) == true);
            Assert.Equal(Scene, await File.ReadAllTextAsync(Path.Combine(directory, "Board.canvas"), TestContext.Current.CancellationToken));
            Assert.NotEqual(before, window.Workspace.Text);
        }
        finally { window.Workspace.DiscardEdits(); window.Close(); Directory.Delete(directory, true); }
    }

    private static T Find<T>(Window window, string name) where T : Control => window.GetVisualDescendants().OfType<T>().Single(control => control.Name == name);
    private static async Task OpenAsync(MainWindow window, string directory)
    {
        window.Show(); await window.OpenVaultAsync(directory);
        var tree = window.FindControl<TreeView>("FileTree")!;
        tree.SelectedItem = tree.ItemsSource!.Cast<NativeFileNode>().Single();
        for (var attempt = 0; window.Workspace.ActiveTab?.Path != "Board.canvas" && attempt < 500; attempt++) { await Task.Delay(10, TestContext.Current.CancellationToken); }
        Assert.Equal("Board.canvas", window.Workspace.ActiveTab?.Path);
        window.UpdateLayout();
    }
}
