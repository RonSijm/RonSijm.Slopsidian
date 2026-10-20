namespace RonSijm.Slopsidian.Services;

public sealed class VaultWatch(ILogger<VaultWatch> logger) : IDisposable
{
    private readonly object sync = new();
    private FileSystemWatcher? watcher;
    private string? directory;
    private long revision;
    private Exception? failure;

    public long Revision => Interlocked.Read(ref revision);

    public void Select(string path)
    {
        var next = new FileSystemWatcher(path)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.CreationTime,
            InternalBufferSize = 32768
        };
        bool Visible(string fullPath)
        {
            var relative = Path.GetRelativePath(path, fullPath);
            return !relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Any(segment => segment.StartsWith('.'));
        }

        void Changed(object? sender, FileSystemEventArgs args)
        {
            lock (sync)
            {
                if (ReferenceEquals(sender, watcher) && (Visible(args.FullPath) || args is RenamedEventArgs renamed && Visible(renamed.OldFullPath)))
                {
                    Interlocked.Increment(ref revision);
                }
            }
        }

        next.Created += Changed;
        next.Changed += Changed;
        next.Deleted += Changed;
        next.Renamed += Changed;
        next.Error += (sender, args) =>
        {
            lock (sync)
            {
                if (ReferenceEquals(sender, watcher))
                {
                    failure = args.GetException();
                    Interlocked.Increment(ref revision);
                    logger.LogError(failure, "Vault filesystem observation failed for {Directory}", path);
                }
            }
        };
        FileSystemWatcher? previous;
        lock (sync)
        {
            previous = watcher;
            var previousDirectory = directory;
            watcher = next;
            directory = path;
            var enabled = false;
            try
            {
                next.EnableRaisingEvents = true;
                enabled = true;
            }
            finally
            {
                if (!enabled)
                {
                    watcher = previous;
                    directory = previousDirectory;
                    next.Dispose();
                }
            }

            failure = null;
            Interlocked.Increment(ref revision);
        }

        previous?.Dispose();
    }

    public void RequireHealthy(string path)
    {
        lock (sync)
        {
            if (!string.Equals(directory, path, StringComparison.OrdinalIgnoreCase))
            {
                throw new VaultException("Filesystem observation does not belong to the selected vault.", StatusCodes.Status409Conflict);
            }

            if (failure is not null)
            {
                throw new VaultException("Filesystem observation failed. Reopen the vault to restart it: " + failure.Message, StatusCodes.Status503ServiceUnavailable);
            }
        }
    }

    public void Dispose()
    {
        FileSystemWatcher? previous;
        lock (sync)
        {
            previous = watcher;
            watcher = null;
            directory = null;
        }

        previous?.Dispose();
    }
}
