namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    public async Task<VaultSnapshot> DeleteCommunityPluginAsync(string id, DeleteCommunityPluginRequest request, CancellationToken cancellationToken = default)
    {
        ValidateCommunityId(id);
        if (string.IsNullOrEmpty(request.Version) || request.Version.Length > 128)
        {
            throw new VaultException("Uninstalling a plugin requires its explicit last-read package version.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            using var rootLease = OpenCommunityDirectory(directory);
            var folder = CommunityPluginPath(id);
            var plugins = Path.GetDirectoryName(folder)!;
            using var configurationLease = OpenCommunityDirectory(Path.GetDirectoryName(plugins)!);
            using var pluginsLease = OpenCommunityDirectory(plugins);
            CommunityIdentity identity;
            CommunityTree tree;
            using (var reviewLease = OpenCommunityDirectory(folder, true))
            {
                identity = reviewLease.Identity;
                var package = await ReadCommunityPackageAsync(folder, id, cancellationToken);
                if (CommunityFingerprint(package.Assets) != request.Version)
                {
                    throw new VaultException("The plugin package changed on disk. Nothing was uninstalled.", StatusCodes.Status409Conflict);
                }

                tree = await ReadCommunityTreeAsync(folder, cancellationToken);
            }

            var snapshot = Scan(directory);
            var transactionBase = Path.Combine(directory, ".obsidian", "vault-dotnet-transactions");
            CreateFileOperationDirectories(transactionBase, [], cancellationToken);
            using var baseLease = OpenCommunityDirectory(transactionBase);
            var transaction = NewCommunityTransaction(transactionBase, cancellationToken);
            using var transactionLease = OpenCommunityDirectory(transaction.Directory, true);
            var staged = Path.Combine(transaction.Directory, "package");
            var moved = false;
            var removedRoot = false;
            CommunityIdentity? movedIdentity = null;
            var removedFiles = new List<CommunityTreeFile>();
            var removedDirectories = new List<CommunityTreeDirectory>();
            try
            {
                MoveCommunityDirectory(folder, staged);
                moved = true;
                using (var stagedLease = OpenCommunityDirectory(staged))
                {
                    movedIdentity = stagedLease.Identity;
                    if (stagedLease.Identity != identity)
                    {
                        throw new VaultException("The reviewed plugin directory was replaced before uninstalling it.", StatusCodes.Status409Conflict);
                    }

                    var current = await ReadCommunityTreeAsync(staged, cancellationToken);
                    if (!SameCommunityTree(tree, current))
                    {
                        throw new VaultException("Plugin package or data files changed while preparing removal.", StatusCodes.Status409Conflict);
                    }

                    for (var index = 0; index < tree.Files.Count; index++)
                    {
                        await WriteFileOperationBackupAsync(transaction, "deleted-" + index.ToString("D4") + ".original", tree.Files[index].Bytes, cancellationToken);
                    }

                    await WriteFileOperationBackupAsync(transaction, "deletion.json", System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { root = directory, id, files = tree.Files.Select((file, index) => new { path = file.Path, backup = "deleted-" + index.ToString("D4") + ".original", version = Version(file.Bytes) }) }, WorkspaceJson), cancellationToken);
                    await RemoveCommunityTreeFilesAsync(staged, tree, removedFiles, cancellationToken);
                    foreach (var entry in tree.Directories.Reverse())
                    {
                        var path = Path.Combine(staged, entry.Path);
                        using var lease = OpenCommunityDirectory(path, true);
                        if (lease.Identity != entry.Identity)
                        {
                            throw new VaultException("A plugin data directory was replaced and was retained.", StatusCodes.Status409Conflict);
                        }

                        Directory.Delete(path);
                        removedDirectories.Add(entry);
                    }
                }

                using (var lease = OpenCommunityDirectory(staged, true))
                {
                    if (lease.Identity != identity)
                    {
                        throw new VaultException("The plugin directory was replaced during removal.", StatusCodes.Status409Conflict);
                    }

                    Directory.Delete(staged);
                    removedRoot = true;
                }

                if (Path.Exists(folder))
                {
                    throw new VaultException("A foreign plugin directory appeared during removal. It was retained.", StatusCodes.Status409Conflict);
                }

                var cleanup = await CleanupCommunityTransactionAsync(transaction, transactionLease.Identity);
                if (cleanup.Count > 0)
                {
                    throw new VaultException("Plugin removal staging cleanup failed: " + string.Join("; ", cleanup.Select(error => error.Message)), StatusCodes.Status500InternalServerError);
                }

                logger.LogInformation("Uninstalled explicitly reviewed community plugin {Plugin} and its data from {Vault}", id, directory);
                return snapshot with { Plugins = snapshot.Plugins.Where(plugin => plugin.Id != id).ToArray() };
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException or OperationCanceledException)
            {
                var failures = new List<Exception>();
                if (moved && removedFiles.Count == 0 && removedDirectories.Count == 0 && !removedRoot)
                {
                    try
                    {
                        using var lease = OpenCommunityDirectory(staged, true);
                        if (lease.Identity != (movedIdentity ?? identity))
                        {
                            throw new VaultException("The private plugin directory was replaced; it was retained.", StatusCodes.Status409Conflict);
                        }

                        MoveCommunityDirectory(staged, folder);
                        moved = false;
                    }
                    catch (Exception restoreException) when (restoreException is IOException or UnauthorizedAccessException or VaultException)
                    {
                        failures.Add(restoreException);
                    }
                }

                if (moved && failures.Count == 0)
                {
                    try
                    {
                        if (removedRoot)
                        {
                            if (Path.Exists(staged))
                            {
                                throw new VaultException("A foreign directory now occupies the private removal path; it was retained.", StatusCodes.Status409Conflict);
                            }

                            CreateFileOperationDirectories(staged, [], CancellationToken.None);
                            using var recreated = OpenCommunityDirectory(staged);
                            identity = recreated.Identity;
                        }

                        using (var lease = OpenCommunityDirectory(staged))
                        {
                            if (lease.Identity != identity)
                            {
                                throw new VaultException("The private plugin directory was replaced; it was retained.", StatusCodes.Status409Conflict);
                            }

                            var restoredDirectories = new Dictionary<string, CommunityIdentity>(StringComparer.OrdinalIgnoreCase);
                            foreach (var entry in tree.Directories)
                            {
                                var path = Path.Combine(staged, entry.Path);
                                if (removedDirectories.Contains(entry))
                                {
                                    if (Path.Exists(path))
                                    {
                                        throw new VaultException("A removed data directory was recreated externally; it was retained.", StatusCodes.Status409Conflict);
                                    }

                                    CreateFileOperationDirectories(path, [], CancellationToken.None);
                                    using var restored = OpenCommunityDirectory(path);
                                    restoredDirectories[entry.Path] = restored.Identity;
                                }
                                else
                                {
                                    using var current = OpenCommunityDirectory(path);
                                    if (current.Identity != entry.Identity)
                                    {
                                        throw new VaultException("A plugin data directory changed externally; it was retained.", StatusCodes.Status409Conflict);
                                    }

                                    restoredDirectories[entry.Path] = current.Identity;
                                }
                            }

                            foreach (var file in removedFiles.AsEnumerable().Reverse())
                            {
                                var path = Path.Combine(staged, file.Path);
                                var parentPath = Path.GetDirectoryName(file.Path);
                                using var parentLease = OpenCommunityDirectory(Path.GetDirectoryName(path)!);
                                var expectedParent = string.IsNullOrEmpty(parentPath) ? identity : restoredDirectories[parentPath];
                                if (parentLease.Identity != expectedParent)
                                {
                                    throw new VaultException("The destination of a recovery copy was replaced externally.", StatusCodes.Status409Conflict);
                                }

                                if (Path.Exists(path))
                                {
                                    await using var original = OpenCommunityFile(path);
                                    var current = await ReadCommunityBoundedAsync(original, CommunityTreeByteLimit, CancellationToken.None);
                                    if (CommunityIdentityOf(CommunityInformation(original.SafeFileHandle)) != file.Identity || !current.AsSpan().SequenceEqual(file.Bytes))
                                    {
                                        throw new VaultException("A newer file occupies a removed plugin data path and was retained.", StatusCodes.Status409Conflict);
                                    }
                                }
                                else
                                {
                                    await AtomicWriteAsync(path, file.Bytes, false, CancellationToken.None);
                                }
                            }
                        }

                        MoveCommunityDirectory(staged, folder);
                    }
                    catch (Exception restoreException) when (restoreException is IOException or UnauthorizedAccessException or VaultException)
                    {
                        failures.Add(restoreException);
                    }
                }

                if (failures.Count == 0)
                {
                    failures.AddRange(await CleanupCommunityTransactionAsync(transaction, transactionLease.Identity));
                }

                if (failures.Count > 0)
                {
                    logger.LogError(new AggregateException(failures.Prepend(exception)), "Community plugin uninstall rollback is incomplete at {RecoveryPath}", transaction.Directory);
                    throw new VaultException("Plugin removal failed and rollback/cleanup is incomplete. Newer foreign bytes were retained. Inspect the staged package, deletion.json and recovery copies at: " + transaction.Directory, StatusCodes.Status500InternalServerError);
                }

                throw;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<CommunityTree> ReadCommunityTreeAsync(string folder, CancellationToken cancellationToken)
    {
        var files = new List<CommunityTreeFile>();
        var directories = new List<CommunityTreeDirectory>();
        var entries = 0;
        long total = 0;
        async Task Visit(string path, int depth)
        {
            if (depth > 64)
            {
                throw new VaultException("Plugin data exceeds the supported directory depth (64).", StatusCodes.Status413PayloadTooLarge);
            }

            using var parentLease = OpenCommunityDirectory(path);
            foreach (var entry in Directory.EnumerateFileSystemEntries(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (++entries > CommunityTreeEntryLimit)
                {
                    throw new VaultException("Plugin removal supports at most 4096 entries.", StatusCodes.Status413PayloadTooLarge);
                }

                EnsureNotLinked(entry);
                var relative = Path.GetRelativePath(folder, entry);
                if (Directory.Exists(entry))
                {
                    using var lease = OpenCommunityDirectory(entry);
                    directories.Add(new CommunityTreeDirectory(relative, lease.Identity));
                    await Visit(entry, depth + 1);
                }
                else
                {
                    await using var stream = OpenCommunityFile(entry);
                    var bytes = await ReadCommunityBoundedAsync(stream, CommunityTreeByteLimit - total, cancellationToken);
                    total += bytes.LongLength;
                    files.Add(new CommunityTreeFile(relative, bytes, CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle))));
                }
            }
        }

        await Visit(folder, 0);
        return new CommunityTree(files, directories);
    }

    private static bool SameCommunityTree(CommunityTree expected, CommunityTree current)
    {
        return expected.Files.Count == current.Files.Count && expected.Directories.Count == current.Directories.Count
            && expected.Files.All(file => current.Files.Any(entry => entry.Path == file.Path && entry.Identity == file.Identity && entry.Bytes.AsSpan().SequenceEqual(file.Bytes)))
            && expected.Directories.All(folder => current.Directories.Contains(folder));
    }

    private static async Task RemoveCommunityTreeFilesAsync(string folder, CommunityTree tree, List<CommunityTreeFile> removed, CancellationToken cancellationToken)
    {
        var inputs = new List<(CommunityTreeFile File, FileStream Stream)>();
        try
        {
            foreach (var file in tree.Files)
            {
                var path = Path.Combine(folder, file.Path);
                var stream = OpenCommunityDeletableFile(path);
                inputs.Add((file, stream));
                var bytes = await ReadCommunityBoundedAsync(stream, CommunityTreeByteLimit, cancellationToken);
                if (CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle)) != file.Identity || !bytes.AsSpan().SequenceEqual(file.Bytes))
                {
                    throw new VaultException("A plugin file changed while preparing removal; newer bytes were retained.", StatusCodes.Status409Conflict);
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            foreach (var input in inputs)
            {
                MarkCommunityFileDeleted(input.Stream);
                removed.Add(input.File);
                await input.Stream.DisposeAsync();
            }
        }
        finally
        {
            foreach (var input in inputs)
            {
                await input.Stream.DisposeAsync();
            }
        }
    }

    private sealed record CommunityTreeFile(string Path, byte[] Bytes, CommunityIdentity Identity);
    private sealed record CommunityTreeDirectory(string Path, CommunityIdentity Identity);
    private sealed record CommunityTree(IReadOnlyList<CommunityTreeFile> Files, IReadOnlyList<CommunityTreeDirectory> Directories);
}
