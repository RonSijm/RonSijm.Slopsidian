using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    private const int CommunityConfigurationLimit = 1024 * 1024;
    private const int CommunityTreeEntryLimit = 4096;
    private const long CommunityTreeByteLimit = 256L * 1024 * 1024;
    private static readonly string[] CommunityAssetNames = ["manifest.json", "main.js", "styles.css"];

    public async Task<CommunityPluginConfiguration> ReadCommunityPluginsAsync(string? expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(expectedRoot);
            using var rootLease = OpenCommunityDirectory(directory);
            var configuration = Path.Combine(directory, ".obsidian");
            using var configurationLease = Directory.Exists(configuration) ? OpenCommunityDirectory(configuration) : null;
            return (await ReadCommunityConfigurationAsync(cancellationToken)).Configuration;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<CommunityPluginConfiguration> WriteCommunityPluginsAsync(WriteCommunityPluginConfigurationRequest request, CancellationToken cancellationToken = default)
    {
        var enabled = ValidateCommunityEnabled(request.Enabled, false);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(request.Root);
            using var rootLease = OpenCommunityDirectory(directory);
            var configuration = Path.Combine(directory, ".obsidian");
            CreateFileOperationDirectories(configuration, [], cancellationToken);
            using var configurationLease = OpenCommunityDirectory(configuration);
            var before = await ReadCommunityConfigurationAsync(cancellationToken);
            if (!string.Equals(before.Configuration.Version, request.Version, StringComparison.Ordinal))
            {
                throw new VaultException("Community plugin enablement changed on disk. Reload it before saving; the original file was retained.", StatusCodes.Status409Conflict);
            }

            var bytes = JsonSerializer.SerializeToUtf8Bytes(enabled, WorkspaceJson);
            if (before.Bytes.AsSpan().StartsWith(Encoding.UTF8.Preamble))
            {
                bytes = [.. Encoding.UTF8.Preamble, .. bytes];
            }

            if (bytes.Length > CommunityConfigurationLimit)
            {
                throw new VaultException("Community plugin enablement exceeds 1 MiB.", StatusCodes.Status413PayloadTooLarge);
            }

            var path = CorePath("community-plugins");
            if (before.Configuration.Version is null)
            {
                try
                {
                    await AtomicWriteAsync(path, bytes, false, cancellationToken);
                }
                catch (IOException) when (Path.Exists(path))
                {
                    throw new VaultException("Community plugin enablement appeared while saving. Its original bytes were retained.", StatusCodes.Status409Conflict);
                }
            }
            else
            {
                await using var stream = OpenCommunityFile(path, true);
                var current = await ReadCommunityBoundedAsync(stream, CommunityConfigurationLimit, cancellationToken);
                if (Version(current) != request.Version)
                {
                    throw new VaultException("Community plugin enablement changed while saving. The original file was retained.", StatusCodes.Status409Conflict);
                }

                try
                {
                    await WriteFileOperationBytesAsync(stream, bytes, cancellationToken);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or OperationCanceledException)
                {
                    try
                    {
                        await WriteFileOperationBytesAsync(stream, current, CancellationToken.None);
                    }
                    catch (Exception restoreException) when (restoreException is IOException or UnauthorizedAccessException)
                    {
                        logger.LogError(new AggregateException(exception, restoreException), "Community plugin enablement rollback failed at {Path}", path);
                        throw new VaultException("Saving community plugin enablement failed and its original bytes could not be completely restored. Inspect: " + path, StatusCodes.Status500InternalServerError);
                    }

                    throw;
                }
            }

            return new CommunityPluginConfiguration(directory, Version(bytes), enabled);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<InstalledCommunityPlugin> ReadInstalledCommunityPluginAsync(string id, string? expectedRoot, CancellationToken cancellationToken = default)
    {
        ValidateCommunityId(id);
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(expectedRoot);
            using var rootLease = OpenCommunityDirectory(directory);
            var folder = CommunityPluginPath(id);
            using var configurationLease = OpenCommunityDirectory(Path.GetDirectoryName(Path.GetDirectoryName(folder)!)!);
            using var parentLease = OpenCommunityDirectory(Path.GetDirectoryName(folder)!);
            using var folderLease = OpenCommunityDirectory(folder);
            var package = await ReadCommunityPackageAsync(folder, id, cancellationToken);
            return new InstalledCommunityPlugin(directory, CommunityFingerprint(package.Assets), package.Manifest);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<(CommunityPluginConfiguration Configuration, byte[] Bytes)> ReadCommunityConfigurationAsync(CancellationToken cancellationToken)
    {
        var path = CorePath("community-plugins");
        ValidateFileOperationDirectory(Path.GetDirectoryName(path)!);
        var attributes = CommunityAttributes(path);
        if (attributes is not null && (attributes.Value & FileAttributes.Directory) != 0)
        {
            throw new VaultException("Community plugin enablement is a folder, not a file.", StatusCodes.Status409Conflict);
        }

        if (attributes is null)
        {
            return (new CommunityPluginConfiguration(RequireRoot(), null, []), []);
        }

        await using var stream = OpenCommunityFile(path);
        var bytes = await ReadCommunityBoundedAsync(stream, CommunityConfigurationLimit, cancellationToken);
        var text = CommunityText(bytes, "community-plugins.json");
        using var document = JsonDocument.Parse(text);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new VaultException("Community plugin enablement must contain an array of plugin identifiers.", StatusCodes.Status422UnprocessableEntity);
        }

        var values = new List<string>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            if (values.Count >= CommunityTreeEntryLimit || element.ValueKind != JsonValueKind.String)
            {
                throw new VaultException("Community plugin enablement must be an array of at most 4096 valid plugin identifiers.", StatusCodes.Status422UnprocessableEntity);
            }

            values.Add(element.GetString()!);
        }

        var enabled = ValidateCommunityEnabled(values, true);
        return (new CommunityPluginConfiguration(RequireRoot(), Version(bytes), enabled), bytes);
    }

    private static IReadOnlyList<string> ValidateCommunityEnabled(IReadOnlyList<string>? values, bool reading)
    {
        var status = reading ? StatusCodes.Status422UnprocessableEntity : StatusCodes.Status400BadRequest;
        if (values is null || values.Count > CommunityTreeEntryLimit)
        {
            throw new VaultException("Community plugin enablement must be an array of at most 4096 valid plugin identifiers.", status);
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        foreach (var id in values)
        {
            ValidateCommunityId(id, status);
            if (seen.Add(id))
            {
                result.Add(id);
            }
            else if (!reading)
            {
                throw new VaultException("Community plugin enablement must contain distinct identifiers.", status);
            }
        }

        return result;
    }

    private static void ValidateCommunityId(string? id, int status = StatusCodes.Status400BadRequest)
    {
        if (id is null || id.Length > 128 || !Regex.IsMatch(id, @"\A[a-zA-Z0-9][a-zA-Z0-9_-]*\z", RegexOptions.CultureInvariant) || ReservedName.IsMatch(id))
        {
            throw new VaultException("Invalid plugin identifier: use at most 128 letters, digits, hyphens or underscores, without Windows reserved names.", status);
        }
    }

    private string CommunityPluginPath(string id)
    {
        ValidateCommunityId(id);
        var folder = Path.Combine(RequireRoot(), ".obsidian", "plugins", id);
        ValidateFileOperationDirectory(folder);
        if (Directory.Exists(folder))
        {
            var actual = Directory.EnumerateDirectories(Path.GetDirectoryName(folder)!).FirstOrDefault(path => string.Equals(Path.GetFileName(path), id, StringComparison.OrdinalIgnoreCase));
            if (actual is null || !string.Equals(Path.GetFileName(actual), id, StringComparison.Ordinal))
            {
                throw new VaultException("The plugin folder's actual identifier must match the route and manifest exactly.", StatusCodes.Status422UnprocessableEntity);
            }
        }

        return folder;
    }

    private static int CommunityAssetLimit(string name) => name switch
    {
        "manifest.json" => 64 * 1024,
        "main.js" => 16 * 1024 * 1024,
        "styles.css" => 4 * 1024 * 1024,
        _ => throw new InvalidOperationException("Unknown community plugin package asset.")
    };

    private static byte[] DecodeCommunityAsset(string? value, string name)
    {
        var limit = CommunityAssetLimit(name);
        if (value is null || value.Length > ((limit + 2) / 3) * 4 || !Regex.IsMatch(value, @"\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\z", RegexOptions.NonBacktracking))
        {
            throw new VaultException(name + " must be canonical Base64 within its supported size.");
        }

        var bytes = Convert.FromBase64String(value);
        if (bytes.Length > limit || Convert.ToBase64String(bytes) != value)
        {
            throw new VaultException(name + " contains invalid or oversized Base64.");
        }

        _ = CommunityText(bytes, name);
        return bytes;
    }

    private static string CommunityText(byte[] bytes, string name)
    {
        try
        {
            var offset = bytes.AsSpan().StartsWith(Encoding.UTF8.Preamble) ? 3 : 0;
            return Utf8.GetString(bytes, offset, bytes.Length - offset);
        }
        catch (DecoderFallbackException)
        {
            throw new VaultException("The file is not valid UTF-8: " + name, StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static PluginManifest ParseCommunityManifest(byte[] bytes, string id)
    {
        using var document = JsonDocument.Parse(CommunityText(bytes, "manifest.json"));
        var manifest = document.RootElement;
        foreach (var name in new[] { "id", "name", "version", "description" })
        {
            if (manifest.ValueKind != JsonValueKind.Object || !manifest.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
            {
                throw new VaultException("The plugin manifest is missing a valid " + name + ".", StatusCodes.Status422UnprocessableEntity);
            }
        }

        if (RequiredString(manifest, "id") != id)
        {
            throw new VaultException("The manifest id must match its plugin folder.", StatusCodes.Status422UnprocessableEntity);
        }

        if (manifest.TryGetProperty("isDesktopOnly", out var desktop) && desktop.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new VaultException("The plugin manifest's isDesktopOnly value must be Boolean.", StatusCodes.Status422UnprocessableEntity);
        }

        string? Metadata(string key)
        {
            if (!manifest.TryGetProperty(key, out var value))
            {
                return null;
            }

            if (value.ValueKind != JsonValueKind.String)
            {
                throw new VaultException("The plugin manifest's " + key + " value must be text.", StatusCodes.Status422UnprocessableEntity);
            }

            return value.GetString();
        }

        return new PluginManifest(id, RequiredString(manifest, "name"), RequiredString(manifest, "version"), RequiredString(manifest, "description"), desktop.ValueKind == JsonValueKind.True, Author: Metadata("author"), AuthorUrl: Metadata("authorUrl"), MinAppVersion: Metadata("minAppVersion"));
    }

    private static string CommunityFingerprint(IReadOnlyDictionary<string, byte[]?> assets)
    {
        var css = assets["styles.css"];
        var cssVersion = css is null ? "missing" : Version(css);
        return Version(Encoding.ASCII.GetBytes(Version(assets["manifest.json"]!) + "." + Version(assets["main.js"]!) + "." + cssVersion));
    }

    private static async Task<byte[]> ReadCommunityBoundedAsync(FileStream stream, long limit, CancellationToken cancellationToken)
    {
        if (stream.Length > limit)
        {
            throw new VaultException("The community plugin file exceeds its supported size.", StatusCodes.Status413PayloadTooLarge);
        }

        var bytes = await ReadFileOperationBytesAsync(stream, cancellationToken);
        if (bytes.LongLength > limit)
        {
            throw new VaultException("The community plugin file exceeds its supported size.", StatusCodes.Status413PayloadTooLarge);
        }

        return bytes;
    }

    private static async Task<CommunityPackage> ReadCommunityPackageAsync(string folder, string id, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(folder))
        {
            throw new VaultException("The plugin directory does not exist.", StatusCodes.Status404NotFound);
        }

        var streams = new List<FileStream>();
        var assets = new Dictionary<string, byte[]?>(StringComparer.Ordinal);
        var identities = new Dictionary<string, CommunityIdentity?>(StringComparer.Ordinal);
        try
        {
            foreach (var name in CommunityAssetNames)
            {
                var path = Path.Combine(folder, name);
                EnsureNotLinked(path);
                var attributes = CommunityAttributes(path);
                if (attributes is not null && (attributes.Value & FileAttributes.Directory) != 0)
                {
                    throw new VaultException("A plugin package asset is a folder: " + name, StatusCodes.Status409Conflict);
                }

                if (attributes is null)
                {
                    if (name != "styles.css")
                    {
                        throw new VaultException("The plugin is missing " + name + ".", StatusCodes.Status404NotFound);
                    }

                    assets.Add(name, null);
                    identities.Add(name, null);
                    continue;
                }

                var stream = OpenCommunityFile(path);
                streams.Add(stream);
                var bytes = await ReadCommunityBoundedAsync(stream, CommunityAssetLimit(name), cancellationToken);
                _ = CommunityText(bytes, name);
                assets.Add(name, bytes);
                identities.Add(name, CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle)));
            }

            if (assets["styles.css"] is null && CommunityAttributes(Path.Combine(folder, "styles.css")) is not null)
            {
                throw new VaultException("The plugin package changed while being read.", StatusCodes.Status409Conflict);
            }

            return new CommunityPackage(assets, ParseCommunityManifest(assets["manifest.json"]!, id), identities);
        }
        finally
        {
            foreach (var stream in streams)
            {
                await stream.DisposeAsync();
            }
        }
    }

    private sealed record CommunityPackage(IReadOnlyDictionary<string, byte[]?> Assets, PluginManifest Manifest, IReadOnlyDictionary<string, CommunityIdentity?> Identities);
}
