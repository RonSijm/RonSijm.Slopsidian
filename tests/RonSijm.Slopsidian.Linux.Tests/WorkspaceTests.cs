using System.Text;
using RonSijm.Slopsidian.Linux;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class WorkspaceTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-native-test-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();

    public WorkspaceTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task EditSaveAndReopenPreserveUtf8BomAndCrLf()
    {
        var original = new UTF8Encoding(true).GetPreamble().Concat(Encoding.UTF8.GetBytes("# Café\r\nText\r\n")).ToArray();
        await File.WriteAllBytesAsync(Path.Combine(directory, "note.md"), original, cancellationToken: TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(directory);
        await workspace.OpenNoteAsync("note.md");
        Assert.False(workspace.IsDirty);
        workspace.Text += "More\r\n";
        await workspace.SaveAsync();
        Assert.False(workspace.IsDirty);
        Assert.Equal(original.Concat(Encoding.UTF8.GetBytes("More\r\n")), await File.ReadAllBytesAsync(Path.Combine(directory, "note.md"), cancellationToken: TestContext.Current.CancellationToken));
        await workspace.OpenNoteAsync("note.md");
        Assert.EndsWith("More\r\n", workspace.Text);
    }

    [Fact]
    public async Task ExternalEditRefusesSaveAndRetainsBothVersions()
    {
        await File.WriteAllTextAsync(Path.Combine(directory, "note.md"), "Original", cancellationToken: TestContext.Current.CancellationToken);
        await workspace.OpenVaultAsync(directory);
        await workspace.OpenNoteAsync("note.md");
        workspace.Text = "My draft";
        await File.WriteAllTextAsync(Path.Combine(directory, "note.md"), "External change", cancellationToken: TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<VaultException>(workspace.SaveAsync);
        Assert.Equal(409, error.StatusCode);
        Assert.True(workspace.IsDirty);
        Assert.Equal("My draft", workspace.Text);
        Assert.Equal("External change", await File.ReadAllTextAsync(Path.Combine(directory, "note.md"), cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task DirtySessionRefusesNavigationAndVaultSwitch()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("note");
        workspace.Text = "Do not lose this";
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.OpenNoteAsync("other.md"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.OpenVaultAsync(directory));
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.CreateNoteAsync("other"));
        Assert.Equal("Do not lose this", workspace.Text);
        Assert.False(File.Exists(Path.Combine(directory, "other.md")));
    }

    [Theory]
    [InlineData("../escape")]
    [InlineData("/tmp/escape")]
    [InlineData(".obsidian/config")]
    public async Task CreateRejectsPathsOutsideVisibleVault(string path)
    {
        await workspace.OpenVaultAsync(directory);
        await Assert.ThrowsAsync<VaultException>(() => workspace.CreateNoteAsync(path));
        Assert.Empty(Directory.EnumerateFileSystemEntries(directory));
    }

    [Fact]
    public async Task CreateSubfolderAndSearchContentWithoutChangingEditor()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("projects/Plan");
        workspace.Text = "A searchable sentence.";
        await workspace.SaveAsync();
        await workspace.CreateNoteAsync("Inbox");
        workspace.Text = "An unsaved keyword.";
        var result = Assert.Single(await workspace.SearchAsync("searchable", cancellationToken: TestContext.Current.CancellationToken));
        Assert.Equal("projects/Plan.md", result.Path);
        Assert.Equal("Inbox.md", Assert.Single(await workspace.SearchAsync("keyword", cancellationToken: TestContext.Current.CancellationToken)).Path);
        Assert.Equal("Inbox.md", workspace.Document!.File.Path);
        Assert.True(workspace.IsDirty);
    }

    [Fact]
    public async Task CreatingExistingNoteNeverOverwritesIt()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("note");
        workspace.Text = "Keep me";
        await workspace.SaveAsync();
        await Assert.ThrowsAsync<VaultException>(() => workspace.CreateNoteAsync("note.md"));
        Assert.Equal("Keep me", await File.ReadAllTextAsync(Path.Combine(directory, "note.md"), cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task LinksResolveRelativeVaultAndUniqueBasenameTargets()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("other/Reference");
        await workspace.CreateNoteAsync("projects/Plan");
        await workspace.CreateNoteAsync("projects/Inbox");
        Assert.Equal("projects/Plan.md", workspace.ResolveNoteLink("Plan.md#heading"));
        Assert.Equal("other/Reference.md", workspace.ResolveNoteLink("other/Reference"));
        Assert.Equal("other/Reference.md", workspace.ResolveNoteLink("Reference"));
        Assert.Equal("projects/Inbox.md", workspace.ResolveNoteLink("#heading"));
        Assert.Throws<InvalidOperationException>(() => workspace.ResolveNoteLink("Missing"));
    }

    [Fact]
    public async Task LinuxCaseDistinctNotesRemainDistinct()
    {
        if (!OperatingSystem.IsLinux()) return;
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("Note");
        workspace.Text = "Upper";
        await workspace.SaveAsync();
        await workspace.CreateNoteAsync("note");
        workspace.Text = "Lower";
        await workspace.SaveAsync();
        Assert.Equal(2, workspace.Notes.Count());
        await workspace.OpenNoteAsync("Note.md");
        Assert.Equal("Upper", workspace.Text);
    }

    [Fact]
    public async Task SymbolicLinkVaultEntriesAreRefused()
    {
        if (!OperatingSystem.IsLinux()) return;
        File.CreateSymbolicLink(Path.Combine(directory, "linked.md"), "/etc/hosts");
        await Assert.ThrowsAsync<VaultException>(() => workspace.OpenVaultAsync(directory));
    }

    [Fact]
    public async Task MarkdownPathDecodingPreservesEncodedHashAndLiteralPercentInFilenames()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateNoteAsync("Symbols/File#100%20.md");
        await workspace.CreateNoteAsync("Index.md");
        Assert.Equal("Symbols/File#100%20.md", workspace.ResolveNoteLink("Symbols/File%23100%2520.md", markdown: true));
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
