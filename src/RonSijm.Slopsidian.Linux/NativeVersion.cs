using System.Reflection;

namespace RonSijm.Slopsidian.Linux;

internal static class NativeVersion
{
    public static string Current { get; } = typeof(NativeVersion).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
        .FirstOrDefault(attribute => attribute.Key == "LinuxClientVersion")?.Value ?? "development";
}
