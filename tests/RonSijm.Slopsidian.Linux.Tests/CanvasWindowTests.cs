using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using AvaloniaEdit;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class CanvasWindowTests
{
    private const string Scene = """
        {"nodes":[{"id":"card","type":"text","x":10,"y":20,"width":400,"height":240,"text":"# Native Canvas\nA card built with native widgets."}],"edges":[]}
        """;

    [AvaloniaFact]
    public async Task NativeCanvasDragUndoRedoAndSaveUseTheSameIndependentDocumentBuffer()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-canvas-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "Board.canvas"), Scene);
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            window.Show();
            await window.OpenVaultAsync(directory);
            window.FindControl<TreeView>("FileTree")!.SelectedItem = window.FindControl<TreeView>("FileTree")!.ItemsSource!.Cast<NativeFileNode>().Single();
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "Board.canvas");
            window.UpdateLayout();
            Assert.Equal(2, window.FindControl<TabControl>("EditorTabs")!.SelectedIndex);
            var surface = window.GetVisualDescendants().OfType<NativeCanvasSurface>().Single();
            surface.SnapToGrid = false;
            var frame = surface.GetVisualDescendants().OfType<Border>().Single(border => border.Tag as string == "card");
            var start = frame.TranslatePoint(new Point(120, 80), window)!.Value;
            var end = new Point(start.X + 40 * surface.Zoom, start.Y + 20 * surface.Zoom);
            window.MouseDown(start, MouseButton.Left); window.MouseMove(end); window.MouseUp(end, MouseButton.Left);
            Assert.True(window.Workspace.IsDirty);
            Assert.Equal(50, new NativeCanvasDocument(window.Workspace.Text).GetCards()[0].X);
            Assert.True(surface.Focus());
            window.KeyPressQwerty(PhysicalKey.Z, RawInputModifiers.Control); window.KeyReleaseQwerty(PhysicalKey.Z, RawInputModifiers.Control);
            Assert.Equal(Scene, window.Workspace.Text);
            Assert.False(window.Workspace.IsDirty);
            window.KeyPressQwerty(PhysicalKey.Y, RawInputModifiers.Control); window.KeyReleaseQwerty(PhysicalKey.Y, RawInputModifiers.Control);
            await window.RunAsync(window.Workspace.SaveAsync);
            Assert.Equal(window.Workspace.Text, await File.ReadAllTextAsync(Path.Combine(directory, "Board.canvas")));
            Assert.False(window.Workspace.IsDirty);
            Assert.Equal("canvas", Assert.Single(window.Workspace.CaptureSession().Tabs).ViewMode);
        }
        finally { window.Workspace.DiscardEdits(); window.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task InvalidCanvasSourceRemainsAccessibleAndCannotOverwriteTheSavedDocument()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-canvas-invalid-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "Board.canvas"), Scene);
        using var profile = new NativeProfile();
        profile.State = profile.State with { Preferences = new NativePreferences { Autosave = false } };
        var window = new MainWindow(profile);
        try
        {
            window.Show();
            await window.OpenVaultAsync(directory);
            var tree = window.FindControl<TreeView>("FileTree")!;
            tree.SelectedItem = tree.ItemsSource!.Cast<NativeFileNode>().Single();
            await WaitForAsync(() => window.Workspace.ActiveTab?.Path == "Board.canvas");
            window.FindControl<TabControl>("EditorTabs")!.SelectedIndex = 0;
            window.FindControl<TextEditor>("Editor")!.Text = "{ broken source";
            await Assert.ThrowsAsync<InvalidDataException>(() => window.Workspace.SaveAsync());
            Assert.Equal(Scene, await File.ReadAllTextAsync(Path.Combine(directory, "Board.canvas")));
            Assert.Equal("{ broken source", window.Workspace.Text);
            Assert.True(window.Workspace.IsDirty);
            var state = window.Workspace.CaptureSession();
            Assert.Equal("source", Assert.Single(state.Tabs).ViewMode);
            using var reopened = new NativeWorkspace();
            await reopened.OpenVaultAsync(directory);
            await reopened.RestoreSessionAsync(state);
            Assert.Equal("source", reopened.ActiveTab!.ViewMode);
            Assert.Equal("{ broken source", reopened.Text);
        }
        finally { window.Workspace.DiscardEdits(); window.Close(); Directory.Delete(directory, true); }
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; !condition() && attempt < 500; attempt++) { await Task.Delay(10); }
        Assert.True(condition());
    }
}
