using System.Text.Json;
using System.Text.Json.Serialization;

namespace RonSijm.Slopsidian.Services;

public sealed record VaultFileStat(long Ctime, long Mtime, long Size);
public sealed record VaultAdapterStat(string Type, long Ctime, long Mtime, long Size);
public sealed record VaultFile(string Path, string Name, string Basename, string Extension, VaultFileStat Stat);
public sealed record PluginManifest(string Id, string Name, string Version, string Description, bool IsDesktopOnly, string? Error = null);
public sealed record VaultSnapshot(string? Root, string Name, IReadOnlyList<VaultFile> Files, IReadOnlyList<PluginManifest> Plugins, IReadOnlyList<string>? Folders = null);
public sealed record VaultDocument(VaultFile File, string Content, string Version, bool HasBom = false);
public sealed record VaultConfigurationDocument(string Root, string Id, JsonElement Data, string? Version);
public sealed record WriteConfigurationRequest(string? Root, string? Version, JsonElement Data);
public sealed record VaultResource(string ContentType, string Base64);
public sealed record PluginSource(PluginManifest Manifest, string Code, string? Css);
public sealed record OpenVaultRequest(string Path);
public sealed record CreateVaultRequest(string Name, string ParentPath);
public sealed record BrowserVaultChoice(string Id, string Name);
public sealed record BrowserVaultState(bool Supported, IReadOnlyList<BrowserVaultChoice> Recent);
public sealed record WriteFileRequest(string Path, string Content, string? Version, string? Root = null);
public sealed record EditorStatus(string? Path, bool Dirty);
public sealed record CommandStatus(string Id, string Name, bool Enabled);
public sealed record PluginStatus(string Id, bool Loaded, bool HasSettings, string? Error);
public sealed record PluginRuntimeStatus(IReadOnlyList<PluginStatus> Plugins, IReadOnlyList<CommandStatus> Commands);
public sealed record NoteOpenRequest(string Path, bool NewTab);
public sealed record WorkspaceViewState(string Type, JsonElement? State = null, bool Pinned = false);
public sealed record WorkspaceNode(string Id, string Type, string? Direction = null, IReadOnlyList<WorkspaceNode>? Children = null, int CurrentTab = 0, WorkspaceViewState? State = null);
public sealed record WorkspaceSidebarState(double Width, bool Collapsed, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] WorkspaceNode? Root = null);
public sealed record WorkspaceLayout(int Version, WorkspaceNode Main, string Active, WorkspaceSidebarState? Left = null, WorkspaceSidebarState? Right = null, IReadOnlyDictionary<string, JsonElement>? Views = null);

public sealed class VaultException(string message, int statusCode = 400) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
