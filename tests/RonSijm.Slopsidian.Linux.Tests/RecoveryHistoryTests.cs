using System.Text.Json;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class RecoveryHistoryTests
{
    private static VaultDocument Document(string content, bool bom = false) => new(new VaultFile("Folder/Note.md", "Note.md", "Note", "md", new VaultFileStat(0, 0, content.Length)), content, new string('a', 64), bom);

    [Fact]
    public void CaptureHonorsIntervalAndRetainsUnknownConfigurationAndExactText()
    {
        var history = new NativeRecoveryHistory(JsonSerializer.SerializeToElement(new { unknown = new { keep = "value" } }));
        var time = DateTimeOffset.FromUnixTimeMilliseconds(1_000_000);
        Assert.Equal(NativeCaptureResult.Added, history.Capture(Document("Café\r\n", true), time, 5));
        Assert.Equal(NativeCaptureResult.Unchanged, history.Capture(Document("Café\r\n", true), time.AddMinutes(1), 5));
        Assert.Equal(NativeCaptureResult.Waiting, history.Capture(Document("Changed\n"), time.AddMinutes(1), 5));
        Assert.Equal(NativeCaptureResult.Added, history.Capture(Document("Changed\n"), time.AddMinutes(1), 5, force: true, reason: "manual"));
        var restarted = new NativeRecoveryHistory(history.Data);
        Assert.Equal("value", restarted.Data.GetProperty("unknown").GetProperty("keep").GetString());
        Assert.Equal("Changed\n", restarted.GetEntries()[0].Content);
        Assert.Equal("Café\r\n", restarted.GetEntries()[1].Content);
        Assert.True(restarted.GetEntries()[1].HasBom);
    }

    [Fact]
    public void TheLastCaptureWinsWhenSnapshotsHaveTheSameTimestamp()
    {
        var history = new NativeRecoveryHistory(JsonSerializer.SerializeToElement(new { }));
        var now = DateTimeOffset.FromUnixTimeMilliseconds(1_000_000);
        history.Capture(Document("First"), now, 0);
        history.Capture(Document("Second"), now, 0);
        Assert.Equal("Second", history.GetEntries()[0].Content);
        Assert.Equal(NativeCaptureResult.Unchanged, history.Capture(Document("Second"), now, 0));
        Assert.Equal(2, history.GetEntries().Count);
    }

    [Fact]
    public void RetentionCanPersistEvenWhenNoNewSnapshotIsAdded()
    {
        var history = new NativeRecoveryHistory(JsonSerializer.SerializeToElement(new { }));
        var old = DateTimeOffset.FromUnixTimeMilliseconds(1_000_000);
        history.Capture(Document("Old"), old, 0);
        Assert.Equal(1, history.Prune(old.AddDays(8), 7));
        Assert.Empty(new NativeRecoveryHistory(history.Data).GetEntries());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"version\":2,\"snapshots\":[]}")]
    [InlineData("{\"version\":1,\"snapshots\":null}")]
    [InlineData("{\"version\":1}")]
    [InlineData("{\"version\":1,\"snapshots\":[{\"id\":\"x\",\"path\":\"../outside.md\",\"ts\":0,\"content\":\"x\",\"hasBom\":false,\"sourceVersion\":null,\"reason\":\"auto\"}]}")]
    public void DamagedOrUnknownHistoryIsRefusedWithoutResettingItsData(string json)
    {
        using var document = JsonDocument.Parse(json);
        Assert.Throws<InvalidDataException>(() => new NativeRecoveryHistory(document.RootElement));
        Assert.Equal(json, document.RootElement.GetRawText());
    }

    [Fact]
    public void SnapshotFingerprintIncludesUnknownFieldsUsedDuringRestoreReview()
    {
        const string original = "{\"version\":1,\"snapshots\":[{\"id\":\"x\",\"path\":\"Note.md\",\"ts\":0,\"content\":\"x\",\"hasBom\":false,\"sourceVersion\":null,\"reason\":\"auto\",\"unknown\":1}]}";
        using var first = JsonDocument.Parse(original);
        using var changed = JsonDocument.Parse(original.Replace("\"unknown\":1", "\"unknown\":2", StringComparison.Ordinal));
        var before = Assert.Single(new NativeRecoveryHistory(first.RootElement).GetEntries());
        var after = Assert.Single(new NativeRecoveryHistory(changed.RootElement).GetEntries());
        Assert.NotEqual(before.Fingerprint, after.Fingerprint);
    }
}
