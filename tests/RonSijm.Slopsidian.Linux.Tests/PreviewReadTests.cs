using System.Security.Cryptography;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class PreviewReadTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-preview-read-" + Guid.NewGuid().ToString("N"));
    private readonly string root;
    private readonly NativeWorkspace workspace = new();

    public PreviewReadTests() { root = Path.Combine(directory, "vault"); Directory.CreateDirectory(root); }

    [Fact]
    public async Task PreviewRetainsExactBinaryBytesAndVersionAtTheRequestedLimit()
    {
        var bytes = Enumerable.Range(0, 256).Select(value => (byte)value).ToArray();
        await File.WriteAllBytesAsync(Path.Combine(root, "Picture.png"), bytes, TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(root);
        var preview = await workspace.Vault.ReadPreviewAsync("Picture.png", root, bytes.Length, TestContext.Current.CancellationToken);
        Assert.Equal(bytes, preview.Bytes);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(bytes)), preview.Version);
        Assert.Equal("Picture.png", preview.File.Path);
        Assert.Equal(bytes.Length, preview.File.Stat.Size);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Path.Combine(root, "Picture.png"), TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task OversizedPreviewIsRefusedAndDoesNotPreventTheNextRead()
    {
        await File.WriteAllBytesAsync(Path.Combine(root, "Picture.png"), new byte[33], TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(root);
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync("Picture.png", root, 32, TestContext.Current.CancellationToken));
        Assert.Equal(413, error.StatusCode);
        var allowed = await workspace.Vault.ReadPreviewAsync("Picture.png", root, 33, TestContext.Current.CancellationToken);
        Assert.Equal(33, allowed.Bytes.Length);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(16 * 1024 * 1024 + 1)]
    public async Task PreviewAllowanceMustBePositiveAndWithinTheSharedBinaryLimit(int limit)
    {
        await workspace.OpenVaultAsync(root);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => workspace.Vault.ReadPreviewAsync("Picture.png", root, limit, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task PreviewRefusesWrongVaultTraversalAndHiddenPaths()
    {
        await File.WriteAllBytesAsync(Path.Combine(root, ".private"), [1, 2], TestContext.Current.CancellationToken);
        await File.WriteAllBytesAsync(Path.Combine(directory, "outside.bin"), [3, 4], TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(root);
        var wrongRoot = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync("Picture.png", directory, 32, TestContext.Current.CancellationToken));
        Assert.Equal(409, wrongRoot.StatusCode);
        await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync("../outside.bin", root, 32, TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync(".private", root, 32, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task PreviewRefusesALinkOutsideTheVault()
    {
        if (!OperatingSystem.IsLinux()) { return; }
        await File.WriteAllBytesAsync(Path.Combine(directory, "outside.bin"), [3, 4], TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(root);
        File.CreateSymbolicLink(Path.Combine(root, "Linked.png"), Path.Combine(directory, "outside.bin"));
        await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync("Linked.png", root, 32, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task PreviewCancellationLeavesTheFileAndGateAvailable()
    {
        await File.WriteAllBytesAsync(Path.Combine(root, "Picture.png"), [1, 2, 3], TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(root);
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => workspace.Vault.ReadPreviewAsync("Picture.png", root, 32, cancellation.Token));
        var preview = await workspace.Vault.ReadPreviewAsync("Picture.png", root, 32, TestContext.Current.CancellationToken);
        Assert.Equal(new byte[] { 1, 2, 3 }, preview.Bytes);
    }

    [Fact]
    public async Task MissingPreviewReportsNotFound()
    {
        await workspace.OpenVaultAsync(root);
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadPreviewAsync("Missing.png", root, 32, TestContext.Current.CancellationToken));
        Assert.Equal(404, error.StatusCode);
    }

    public void Dispose() { workspace.Dispose(); Directory.Delete(directory, true); }
}
