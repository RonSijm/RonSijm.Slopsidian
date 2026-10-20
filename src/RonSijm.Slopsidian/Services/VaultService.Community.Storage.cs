using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    private const uint CommunityOpenReparsePoint = 0x00200000;
    private const uint CommunityBackupSemantics = 0x02000000;
    private const uint CommunityOverlapped = 0x40000000;

    private static FileAttributes? CommunityAttributes(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new VaultException("Symbolic links and junctions are not supported in community plugin operations: " + path, StatusCodes.Status409Conflict);
            }

            return attributes;
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            throw new VaultException("Access to a community plugin entry was denied: " + path, StatusCodes.Status403Forbidden);
        }
        catch (IOException)
        {
            throw new VaultException("A community plugin entry could not be inspected safely: " + path, StatusCodes.Status409Conflict);
        }
    }

    private static CommunityDirectoryLease OpenCommunityDirectory(string path, bool movable = false)
    {
        EnsureNotLinked(path);
        var attributes = CommunityAttributes(path);
        if (attributes is null)
        {
            throw new VaultException("The required plugin directory no longer exists: " + path, StatusCodes.Status404NotFound);
        }

        if ((attributes.Value & FileAttributes.Directory) == 0)
        {
            throw new VaultException("A file occupies a required plugin directory path.", StatusCodes.Status409Conflict);
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new VaultException("Handle-guarded community plugin package operations require the Windows native host; use browser folder storage on other platforms.", StatusCodes.Status501NotImplemented);
        }

        var sharing = movable ? 5u : 1u;
        var handle = OpenCommunityPathHandle(path, 0x80, sharing, IntPtr.Zero, 3, CommunityOpenReparsePoint | CommunityBackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw CommunityFilesystemError(error, "The plugin directory could not be guarded");
        }

        try
        {
            var information = CommunityInformation(handle);
            if ((information.Attributes & (uint)FileAttributes.ReparsePoint) != 0 || (information.Attributes & (uint)FileAttributes.Directory) == 0)
            {
                throw new VaultException("The plugin directory was replaced by a link or non-directory entry.", StatusCodes.Status409Conflict);
            }

            return new CommunityDirectoryLease(handle, CommunityIdentityOf(information));
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    private static CommunityIdentity CommunityIdentityOf(CommunityFileInformation information) => new(information.Volume, information.IndexHigh, information.IndexLow);

    private static CommunityFileInformation CommunityInformation(SafeFileHandle handle)
    {
        if (!GetCommunityFileInformation(handle, out var information))
        {
            throw CommunityFilesystemError(Marshal.GetLastWin32Error(), "The plugin entry identity could not be checked");
        }

        if ((information.Attributes & (uint)FileAttributes.ReparsePoint) != 0)
        {
            throw new VaultException("Symbolic links and junctions are not supported in community plugin operations.", StatusCodes.Status409Conflict);
        }

        return information;
    }

    private static VaultException CommunityFilesystemError(int error, string operation)
    {
        var status = error switch
        {
            2 or 3 => StatusCodes.Status404NotFound,
            5 => StatusCodes.Status403Forbidden,
            32 or 33 or 80 or 183 => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status500InternalServerError
        };
        return new VaultException(operation + ": " + new Win32Exception(error).Message, status);
    }

    private static FileStream OpenCommunityFile(string path, bool writable = false, bool deletable = false, bool create = false)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new VaultException("Handle-guarded community plugin file operations require the Windows native host.", StatusCodes.Status501NotImplemented);
        }

        EnsureNotLinked(path);
        var attributes = CommunityAttributes(path);
        if (attributes is not null && (attributes.Value & FileAttributes.Directory) != 0)
        {
            throw new VaultException("A folder occupies a plugin file path.", StatusCodes.Status409Conflict);
        }

        if (create && attributes is not null)
        {
            throw new VaultException("A plugin file path was occupied externally; nothing was overwritten.", StatusCodes.Status409Conflict);
        }

        if (!create && attributes is null)
        {
            throw new VaultException("The requested community plugin file no longer exists.", StatusCodes.Status404NotFound);
        }

        var access = 0x80000000u;
        if (writable)
        {
            access |= 0x40000000u;
        }

        if (deletable)
        {
            access |= 0x10000u;
        }

        var disposition = create ? 1u : 3u;
        var handle = OpenCommunityPathHandle(path, access, 1, IntPtr.Zero, disposition, CommunityOpenReparsePoint | CommunityOverlapped, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw CommunityFilesystemError(error, "The plugin file could not be guarded");
        }

        try
        {
            var information = CommunityInformation(handle);
            if ((information.Attributes & (uint)FileAttributes.Directory) != 0)
            {
                throw new VaultException("A folder occupies a plugin file path.", StatusCodes.Status409Conflict);
            }

            var fileAccess = writable ? FileAccess.ReadWrite : FileAccess.Read;
            return new FileStream(handle, fileAccess, 65536, isAsync: true);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    private static FileStream OpenCommunityDeletableFile(string path, bool writable = false) => OpenCommunityFile(path, writable, true);

    private static void MarkCommunityFileDeleted(FileStream stream, bool delete = true)
    {
        var information = new FileDispositionInformation { DeleteFile = delete };
        if (!SetFileInformationByHandle(stream.SafeFileHandle, FileDispositionInformationClass, ref information, (uint)Marshal.SizeOf<FileDispositionInformation>()))
        {
            throw CommunityFilesystemError(Marshal.GetLastWin32Error(), "A community plugin file could not be removed");
        }
    }

    private async Task<CommunityIdentity> WriteNewCommunityAssetAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        EnsureNotLinked(path);
        await using var stream = OpenCommunityFile(path, true, true, true);
        var identity = CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle));
        try
        {
            await WriteFileOperationBytesAsync(stream, bytes, cancellationToken);
            return identity;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or OperationCanceledException)
        {
            try
            {
                MarkCommunityFileDeleted(stream);
            }
            catch (VaultException cleanupException)
            {
                logger.LogError(new AggregateException(exception, cleanupException), "A new private plugin asset could not be removed at {Path}", path);
                throw new VaultException("Writing a private plugin asset failed and cleanup is incomplete. Inspect: " + path, StatusCodes.Status500InternalServerError);
            }

            throw;
        }
    }

    private async Task<List<Exception>> CleanupCommunityTransactionAsync(FileOperationTransaction transaction, CommunityIdentity identity)
    {
        var failures = new List<Exception>();
        try
        {
            ValidateFileOperationDirectory(transaction.Directory);
            using (var lease = OpenCommunityDirectory(transaction.Directory, true))
            {
                if (lease.Identity != identity)
                {
                    throw new VaultException("The private plugin transaction directory was replaced; it was retained.", StatusCodes.Status409Conflict);
                }

                foreach (var backup in transaction.Backups)
                {
                    if (!Path.Exists(backup.Path))
                    {
                        continue;
                    }

                    await using var stream = OpenCommunityDeletableFile(backup.Path);
                    var bytes = await ReadCommunityBoundedAsync(stream, CommunityTreeByteLimit, CancellationToken.None);
                    if (Version(bytes) != backup.Version)
                    {
                        throw new VaultException("A private plugin recovery copy changed; it was retained: " + backup.Path, StatusCodes.Status409Conflict);
                    }

                    MarkCommunityFileDeleted(stream);
                }
            }

            Directory.Delete(transaction.Directory);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException)
        {
            failures.Add(exception);
        }

        return failures;
    }

    private static void MoveCommunityDirectory(string source, string destination)
    {
        EnsureNotLinked(source);
        EnsureNotLinked(destination);
        if (Path.Exists(destination))
        {
            throw new VaultException("A file or plugin directory appeared at the destination. It was not overwritten.", StatusCodes.Status409Conflict);
        }

        try
        {
            Directory.Move(source, destination);
        }
        catch (IOException)
        {
            throw new VaultException("The plugin directory moved, is in use, or its destination was occupied. No directory was overwritten.", StatusCodes.Status409Conflict);
        }
    }

    private async Task<IReadOnlyDictionary<string, CommunityIdentity?>> ReplaceCommunityAssetsAsync(string folder, CommunityPackage expected, IReadOnlyDictionary<string, byte[]?> replacement, FileOperationTransaction? backup, CancellationToken cancellationToken)
    {
        using var lease = OpenCommunityDirectory(folder);
        var inputs = new List<CommunityAssetWrite>();
        try
        {
            foreach (var name in CommunityAssetNames)
            {
                var path = Path.Combine(folder, name);
                EnsureNotLinked(path);
                var original = expected.Assets[name];
                if (original is null)
                {
                    if (Path.Exists(path))
                    {
                        throw new VaultException("The plugin package changed externally: " + name, StatusCodes.Status409Conflict);
                    }

                    if (replacement[name] is not null)
                    {
                        var created = OpenCommunityFile(path, true, true, true);
                        inputs.Add(new CommunityAssetWrite(name, null, replacement[name], created, true));
                    }

                    continue;
                }

                var stream = replacement[name] is null ? OpenCommunityDeletableFile(path, true) : OpenCommunityFile(path, true);
                var input = new CommunityAssetWrite(name, original, replacement[name], stream);
                inputs.Add(input);
                var current = await ReadCommunityBoundedAsync(stream, CommunityAssetLimit(name), cancellationToken);
                var identity = CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle));
                if (!current.AsSpan().SequenceEqual(original) || expected.Identities[name] != identity)
                {
                    throw new VaultException("The plugin package changed externally: " + name, StatusCodes.Status409Conflict);
                }
            }

            if (backup is not null)
            {
                foreach (var input in inputs.Where(input => input.Original is not null))
                {
                    await WriteFileOperationBackupAsync(backup, input.Name + ".original", input.Original!, cancellationToken);
                }
            }

            foreach (var name in new[] { "main.js", "styles.css", "manifest.json" })
            {
                var input = inputs.FirstOrDefault(input => input.Name == name);
                if (input?.Replacement is null)
                {
                    continue;
                }

                input.Written = true;
                await WriteFileOperationBytesAsync(input.Stream, input.Replacement, cancellationToken);
            }

            cancellationToken.ThrowIfCancellationRequested();
            if (expected.Assets["styles.css"] is null && replacement["styles.css"] is null && Path.Exists(Path.Combine(folder, "styles.css")))
            {
                throw new VaultException("A stylesheet appeared externally while updating the plugin.", StatusCodes.Status409Conflict);
            }

            var identities = CommunityAssetNames.ToDictionary(name => name, _ => (CommunityIdentity?)null, StringComparer.Ordinal);
            foreach (var input in inputs.Where(input => input.Replacement is not null))
            {
                identities[input.Name] = CommunityIdentityOf(CommunityInformation(input.Stream.SafeFileHandle));
            }

            var removed = inputs.FirstOrDefault(input => input.Replacement is null);
            if (removed is not null)
            {
                MarkCommunityFileDeleted(removed.Stream);
            }

            return identities;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException or OperationCanceledException)
        {
            var failures = new List<Exception>();
            foreach (var input in inputs.AsEnumerable().Reverse())
            {
                try
                {
                    if (input.Created)
                    {
                        MarkCommunityFileDeleted(input.Stream);
                    }
                    else if (input.Written)
                    {
                        await WriteFileOperationBytesAsync(input.Stream, input.Original!, CancellationToken.None);
                    }
                }
                catch (Exception restoreException) when (restoreException is IOException or UnauthorizedAccessException or VaultException)
                {
                    failures.Add(restoreException);
                }
            }

            if (failures.Count > 0)
            {
                logger.LogError(new AggregateException(failures.Prepend(exception)), "Community plugin asset rollback failed in {Directory}", folder);
                throw new VaultException("The plugin update failed and could not restore every package asset. Newer foreign bytes were retained. Recovery copies are at: " + backup?.Directory, StatusCodes.Status500InternalServerError);
            }

            throw;
        }
        finally
        {
            var failures = new List<Exception>();
            foreach (var input in inputs)
            {
                try
                {
                    await input.Stream.DisposeAsync();
                }
                catch (Exception closeException) when (closeException is IOException or UnauthorizedAccessException)
                {
                    failures.Add(closeException);
                }
            }

            if (failures.Count > 0)
            {
                logger.LogError(new AggregateException(failures), "Community plugin asset handles could not be closed safely in {Directory}", folder);
                throw new VaultException("The plugin update could not finish closing its asset handles. Do not retry before inspecting the staged package and recovery copies at: " + backup?.Directory, StatusCodes.Status500InternalServerError);
            }
        }
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle OpenCommunityPathHandle(string path, uint access, uint sharing, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCommunityFileInformation(SafeFileHandle handle, out CommunityFileInformation information);

    [StructLayout(LayoutKind.Sequential)]
    private struct CommunityFileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
        public System.Runtime.InteropServices.ComTypes.FILETIME Access;
        public System.Runtime.InteropServices.ComTypes.FILETIME Write;
        public uint Volume;
        public uint SizeHigh;
        public uint SizeLow;
        public uint Links;
        public uint IndexHigh;
        public uint IndexLow;
    }

    private readonly record struct CommunityIdentity(uint Volume, uint High, uint Low);

    private sealed class CommunityDirectoryLease(SafeFileHandle handle, CommunityIdentity identity) : IDisposable
    {
        public CommunityIdentity Identity { get; } = identity;
        public void Dispose() => handle.Dispose();
    }

    private sealed class CommunityAssetWrite(string name, byte[]? original, byte[]? replacement, FileStream stream, bool created = false)
    {
        public string Name { get; } = name;
        public byte[]? Original { get; } = original;
        public byte[]? Replacement { get; } = replacement;
        public FileStream Stream { get; } = stream;
        public bool Created { get; } = created;
        public bool Written { get; set; }
    }
}
