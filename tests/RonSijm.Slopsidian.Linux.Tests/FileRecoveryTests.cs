using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class FileRecoveryTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-history-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();
    public FileRecoveryTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task SnapshotsContainSavedBytesAndRestoreWithDurableBackupAcrossRestart()
    {
        await workspace.OpenVaultAsync(directory);
        var original = new byte[] { 0xef, 0xbb, 0xbf }.Concat(Encoding.UTF8.GetBytes("Café\r\nSaved\r\n")).ToArray();
        await workspace.Vault.CreateBinaryAsync(new("Note.md", Convert.ToBase64String(original), directory), CancellationToken.None);
        var tab = await workspace.OpenTabAsync("Note.md");
        tab.Text = "Unsaved draft";
        Assert.Equal(NativeCaptureResult.Added, await workspace.Recovery.CaptureAsync(tab.Path, force: true));
        var old = Assert.Single((await workspace.Recovery.ListAsync()).Snapshots);
        Assert.Equal("Café\r\nSaved\r\n", old.Content);
        Assert.True(old.HasBom);
        tab.Reload(tab.Document);
        tab.Text = "Replacement\n";
        await workspace.SaveAsync();
        using var reopened = new NativeWorkspace();
        await reopened.OpenVaultAsync(directory);
        var plan = await reopened.Recovery.ReviewAsync(old.Id);
        await reopened.Recovery.RestoreAsync(plan);
        Assert.Equal(original, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md")));
        var history = await reopened.Recovery.ListAsync();
        Assert.Contains(history.Snapshots, snapshot => snapshot.Content == "Replacement\n" && snapshot.Reason == "before-restore");
    }

    [Fact]
    public async Task RestoreRefusesExternalChangesAfterReviewAndRetainsTheirBytes()
    {
        var snapshot = await CreateSnapshotAsync();
        var plan = await workspace.Recovery.ReviewAsync(snapshot.Id);
        var external = Encoding.UTF8.GetBytes("External\r\n");
        await File.WriteAllBytesAsync(Path.Combine(directory, "Note.md"), external);
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal(external, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md")));
    }

    [Fact]
    public async Task MissingFileIsRecreatedButANewFileInvalidatesTheReview()
    {
        var snapshot = await CreateSnapshotAsync();
        File.Delete(Path.Combine(directory, "Note.md"));
        var plan = await workspace.Recovery.ReviewAsync(snapshot.Id);
        Assert.Null(plan.Before);
        await File.WriteAllTextAsync(Path.Combine(directory, "Note.md"), "Appeared later");
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal("Appeared later", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
        File.Delete(Path.Combine(directory, "Note.md"));
        await workspace.Recovery.RestoreAsync(await workspace.Recovery.ReviewAsync(snapshot.Id));
        Assert.Equal(snapshot.Content, await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
    }

    [Fact]
    public async Task ChangingTheSelectedSnapshotInvalidatesRestoreIncludingUnknownFields()
    {
        var snapshot = await CreateSnapshotAsync();
        var plan = await workspace.Recovery.ReviewAsync(snapshot.Id);
        var configuration = await workspace.Vault.ReadConfigurationAsync(NativeRecoveryHistory.ConfigurationId, directory);
        var changed = JsonNode.Parse(configuration.Data.GetRawText())!.AsObject();
        changed["snapshots"]!.AsArray()[0]!["unknown"] = "Changed after review";
        await workspace.Vault.WriteConfigurationAsync(NativeRecoveryHistory.ConfigurationId, new(directory, configuration.Version, JsonSerializer.SerializeToElement(changed)));
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal("Original", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
    }

    [Fact]
    public async Task DirtyTabsAndOldVaultSessionsInvalidateRestore()
    {
        var snapshot = await CreateSnapshotAsync();
        var plan = await workspace.Recovery.ReviewAsync(snapshot.Id);
        workspace.Text = "Keep this draft";
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal("Keep this draft", workspace.Text);
        workspace.DiscardEdits();
        await workspace.OpenVaultAsync(directory);
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal("Original", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
    }

    [Fact]
    public async Task DisabledRecoveryDoesNotWriteOrOfferManualOperations()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("Note.md", "Original");
        await workspace.Vault.SetCoreEnabledAsync("file-recovery", new(directory, false));
        Assert.Null(await workspace.Recovery.CaptureAsync("Note.md"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.CaptureAsync("Note.md", force: true));
        Assert.False(File.Exists(Path.Combine(directory, ".obsidian", NativeRecoveryHistory.ConfigurationId + ".json")));
        await workspace.Vault.SetCoreEnabledAsync("file-recovery", new(directory, true));
        Assert.Equal(NativeCaptureResult.Added, await workspace.Recovery.CaptureAsync("Note.md"));
    }

    [Fact]
    public async Task ClearRefusesHistoryThatChangedSinceConfirmation()
    {
        await CreateSnapshotAsync();
        var review = await workspace.Recovery.ListAsync();
        workspace.Text = "Second saved version";
        await workspace.SaveAsync();
        await workspace.Recovery.CaptureAsync("Note.md", force: true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.Recovery.ClearAsync(review));
        Assert.Equal(2, (await workspace.Recovery.ListAsync()).Snapshots.Count);
        await workspace.Recovery.ClearAsync(await workspace.Recovery.ListAsync());
        Assert.Empty((await workspace.Recovery.ListAsync()).Snapshots);
    }

    [Fact]
    public async Task AnInvalidUtf8FileIsNeverReviewedForReplacement()
    {
        var snapshot = await CreateSnapshotAsync();
        byte[] invalidUtf8 = [0xff, 0xfe, 0x61];
        await File.WriteAllBytesAsync(Path.Combine(directory, "Note.md"), invalidUtf8);
        await Assert.ThrowsAsync<DecoderFallbackException>(() => workspace.Recovery.ReviewAsync(snapshot.Id));
        Assert.Equal(invalidUtf8, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md")));
    }

    [Fact]
    public async Task FailureToPersistTheBackupLeavesTheFileUntouched()
    {
        var snapshot = await CreateSnapshotAsync();
        workspace.Text = "Replacement";
        await workspace.SaveAsync();
        var plan = await workspace.Recovery.ReviewAsync(snapshot.Id);
        var historyPath = Path.Combine(directory, ".obsidian", NativeRecoveryHistory.ConfigurationId + ".json");
        File.Delete(historyPath);
        Directory.CreateDirectory(historyPath);
        await Assert.ThrowsAsync<VaultException>(() => workspace.Recovery.RestoreAsync(plan));
        Assert.Equal("Replacement", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
    }

    private async Task<NativeRecoverySnapshot> CreateSnapshotAsync()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("Note.md", "Original");
        await workspace.Recovery.CaptureAsync("Note.md", force: true);
        return Assert.Single((await workspace.Recovery.ListAsync()).Snapshots);
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
