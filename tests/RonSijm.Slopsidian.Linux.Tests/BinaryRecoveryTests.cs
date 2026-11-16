using System.Text;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class BinaryRecoveryTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-binary-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();
    public BinaryRecoveryTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task RecoveryCanRestoreExactBomAndLineEndingsThroughExistingBinaryApi()
    {
        await workspace.OpenVaultAsync(directory);
        var original = Encoding.UTF8.Preamble.ToArray().Concat(Encoding.UTF8.GetBytes("# Café\r\nRecovered\r\n")).ToArray();
        var created = await workspace.Vault.CreateBinaryAsync(new("Note.md", Convert.ToBase64String(original), directory), CancellationToken.None);
        var document = await workspace.Vault.ReadAsync("Note.md", expectedRoot: directory, cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(document.HasBom);
        Assert.Equal("# Café\r\nRecovered\r\n", document.Content);
        Assert.Equal(original, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md"), cancellationToken: TestContext.Current.CancellationToken));
        var replacement = Encoding.UTF8.GetBytes("No BOM\n");
        await workspace.Vault.ModifyBinaryAsync(new("Note.md", Convert.ToBase64String(replacement), directory, created.Version), CancellationToken.None);
        Assert.False((await workspace.Vault.ReadAsync("Note.md", expectedRoot: directory, cancellationToken: TestContext.Current.CancellationToken)).HasBom);
        Assert.Equal(replacement, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md"), cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task BinaryRecoveryRefusesAnExternalEditAndKeepsItsExactBytes()
    {
        await workspace.OpenVaultAsync(directory);
        var created = await workspace.Vault.CreateBinaryAsync(new("Note.md", Convert.ToBase64String(Encoding.UTF8.GetBytes("Original")), directory), CancellationToken.None);
        var external = new byte[] { 0xef, 0xbb, 0xbf, 65, 13, 10 };
        await File.WriteAllBytesAsync(Path.Combine(directory, "Note.md"), external, cancellationToken: TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ModifyBinaryAsync(new("Note.md", Convert.ToBase64String(Encoding.UTF8.GetBytes("Old recovery")), directory, created.Version), CancellationToken.None));
        Assert.Equal(409, error.StatusCode);
        Assert.Equal(external, await File.ReadAllBytesAsync(Path.Combine(directory, "Note.md"), cancellationToken: TestContext.Current.CancellationToken));
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
