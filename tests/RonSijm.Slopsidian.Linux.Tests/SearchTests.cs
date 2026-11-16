using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class SearchTests
{
    private const string Text = "---\nstatus: Open\npriority: 3\nactive: true\nquoted: 'true'\nempty: null\nnested: {items: [2, 4]}\ntags: [project/native]\n---\n# Plan\nAlpha beta\nGamma task:done #work/linux\n`#hidden`\n";
    private static NativeSearchDocument Document => new("Projects/Plan.md", Text, NativeMetadata.Parse("Projects/Plan.md", Text));

    [Theory]
    [InlineData("Alpha AND beta", true)]
    [InlineData("Alpha NOT Gamma", false)]
    [InlineData("(missing OR Alpha) -missing", true)]
    [InlineData("path:Projects file:Plan.md", true)]
    [InlineData("path:Elsewhere OR content:Gamma", true)]
    [InlineData("\"task:done\"", true)]
    [InlineData("'Alpha beta'", true)]
    [InlineData("/alpha\\s+beta/i", true)]
    [InlineData("/Alpha.*Gamma/s", true)]
    [InlineData("/^Gamma/m", true)]
    [InlineData("/[a/b]+/", true)]
    [InlineData("tag:project", true)]
    [InlineData("tag:#work", true)]
    [InlineData("tag:wor", false)]
    [InlineData("tag:hidden", false)]
    [InlineData("[status:open] [priority:>=3]", true)]
    [InlineData("[priority:>3]", false)]
    [InlineData("[active:true]", true)]
    [InlineData("[quoted:true]", false)]
    [InlineData("[empty:null]", true)]
    [InlineData("[nested:>3]", true)]
    [InlineData("[status:/^o/i]", true)]
    [InlineData("[nested]", true)]
    [InlineData("[missing]", false)]
    public void NativeQueryMatchesOriginalSearchOperators(string query, bool expected)
    {
        Assert.Equal(expected, NativeSearchQuery.Parse(query).Match(Document).Success);
    }

    [Fact]
    public void PropertySearchResolvesYamlAliasesAndKeepsExactNumericComparisons()
    {
        const string text = "---\nanchor: &numbers [2, 4]\ncopy: *numbers\nvalue: 3\n---\n";
        var document = new NativeSearchDocument("Aliases.md", text, NativeMetadata.Parse("Aliases.md", text));
        Assert.True(NativeSearchQuery.Parse("[copy:>=4]").Match(document).Success);
        Assert.False(NativeSearchQuery.Parse("[value:=3.0000000000000004]").Match(document).Success);
        Assert.True(NativeSearchQuery.Parse("[value:=3]").Match(document).Success);
    }

    [Fact]
    public void MatchCaseAndRegexFlagControlCaseSensitivity()
    {
        Assert.False(NativeSearchQuery.Parse("alpha", true).Match(Document).Success);
        Assert.True(NativeSearchQuery.Parse("/alpha/i", true).Match(Document).Success);
        Assert.True(NativeSearchQuery.Parse("Alpha", true).Match(Document).Success);
    }

    [Theory]
    [InlineData("Alpha OR")]
    [InlineData("(Alpha")]
    [InlineData("\"unfinished")]
    [InlineData("/unfinished")]
    [InlineData("[status:Open")]
    [InlineData("unknown:value")]
    [InlineData("/broken(/")]
    [InlineData("/Alpha/ii")]
    public void InvalidSearchReportsAnErrorInsteadOfReturningUnfilteredNotes(string query)
    {
        Assert.Throws<InvalidOperationException>(() => NativeSearchQuery.Parse(query));
    }

    [Fact]
    public async Task SearchUsesAllOpenDraftsAndNavigatesToMatchingOffsetWithoutChangingFiles()
    {
        var directory = Path.Combine(Path.GetTempPath(), "slopsidian-search-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        using var workspace = new NativeWorkspace();
        try
        {
            await workspace.OpenVaultAsync(directory);
            var first = await workspace.CreateTabAsync("First.md", "Saved first");
            first.Text = "---\nstatus: Open\n---\nDraft keyword";
            await workspace.CreateTabAsync("Second.md", "Saved second");
            var result = Assert.Single(await workspace.SearchAsync("[status:Open] keyword", cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal("First.md", result.Path);
            Assert.Equal(first.Text.IndexOf("keyword", StringComparison.Ordinal), result.Offset);
            Assert.Equal("Second.md", workspace.ActiveTab!.Path);
            Assert.Equal("Saved first", await File.ReadAllTextAsync(Path.Combine(directory, "First.md"), cancellationToken: TestContext.Current.CancellationToken));
            Assert.True(first.IsDirty);
            await Assert.ThrowsAsync<InvalidOperationException>(() => workspace.SearchAsync("tag:", cancellationToken: TestContext.Current.CancellationToken));
        }
        finally { Directory.Delete(directory, true); }
    }
}
