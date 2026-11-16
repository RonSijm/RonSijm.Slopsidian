using System.Text.Json;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class FileSettingsTests
{
    [Fact]
    public void SettingsPreserveUnknownValuesAndUseConfiguredNoteFolder()
    {
        var original = JsonSerializer.SerializeToElement(new { unknown = new { values = new[] { 1, 2 } }, newFileLocation = "current" });
        var settings = NativeFileSettings.Read(original);
        var snapshot = new RonSijm.Slopsidian.Services.VaultSnapshot("/vault", "Vault", [], [], ["Inbox"]);
        Assert.Equal("Projects/New.md", settings.NotePath("New.md", "Projects/Active.md", snapshot));
        Assert.Equal("Explicit/New.md", settings.NotePath("Explicit/New.md", "Projects/Active.md", snapshot));
        var updated = (settings with { NewFileLocation = "folder", NewFileFolderPath = "Inbox" }).Apply(original);
        Assert.Equal(2, updated.GetProperty("unknown").GetProperty("values").GetArrayLength());
        Assert.Equal("Inbox/New.md", NativeFileSettings.Read(updated).NotePath("New.md", null, snapshot));
        Assert.Equal("New.md", (settings with { NewFileLocation = "folder", NewFileFolderPath = "Missing" }).NotePath("New.md", null, snapshot));
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("/absolute")]
    [InlineData(".obsidian")]
    public void SettingsRejectFolderTraversal(string folder)
    {
        Assert.Throws<InvalidOperationException>(() => (new NativeFileSettings() with { NewFileFolderPath = folder }).Apply(JsonSerializer.SerializeToElement(new { })));
    }
}
