namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    public async Task<VaultSnapshot> InstallCommunityPluginAsync(string id, CommunityPluginInstallRequest request, CancellationToken cancellationToken = default)
    {
        ValidateCommunityId(id);
        if (request.Version is { Length: 0 or > 128 })
        {
            throw new VaultException("An update requires its last-read package version; use null only for creation.");
        }

        var replacement = new Dictionary<string, byte[]?>(StringComparer.Ordinal)
        {
            ["manifest.json"] = DecodeCommunityAsset(request.ManifestBase64, "manifest.json"),
            ["main.js"] = DecodeCommunityAsset(request.CodeBase64, "main.js"),
            ["styles.css"] = request.CssBase64 is null ? null : DecodeCommunityAsset(request.CssBase64, "styles.css")
        };
        _ = ParseCommunityManifest(replacement["manifest.json"]!, id);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            using var rootLease = OpenCommunityDirectory(directory);
            var folder = CommunityPluginPath(id);
            var plugins = Path.GetDirectoryName(folder)!;
            CreateFileOperationDirectories(plugins, [], cancellationToken);
            using var configurationLease = OpenCommunityDirectory(Path.GetDirectoryName(plugins)!);
            using var pluginsLease = OpenCommunityDirectory(plugins);
            CommunityPackage? before = null;
            CommunityIdentity? reviewedIdentity = null;
            if (request.Version is null)
            {
                if (Path.Exists(folder))
                {
                    throw new VaultException("A file or plugin directory already exists. Creation never overwrites it.", StatusCodes.Status409Conflict);
                }
            }
            else
            {
                using var reviewLease = OpenCommunityDirectory(folder, true);
                reviewedIdentity = reviewLease.Identity;
                before = await ReadCommunityPackageAsync(folder, id, cancellationToken);
                if (CommunityFingerprint(before.Assets) != request.Version)
                {
                    throw new VaultException("The plugin package changed on disk. Reload it before updating.", StatusCodes.Status409Conflict);
                }
            }

            var transactionBase = Path.Combine(directory, ".obsidian", "vault-dotnet-transactions");
            CreateFileOperationDirectories(transactionBase, [], cancellationToken);
            using var baseLease = OpenCommunityDirectory(transactionBase);
            var transaction = NewCommunityTransaction(transactionBase, cancellationToken);
            using var transactionLease = OpenCommunityDirectory(transaction.Directory, true);
            var staged = Path.Combine(transaction.Directory, "package");
            CommunityIdentity? packageIdentity = null;
            CommunityPackage? after = null;
            var createdAssets = new Dictionary<string, CommunityIdentity>(StringComparer.Ordinal);
            var ownedAssets = CommunityAssetNames.ToDictionary(name => name, _ => (CommunityIdentity?)null, StringComparer.Ordinal);
            var moved = false;
            var published = false;
            var changed = false;
            var incompleteAssetRollback = false;
            try
            {
                if (before is null)
                {
                    var created = new List<string>();
                    CreateFileOperationDirectories(staged, created, cancellationToken);
                    if (!created.Contains(staged, StringComparer.OrdinalIgnoreCase))
                    {
                        throw new VaultException("The private package staging directory appeared externally; it was not overwritten.", StatusCodes.Status409Conflict);
                    }

                    using (var stagedLease = OpenCommunityDirectory(staged))
                    {
                        packageIdentity = stagedLease.Identity;
                        foreach (var name in CommunityAssetNames)
                        {
                            if (replacement[name] is { } bytes)
                            {
                                createdAssets[name] = await WriteNewCommunityAssetAsync(Path.Combine(staged, name), bytes, cancellationToken);
                                ownedAssets[name] = createdAssets[name];
                            }
                        }
                    }
                }
                else
                {
                    MoveCommunityDirectory(folder, staged);
                    moved = true;
                    using (var stagedLease = OpenCommunityDirectory(staged))
                    {
                        packageIdentity = stagedLease.Identity;
                        var current = await ReadCommunityPackageAsync(staged, id, cancellationToken);
                        if (packageIdentity != reviewedIdentity || !SameCommunityPackage(before, current))
                        {
                            throw new VaultException("The plugin directory or package changed while staging. No package asset was updated.", StatusCodes.Status409Conflict);
                        }
                    }

                    try
                    {
                        var written = await ReplaceCommunityAssetsAsync(staged, before, replacement, transaction, cancellationToken);
                        foreach (var name in CommunityAssetNames)
                        {
                            ownedAssets[name] = written[name];
                        }
                    }
                    catch (VaultException exception) when (exception.StatusCode == StatusCodes.Status500InternalServerError)
                    {
                        incompleteAssetRollback = true;
                        throw;
                    }

                    changed = true;
                }

                using (var stagedLease = OpenCommunityDirectory(staged))
                {
                    if (stagedLease.Identity != packageIdentity)
                    {
                        throw new VaultException("The private plugin directory was replaced externally.", StatusCodes.Status409Conflict);
                    }

                    var candidate = await ReadCommunityPackageAsync(staged, id, cancellationToken);
                    if (CommunityFingerprint(candidate.Assets) != CommunityFingerprint(replacement) || CommunityAssetNames.Any(name => candidate.Identities[name] != ownedAssets[name]))
                    {
                        throw new VaultException("The staged plugin package changed externally.", StatusCodes.Status409Conflict);
                    }

                    if (before is null && Directory.EnumerateFileSystemEntries(staged).Any(path => !replacement.TryGetValue(Path.GetFileName(path), out var bytes) || bytes is null))
                    {
                        throw new VaultException("Unexpected files appeared in the new private plugin directory. They were not published.", StatusCodes.Status409Conflict);
                    }

                    after = candidate;
                }

                RequireFileOperationRoot(request.Root);
                cancellationToken.ThrowIfCancellationRequested();
                MoveCommunityDirectory(staged, folder);
                published = true;
                using (var installedLease = OpenCommunityDirectory(folder))
                {
                    var current = await ReadCommunityPackageAsync(folder, id, cancellationToken);
                    if (installedLease.Identity != packageIdentity || !SameCommunityPackage(after, current))
                    {
                        throw new VaultException("The installed plugin changed before installation completed.", StatusCodes.Status409Conflict);
                    }
                }

                var snapshot = Scan(directory);
                var cleanup = await CleanupCommunityTransactionAsync(transaction, transactionLease.Identity);
                if (cleanup.Count > 0)
                {
                    throw new VaultException("The package was written, but its private staging data could not be removed: " + string.Join("; ", cleanup.Select(error => error.Message)), StatusCodes.Status500InternalServerError);
                }

                logger.LogInformation("Installed community plugin {Plugin} in {Vault}; enablement and plugin data were not changed", id, directory);
                return snapshot;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException or OperationCanceledException or System.Text.Json.JsonException)
            {
                var failures = new List<Exception>();
                if (incompleteAssetRollback)
                {
                    failures.Add(new IOException("Package assets could not be restored while locked; the staged directory and recovery copies were retained."));
                }
                else
                {
                    try
                    {
                        if (published)
                        {
                            using (var installedLease = OpenCommunityDirectory(folder, true))
                            {
                                var current = await ReadCommunityPackageAsync(folder, id, CancellationToken.None);
                                if (installedLease.Identity != packageIdentity || after is null || !SameCommunityPackage(after, current))
                                {
                                    throw new VaultException("The published plugin was modified or replaced externally. Its newer bytes were retained.", StatusCodes.Status409Conflict);
                                }
                            }

                            MoveCommunityDirectory(folder, staged);
                            published = false;
                        }

                        if (before is not null && moved)
                        {
                            if (changed)
                            {
                                using (var stagedLease = OpenCommunityDirectory(staged))
                                {
                                    var current = await ReadCommunityPackageAsync(staged, id, CancellationToken.None);
                                    if (stagedLease.Identity != packageIdentity || after is null || !SameCommunityPackage(after, current))
                                    {
                                        throw new VaultException("The staged package changed externally; its newer bytes were retained.", StatusCodes.Status409Conflict);
                                    }
                                }

                                await ReplaceCommunityAssetsAsync(staged, after, before.Assets, null, CancellationToken.None);
                            }

                            MoveCommunityDirectory(staged, folder);
                        }
                        else if (before is null && Directory.Exists(staged))
                        {
                            if (packageIdentity is null)
                            {
                                throw new VaultException("An unowned staging directory was retained.", StatusCodes.Status409Conflict);
                            }

                            await RemoveNewCommunityPackageAsync(staged, replacement, createdAssets, packageIdentity);
                        }
                    }
                    catch (Exception restoreException) when (restoreException is IOException or UnauthorizedAccessException or VaultException or System.Text.Json.JsonException)
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
                    logger.LogError(new AggregateException(failures.Prepend(exception)), "Community plugin installation rollback is incomplete at {RecoveryPath}", transaction.Directory);
                    throw new VaultException("Plugin installation failed and rollback/cleanup is incomplete. Newer foreign bytes were retained. Inspect the staged package and original asset copies before retrying: " + transaction.Directory, StatusCodes.Status500InternalServerError);
                }

                throw;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private FileOperationTransaction NewCommunityTransaction(string transactionBase, CancellationToken cancellationToken)
    {
        var transaction = new FileOperationTransaction(Path.Combine(transactionBase, "community-" + Guid.NewGuid().ToString("N")));
        if (Path.Exists(transaction.Directory))
        {
            throw new VaultException("The private plugin staging path is occupied.", StatusCodes.Status409Conflict);
        }

        var created = new List<string>();
        CreateFileOperationDirectories(transaction.Directory, created, cancellationToken);
        if (!created.Contains(transaction.Directory, StringComparer.OrdinalIgnoreCase))
        {
            throw new VaultException("The private plugin transaction directory appeared externally; it was not overwritten.", StatusCodes.Status409Conflict);
        }

        return transaction;
    }

    private static bool SameCommunityPackage(CommunityPackage expected, CommunityPackage current)
    {
        return CommunityFingerprint(expected.Assets) == CommunityFingerprint(current.Assets)
            && CommunityAssetNames.All(name => expected.Identities[name] == current.Identities[name]);
    }

    private static async Task RemoveNewCommunityPackageAsync(string folder, IReadOnlyDictionary<string, byte[]?> expected, IReadOnlyDictionary<string, CommunityIdentity> owned, CommunityIdentity? identity)
    {
        using (var lease = OpenCommunityDirectory(folder, true))
        {
            if (identity is not null && lease.Identity != identity)
            {
                throw new VaultException("A different plugin staging directory was retained.", StatusCodes.Status409Conflict);
            }

            var streams = new List<FileStream>();
            try
            {
                foreach (var name in CommunityAssetNames)
                {
                    var path = Path.Combine(folder, name);
                    if (!Path.Exists(path))
                    {
                        continue;
                    }

                    var stream = OpenCommunityDeletableFile(path);
                    streams.Add(stream);
                    var bytes = await ReadCommunityBoundedAsync(stream, CommunityAssetLimit(name), CancellationToken.None);
                    if (expected[name] is null || !owned.TryGetValue(name, out var fileIdentity) || CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle)) != fileIdentity || !bytes.AsSpan().SequenceEqual(expected[name]))
                    {
                        throw new VaultException("A staged asset changed externally and was retained: " + name, StatusCodes.Status409Conflict);
                    }
                }

                foreach (var stream in streams)
                {
                    MarkCommunityFileDeleted(stream);
                }
            }
            finally
            {
                foreach (var stream in streams)
                {
                    await stream.DisposeAsync();
                }
            }
        }

        Directory.Delete(folder);
    }
}
