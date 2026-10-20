using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using System.Text.Json;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    private const int FileOperationEditLimit = 256;
    private const int FileDispositionInformationClass = 4;

    public async Task<VaultFileInfo> GetFileInfoAsync(string? expectedRoot, string path, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(expectedRoot);
            var fullPath = Resolve(path);
            RequireFileOperationFile(fullPath);
            await using var stream = OpenFileOperationStream(fullPath, false);
            var bytes = await ReadFileOperationBytesAsync(stream, cancellationToken);
            return new VaultFileInfo(directory, Describe(directory, fullPath), Version(bytes));
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultSnapshot> CreateFolderAsync(CreateVaultFolderRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            var fullPath = Resolve(request.Path);
            if (Path.Exists(fullPath))
            {
                throw new VaultException("A file or folder already exists at that path.", StatusCodes.Status409Conflict);
            }

            ValidateFileOperationDirectory(fullPath);
            var created = new List<string>();
            try
            {
                CreateFileOperationDirectories(fullPath, created, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                return Scan(directory);
            }
            catch (Exception exception)
            {
                var failures = RemoveFileOperationDirectories(created);
                if (failures.Count > 0)
                {
                    logger.LogError(new AggregateException(failures.Prepend(exception)), "Cannot roll back folder creation at {Path}", fullPath);
                    throw new VaultException("Folder creation failed, and some newly created folders could not be removed: " + string.Join(", ", created), StatusCodes.Status500InternalServerError);
                }

                throw;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<EditVaultFilesResult> EditFilesAsync(EditVaultFilesRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireFileOperationRoot(request.Root);
            if (request.Edits is not { Count: > 0 and <= FileOperationEditLimit })
            {
                throw new VaultException("Provide between 1 and " + FileOperationEditLimit + " Markdown/Canvas edits in one file operation.");
            }

            return await ExecuteFileOperationAsync(null, null, null, request.Edits, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<RenameVaultFileResult> RenameFileAsync(RenameVaultFileRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireFileOperationRoot(request.Root);
            var source = Resolve(request.Path);
            var destination = Resolve(request.NewPath);
            if (string.Equals(source, destination, StringComparison.Ordinal))
            {
                throw new VaultException("Choose a different destination path.");
            }

            return await MoveFileOperationAsync(source, destination, request.Version, request.Edits ?? [], cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<TrashVaultFileResult> TrashFileAsync(TrashVaultFileRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            var source = Resolve(request.Path);
            var trash = Path.Combine(directory, ".trash");
            ValidateFileOperationDirectory(trash);
            var destination = Path.Combine(trash, Path.GetFileName(source));
            EnsureNotLinked(destination);
            while (Path.Exists(destination))
            {
                destination = Path.Combine(trash, Path.GetFileNameWithoutExtension(source) + "." + Guid.NewGuid().ToString("N") + Path.GetExtension(source));
                EnsureNotLinked(destination);
            }

            var moved = await MoveFileOperationAsync(source, destination, request.Version, request.Edits ?? [], cancellationToken);
            var documents = moved.Documents.Where(document => !string.Equals(document.File.Path, moved.NewPath, StringComparison.OrdinalIgnoreCase)).ToArray();
            return new TrashVaultFileResult(moved.Snapshot, moved.OldPath, moved.NewPath, documents);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<DeleteVaultFileResult> DeleteFileAsync(DeleteVaultFileRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            var source = Resolve(request.Path);
            RequireFileOperationVersion(request.Version);
            RequireFileOperationFile(source);
            var path = FileOperationRelativePath(source);
            VaultSnapshot snapshot;
            VaultFile deleted;
            await using (var stream = OpenFileOperationStream(source, false, deletable: true))
            {
                var bytes = await ReadFileOperationBytesAsync(stream, cancellationToken);
                if (!string.Equals(request.Version, Version(bytes), StringComparison.Ordinal))
                {
                    throw new VaultException("The file changed on disk. No file was deleted; reload the affected note.", StatusCodes.Status409Conflict);
                }

                // Validate the inventory before committing the irreversible, handle-bound deletion.
                snapshot = Scan(directory);
                var matches = snapshot.Files.Where(file => string.Equals(file.Path, path, StringComparison.OrdinalIgnoreCase)).ToArray();
                var entry = matches.FirstOrDefault(file => string.Equals(file.Path, path, StringComparison.Ordinal));
                if (entry is null && matches.Length == 1)
                {
                    entry = matches[0];
                }

                if (entry is null)
                {
                    throw new VaultException("The file is missing or ambiguous in the vault inventory. Reload before permanently deleting it.", StatusCodes.Status409Conflict);
                }

                deleted = entry;
                cancellationToken.ThrowIfCancellationRequested();
                var information = new FileDispositionInformation { DeleteFile = true };
                if (!SetFileInformationByHandle(stream.SafeFileHandle, FileDispositionInformationClass, ref information, (uint)Marshal.SizeOf<FileDispositionInformation>()))
                {
                    var error = Marshal.GetLastWin32Error();
                    var status = error switch
                    {
                        5 => StatusCodes.Status403Forbidden,
                        32 or 33 => StatusCodes.Status409Conflict,
                        _ => StatusCodes.Status500InternalServerError
                    };
                    throw new VaultException("The file could not be permanently deleted: " + new Win32Exception(error).Message, status);
                }
            }

            var files = snapshot.Files.Where(file => file != deleted).ToArray();
            return new DeleteVaultFileResult(snapshot with { Files = files }, path);
        }
        finally
        {
            gate.Release();
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInformation
    {
        [MarshalAs(UnmanagedType.Bool)]
        public bool DeleteFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file, int informationClass, ref FileDispositionInformation information, uint size);

    private string RequireFileOperationRoot(string? expected)
    {
        var directory = RequireRoot();
        if (!string.Equals(expected, directory, StringComparison.OrdinalIgnoreCase))
        {
            throw new VaultException("The selected vault changed. Reload its files before continuing.", StatusCodes.Status409Conflict);
        }

        EnsureNotLinked(directory);
        if (!Directory.Exists(directory))
        {
            throw new VaultException("The selected vault folder no longer exists.", StatusCodes.Status409Conflict);
        }

        return directory;
    }

    private async Task<RenameVaultFileResult> MoveFileOperationAsync(string sourcePath, string destination, string? sourceVersion, IReadOnlyList<VaultFileEdit> requestedEdits, CancellationToken cancellationToken)
    {
        var result = await ExecuteFileOperationAsync(sourcePath, destination, sourceVersion, requestedEdits, cancellationToken);
        return new RenameVaultFileResult(result.Snapshot, FileOperationRelativePath(sourcePath), FileOperationRelativePath(destination), result.Documents);
    }

    private async Task<EditVaultFilesResult> ExecuteFileOperationAsync(string? sourcePath, string? destination, string? sourceVersion, IReadOnlyList<VaultFileEdit> requestedEdits, CancellationToken cancellationToken)
    {
        if (sourcePath is not null)
        {
            RequireFileOperationVersion(sourceVersion);
            RequireFileOperationFile(sourcePath);
            ValidateFileOperationDestination(sourcePath, destination!);
        }

        var edits = ValidateFileOperationEdits(sourcePath, destination, requestedEdits);
        var transactionBase = Path.Combine(RequireRoot(), ".obsidian", "vault-dotnet-transactions");
        ValidateFileOperationDirectory(transactionBase);
        var inputs = new List<FileOperationInput>();
        FileOperationTransaction? transaction = null;
        FileOperationInput? source = null;
        var created = new List<string>();
        try
        {
            if (sourcePath is not null)
            {
                edits.TryGetValue(sourcePath, out var sourceEdit);
                source = await ReadFileOperationInputAsync(sourcePath, sourceVersion!, sourceEdit, cancellationToken);
                inputs.Add(source);
            }

            foreach (var edit in edits)
            {
                if (!string.Equals(edit.Key, sourcePath, StringComparison.OrdinalIgnoreCase))
                {
                    inputs.Add(await ReadFileOperationInputAsync(edit.Key, edit.Value.Version, edit.Value, cancellationToken));
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            if (sourcePath is not null)
            {
                ValidateFileOperationDestination(sourcePath, destination!);
            }

            CreateFileOperationDirectories(transactionBase, [], cancellationToken);
            transaction = CreateFileOperationTransaction(transactionBase);
            await BackupFileOperationAsync(transaction, sourcePath, destination, inputs, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            if (source is not null)
            {
                CreateFileOperationDirectories(Path.GetDirectoryName(destination)!, created, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                CloseFileOperationInput(source);
                MoveFileOperationSource(source, destination!, transaction);
                await LockFileOperationInputAsync(source, source.Original, cancellationToken);
            }

            foreach (var input in inputs)
            {
                if (input.Replacement is not null && (input.IsCreation || !input.Original.AsSpan().SequenceEqual(input.Replacement)))
                {
                    if (input.IsCreation)
                    {
                        CreateFileOperationDirectories(Path.GetDirectoryName(input.Path)!, created, cancellationToken);
                        ValidateFileOperationCreation(input.Path);
                        cancellationToken.ThrowIfCancellationRequested();
                        try
                        {
                            input.Stream = new FileStream(input.Path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read, 65536, FileOptions.Asynchronous);
                        }
                        catch (IOException) when (Path.Exists(input.Path))
                        {
                            throw new VaultException("A file or folder appeared at the new note path. Nothing will be overwritten.", StatusCodes.Status409Conflict);
                        }
                    }

                    // Keep the original handle locked through rollback, including a partially failed write.
                    input.Written = true;
                    await WriteFileOperationBytesAsync(input.Stream!, input.Replacement, cancellationToken);
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            foreach (var input in inputs)
            {
                CloseFileOperationInput(input);
            }

            var documents = FileOperationDocuments(source, destination, inputs);
            var result = new EditVaultFilesResult(Scan(RequireRoot()), documents);
            CleanupFileOperationTransaction(transaction);
            return result;
        }
        catch (Exception exception)
        {
            var failures = await RollbackFileOperationAsync(source, inputs, created, transaction);
            if (failures.Count > 0)
            {
                var recovery = transaction?.Directory ?? transactionBase;
                logger.LogError(new AggregateException(failures.Prepend(exception)), "File operation rollback is incomplete. Recovery copies are at {RecoveryPath}", recovery);
                throw new VaultException("The file operation failed and could not be fully rolled back. Do not retry before checking the recovery copies at: " + recovery, StatusCodes.Status500InternalServerError);
            }

            if (transaction is not null)
            {
                CleanupFileOperationTransaction(transaction);
            }

            throw;
        }
        finally
        {
            foreach (var input in inputs)
            {
                CloseFileOperationInput(input);
            }
        }
    }

    private Dictionary<string, VaultFileEdit> ValidateFileOperationEdits(string? source, string? destination, IReadOnlyList<VaultFileEdit> edits)
    {
        if (edits.Count > FileOperationEditLimit)
        {
            throw new VaultException("A file operation supports up to " + FileOperationEditLimit + " Markdown/Canvas edits.");
        }

        var result = new Dictionary<string, VaultFileEdit>(StringComparer.OrdinalIgnoreCase);
        foreach (var edit in edits)
        {
            if (edit is null || edit.Content is null)
            {
                throw new VaultException("Each reference edit must include a Markdown/Canvas path, version, and string content.");
            }

            if (edit.Create)
            {
                if (edit.Version is not null)
                {
                    throw new VaultException("A newly created note must have a null version.");
                }
            }
            else
            {
                RequireFileOperationVersion(edit.Version);
            }
            var path = Resolve(edit.Path);
            if (!IsFileOperationText(path))
            {
                throw new VaultException("Reference content edits are only supported for Markdown notes and Canvas files.");
            }

            if (!result.TryAdd(path, edit))
            {
                throw new VaultException("A note cannot be edited more than once in a file operation.", StatusCodes.Status409Conflict);
            }

            var isSource = string.Equals(path, source, StringComparison.OrdinalIgnoreCase);
            if ((!isSource && source is not null && FileOperationPathsOverlap(path, source)) || (!isSource && destination is not null && FileOperationPathsOverlap(path, destination)) || result.Keys.Any(other => !string.Equals(other, path, StringComparison.OrdinalIgnoreCase) && FileOperationPathsOverlap(path, other)))
            {
                throw new VaultException("Reference edits must not overlap the moved file, its destination, or another edit.", StatusCodes.Status409Conflict);
            }

            if (edit.Create)
            {
                ValidateFileOperationCreation(path);
            }
            else
            {
                RequireFileOperationFile(path);
            }
        }

        return result;
    }

    private void ValidateFileOperationCreation(string path)
    {
        EnsureNotLinked(path);
        if (Path.Exists(path))
        {
            throw new VaultException("A file or folder already exists at the new note path.", StatusCodes.Status409Conflict);
        }

        ValidateFileOperationDirectory(Path.GetDirectoryName(path)!);
    }

    private void ValidateFileOperationDestination(string source, string destination)
    {
        var caseOnly = string.Equals(source, destination, StringComparison.OrdinalIgnoreCase);
        if ((!caseOnly && Path.Exists(destination)) || Directory.Exists(destination))
        {
            throw new VaultException("A file or folder already exists at the destination.", StatusCodes.Status409Conflict);
        }

        if (!caseOnly && FileOperationPathsOverlap(source, destination))
        {
            throw new VaultException("A file cannot be moved inside itself or over one of its parent folders.", StatusCodes.Status409Conflict);
        }

        EnsureNotLinked(destination);
        ValidateFileOperationDirectory(Path.GetDirectoryName(destination)!);
    }

    private static bool FileOperationPathsOverlap(string first, string second)
    {
        return string.Equals(first, second, StringComparison.OrdinalIgnoreCase)
            || first.StartsWith(second + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || second.StartsWith(first + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFileOperationText(string path)
    {
        var extension = Path.GetExtension(path);
        return string.Equals(extension, ".md", StringComparison.OrdinalIgnoreCase) || string.Equals(extension, ".canvas", StringComparison.OrdinalIgnoreCase);
    }

    private string FileOperationRelativePath(string path) => Path.GetRelativePath(RequireRoot(), path).Replace('\\', '/');

    private static void RequireFileOperationVersion(string? version)
    {
        if (string.IsNullOrEmpty(version))
        {
            throw new VaultException("The file's last-read version is required.", StatusCodes.Status428PreconditionRequired);
        }
    }

    private static void RequireFileOperationFile(string path)
    {
        EnsureNotLinked(path);
        if (Directory.Exists(path))
        {
            throw new VaultException("This operation only supports regular files, not folders.");
        }

        if (!File.Exists(path))
        {
            throw new VaultException("The requested file does not exist.", StatusCodes.Status404NotFound);
        }
    }

    private static FileStream OpenFileOperationStream(string path, bool writable, bool deletable = false)
    {
        try
        {
            if (deletable)
            {
                if (!OperatingSystem.IsWindows())
                {
                    throw new VaultException("Handle-bound permanent deletion is supported only by the Windows native host.", StatusCodes.Status501NotImplemented);
                }

                return new FileInfo(path).Create(FileMode.Open, FileSystemRights.Read | FileSystemRights.Delete, FileShare.Read, 65536, FileOptions.Asynchronous, null);
            }

            var access = writable ? FileAccess.ReadWrite : FileAccess.Read;
            return new FileStream(path, FileMode.Open, access, FileShare.Read, 65536, FileOptions.Asynchronous);
        }
        catch (FileNotFoundException)
        {
            throw new VaultException("The requested file no longer exists.", StatusCodes.Status404NotFound);
        }
        catch (DirectoryNotFoundException)
        {
            throw new VaultException("The requested file no longer exists.", StatusCodes.Status404NotFound);
        }
        catch (UnauthorizedAccessException)
        {
            throw new VaultException("Access to the requested file was denied.", StatusCodes.Status403Forbidden);
        }
        catch (IOException)
        {
            throw new VaultException("The requested file is in use or changed on disk. Retry after resolving the conflict.", StatusCodes.Status409Conflict);
        }
    }

    private static async Task<byte[]> ReadFileOperationBytesAsync(FileStream stream, CancellationToken cancellationToken)
    {
        stream.Position = 0;
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    private async Task<FileOperationInput> ReadFileOperationInputAsync(string path, string? expectedVersion, VaultFileEdit? edit, CancellationToken cancellationToken)
    {
        if (edit is { Create: true })
        {
            ValidateFileOperationCreation(path);
            return new FileOperationInput(path, [], FileOperationContent(edit.Content), default, default, null, true);
        }

        RequireFileOperationFile(path);
        var stream = OpenFileOperationStream(path, edit is not null);
        try
        {
            var original = await ReadFileOperationBytesAsync(stream, cancellationToken);
            var actualVersion = Version(original);
            if (!string.Equals(expectedVersion, actualVersion, StringComparison.Ordinal) || (edit is not null && !string.Equals(edit.Version, actualVersion, StringComparison.Ordinal)))
            {
                throw new VaultException("A file changed on disk. No file operation was applied; reload the affected notes.", StatusCodes.Status409Conflict);
            }

            byte[]? replacement = null;
            if (edit is not null)
            {
                try
                {
                    _ = Utf8.GetString(original);
                    var content = FileOperationContent(edit.Content);
                    replacement = original.AsSpan().StartsWith(Encoding.UTF8.Preamble) ? [.. Encoding.UTF8.Preamble, .. content] : content;
                }
                catch (DecoderFallbackException)
                {
                    throw new VaultException("Reference edits require valid UTF-8 Markdown/Canvas files.", StatusCodes.Status422UnprocessableEntity);
                }
            }

            return new FileOperationInput(path, original, replacement, File.GetCreationTimeUtc(stream.SafeFileHandle), File.GetLastWriteTimeUtc(stream.SafeFileHandle), stream);
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }

    private static byte[] FileOperationContent(string content)
    {
        try
        {
            return Utf8.GetBytes(content);
        }
        catch (EncoderFallbackException)
        {
            throw new VaultException("Reference edits must contain valid Unicode text.");
        }
    }

    private static async Task WriteFileOperationBytesAsync(FileStream stream, byte[] bytes, CancellationToken cancellationToken)
    {
        stream.Position = 0;
        await stream.WriteAsync(bytes, cancellationToken);
        stream.SetLength(bytes.Length);
        await stream.FlushAsync(cancellationToken);
        stream.Flush(true);
    }

    private async Task LockFileOperationInputAsync(FileOperationInput input, byte[] expected, CancellationToken cancellationToken)
    {
        ValidateFileOperationDirectory(Path.GetDirectoryName(input.CurrentPath)!);
        RequireFileOperationFile(input.CurrentPath);
        var stream = OpenFileOperationStream(input.CurrentPath, input.Replacement is not null);
        try
        {
            var actual = await ReadFileOperationBytesAsync(stream, cancellationToken);
            if (!actual.AsSpan().SequenceEqual(expected))
            {
                throw new VaultException("A file changed unexpectedly on disk.", StatusCodes.Status409Conflict);
            }

            input.Stream = stream;
        }
        catch
        {
            stream.Dispose();
            throw;
        }
    }

    private static void CloseFileOperationInput(FileOperationInput input)
    {
        var stream = input.Stream;
        input.Stream = null;
        stream?.Dispose();
    }

    private void MoveFileOperationSource(FileOperationInput source, string destination, FileOperationTransaction transaction)
    {
        ValidateFileOperationDirectory(Path.GetDirectoryName(source.CurrentPath)!);
        RequireFileOperationFile(source.CurrentPath);
        ValidateFileOperationDirectory(Path.GetDirectoryName(destination)!);
        EnsureNotLinked(destination);
        var caseOnly = string.Equals(source.CurrentPath, destination, StringComparison.OrdinalIgnoreCase);
        if (caseOnly)
        {
            EnsureNotLinked(transaction.Directory);
            var staging = Path.Combine(transaction.Directory, "moving-source");
            if (Path.Exists(staging))
            {
                throw new VaultException("The private rename staging path is unexpectedly occupied.", StatusCodes.Status409Conflict);
            }

            File.Move(source.CurrentPath, staging);
            source.CurrentPath = staging;
        }

        try
        {
            File.Move(source.CurrentPath, destination);
            source.CurrentPath = destination;
        }
        catch (IOException) when (Path.Exists(destination))
        {
            throw new VaultException("A file or folder appeared at the destination. Nothing will be overwritten.", StatusCodes.Status409Conflict);
        }
    }

    private IReadOnlyList<VaultDocument> FileOperationDocuments(FileOperationInput? source, string? destination, IReadOnlyList<FileOperationInput> inputs)
    {
        var documents = new List<VaultDocument>();
        foreach (var input in inputs)
        {
            if (input.Replacement is not null)
            {
                documents.Add(Document(input.CurrentPath, input.Replacement));
            }
        }

        if (source is not null && source.Replacement is null && (IsFileOperationText(source.Path) || (destination is not null && IsFileOperationText(destination))))
        {
            try
            {
                documents.Add(Document(source.CurrentPath, source.Original));
            }
            catch (DecoderFallbackException)
            {
                // A binary or non-UTF-8 file can still be moved, but must never enter a text DTO.
            }
        }

        return documents;
    }

    private IReadOnlyList<string> FileOperationDirectoryChain(string directory)
    {
        var relative = Path.GetRelativePath(RequireRoot(), directory);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new VaultException("File operations must stay inside the selected vault.");
        }

        var paths = new List<string> { RequireRoot() };
        if (relative != ".")
        {
            var current = RequireRoot();
            foreach (var segment in relative.Split(Path.DirectorySeparatorChar))
            {
                current = Path.Combine(current, segment);
                paths.Add(current);
            }
        }

        return paths;
    }

    private void ValidateFileOperationDirectory(string directory)
    {
        foreach (var path in FileOperationDirectoryChain(directory))
        {
            EnsureNotLinked(path);
            if (Path.Exists(path) && !Directory.Exists(path))
            {
                throw new VaultException("A file occupies one of the required parent folder paths.", StatusCodes.Status409Conflict);
            }
        }
    }

    private void CreateFileOperationDirectories(string directory, List<string> created, CancellationToken cancellationToken)
    {
        foreach (var path in FileOperationDirectoryChain(directory))
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureNotLinked(path);
            if (Directory.Exists(path))
            {
                continue;
            }

            if (Path.Exists(path))
            {
                throw new VaultException("A file occupies one of the required parent folder paths.", StatusCodes.Status409Conflict);
            }

            var staging = Path.Combine(Path.GetDirectoryName(path)!, ".vault-prototype-folder-" + Guid.NewGuid().ToString("N") + ".tmp");
            Directory.CreateDirectory(staging);
            try
            {
                Directory.Move(staging, path);
                created.Add(path);
            }
            catch (IOException) when (Path.Exists(path))
            {
                throw new VaultException("A file or folder appeared at the requested folder path.", StatusCodes.Status409Conflict);
            }
            finally
            {
                if (Directory.Exists(staging))
                {
                    EnsureNotLinked(staging);
                    Directory.Delete(staging);
                }
            }
        }
    }

    private List<Exception> RemoveFileOperationDirectories(IReadOnlyList<string> created)
    {
        var failures = new List<Exception>();
        foreach (var path in created.Reverse())
        {
            try
            {
                ValidateFileOperationDirectory(path);
                if (Directory.Exists(path))
                {
                    Directory.Delete(path);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException)
            {
                failures.Add(exception);
            }
        }

        return failures;
    }

    private FileOperationTransaction CreateFileOperationTransaction(string transactionBase)
    {
        ValidateFileOperationDirectory(transactionBase);
        var directory = Path.Combine(transactionBase, Guid.NewGuid().ToString("N"));
        if (Path.Exists(directory))
        {
            throw new VaultException("The private transaction directory is unexpectedly occupied.", StatusCodes.Status409Conflict);
        }

        Directory.CreateDirectory(directory);
        return new FileOperationTransaction(directory);
    }

    private async Task BackupFileOperationAsync(FileOperationTransaction transaction, string? source, string? destination, IReadOnlyList<FileOperationInput> inputs, CancellationToken cancellationToken)
    {
        var entries = new List<object>();
        for (var index = 0; index < inputs.Count; index++)
        {
            var input = inputs[index];
            if (input.IsCreation)
            {
                entries.Add(new { path = FileOperationRelativePath(input.Path), create = true });
                continue;
            }

            var name = index.ToString("D4") + ".original";
            await WriteFileOperationBackupAsync(transaction, name, input.Original, cancellationToken);
            entries.Add(new { path = FileOperationRelativePath(input.Path), backup = name, version = Version(input.Original), input.CreationTimeUtc, input.LastWriteTimeUtc });
        }

        var recovery = JsonSerializer.SerializeToUtf8Bytes(new { root = RequireRoot(), operation = source is null ? "edit" : "move", source = source is null ? null : FileOperationRelativePath(source), destination = destination is null ? null : FileOperationRelativePath(destination), files = entries }, WorkspaceJson);
        await WriteFileOperationBackupAsync(transaction, "recovery.json", recovery, cancellationToken);
    }

    private async Task WriteFileOperationBackupAsync(FileOperationTransaction transaction, string name, byte[] bytes, CancellationToken cancellationToken)
    {
        ValidateFileOperationDirectory(transaction.Directory);
        var path = Path.Combine(transaction.Directory, name);
        transaction.Backups.Add((path, Version(bytes)));
        await AtomicWriteAsync(path, bytes, false, cancellationToken);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.Read);
        stream.Flush(true);
    }

    private async Task<List<Exception>> RollbackFileOperationAsync(FileOperationInput? source, IReadOnlyList<FileOperationInput> inputs, IReadOnlyList<string> created, FileOperationTransaction? transaction)
    {
        var failures = new List<Exception>();
        foreach (var input in inputs.Reverse())
        {
            if (!input.Written)
            {
                continue;
            }

            try
            {
                if (input.Stream is null)
                {
                    await LockFileOperationInputAsync(input, input.Replacement!, CancellationToken.None);
                }

                if (input.IsCreation)
                {
                    EnsureNotLinked(input.CurrentPath);
                    CloseFileOperationInput(input);
                    File.Delete(input.CurrentPath);
                    input.Written = false;
                    continue;
                }

                await WriteFileOperationBytesAsync(input.Stream!, input.Original, CancellationToken.None);
                File.SetLastWriteTimeUtc(input.Stream!.SafeFileHandle, input.LastWriteTimeUtc);
                input.Written = false;
            }
            catch (Exception exception)
            {
                failures.Add(exception);
            }
        }

        if (source is not null && !string.Equals(source.CurrentPath, source.Path, StringComparison.Ordinal))
        {
            try
            {
                if (failures.Count > 0 && source.Written)
                {
                    throw new IOException("The moved source still has un-restored content; leave it and its recovery copy in place.");
                }

                if (source.Stream is null)
                {
                    await LockFileOperationInputAsync(source, source.Original, CancellationToken.None);
                }

                CloseFileOperationInput(source);
                MoveFileOperationSource(source, source.Path, transaction!);
            }
            catch (Exception exception)
            {
                failures.Add(exception);
            }
        }

        failures.AddRange(RemoveFileOperationDirectories(created));
        foreach (var input in inputs)
        {
            try
            {
                CloseFileOperationInput(input);
            }
            catch (Exception exception)
            {
                failures.Add(exception);
            }
        }

        return failures;
    }

    private void CleanupFileOperationTransaction(FileOperationTransaction transaction)
    {
        try
        {
            ValidateFileOperationDirectory(transaction.Directory);
            foreach (var backup in transaction.Backups)
            {
                EnsureNotLinked(backup.Path);
                if (File.Exists(backup.Path))
                {
                    if (!string.Equals(Version(File.ReadAllBytes(backup.Path)), backup.Version, StringComparison.Ordinal))
                    {
                        throw new IOException("A private recovery copy changed unexpectedly; it was not deleted.");
                    }

                    File.Delete(backup.Path);
                }
            }

            Directory.Delete(transaction.Directory);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException)
        {
            logger.LogWarning(exception, "Recovery data could not be cleaned up at {RecoveryPath}; only explicitly owned transaction files were considered", transaction.Directory);
        }
    }

    private sealed class FileOperationInput(string path, byte[] original, byte[]? replacement, DateTime creationTimeUtc, DateTime lastWriteTimeUtc, FileStream? stream, bool isCreation = false)
    {
        public string Path { get; } = path;
        public string CurrentPath { get; set; } = path;
        public byte[] Original { get; } = original;
        public byte[]? Replacement { get; } = replacement;
        public DateTime CreationTimeUtc { get; } = creationTimeUtc;
        public DateTime LastWriteTimeUtc { get; } = lastWriteTimeUtc;
        public FileStream? Stream { get; set; } = stream;
        public bool IsCreation { get; } = isCreation;
        public bool Written { get; set; }
    }

    private sealed class FileOperationTransaction(string directory)
    {
        public string Directory { get; } = directory;
        public List<(string Path, string Version)> Backups { get; } = [];
    }
}
