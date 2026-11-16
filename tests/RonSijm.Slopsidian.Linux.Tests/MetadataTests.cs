using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class MetadataTests
{
    [Fact]
    public void MetadataSeparatesActualLinksTagsAndHeadingsFromCodeAndFrontmatter()
    {
        var content = "---\naliases: [Alias]\ntags: [project]\n---\n# Heading\n\n[[Other]] and #active `[[Code]] #code`\n\n```md\n# Not a heading\n[[Hidden]] #hidden\n```\n\n[^note]: A footnote.\n";
        var metadata = NativeMetadata.Parse("note.md", content);
        Assert.Equal("Heading", Assert.Single(metadata.Headings).Title);
        Assert.Equal("Other", Assert.Single(metadata.Links).Target);
        Assert.Equal(new[] { "active", "project" }, metadata.Tags);
        Assert.Equal("Alias", Assert.Single(metadata.Aliases));
        Assert.Equal("note", Assert.Single(metadata.Footnotes).Id);
        Assert.Equal(content.IndexOf("# Heading", StringComparison.Ordinal), metadata.Headings[0].Offset);
    }

    [Theory]
    [InlineData("\n")]
    [InlineData("\r\n")]
    public void PropertyEditPreservesOtherSourceBytesAndComments(string newline)
    {
        var original = "---" + newline + "title: \"Café 📝\" # retain this comment" + newline + "count: 1e2" + newline + "unknown: { nested: [one, two] }" + newline + "---" + newline + "# Body" + newline;
        var updated = NativeFrontmatter.Set(original, "count", "2.50");
        Assert.Equal(original.Replace("count: 1e2", "count: 2.50", StringComparison.Ordinal), updated);
        var metadata = NativeMetadata.Parse("note.md", updated);
        Assert.Equal("2.50", metadata.Properties.Single(property => property.Key == "count").Raw);
    }

    [Fact]
    public void PropertyCreationRetainsBodyAndExistingUnknownProperties()
    {
        const string original = "---\nunknown: [one, two]\n---\n\n# Body\n";
        var updated = NativeFrontmatter.Set(original, "status", "\"In progress\"");
        Assert.EndsWith("---\n\n# Body\n", updated);
        var properties = NativeMetadata.Parse("note.md", updated).Properties;
        Assert.Contains(properties, property => property.Key == "unknown" && property.Raw == "[one, two]");
        Assert.Contains(properties, property => property.Key == "status" && property.Value == "In progress");
    }

    [Fact]
    public void InvalidFrontmatterCannotBeSilentlyReplacedByPropertyEditor()
    {
        const string original = "---\nbroken: [\n---\nBody\n";
        Assert.NotNull(NativeMetadata.Parse("note.md", original).PropertyError);
        Assert.Throws<InvalidOperationException>(() => NativeFrontmatter.Set(original, "status", "done"));
    }

    [Fact]
    public void EditingAFlowListReplacesItsClosingDelimiterExactlyOnce()
    {
        const string original = "---\ntags: [one, two] # comment\nkeep: 2\n---\nBody\n";
        var updated = NativeFrontmatter.Set(original, "tags", "[three]");
        Assert.Equal(original.Replace("[one, two]", "[three]", StringComparison.Ordinal), updated);
        Assert.Null(NativeMetadata.Parse("note.md", updated).PropertyError);
    }

    [Fact]
    public void AddingAPropertyToAFlowMappingKeepsValidYamlAndTheBody()
    {
        const string original = "---\n{keep: [one, two]}\n---\nBody\n";
        var updated = NativeFrontmatter.Set(original, "#status", "done");
        var metadata = NativeMetadata.Parse("note.md", updated);
        Assert.Null(metadata.PropertyError);
        Assert.Contains(metadata.Properties, property => property.Key == "#status" && property.Value == "done");
        Assert.EndsWith("---\nBody\n", updated);
    }
}
