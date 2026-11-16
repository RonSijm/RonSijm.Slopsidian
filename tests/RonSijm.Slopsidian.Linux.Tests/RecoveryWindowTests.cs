using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class RecoveryWindowTests
{
    [AvaloniaFact]
    public async Task NativeHistoryPreviewAndReviewedRestoreUpdateTheSavedFileAndOpenTab()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-recovery-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeRecoveryWindow? window = null;
        try
        {
            await workspace.OpenVaultAsync(directory);
            var tab = await workspace.CreateTabAsync("Note.md", "Original\r\n");
            await workspace.Recovery.CaptureAsync(tab.Path, force: true);
            var original = Assert.Single((await workspace.Recovery.ListAsync()).Snapshots);
            tab.Text = "Second version\n";
            await workspace.SaveAsync();
            await workspace.Recovery.CaptureAsync(tab.Path, force: true);
            window = new NativeRecoveryWindow(workspace);
            window.Show();
            window.UpdateLayout();
            await WaitForAsync(() => Control<ListBox>(window, "RecoveryVersions").ItemCount == 2);
            var versions = Control<ListBox>(window, "RecoveryVersions");
            versions.SelectedItem = versions.Items.Cast<NativeRecoverySnapshot>().Single(snapshot => snapshot.Id == original.Id);
            Assert.Equal("Original\r\n", Control<TextBox>(window, "RecoveryPreview").Text);
            Click(window, "RecoveryPrepare");
            await WaitForAsync(() => window.GetVisualDescendants().OfType<Button>().Any(button => button.Name == "RecoveryConfirm"));
            Assert.Equal("Second version\n", Control<TextBox>(window, "RecoveryBefore").Text);
            Click(window, "RecoveryConfirm");
            await WaitForAsync(() => Control<TextBlock>(window, "RecoveryStatus").Text == "Restored Note.md.");
            Assert.Equal("Original\r\n", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
            Assert.Equal("Original\r\n", tab.Text);
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task NativeHistoryShowsAConflictInsteadOfOverwritingAnExternalChange()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-recovery-conflict-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeRecoveryWindow? window = null;
        try
        {
            await workspace.OpenVaultAsync(directory);
            await workspace.CreateTabAsync("Note.md", "Original");
            await workspace.Recovery.CaptureAsync("Note.md", force: true);
            window = new NativeRecoveryWindow(workspace);
            window.Show();
            window.UpdateLayout();
            await WaitForAsync(() => Control<ListBox>(window, "RecoveryVersions").ItemCount == 1);
            Click(window, "RecoveryPrepare");
            await WaitForAsync(() => window.GetVisualDescendants().OfType<Button>().Any(button => button.Name == "RecoveryConfirm"));
            await File.WriteAllTextAsync(Path.Combine(directory, "Note.md"), "External version");
            Click(window, "RecoveryConfirm");
            await WaitForAsync(() => Control<TextBlock>(window, "RecoveryStatus").Classes.Contains("error"));
            Assert.Contains("changed after review", Control<TextBlock>(window, "RecoveryStatus").Text);
            Assert.Equal("External version", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    private static T Control<T>(Window window, string name) where T : Avalonia.Controls.Control => window.GetVisualDescendants().OfType<T>().Single(control => control.Name == name);
    private static void Click(Window window, string name) => Control<Button>(window, name).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; !condition() && attempt < 500; attempt++) { await Task.Delay(10); }
        Assert.True(condition());
    }
}
