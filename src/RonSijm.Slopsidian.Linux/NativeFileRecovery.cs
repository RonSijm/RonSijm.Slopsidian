using System.Security.Cryptography;
using System.Text;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeRecoveryIndex(string Root, long Epoch, string? Version, IReadOnlyList<NativeRecoverySnapshot> Snapshots);
public sealed record NativeRecoveryPlan(string Root, long Epoch, NativeRecoverySnapshot Snapshot, VaultDocument? Before);

/// <summary>Saved-file history and reviewed restores, serialized within one vault epoch.</summary>
public sealed class NativeFileRecovery(NativeWorkspace workspace, TimeProvider? clock = null) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly TimeProvider time = clock ?? TimeProvider.System;

    public Task<NativeCaptureResult?> CaptureAsync(string path, bool force = false, CancellationToken cancellationToken = default) => RunAsync<NativeCaptureResult?>(async context =>
    {
        var options = await OptionsAsync(context, cancellationToken);
        if (!options.Enabled)
        {
            if (force) { throw new InvalidOperationException("Enable File recovery in Core plugins before saving a snapshot."); }
            return null;
        }
        var document = await ReadFileAsync(context, path, cancellationToken);
        if (document is null) { return null; }
        VerifyEncoding(document);
        var (configuration, history) = await ReadHistoryAsync(context, cancellationToken);
        var now = time.GetUtcNow();
        var removed = history.Prune(now, options.KeepDays);
        var result = history.Capture(document, now, options.IntervalMinutes, force, force ? "manual" : "auto");
        if (removed > 0 || result == NativeCaptureResult.Added) { await WriteHistoryAsync(context, configuration, history, cancellationToken); }
        return result;
    }, cancellationToken);

    public Task<NativeRecoveryIndex> ListAsync(CancellationToken cancellationToken = default) => RunAsync(async context =>
    {
        await RequireEnabledAsync(context, cancellationToken);
        var (configuration, history) = await ReadHistoryAsync(context, cancellationToken);
        return new NativeRecoveryIndex(context.Root, context.Epoch, configuration.Version, history.GetEntries());
    }, cancellationToken);

    public Task<int> PruneAsync(CancellationToken cancellationToken = default) => RunAsync(async context =>
    {
        var options = await OptionsAsync(context, cancellationToken);
        if (!options.Enabled) { return 0; }
        var (configuration, history) = await ReadHistoryAsync(context, cancellationToken);
        var removed = history.Prune(time.GetUtcNow(), options.KeepDays);
        if (removed > 0) { await WriteHistoryAsync(context, configuration, history, cancellationToken); }
        return removed;
    }, cancellationToken);

    public Task<bool> ClearAsync(NativeRecoveryIndex review, CancellationToken cancellationToken = default) => RunAsync(async context =>
    {
        GuardReview(context, review.Root, review.Epoch);
        await RequireEnabledAsync(context, cancellationToken);
        var (configuration, history) = await ReadHistoryAsync(context, cancellationToken);
        if (configuration.Version != review.Version) { throw new InvalidOperationException("Recovery history changed after confirmation. Reload it before clearing."); }
        history.Clear();
        await WriteHistoryAsync(context, configuration, history, cancellationToken);
        return true;
    }, cancellationToken);

    public Task<NativeRecoveryPlan> ReviewAsync(string id, CancellationToken cancellationToken = default) => RunAsync(async context =>
    {
        RequireClean();
        await RequireEnabledAsync(context, cancellationToken);
        var (_, history) = await ReadHistoryAsync(context, cancellationToken);
        var snapshot = history.GetEntries().FirstOrDefault(entry => entry.Id == id)
            ?? throw new InvalidOperationException("This snapshot is no longer in recovery history. Reload the history.");
        var before = await ReadFileAsync(context, snapshot.Path, cancellationToken);
        RequireClean();
        return new NativeRecoveryPlan(context.Root, context.Epoch, snapshot, before);
    }, cancellationToken);

    public Task<VaultDocument> RestoreAsync(NativeRecoveryPlan review, CancellationToken cancellationToken = default) => RunAsync(async context =>
    {
        GuardReview(context, review.Root, review.Epoch);
        RequireClean();
        await RequireEnabledAsync(context, cancellationToken);
        var current = await ReadFileAsync(context, review.Snapshot.Path, cancellationToken);
        if (current?.Version != review.Before?.Version) { throw new InvalidOperationException("The file changed after review. Review it again; the external version was retained."); }
        var (configuration, history) = await ReadHistoryAsync(context, cancellationToken);
        if (history.GetEntries().FirstOrDefault(entry => entry.Id == review.Snapshot.Id) != review.Snapshot)
        {
            throw new InvalidOperationException("The selected snapshot changed or was cleared. Reload history before restoring.");
        }
        if (current is not null)
        {
            VerifyEncoding(current);
            if (history.Capture(current, time.GetUtcNow(), 0, force: true, reason: "before-restore") == NativeCaptureResult.Added)
            {
                await WriteHistoryAsync(context, configuration, history, cancellationToken);
            }
        }
        Guard(context);
        RequireClean();
        var base64 = Convert.ToBase64String(Encode(review.Snapshot.Content, review.Snapshot.HasBom));
        if (current is null) { await workspace.Vault.CreateBinaryAsync(new(review.Snapshot.Path, base64, context.Root), cancellationToken); }
        else { await workspace.Vault.ModifyBinaryAsync(new(review.Snapshot.Path, base64, context.Root, current.Version), cancellationToken); }
        Guard(context);
        var saved = await workspace.Vault.ReadAsync(review.Snapshot.Path, cancellationToken, context.Root);
        Guard(context);
        foreach (var tab in workspace.Tabs.Where(tab => tab.Path == saved.File.Path)) { tab.Reload(saved); }
        await workspace.RefreshAsync();
        return saved;
    }, cancellationToken);

    private async Task<T> RunAsync<T>(Func<Context, Task<T>> operation, CancellationToken cancellationToken)
    {
        var context = new Context(workspace.Snapshot.Root ?? throw new InvalidOperationException("Open a vault first."), workspace.VaultEpoch);
        await gate.WaitAsync(cancellationToken);
        try
        {
            Guard(context);
            var result = await operation(context);
            Guard(context);
            return result;
        }
        finally { gate.Release(); }
    }

    private async Task<(VaultConfigurationDocument Configuration, NativeRecoveryHistory History)> ReadHistoryAsync(Context context, CancellationToken cancellationToken)
    {
        var configuration = await workspace.Vault.ReadConfigurationAsync(NativeRecoveryHistory.ConfigurationId, context.Root, cancellationToken);
        Guard(context);
        return (configuration, new NativeRecoveryHistory(configuration.Data));
    }

    private async Task WriteHistoryAsync(Context context, VaultConfigurationDocument configuration, NativeRecoveryHistory history, CancellationToken cancellationToken)
    {
        Guard(context);
        await workspace.Vault.WriteConfigurationAsync(NativeRecoveryHistory.ConfigurationId, new(context.Root, configuration.Version, history.Data), cancellationToken);
        Guard(context);
    }

    private async Task<VaultDocument?> ReadFileAsync(Context context, string path, CancellationToken cancellationToken)
    {
        try
        {
            var result = await workspace.Vault.ReadAsync(path, cancellationToken, context.Root);
            Guard(context);
            return result;
        }
        catch (VaultException exception) when (exception.StatusCode == 404) { Guard(context); return null; }
    }

    private async Task<Options> OptionsAsync(Context context, CancellationToken cancellationToken)
    {
        var configuration = await workspace.Vault.ReadCorePluginsAsync(cancellationToken);
        Guard(context);
        if (configuration.Root != context.Root) { throw new InvalidOperationException("The selected vault changed. Reopen file recovery."); }
        var plugin = configuration.Plugins.Single(item => item.Id == "file-recovery");
        var interval = plugin.Settings["intervalMinutes"]?.GetValue<double>() ?? 5;
        var keep = plugin.Settings["keepDays"]?.GetValue<double>() ?? 7;
        NativeRecoveryHistory.ValidateOptions(interval, keep);
        return new Options(plugin.Enabled, interval, keep);
    }

    private async Task RequireEnabledAsync(Context context, CancellationToken cancellationToken)
    {
        if (!(await OptionsAsync(context, cancellationToken)).Enabled) { throw new InvalidOperationException("Enable File recovery in Core plugins to use saved-file history."); }
    }

    private void Guard(Context context)
    {
        if (workspace.Snapshot.Root != context.Root || workspace.VaultEpoch != context.Epoch) { throw new InvalidOperationException("This recovery operation belongs to a previous vault session. Reopen file recovery."); }
    }

    private void GuardReview(Context context, string root, long epoch)
    {
        Guard(context);
        if (context.Root != root || context.Epoch != epoch) { throw new InvalidOperationException("This recovery review belongs to a previous vault session. Review it again."); }
    }

    private void RequireClean()
    {
        if (workspace.HasDirtyTabs || workspace.OrphanedDrafts.Count > 0) { throw new InvalidOperationException("Save or recover all unsaved drafts before reviewing a restore. Their text was retained."); }
    }

    private static byte[] Encode(string content, bool hasBom) => hasBom ? [0xef, 0xbb, 0xbf, .. Encoding.UTF8.GetBytes(content)] : Encoding.UTF8.GetBytes(content);

    private static void VerifyEncoding(VaultDocument document)
    {
        if (Convert.ToHexStringLower(SHA256.HashData(Encode(document.Content, document.HasBom))) != document.Version)
        {
            throw new InvalidDataException("This file cannot be captured as exact UTF-8 text. Its bytes were retained.");
        }
    }

    public void Dispose() => gate.Dispose();
    private sealed record Context(string Root, long Epoch);
    private sealed record Options(bool Enabled, double IntervalMinutes, double KeepDays);
}
