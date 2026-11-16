using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class FileOperationTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-files-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();

    public FileOperationTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task RenameAndReferenceEditsCommitTogetherOnLinux()
    {
        await workspace.OpenVaultAsync(directory);
        var source = await workspace.CreateTabAsync("Original.md", "# Original\r\n");
        var link = await workspace.CreateTabAsync("Link.md", "[[Original]]\n");
        var result = await workspace.Vault.RenameFileAsync(new(directory, source.Path, "Folder/Renamed.md", source.Document.Version,
            [new(link.Path, link.Document.Version, "[[Folder/Renamed]]\n")]));
        Assert.False(File.Exists(Path.Combine(directory, "Original.md")));
        Assert.Equal("# Original\r\n", await File.ReadAllTextAsync(Path.Combine(directory, "Folder/Renamed.md")));
        Assert.Equal("[[Folder/Renamed]]\n", await File.ReadAllTextAsync(Path.Combine(directory, "Link.md")));
        Assert.Equal("Folder/Renamed.md", result.NewPath);
    }

    [Fact]
    public async Task ReferenceConflictRefusesRenameWithoutLosingEitherFile()
    {
        await workspace.OpenVaultAsync(directory);
        var source = await workspace.CreateTabAsync("Original.md", "Original");
        var link = await workspace.CreateTabAsync("Link.md", "[[Original]]");
        await File.WriteAllTextAsync(Path.Combine(directory, "Link.md"), "External edit");
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.RenameFileAsync(new(directory, source.Path, "Renamed.md", source.Document.Version,
            [new(link.Path, link.Document.Version, "[[Renamed]]")])));
        Assert.Equal(409, error.StatusCode);
        Assert.Equal("Original", await File.ReadAllTextAsync(Path.Combine(directory, "Original.md")));
        Assert.Equal("External edit", await File.ReadAllTextAsync(Path.Combine(directory, "Link.md")));
        Assert.False(File.Exists(Path.Combine(directory, "Renamed.md")));
    }

    [Fact]
    public async Task RenameDoesNotOverwriteCaseDistinctDestination()
    {
        await workspace.OpenVaultAsync(directory);
        var upper = await workspace.CreateTabAsync("Note.md", "Upper");
        await workspace.CreateTabAsync("note.md", "Lower");
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.RenameFileAsync(new(directory, upper.Path, "note.md", upper.Document.Version)));
        Assert.Equal(409, error.StatusCode);
        Assert.Equal("Upper", await File.ReadAllTextAsync(Path.Combine(directory, "Note.md")));
        Assert.Equal("Lower", await File.ReadAllTextAsync(Path.Combine(directory, "note.md")));
    }

    [Fact]
    public async Task VaultTrashRetainsExactBytesAndResolvesNameCollisions()
    {
        await workspace.OpenVaultAsync(directory);
        var first = await workspace.CreateTabAsync("One/Note.md", "One\r\n");
        var second = await workspace.CreateTabAsync("Two/Note.md", "Two\n");
        var one = await workspace.Vault.TrashFileAsync(new(directory, first.Path, first.Document.Version));
        var two = await workspace.Vault.TrashFileAsync(new(directory, second.Path, second.Document.Version));
        Assert.NotEqual(one.TrashPath, two.TrashPath);
        Assert.Equal("One\r\n", await File.ReadAllTextAsync(Path.Combine(directory, one.TrashPath)));
        Assert.Equal("Two\n", await File.ReadAllTextAsync(Path.Combine(directory, two.TrashPath)));
        Assert.Empty(two.Snapshot.Files);
    }

    [Fact]
    public async Task ConfigurationRejectsWrongCaseVaultRootOnLinux()
    {
        await workspace.OpenVaultAsync(directory);
        var error = await Assert.ThrowsAsync<VaultException>(() => workspace.Vault.ReadConfigurationAsync("app", directory.ToUpperInvariant()));
        Assert.Equal(409, error.StatusCode);
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
