using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class RenameTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-rename-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();
    public RenameTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task RenameUpdatesWikiMarkdownAndFrontmatterReferencesButPreservesCodeAndDraftSafety()
    {
        await workspace.OpenVaultAsync(directory);
        var source = await workspace.CreateTabAsync("Original.md", "# Original\r\n");
        var link = await workspace.CreateTabAsync("Links.md", "---\nalias: '[[Original]]'\n---\n[[Original#Heading|label]]\n[text](Original.md#Heading)\n`[[Original]]`\n\\[[Original]]\n");
        await workspace.RenameAsync(source, "Folder/Renamed.md", true);
        Assert.Equal("Folder/Renamed.md", source.Path);
        Assert.False(source.IsDirty);
        Assert.Contains("'[[/Folder/Renamed]]'", link.Text);
        Assert.Contains("[[/Folder/Renamed#Heading|label]]", link.Text);
        Assert.Contains("[text](Folder/Renamed.md#Heading)", link.Text);
        Assert.Contains("`[[Original]]`", link.Text);
        Assert.Contains("\\[[Original]]", link.Text);
        Assert.Equal(link.Text, await File.ReadAllTextAsync(Path.Combine(directory, "Links.md"), cancellationToken: TestContext.Current.CancellationToken));
        link.Text = "Keep draft";
        await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.RenameAsync(source, "Again.md", true));
        Assert.Equal("Keep draft", link.Text);
        Assert.True(File.Exists(Path.Combine(directory, source.Path)));
    }

    [Fact]
    public async Task MoveRetainsRelativeMarkdownTargetsAndLiteralPercentNames()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("100%20.md", "Percent filename");
        await workspace.CreateTabAsync("Folder/Target.md", "Target");
        var source = await workspace.CreateTabAsync("Folder/Source.md", "[Link](Target.md)\n[[100%20]]");
        await workspace.RenameAsync(source, "Other/Source.md", true);
        Assert.Contains("[Link](../Folder/Target.md)", source.Text);
        Assert.Contains("[[/100%20]]", source.Text);
    }

    [Fact]
    public async Task VaultRootLinksDoNotResolveToSameNamedNotesInTheCurrentFolder()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("Target.md", "Root");
        await workspace.CreateTabAsync("Folder/Target.md", "Nested");
        Assert.Equal("Target.md", workspace.ResolveLinkTarget("Folder/Source.md", "/Target"));
        Assert.Equal("Folder/Target.md", workspace.ResolveLinkTarget("Folder/Source.md", "Target"));
        Assert.Equal("Target.md", workspace.ResolveNoteLink("/Target"));
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
