using System.Text.Json.Serialization;

namespace RonSijm.Slopsidian.Services;

public sealed record CommunityPluginConfiguration(string Root, string? Version, IReadOnlyList<string> Enabled);
public sealed record WriteCommunityPluginConfigurationRequest(string? Root, [property: JsonRequired] string? Version, IReadOnlyList<string>? Enabled);
public sealed record InstalledCommunityPlugin(string Root, string Version, PluginManifest Manifest);
public sealed record CommunityPluginInstallRequest(string? Root, [property: JsonRequired] string? Version, string? ManifestBase64, string? CodeBase64, [property: JsonRequired] string? CssBase64);
public sealed record DeleteCommunityPluginRequest(string? Root, string? Version);
