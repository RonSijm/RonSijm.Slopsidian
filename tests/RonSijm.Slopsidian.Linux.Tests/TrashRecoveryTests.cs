using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class TrashRecoveryTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-trash-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();
    public TrashRecoveryTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task ReviewedTrashNoteRestoresExactContentOnLinux()
    {
        await workspace.OpenVaultAsync(directory);
        var note = await workspace.CreateTabAsync("Deleted.md", "# Café\r\nRecover me\r\n");
        await workspace.Vault.TrashFileAsync(new(directory, note.Path, note.Document.Version), cancellationToken: TestContext.Current.CancellationToken);
        var entry = Assert.Single((await workspace.Vault.ListTrashAsync(directory, cancellationToken: TestContext.Current.CancellationToken)).Entries);
        var preview = await workspace.Vault.PreviewTrashAsync(directory, entry.Path, entry.Token, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(note.Text, preview.Content);
        var review = await workspace.Vault.ReviewTrashRestoreAsync(new(directory, "/", [new(entry.Path, entry.Token)]), cancellationToken: TestContext.Current.CancellationToken);
        var result = await workspace.Vault.RestoreTrashAsync(new(directory, review.Token, entry.Path), cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(note.Text, result.Document.Content);
        Assert.Equal(note.Text, await File.ReadAllTextAsync(Path.Combine(directory, "Deleted.md"), cancellationToken: TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.RestoreTrashAsync(new(directory, review.Token, entry.Path), cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ReplacedTrashFileCannotConsumeReviewedRestoreEvenWithIdenticalBytes()
    {
        await workspace.OpenVaultAsync(directory);
        var note = await workspace.CreateTabAsync("Deleted.md", "Keep me");
        await workspace.Vault.TrashFileAsync(new(directory, note.Path, note.Document.Version), cancellationToken: TestContext.Current.CancellationToken);
        var entry = Assert.Single((await workspace.Vault.ListTrashAsync(directory, cancellationToken: TestContext.Current.CancellationToken)).Entries);
        var review = await workspace.Vault.ReviewTrashRestoreAsync(new(directory, "/", [new(entry.Path, entry.Token)]), cancellationToken: TestContext.Current.CancellationToken);
        var path = Path.Combine(directory, entry.Path);
        // Keep the original inode alive while replacing the path with identical bytes.
        File.Move(path, path + ".original");
        await File.WriteAllTextAsync(path, note.Text, cancellationToken: TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.RestoreTrashAsync(new(directory, review.Token, entry.Path), cancellationToken: TestContext.Current.CancellationToken));
        Assert.Equal(409, error.StatusCode);
        Assert.False(File.Exists(Path.Combine(directory, "Deleted.md")));
        Assert.Equal(note.Text, await File.ReadAllTextAsync(path, cancellationToken: TestContext.Current.CancellationToken));
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
