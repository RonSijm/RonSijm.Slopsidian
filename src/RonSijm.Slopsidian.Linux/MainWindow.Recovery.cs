using Avalonia.Threading;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow
{
    private readonly DispatcherTimer recoveryTimer = new() { Interval = TimeSpan.FromMinutes(1) };
    private Task recoveryTask = Task.CompletedTask;
    private readonly HashSet<string> pendingRecovery = new(StringComparer.Ordinal);

    private void QueueRecovery(string path)
    {
        if (System.IO.Path.GetExtension(path).ToLowerInvariant() is not (".md" or ".canvas" or ".base")) { return; }
        if (pendingRecovery.Count >= 1000 && !pendingRecovery.Contains(path))
        {
            ShowError(new InvalidOperationException("Too many files await a recovery snapshot. Open the intended file and save a snapshot manually."));
            return;
        }
        pendingRecovery.Add(path);
        recoveryTimer.Interval = TimeSpan.FromMilliseconds(300);
    }

    private Task CaptureRecoveryAsync()
    {
        recoveryTimer.Interval = TimeSpan.FromMinutes(1);
        if (busy || Workspace.Snapshot.Root is null || !recoveryTask.IsCompleted) { return Task.CompletedTask; }
        recoveryTask = RecordRecoveryAsync();
        return recoveryTask;
    }

    private async Task RecordRecoveryAsync()
    {
        try
        {
            var paths = pendingRecovery.Concat(Workspace.Tabs.Select(tab => tab.Path)).Distinct(StringComparer.Ordinal).Take(64).ToArray();
            foreach (var path in paths)
            {
                try
                {
                    var result = await Workspace.Recovery.CaptureAsync(path, cancellationToken: CancellationToken.None);
                    if (result != NativeCaptureResult.Waiting) { pendingRecovery.Remove(path); }
                }
                catch (Exception exception) { ShowError(exception); }
            }
            await Workspace.Recovery.PruneAsync(CancellationToken.None);
        }
        catch (Exception exception) { ShowError(exception); }
    }

    private Task OpenRecoveryAsync() => RunAsync(async () =>
    {
        if (Workspace.Snapshot.Root is null) { return; }
        await new NativeRecoveryWindow(Workspace).ShowDialog(this);
        await RefreshWorkspaceAsync();
        await PersistProfileAsync();
    });

    private Task SaveRecoverySnapshotAsync() => RunAsync(async () =>
    {
        var path = Workspace.Document?.File.Path ?? throw new InvalidOperationException("Open a file before saving a recovery snapshot.");
        await Workspace.Recovery.CaptureAsync(path, force: true, CancellationToken.None);
    });
}
