using Microsoft.Win32;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace RonSijm.Slopsidian.Services;

public sealed record SystemTrashResult(string? RecycledPath, bool IdentityConfirmed);

public readonly record struct FileIdentity(ulong Volume, ulong IdLow, ulong IdHigh);

/// <summary>Moves one existing file or folder into the real Windows Recycle Bin through IFileOperation; never deletes permanently.</summary>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public static class SystemTrash
{
    private const string HoldVariable = "SLOPSIDIAN_TEST_SYSTEM_TRASH_HOLD";

    [StructLayout(LayoutKind.Sequential)]
    private struct FileIdInfo
    {
        public ulong Volume;
        public ulong IdLow;
        public ulong IdHigh;
    }

    public static FileIdentity? IdentityOf(Microsoft.Win32.SafeHandles.SafeFileHandle handle) =>
        GetFileInformationByHandleEx(handle, 18, out var info, (uint)Marshal.SizeOf<FileIdInfo>()) ? new FileIdentity(info.Volume, info.IdLow, info.IdHigh) : null;

    // Attribute-only access ignores sharing modes, and OPEN_REPARSE_POINT identifies a link itself instead of its target.
    public static Microsoft.Win32.SafeHandles.SafeFileHandle OpenIdentityHandle(string path) =>
        CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);

    public static FileIdentity? IdentityOfPath(string path)
    {
        using var handle = OpenIdentityHandle(path);
        return handle.IsInvalid ? null : IdentityOf(handle);
    }

    private const uint AllowUndo = 0x0040;
    private const uint Silent = 0x0004;
    private const uint NoConfirmation = 0x0010;
    private const uint NoErrorUi = 0x0400;
    private const uint RecycleOnDelete = 0x00080000;
    private const uint RecycleIfPossible = 0x80;
    private const int Abort = unchecked((int)0x80004004);
    private const uint FileSystemPath = 0x80058000;

    /// <summary>
    /// Recycles <paramref name="path"/>. <paramref name="verify"/> receives the path being committed and returns a refusal reason or null; it runs
    /// immediately before the shell starts and again inside the shell's pre-delete callback. <paramref name="expected"/> is the checked item's identity.
    /// A window between that last check and the shell's rename remains; the recycled item is re-identified afterwards and a mismatch is reported.
    /// </summary>
    public static SystemTrashResult Move(string path, long bytes, FileIdentity expected, Func<string, string?> verify)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new VaultException("System trash is only available in the Windows native host.", StatusCodes.Status501NotImplemented);
        }

        if (!Path.IsPathFullyQualified(path) || path.Contains('\0'))
        {
            throw new VaultException("This path cannot be sent to the Windows Recycle Bin. Nothing was moved.");
        }

        RequireRecycleBinEligibility(path, bytes);
        HoldForTests();
        var refusal = verify(path);
        if (refusal is not null)
        {
            throw new VaultException(refusal + " Nothing was moved to the Recycle Bin.", StatusCodes.Status409Conflict);
        }

        SystemTrashResult? result = null;
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                result = Recycle(path, verify);
            }
            catch (Exception exception)
            {
                failure = exception;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join();
        if (failure is VaultException vault)
        {
            throw vault;
        }

        if (failure is not null)
        {
            var code = failure.HResult;
            throw new VaultException("The Windows Recycle Bin could not accept this item (" + new Win32Exception(code & 0xFFFF).Message + ", 0x" + code.ToString("X8") + "). Reload the vault to confirm its state.", code == unchecked((int)0x80070005) ? StatusCodes.Status403Forbidden : StatusCodes.Status409Conflict);
        }

        var recycled = result!;
        var identity = Environment.GetEnvironmentVariable("SLOPSIDIAN_TEST_SYSTEM_TRASH_HIDE_IDENTITY") == "1" ? null : IdentityOfPath(recycled.RecycledPath!);
        if (identity is null)
        {
            throw new VaultException("The item left the vault and the shell reported the Recycle Bin item '" + recycled.RecycledPath + "', but its identity could not be read back to confirm it is the checked item. The outcome is unconfirmed: nothing was retried or overwritten. Inspect the Recycle Bin item, restore it if it was not intended, and reload the vault.", StatusCodes.Status409Conflict);
        }

        if (identity != expected)
        {
            throw new VaultException("A different item than the checked one was moved to the Recycle Bin ('" + recycled.RecycledPath + "'), most likely because it was replaced externally at the last moment. Restore it from the Recycle Bin if it was not intended, and reload the vault.", StatusCodes.Status409Conflict);
        }

        return recycled with { IdentityConfirmed = identity is not null };
    }

    // Test-only seam: lets a test replace the path inside the check-to-commit window deterministically.
    private static void HoldForTests()
    {
        var hold = Environment.GetEnvironmentVariable(HoldVariable);
        if (string.IsNullOrEmpty(hold))
        {
            return;
        }

        File.WriteAllText(hold + ".ready", "ready");
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (!File.Exists(hold + ".go") && DateTime.UtcNow < deadline)
        {
            Thread.Sleep(20);
        }
    }

    // Refuses when Windows is configured to bypass the Recycle Bin or the item exceeds its capacity, since the shell could otherwise delete permanently.
    private static void RequireRecycleBinEligibility(string path, long bytes)
    {
        var root = new StringBuilder(1024);
        if (!GetVolumePathNameW(path, root, root.Capacity))
        {
            throw new VaultException("The file's volume could not be inspected. Nothing was moved to the Recycle Bin.", StatusCodes.Status409Conflict);
        }

        if (new DriveInfo(root.ToString()).DriveType != DriveType.Fixed)
        {
            throw new VaultException("Only fixed local drives have a Recycle Bin. Nothing was moved; use vault trash instead.", StatusCodes.Status409Conflict);
        }

        var name = new StringBuilder(64);
        if (!GetVolumeNameForVolumeMountPointW(root.ToString(), name, name.Capacity))
        {
            throw new VaultException("The file's volume could not be identified. Nothing was moved to the Recycle Bin.", StatusCodes.Status409Conflict);
        }

        var guid = name.ToString().TrimEnd('\\').Replace("\\\\?\\Volume", string.Empty, StringComparison.OrdinalIgnoreCase);
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\" + guid);
        if (key?.GetValue("NukeOnDelete") is int nuke && nuke != 0)
        {
            throw new VaultException("Windows is set not to move files to the Recycle Bin on this drive. Nothing was moved; use vault trash instead.", StatusCodes.Status409Conflict);
        }

        if (key?.GetValue("MaxCapacity") is int capacity && capacity > 0 && bytes >= capacity * 1024L * 1024L)
        {
            throw new VaultException("The item is larger than this drive's Recycle Bin capacity. Nothing was moved; use vault trash instead.", StatusCodes.Status409Conflict);
        }
    }

    private static SystemTrashResult Recycle(string path, Func<string, string?> verify)
    {
        var operation = (IFileOperation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09"), true)!)!;
        var sink = new Sink(verify);
        try
        {
            operation.SetOperationFlags(AllowUndo | RecycleOnDelete | Silent | NoConfirmation | NoErrorUi);
            var itemId = typeof(IShellItem).GUID;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref itemId, out var item);
            try
            {
                operation.DeleteItem(item, sink);
            }
            finally
            {
                Marshal.ReleaseComObject(item);
            }

            try
            {
                operation.PerformOperations();
            }
            catch (Exception) when (sink.Refused)
            {
            }

            operation.GetAnyOperationsAborted(out var aborted);
            if (aborted || sink.Refused)
            {
                throw new VaultException((sink.Reason ?? "The Windows Recycle Bin refused the item.") + " It was left in place; no permanent deletion was allowed.", StatusCodes.Status409Conflict);
            }

            if (sink.Result < 0 || sink.RecycledPath is null)
            {
                throw new VaultException("Windows did not confirm a Recycle Bin item (0x" + sink.Result.ToString("X8") + "). Reload the vault to confirm its state; it may have been removed.", StatusCodes.Status500InternalServerError);
            }

            return new SystemTrashResult(sink.RecycledPath, false);
        }
        finally
        {
            Marshal.ReleaseComObject(operation);
        }
    }

    [ClassInterface(ClassInterfaceType.None)]
    private sealed class Sink(Func<string, string?> verify) : IFileOperationProgressSink
    {
        public bool Refused { get; private set; }
        public string? Reason { get; private set; }
        public int Result { get; private set; } = Abort;
        public string? RecycledPath { get; private set; }

        public void StartOperations() { }
        public void FinishOperations(int result) { }
        public void PreRenameItem(uint flags, IShellItem item, string name) { }
        public void PostRenameItem(uint flags, IShellItem item, string name, int result, IShellItem? created) { }
        public void PreMoveItem(uint flags, IShellItem item, IShellItem destination, string name) { }
        public void PostMoveItem(uint flags, IShellItem item, IShellItem destination, string name, int result, IShellItem? created) { }
        public void PreCopyItem(uint flags, IShellItem item, IShellItem destination, string name) { }
        public void PostCopyItem(uint flags, IShellItem item, IShellItem destination, string name, int result, IShellItem? created) { }

        public void PreDeleteItem(uint flags, IShellItem item)
        {
            if ((flags & RecycleIfPossible) == 0)
            {
                Refused = true;
                Reason = "The shell would delete this item permanently instead of recycling it.";
                Marshal.ThrowExceptionForHR(Abort);
            }

            string? reason;
            try
            {
                item.GetDisplayName(FileSystemPath, out var name);
                string? shellPath;
                try
                {
                    shellPath = Marshal.PtrToStringUni(name);
                }
                finally
                {
                    Marshal.FreeCoTaskMem(name);
                }

                reason = shellPath is null ? "The shell item has no file-system path." : verify(shellPath);
            }
            catch (Exception exception) when (exception is not VaultException)
            {
                reason = "The shell item could not be re-verified (" + exception.Message + ").";
            }
            catch (VaultException exception)
            {
                reason = exception.Message;
            }

            if (reason is not null)
            {
                Refused = true;
                Reason = reason;
                Marshal.ThrowExceptionForHR(Abort);
            }
        }

        public void PostDeleteItem(uint flags, IShellItem item, int result, IShellItem? created)
        {
            Result = result;
            if (result >= 0 && created is not null)
            {
                created.GetDisplayName(FileSystemPath, out var name);
                try
                {
                    RecycledPath = Marshal.PtrToStringUni(name);
                }
                finally
                {
                    Marshal.FreeCoTaskMem(name);
                }
            }
        }

        public void PreNewItem(uint flags, IShellItem destination, string name) { }
        public void PostNewItem(uint flags, IShellItem destination, string name, string template, uint attributes, int result, IShellItem? created) { }
        public void UpdateProgress(uint total, uint current) { }
        public void ResetTimer() { }
        public void PauseTimer() { }
        public void ResumeTimer() { }
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid id, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    [ComImport, Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOperationProgressSink
    {
        void StartOperations();
        void FinishOperations(int result);
        void PreRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name);
        void PostRenameItem(uint flags, IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem? created);
        void PreMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
        void PostMoveItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem? created);
        void PreCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
        void PostCopyItem(uint flags, IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, int result, IShellItem? created);
        void PreDeleteItem(uint flags, IShellItem item);
        void PostDeleteItem(uint flags, IShellItem item, int result, IShellItem? created);
        void PreNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name);
        void PostNewItem(uint flags, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string template, uint attributes, int result, IShellItem? created);
        void UpdateProgress(uint total, uint current);
        void ResetTimer();
        void PauseTimer();
        void ResumeTimer();
    }

    [ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOperation
    {
        void Advise(IFileOperationProgressSink sink, out uint cookie);
        void Unadvise(uint cookie);
        void SetOperationFlags(uint flags);
        void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)] string message);
        void SetProgressDialog(IntPtr dialog);
        void SetProperties(IntPtr properties);
        void SetOwnerWindow(IntPtr owner);
        void ApplyPropertiesToItem(IShellItem item);
        void ApplyPropertiesToItems(IntPtr items);
        void RenameItem(IShellItem item, [MarshalAs(UnmanagedType.LPWStr)] string name, IFileOperationProgressSink? sink);
        void RenameItems(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string name);
        void MoveItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string? name, IFileOperationProgressSink? sink);
        void MoveItems(IntPtr items, IShellItem destination);
        void CopyItem(IShellItem item, IShellItem destination, [MarshalAs(UnmanagedType.LPWStr)] string? name, IFileOperationProgressSink? sink);
        void CopyItems(IntPtr items, IShellItem destination);
        void DeleteItem(IShellItem item, IFileOperationProgressSink? sink);
        void DeleteItems(IntPtr items);
        void NewItem(IShellItem destination, uint attributes, [MarshalAs(UnmanagedType.LPWStr)] string name, [MarshalAs(UnmanagedType.LPWStr)] string? template, IFileOperationProgressSink? sink);
        void PerformOperations();
        void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)] out bool aborted);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(Microsoft.Win32.SafeHandles.SafeFileHandle file, int informationClass, out FileIdInfo information, uint size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumePathNameW(string path, StringBuilder volume, int length);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeNameForVolumeMountPointW(string mountPoint, StringBuilder volume, int length);
}
