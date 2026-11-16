using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class SessionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "slopsidian-session-" + Guid.NewGuid().ToString("N"));
    private readonly NativeWorkspace workspace = new();

    public SessionTests() => Directory.CreateDirectory(directory);

    [Fact]
    public async Task TabSwitchRetainsIndependentDraftsAndOnlySavesRequestedTab()
    {
        await workspace.OpenVaultAsync(directory);
        var first = await workspace.CreateTabAsync("first.md", "First saved");
        first.Text = "First draft";
        var second = await workspace.CreateTabAsync("second.md", "Second saved");
        second.Text = "Second draft";
        workspace.Activate(first);
        Assert.Equal("First draft", workspace.Text);
        Assert.Same(first, await workspace.OpenTabAsync("first.md"));
        await workspace.SaveAsync();
        Assert.False(first.IsDirty);
        Assert.True(second.IsDirty);
        Assert.Equal("First draft", await File.ReadAllTextAsync(Path.Combine(directory, "first.md")));
        Assert.Equal("Second saved", await File.ReadAllTextAsync(Path.Combine(directory, "second.md")));
    }

    [Fact]
    public async Task RecoveredDraftKeepsOriginalVersionAndRefusesOverwriteOfExternalEdit()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("note.md", "Original");
        workspace.Text = "Recovered draft";
        var session = workspace.CaptureSession();
        await File.WriteAllTextAsync(Path.Combine(directory, "note.md"), "Changed externally");
        using var restarted = new NativeWorkspace();
        await restarted.OpenVaultAsync(directory);
        await restarted.RestoreSessionAsync(session);
        Assert.Equal("Recovered draft", restarted.Text);
        Assert.True(restarted.ActiveTab!.ExternalChange);
        var error = await Assert.ThrowsAsync<VaultException>(restarted.SaveAsync);
        Assert.Equal(409, error.StatusCode);
        Assert.Equal("Changed externally", await File.ReadAllTextAsync(Path.Combine(directory, "note.md")));
    }

    [Fact]
    public async Task DeletedFileDraftRemainsRecoverableAcrossAnotherProfileSave()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("note.md", "Original");
        workspace.Text = "Draft for deleted note";
        var session = workspace.CaptureSession();
        File.Delete(Path.Combine(directory, "note.md"));
        using var restarted = new NativeWorkspace();
        await restarted.OpenVaultAsync(directory);
        await restarted.RestoreSessionAsync(session);
        Assert.Equal("Draft for deleted note", Assert.Single(restarted.OrphanedDrafts).Draft);
        Assert.Equal("Draft for deleted note", Assert.Single(restarted.CaptureSession().Tabs).Draft);
    }

    [Fact]
    public async Task ReloadFailureRetainsTheDraft()
    {
        await workspace.OpenVaultAsync(directory);
        var tab = await workspace.CreateTabAsync("note.md", "Original");
        tab.Text = "Keep this draft";
        File.Delete(Path.Combine(directory, "note.md"));
        await Assert.ThrowsAsync<VaultException>(() => workspace.ReloadTabAsync(tab, discardDraft: true));
        Assert.Equal("Keep this draft", tab.Text);
        Assert.True(tab.IsDirty);
    }

    [Fact]
    public async Task ExistingDirtyTabSurvivesLoadingAnOlderWorkspace()
    {
        await workspace.OpenVaultAsync(directory);
        var tab = await workspace.CreateTabAsync("note.md", "Original");
        tab.Text = "Earlier draft";
        var session = workspace.CaptureSession();
        tab.Text = "More recent edits";
        await workspace.RestoreSessionAsync(session);
        Assert.Equal("More recent edits", tab.Text);
    }

    [Fact]
    public async Task ProfileRoundTripsRecoveryWithoutWritingIntoVault()
    {
        var profileDirectory = Path.Combine(directory, "profile");
        var note = new NativeTabState("Folder/Unicode café.md", 5, 40, false, false, "# Draft\r\nKeep exact text\r\n", "version");
        using (var profile = new NativeProfile(profileDirectory))
        {
            profile.State = profile.State with { Session = new NativeSession("/a/vault", note.Path, [note]) };
            await profile.SaveAsync();
        }
        using var loaded = new NativeProfile(profileDirectory);
        await loaded.LoadAsync();
        Assert.Equal(note, Assert.Single(loaded.State.Session!.Tabs));
        Assert.Single(Directory.GetFiles(profileDirectory));
        if (OperatingSystem.IsLinux())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(profileDirectory, "state.json")));
        }
    }

    [Theory]
    [InlineData("{\"version\":1,\"preferences\":null}")]
    [InlineData("{\"version\":1,\"session\":{\"root\":\"/vault\",\"tabs\":null}}")]
    public async Task InvalidProfileRemainsUntouched(string json)
    {
        var profileDirectory = Path.Combine(directory, "invalid-profile");
        Directory.CreateDirectory(profileDirectory);
        var file = Path.Combine(profileDirectory, "state.json");
        await File.WriteAllTextAsync(file, json);
        using var profile = new NativeProfile(profileDirectory);
        await Assert.ThrowsAsync<InvalidDataException>(() => profile.LoadAsync());
        Assert.Equal(json, await File.ReadAllTextAsync(file));
    }

    [Fact]
    public async Task VaultSwitchClearsMetadataAndRetainsCaseDistinctNotes()
    {
        await workspace.OpenVaultAsync(directory);
        await workspace.CreateTabAsync("Note.md", "# First");
        await workspace.CreateTabAsync("note.md", "# Second");
        Assert.Equal(2, workspace.Tabs.Count);
        Assert.Equal("First", Assert.Single(workspace.MetadataFor("Note.md").Headings).Title);
        var other = Path.Combine(directory, "other");
        Directory.CreateDirectory(other);
        await workspace.OpenVaultAsync(other);
        Assert.Empty(workspace.MetadataFor("Note.md").Headings);
    }

    [Fact]
    public async Task UnrelatedVaultRefreshDoesNotMarkAnUnchangedDirtyNoteAsConflicted()
    {
        await workspace.OpenVaultAsync(directory);
        var tab = await workspace.CreateTabAsync("Draft.md", "Saved");
        tab.Text = "Draft";
        await workspace.ReloadTabAsync(tab);
        Assert.False(tab.ExternalChange);
        Assert.Equal("Draft", tab.Text);
        await File.WriteAllTextAsync(Path.Combine(directory, "Draft.md"), "External");
        await workspace.ReloadTabAsync(tab);
        Assert.True(tab.ExternalChange);
        Assert.Equal("Draft", tab.Text);
    }

    public void Dispose()
    {
        workspace.Dispose();
        Directory.Delete(directory, true);
    }
}
