using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class TrashWindowTests
{
    [AvaloniaFact]
    public async Task NativeTrashPreviewAndReviewedRestoreRecoverTheSavedNote()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-trash-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeTrashWindow? window = null;
        try
        {
            await workspace.OpenVaultAsync(directory);
            var tab = await workspace.CreateTabAsync("Deleted.md", "Café\r\nSaved text\r\n");
            await workspace.TrashAsync(tab);
            window = new NativeTrashWindow(workspace);
            window.Show();
            window.UpdateLayout();
            await WaitForAsync(() => Control<TextBox>(window, "TrashPreview").Text == "Café\r\nSaved text\r\n");
            Click(window, "TrashPrepare");
            await WaitForAsync(() => HasButton(window, "TrashConfirm"));
            Click(window, "TrashConfirm");
            await WaitForAsync(() => Control<TextBlock>(window, "TrashStatus").Text == "Restored 1 note.");
            Assert.Equal("Café\r\nSaved text\r\n", await File.ReadAllTextAsync(Path.Combine(directory, "Deleted.md")));
            Assert.Empty((await workspace.Vault.ListTrashAsync(directory)).Entries);
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task NativeTrashRefusesAFileThatAppearsAtTheReviewedDestination()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-trash-conflict-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeTrashWindow? window = null;
        try
        {
            await workspace.OpenVaultAsync(directory);
            var tab = await workspace.CreateTabAsync("Deleted.md", "Trash original");
            await workspace.TrashAsync(tab);
            window = new NativeTrashWindow(workspace);
            window.Show();
            window.UpdateLayout();
            await WaitForAsync(() => Control<TextBox>(window, "TrashPreview").Text == "Trash original");
            Click(window, "TrashPrepare");
            await WaitForAsync(() => HasButton(window, "TrashConfirm"));
            await File.WriteAllTextAsync(Path.Combine(directory, "Deleted.md"), "Appeared after review");
            Click(window, "TrashConfirm");
            await WaitForAsync(() => Control<TextBlock>(window, "TrashStatus").Classes.Contains("error"));
            Assert.Equal("Appeared after review", await File.ReadAllTextAsync(Path.Combine(directory, "Deleted.md")));
            Assert.Equal("Trash original", await File.ReadAllTextAsync(Path.Combine(directory, ".trash", "Deleted.md")));
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    [AvaloniaFact]
    public async Task NativeTrashReportsPartialSuccessWhenALaterReviewedSourceIsReplaced()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-trash-partial-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeTrashWindow? window = null;
        try
        {
            await workspace.OpenVaultAsync(directory);
            await workspace.TrashAsync(await workspace.CreateTabAsync("A.md", "First original"));
            await workspace.TrashAsync(await workspace.CreateTabAsync("B.md", "Second original"));
            window = new NativeTrashWindow(workspace);
            window.Show();
            window.UpdateLayout();
            await WaitForAsync(() => Control<TextBox>(window, "TrashPreview").Text == "First original");
            var entries = Control<ListBox>(window, "TrashEntries");
            entries.SelectedItems!.Add(entries.Items.Cast<RonSijm.Slopsidian.Services.VaultTrashEntry>().Single(entry => entry.Name == "B.md"));
            await WaitForAsync(() => entries.IsEnabled && entries.SelectedItems.Count == 2);
            Click(window, "TrashPrepare");
            await WaitForAsync(() => HasButton(window, "TrashConfirm"));
            var second = Path.Combine(directory, ".trash", "B.md");
            File.Move(second, second + ".original");
            await File.WriteAllTextAsync(second, "Second original");
            Click(window, "TrashConfirm");
            await WaitForAsync(() => Control<TextBlock>(window, "TrashStatus").Classes.Contains("error"));
            Assert.Contains("Restored 1 note.", Control<TextBlock>(window, "TrashStatus").Text);
            Assert.Equal("First original", await File.ReadAllTextAsync(Path.Combine(directory, "A.md")));
            Assert.False(File.Exists(Path.Combine(directory, "B.md")));
            Assert.Equal("Second original", await File.ReadAllTextAsync(second));
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    private static bool HasButton(Window window, string name) => window.GetVisualDescendants().OfType<Button>().Any(button => button.Name == name);
    private static T Control<T>(Window window, string name) where T : Avalonia.Controls.Control => window.GetVisualDescendants().OfType<T>().Single(control => control.Name == name);
    private static void Click(Window window, string name) => Control<Button>(window, name).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; !condition() && attempt < 500; attempt++) { await Task.Delay(10); }
        Assert.True(condition());
    }
}
