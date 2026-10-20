using System.ComponentModel;
using System.Runtime.InteropServices;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    internal const int FolderOperationFileLimit = 4096;
    internal const int FolderOperationEntryLimit = 16384;
    internal const long FolderOperationByteLimit = 512L * 1024 * 1024;

    private sealed record FolderTree(IReadOnlyList<string> Files, IReadOnlyList<string> Directories, long Bytes);

    public async Task<RenameVaultFolderResult> RenameFolderAsync(RenameVaultFolderRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            var source = Resolve(request.Path);
            var destination = Resolve(request.NewPath);
            RequireFolder(source);
            var caseOnly = string.Equals(source, destination, StringComparison.OrdinalIgnoreCase);
            if (string.Equals(source, destination, StringComparison.Ordinal))
            {
                throw new VaultException("Choose a different destination path.");
            }

            if (!caseOnly)
            {
                if (FileOperationPathsOverlap(source, destination))
                {
                    throw new VaultException("A folder cannot be moved inside itself or over one of its parent folders.", StatusCodes.Status409Conflict);
                }

                if (Path.Exists(destination))
                {
                    throw new VaultException("A file or folder already exists at the destination.", StatusCodes.Status409Conflict);
                }
            }

            EnsureNotLinked(destination);
            ValidateFileOperationDirectory(Path.GetDirectoryName(destination)!);
            var sourcePath = FileOperationRelativePath(source);
            var destinationPath = FileOperationRelativePath(destination);
            var manifest = RequireManifest(request.Manifest, sourcePath);
            var edits = request.Edits ?? [];
            foreach (var edit in edits)
            {
                if (edit.Create)
                {
                    throw new VaultException("Folder moves can only update existing notes.");
                }
            }

            await VerifyFolderAsync(source, sourcePath, manifest, null, cancellationToken);
            var originals = new List<VaultFileEdit>();
            var applied = new List<VaultDocument>();
            if (edits.Count > 0)
            {
                foreach (var edit in edits)
                {
                    var editPath = Resolve(edit.Path);
                    RequireFileOperationFile(editPath);
                    var bytes = await File.ReadAllBytesAsync(editPath, cancellationToken);
                    var current = Document(editPath, bytes);
                    originals.Add(new VaultFileEdit(current.File.Path, null, current.Content));
                }

                var result = await EditFilesAsyncCore(edits, cancellationToken);
                applied.AddRange(result.Documents);
                var updated = applied.ToDictionary(document => document.File.Path, document => document.Version, StringComparer.Ordinal);
                manifest = manifest.Select(entry => updated.TryGetValue(entry.Path, out var version) ? entry with { Version = version } : entry).ToArray();
            }

            var created = new List<string>();
            try
            {
                CreateFileOperationDirectories(Path.GetDirectoryName(destination)!, created, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                MoveFolderDirectory(source, destination, caseOnly);
            }
            catch (Exception exception)
            {
                var failures = RemoveFileOperationDirectories(created);
                var message = await RevertFolderEditsAsync(applied, originals, cancellationToken);
                if (failures.Count > 0 || message is not null)
                {
                    logger.LogError(new AggregateException(failures.Prepend(exception)), "Cannot fully recover failed folder move {Source}", sourcePath);
                    throw new VaultException("The folder move failed and recovery is incomplete. " + (message ?? "Created folders could not be removed.") + " Reload the vault and inspect the listed paths.", StatusCodes.Status500InternalServerError);
                }

                if (exception is VaultException)
                {
                    throw;
                }

                throw new VaultException("The folder could not be moved; no files were changed: " + exception.Message, exception is IOException ? StatusCodes.Status409Conflict : StatusCodes.Status500InternalServerError);
            }

            var moved = manifest.Select(entry => new VaultFolderMove(entry.Path, destinationPath + entry.Path[sourcePath.Length..])).ToArray();
            try
            {
                await VerifyFolderAsync(destination, destinationPath, manifest, sourcePath, cancellationToken);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Moved folder {Source} to {Destination} but descendant verification failed", sourcePath, destinationPath);
                throw new VaultException("The folder was moved, but its contents changed or could not be verified afterwards. No automatic revert was attempted; inspect '" + destinationPath + "'.", StatusCodes.Status500InternalServerError);
            }

            return new RenameVaultFolderResult(Scan(directory), sourcePath, destinationPath, applied, moved);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<DeleteVaultFolderResult> DeleteFolderAsync(DeleteVaultFolderRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            if (string.IsNullOrWhiteSpace(request.Path) || request.Path is "/" or ".")
            {
                throw new VaultException("The vault root cannot be deleted.", StatusCodes.Status403Forbidden);
            }

            var source = Resolve(request.Path);
            RequireFolder(source);
            var sourcePath = FileOperationRelativePath(source);
            var manifest = RequireManifest(request.Manifest, sourcePath);
            if (!OperatingSystem.IsWindows())
            {
                throw new VaultException("Handle-bound permanent deletion is supported only by the Windows native host.", StatusCodes.Status501NotImplemented);
            }

            var tree = EnumerateFolderTree(source);
            var handles = new List<(string Path, FileStream Stream)>();
            var deleted = new List<string>();
            var pending = new List<string>();
            try
            {
                CompareManifest(tree, sourcePath, manifest);
                foreach (var file in tree.Files)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var stream = OpenFileOperationStream(file, false, deletable: true);
                    handles.Add((FileOperationRelativePath(file), stream));
                    var bytes = await ReadFileOperationBytesAsync(stream, cancellationToken);
                    var expected = manifest.First(entry => string.Equals(entry.Path, FileOperationRelativePath(file), StringComparison.Ordinal));
                    if (!string.Equals(expected.Version, Version(bytes), StringComparison.Ordinal))
                    {
                        throw new VaultException("'" + expected.Path + "' changed on disk. No file was deleted; reload the folder.", StatusCodes.Status409Conflict);
                    }
                }

                // Entries added while handles were being opened must also cancel the operation.
                CompareManifest(EnumerateFolderTree(source), sourcePath, manifest);
                cancellationToken.ThrowIfCancellationRequested();
                foreach (var (path, stream) in handles)
                {
                    var information = new FileDispositionInformation { DeleteFile = true };
                    if (!SetFileInformationByHandle(stream.SafeFileHandle, FileDispositionInformationClass, ref information, (uint)Marshal.SizeOf<FileDispositionInformation>()))
                    {
                        var error = Marshal.GetLastWin32Error();
                        pending.AddRange(handles.Select(item => item.Path).Except(deleted));
                        throw new VaultException("Permanent folder deletion stopped after " + deleted.Count + " of " + handles.Count + " files ('" + path + "': " + new Win32Exception(error).Message + "). Deleted: " + Summarize(deleted) + ". Remaining: " + Summarize(pending) + ".", StatusCodes.Status500InternalServerError);
                    }

                    deleted.Add(path);
                }
            }
            finally
            {
                foreach (var (_, stream) in handles)
                {
                    stream.Dispose();
                }
            }

            var deletedFolders = new List<string>();
            var remaining = new List<string>();
            foreach (var folder in tree.Directories.OrderByDescending(path => path.Length).Append(source))
            {
                try
                {
                    EnsureNotLinked(folder);
                    Directory.Delete(folder, false);
                    deletedFolders.Add(FileOperationRelativePath(folder));
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException)
                {
                    remaining.Add(FileOperationRelativePath(folder));
                    logger.LogError(exception, "Cannot remove folder {Folder} after deleting its files", folder);
                }
            }

            if (remaining.Count > 0)
            {
                throw new VaultException("All " + deleted.Count + " files were deleted, but these folders could not be removed (content appeared or access was denied): " + Summarize(remaining) + ".", StatusCodes.Status409Conflict);
            }

            return new DeleteVaultFolderResult(Scan(directory), sourcePath, deleted, deletedFolders);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<EditVaultFilesResult> EditFilesAsyncCore(IReadOnlyList<VaultFileEdit> edits, CancellationToken cancellationToken)
    {
        if (edits.Count > FileOperationEditLimit)
        {
            throw new VaultException("Provide between 1 and " + FileOperationEditLimit + " Markdown/Canvas edits in one file operation.");
        }

        return await ExecuteFileOperationAsync(null, null, null, edits, cancellationToken);
    }

    private async Task<string?> RevertFolderEditsAsync(IReadOnlyList<VaultDocument> applied, IReadOnlyList<VaultFileEdit> originals, CancellationToken cancellationToken)
    {
        if (applied.Count == 0)
        {
            return null;
        }

        try
        {
            var inverse = applied.Select(document => originals.First(original => string.Equals(original.Path, document.File.Path, StringComparison.OrdinalIgnoreCase)) with { Version = document.Version }).ToArray();
            await ExecuteFileOperationAsync(null, null, null, inverse, CancellationToken.None);
            return null;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Cannot revert reference edits after a failed folder move");
            return "Reference edits could not be reverted for: " + Summarize(applied.Select(document => document.File.Path).ToArray()) + ".";
        }
    }

    private void MoveFolderDirectory(string source, string destination, bool caseOnly)
    {
        if (!caseOnly)
        {
            Directory.Move(source, destination);
            return;
        }

        var staging = Path.Combine(Path.GetDirectoryName(source)!, ".vault-prototype-folder-" + Guid.NewGuid().ToString("N") + ".tmp");
        Directory.Move(source, staging);
        try
        {
            Directory.Move(staging, destination);
        }
        catch
        {
            Directory.Move(staging, source);
            throw;
        }
    }

    private void RequireFolder(string path)
    {
        EnsureNotLinked(path);
        if (File.Exists(path))
        {
            throw new VaultException("This operation only supports folders, not files.");
        }

        if (!Directory.Exists(path))
        {
            throw new VaultException("The requested folder does not exist.", StatusCodes.Status404NotFound);
        }
    }

    private static IReadOnlyList<FolderManifestEntry> RequireManifest(IReadOnlyList<FolderManifestEntry>? manifest, string folder)
    {
        if (manifest is null)
        {
            throw new VaultException("A manifest of the folder's files and last-read versions is required.", StatusCodes.Status428PreconditionRequired);
        }

        if (manifest.Count > FolderOperationFileLimit)
        {
            throw new VaultException("Folder operations support at most " + FolderOperationFileLimit + " files.", StatusCodes.Status413PayloadTooLarge);
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in manifest)
        {
            if (entry is null || string.IsNullOrEmpty(entry.Version) || string.IsNullOrEmpty(entry.Path) || !entry.Path.StartsWith(folder + "/", StringComparison.Ordinal) || !seen.Add(entry.Path))
            {
                throw new VaultException("The folder manifest is invalid. Reload the vault and retry.", StatusCodes.Status428PreconditionRequired);
            }
        }

        return manifest;
    }

    private FolderTree EnumerateFolderTree(string folder)
    {
        var files = new List<string>();
        var directories = new List<string>();
        long bytes = 0;
        var pending = new Stack<string>();
        pending.Push(folder);
        while (pending.Count > 0)
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(pending.Pop()))
            {
                if (Path.GetFileName(entry).StartsWith('.'))
                {
                    throw new VaultException("The folder contains hidden entries that this operation cannot verify: " + FileOperationRelativePath(entry), StatusCodes.Status409Conflict);
                }

                EnsureNotLinked(entry);
                if (files.Count + directories.Count >= FolderOperationEntryLimit)
                {
                    throw new VaultException("Folder operations support at most " + FolderOperationEntryLimit + " entries.", StatusCodes.Status413PayloadTooLarge);
                }

                if (Directory.Exists(entry))
                {
                    directories.Add(entry);
                    pending.Push(entry);
                    continue;
                }

                if (files.Count >= FolderOperationFileLimit)
                {
                    throw new VaultException("Folder operations support at most " + FolderOperationFileLimit + " files.", StatusCodes.Status413PayloadTooLarge);
                }

                bytes += new FileInfo(entry).Length;
                if (bytes > FolderOperationByteLimit)
                {
                    throw new VaultException("Folder operations support at most " + FolderOperationByteLimit / 1024 / 1024 + " MiB of descendant files.", StatusCodes.Status413PayloadTooLarge);
                }

                files.Add(entry);
            }
        }

        return new FolderTree(files, directories, bytes);
    }

    private void CompareManifest(FolderTree tree, string folder, IReadOnlyList<FolderManifestEntry> manifest)
    {
        var actual = tree.Files.Select(FileOperationRelativePath).ToHashSet(StringComparer.Ordinal);
        var expected = manifest.Select(entry => entry.Path).ToHashSet(StringComparer.Ordinal);
        var added = actual.Except(expected).Order(StringComparer.Ordinal).ToArray();
        var missing = expected.Except(actual).Order(StringComparer.Ordinal).ToArray();
        if (added.Length > 0 || missing.Length > 0)
        {
            throw new VaultException("The folder '" + folder + "' changed on disk. Added: " + Summarize(added) + ". Missing: " + Summarize(missing) + ". Nothing was changed; reload the vault.", StatusCodes.Status409Conflict);
        }
    }

    private async Task VerifyFolderAsync(string folder, string folderPath, IReadOnlyList<FolderManifestEntry> manifest, string? previousPath, CancellationToken cancellationToken)
    {
        var tree = EnumerateFolderTree(folder);
        var current = previousPath is null ? manifest : manifest.Select(entry => entry with { Path = folderPath + entry.Path[previousPath.Length..] }).ToArray();
        CompareManifest(tree, folderPath, current);
        foreach (var entry in current)
        {
            var bytes = await File.ReadAllBytesAsync(Resolve(entry.Path), cancellationToken);
            if (!string.Equals(entry.Version, Version(bytes), StringComparison.Ordinal))
            {
                throw new VaultException("'" + entry.Path + "' changed on disk. Nothing was changed; reload the folder.", StatusCodes.Status409Conflict);
            }
        }
    }

    private static string Summarize(IReadOnlyCollection<string> paths) => paths.Count == 0 ? "none" : string.Join(", ", paths.Take(10)) + (paths.Count > 10 ? " and " + (paths.Count - 10) + " more" : "");
}
