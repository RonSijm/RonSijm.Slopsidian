using System.Text;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class DraftRecoveryTests
{
    [Fact]
    public async Task DeletedDraftCanBeSavedAsANewFileAfterRestartWithExactEncoding()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-draft-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var session = await DeletedDraftAsync(directory);
            using var restarted = new NativeWorkspace();
            await restarted.OpenVaultAsync(directory);
            await restarted.RestoreSessionAsync(session);
            var draft = Assert.Single(restarted.OrphanedDrafts);
            Assert.True(draft.HasBom);
            await File.WriteAllTextAsync(Path.Combine(directory, "Missing.md"), "External file", cancellationToken: TestContext.Current.CancellationToken);
            var error = await Assert.ThrowsAsync<VaultException>(() => restarted.RecoverDraftAsync(draft, "Missing.md"));
            Assert.Equal(409, error.StatusCode);
            Assert.Single(restarted.OrphanedDrafts);
            Assert.Equal("External file", await File.ReadAllTextAsync(Path.Combine(directory, "Missing.md"), cancellationToken: TestContext.Current.CancellationToken));
            var recovered = await restarted.RecoverDraftAsync(draft, "Recovered draft.md");
            Assert.Empty(restarted.OrphanedDrafts);
            var expected = new byte[] { 0xef, 0xbb, 0xbf }.Concat(Encoding.UTF8.GetBytes("Café draft\r\nKeep every line\r\n")).ToArray();
            Assert.Equal(expected, await File.ReadAllBytesAsync(Path.Combine(directory, recovered.Path), cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal(draft.Draft, recovered.Text);
            Assert.Equal(4, recovered.Caret);
            Assert.False(recovered.IsDirty);
            Assert.Same(recovered, restarted.ActiveTab);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void ProfilesFromBeforeTheEncodingFlagRemainReadable()
    {
        var state = JsonSerializer.Deserialize<NativeTabState>("{\"Path\":\"Note.md\",\"Caret\":0,\"ScrollOffset\":0,\"Reading\":false,\"Pinned\":false,\"Draft\":\"Old draft\",\"Version\":\"old\"}");
        Assert.NotNull(state);
        Assert.False(state.HasBom);
        Assert.Equal("Old draft", state.Draft);
    }

    [AvaloniaFact]
    public async Task NativeDraftRecoveryPreviewsAndSavesWithoutOverwritingExistingNotes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-draft-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        NativeDraftRecoveryWindow? window = null;
        try
        {
            var session = await DeletedDraftAsync(directory);
            await workspace.OpenVaultAsync(directory);
            await workspace.RestoreSessionAsync(session);
            var persisted = 0;
            window = new NativeDraftRecoveryWindow(workspace, () => { persisted++; return Task.CompletedTask; });
            window.Show();
            window.UpdateLayout();
            Assert.Equal("Café draft\r\nKeep every line\r\n", Control<TextBox>(window, "DraftRecoveryPreview").Text);
            Control<TextBox>(window, "DraftRecoveryDestination").Text = "Recovered.md";
            Control<Button>(window, "DraftRecoverySave").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            await WaitForAsync(() => Control<TextBlock>(window, "DraftRecoveryStatus").Text == "Saved Recovered.md.");
            Assert.Equal(1, persisted);
            Assert.Empty(workspace.OrphanedDrafts);
            Assert.Equal("Café draft\r\nKeep every line\r\n", await File.ReadAllTextAsync(Path.Combine(directory, "Recovered.md")));
        }
        finally { window?.Close(); Directory.Delete(directory, true); }
    }

    private static async Task<NativeSession> DeletedDraftAsync(string directory)
    {
        using var workspace = new NativeWorkspace();
        await workspace.OpenVaultAsync(directory);
        var bytes = new byte[] { 0xef, 0xbb, 0xbf }.Concat(Encoding.UTF8.GetBytes("Saved\r\n")).ToArray();
        await workspace.Vault.CreateBinaryAsync(new("Missing.md", Convert.ToBase64String(bytes), directory), CancellationToken.None);
        var tab = await workspace.OpenTabAsync("Missing.md");
        tab.Text = "Café draft\r\nKeep every line\r\n";
        tab.Caret = 4;
        var session = workspace.CaptureSession();
        File.Delete(Path.Combine(directory, "Missing.md"));
        return session;
    }

    private static T Control<T>(Window window, string name) where T : Avalonia.Controls.Control => window.GetVisualDescendants().OfType<T>().Single(control => control.Name == name);
    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var attempt = 0; !condition() && attempt < 500; attempt++) { await Task.Delay(10); }
        Assert.True(condition());
    }
}
