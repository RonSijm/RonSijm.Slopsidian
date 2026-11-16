using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace RonSijm.Slopsidian.Services;

/// <summary>Device/inode identity using the architecture-independent Linux statx ABI.</summary>
[SupportedOSPlatform("linux")]
internal static class LinuxFileIdentity
{
    private const int AtCurrentDirectory = -100;
    private const int NoFollow = 0x100;
    private const int EmptyPath = 0x1000;
    private const uint RequiredMask = 0x101; // STATX_TYPE | STATX_INO

    internal static FileIdentity? OfPath(string path) =>
        StatxPath(AtCurrentDirectory, path, NoFollow, RequiredMask, out var information) == 0 ? Identity(information) : null;

    internal static FileIdentity? OfHandle(SafeFileHandle handle) =>
        StatxHandle(handle, "", EmptyPath | NoFollow, RequiredMask, out var information) == 0 ? Identity(information) : null;

    private static FileIdentity? Identity(Statx information)
    {
        if ((information.Mask & RequiredMask) != RequiredMask || (information.Mode & 0xf000) is not (0x8000 or 0x4000)) { return null; }
        return new FileIdentity(((ulong)information.DeviceMajor << 32) | information.DeviceMinor, information.Inode, 0);
    }

    // Offsets and total size are defined by the Linux UAPI, linux/stat.h.
    // https://man7.org/linux/man-pages/man2/statx.2.html
    [StructLayout(LayoutKind.Explicit, Size = 256)]
    private struct Statx
    {
        [FieldOffset(0)] public uint Mask;
        [FieldOffset(28)] public ushort Mode;
        [FieldOffset(32)] public ulong Inode;
        [FieldOffset(136)] public uint DeviceMajor;
        [FieldOffset(140)] public uint DeviceMinor;
    }

    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int StatxPath(int directory, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, out Statx information);

    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int StatxHandle(SafeFileHandle descriptor, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, out Statx information);
}
