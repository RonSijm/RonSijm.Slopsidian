using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

public sealed record InstallAppearanceThemeResource(string Path, string Base64, string? ExpectedVersion);
public sealed record InstallAppearanceThemeRequest(string? Root, string Name, string CssBase64, string ManifestBase64, string? ExpectedVersion, IReadOnlyList<InstallAppearanceThemeResource>? Resources = null, string? ExpectedManifestVersion = null);
public sealed record AppearanceThemeInstall(string Root, string Name, string Path, string Version, int Size, bool Updated, int Resources);

public sealed partial class VaultService
{
    private const int AppearanceThemeCssBytes = 1024 * 1024;
    private const int AppearanceThemeManifestBytes = 64 * 1024;
    private const int AppearanceThemeResourceTotalBytes = 16 * 1024 * 1024;

    private sealed record ThemeWrite(string Path, byte[] Bytes, byte[]? Previous, CommunityIdentity? Identity);

    /// <summary>
    /// Writes one reviewed theme.css, manifest.json and the exact supported relative font/image bundle its CSS references.
    /// The same size, import and resource policy as the actual-folder browser host is enforced; expected versions must still match.
    /// </summary>
    public async Task<AppearanceThemeInstall> InstallAppearanceThemeAsync(InstallAppearanceThemeRequest request, CancellationToken cancellationToken = default)
    {
        var name = request.Name;
        if (string.IsNullOrWhiteSpace(name) || name.Length > 200 || InvalidPathSegment(name))
        {
            throw new VaultException("Use a theme name without hidden, reserved, traversal or invalid path characters.");
        }

        var css = DecodeAppearanceThemeBytes(request.CssBase64, AppearanceThemeCssBytes, "theme.css");
        var manifest = DecodeAppearanceThemeBytes(request.ManifestBase64, AppearanceThemeManifestBytes, "manifest.json");
        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(css);
            if (text.Contains('\0'))
            {
                throw new VaultException("Appearance CSS must not contain null characters.", StatusCodes.Status415UnsupportedMediaType);
            }
        }
        catch (DecoderFallbackException)
        {
            throw new VaultException("Appearance CSS must be valid UTF-8 text.", StatusCodes.Status415UnsupportedMediaType);
        }

        var references = AppearanceCssPolicy.Urls(text).Select(AppearanceCssPolicy.Resource).Distinct(StringComparer.Ordinal).ToList();
        if (references.Count > AppearanceCssPolicy.ResourceCount || references.Select(path => path.ToLowerInvariant()).Distinct().Count() != references.Count)
        {
            throw new VaultException("A theme may use at most 64 distinct local resources, and their names must not differ only by case.", StatusCodes.Status415UnsupportedMediaType);
        }

        var resources = new Dictionary<string, (byte[] Bytes, string? Expected)>(StringComparer.Ordinal);
        long total = 0;
        foreach (var resource in request.Resources ?? [])
        {
            var relative = AppearanceCssPolicy.Resource(resource.Path ?? "");
            if (!resources.TryAdd(relative, default))
            {
                throw new VaultException("A theme resource was supplied more than once: " + relative, StatusCodes.Status400BadRequest);
            }

            if (!AppearanceAssetTypes.TryGetValue(System.IO.Path.GetExtension(relative), out var contentType))
            {
                throw new VaultException("This appearance resource format is not supported. Use woff2, woff, ttf, otf, png, jpg, gif, webp or avif.", StatusCodes.Status415UnsupportedMediaType);
            }

            var bytes = DecodeAppearanceThemeBytes(resource.Base64, AppearanceAssetBytes, relative);
            if (!AppearanceAssetMagicMatches(contentType, bytes))
            {
                throw new VaultException("The resource content does not match its file extension: " + relative, StatusCodes.Status415UnsupportedMediaType);
            }

            total += bytes.Length;
            if (total > AppearanceThemeResourceTotalBytes)
            {
                throw new VaultException("Theme resources exceed the 16 MiB total limit.", StatusCodes.Status413PayloadTooLarge);
            }

            resources[relative] = (bytes, resource.ExpectedVersion);
        }

        if (resources.Count != references.Count || references.Any(path => !resources.ContainsKey(path)))
        {
            throw new VaultException("The supplied resources must be exactly the relative files the theme CSS references.", StatusCodes.Status422UnprocessableEntity);
        }

        try
        {
            var offset = manifest.AsSpan().StartsWith(Encoding.UTF8.Preamble) ? Encoding.UTF8.Preamble.Length : 0;
            using var document = JsonDocument.Parse(manifest.AsMemory(offset), new JsonDocumentOptions { MaxDepth = 16 });
            if (document.RootElement.ValueKind != JsonValueKind.Object || document.RootElement.TryGetProperty("name", out var manifestName) && manifestName.ValueKind != JsonValueKind.String)
            {
                throw new VaultException("The theme manifest must be a JSON object with a text name.", StatusCodes.Status422UnprocessableEntity);
            }
        }
        catch (JsonException)
        {
            throw new VaultException("The theme manifest is not valid JSON.", StatusCodes.Status422UnprocessableEntity);
        }

        await gate.WaitAsync(cancellationToken);
        var written = new List<ThemeWrite>();
        var createdFolders = new List<string>();
        try
        {
            RequireFileOperationRoot(request.Root);
            var themeFolder = ".obsidian/themes/" + name + "/";
            var cssPath = Resolve(themeFolder + "theme.css", allowHidden: true);
            var manifestPath = Resolve(themeFolder + "manifest.json", allowHidden: true);
            var plan = new List<(string Path, byte[] Bytes, string? Expected, int Limit)>();
            foreach (var (relative, value) in resources.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                plan.Add((Resolve(themeFolder + relative, allowHidden: true), value.Bytes, value.Expected, AppearanceAssetBytes));
            }

            plan.Add((cssPath, css, request.ExpectedVersion, AppearanceThemeCssBytes));
            plan.Add((manifestPath, manifest, request.ExpectedManifestVersion, AppearanceThemeManifestBytes));
            var previous = new Dictionary<string, byte[]?>();
            foreach (var (path, _, expected, limit) in plan)
            {
                if (Directory.Exists(path))
                {
                    throw new VaultException("A folder already exists where a theme file would be written.", StatusCodes.Status409Conflict);
                }

                byte[]? before = null;
                if (File.Exists(path))
                {
                    if (new FileInfo(path).Length > limit)
                    {
                        throw new VaultException("An installed theme file exceeds the supported size; it was retained.", StatusCodes.Status413PayloadTooLarge);
                    }

                    before = await File.ReadAllBytesAsync(path, cancellationToken);
                }

                previous[path] = before;
                if ((before is null ? null : Version(before)) != expected)
                {
                    throw new VaultException("The installed theme changed after it was reviewed. Review it again; the existing files were retained.", StatusCodes.Status409Conflict);
                }
            }

            ThemeWrite? inflight = null;
            try
            {
                foreach (var (path, bytes, _, _) in plan)
                {
                    var before = previous[path];
                    if (before is not null && before.AsSpan().SequenceEqual(bytes))
                    {
                        continue;
                    }

                    var folder = System.IO.Path.GetDirectoryName(path)!;
                    for (var missing = folder; !Directory.Exists(missing); missing = System.IO.Path.GetDirectoryName(missing)!)
                    {
                        createdFolders.Add(missing);
                    }

                    inflight = new ThemeWrite(path, bytes, before, null);
                    CommunityIdentity? stagedIdentity = null;
                    await AtomicWriteAsync(path, bytes, before is not null, cancellationToken, before, before is null ? staged => stagedIdentity = CaptureThemeIdentity(staged) : null);
                    inflight = null;
                    written.Add(new ThemeWrite(path, bytes, before, stagedIdentity));
                }
            }
            catch (Exception exception)
            {
                // A write that failed or was refused may or may not have landed; without proven identity it is never rolled back.
                var uncertain = new List<string>();
                if (inflight is { } pending && written.All(write => write.Path != pending.Path) && Path.Exists(pending.Path))
                {
                    uncertain.Add(pending.Path + " (unconfirmed: it may be a foreign file or a partial write; retained)");
                }

                var failures = await RestoreAppearanceThemeAsync(written, createdFolders);
                failures.AddRange(uncertain);
                var cause = exception is WritePreconditionException
                    ? "The installed theme changed while saving."
                    : exception is VaultException vault ? vault.Message : "Installing the theme failed (" + exception.GetType().Name + ").";
                if (failures.Count > 0)
                {
                    logger.LogError(exception, "Theme install failed and rollback is incomplete");
                    throw new VaultException(cause + " Rollback is incomplete; newer or unverifiable files were retained and may need inspection: " + string.Join("; ", failures), StatusCodes.Status500InternalServerError);
                }

                if (exception is WritePreconditionException)
                {
                    throw new VaultException(cause + " Review it again; files written by this install were rolled back.", StatusCodes.Status409Conflict);
                }

                if (exception is IOException or UnauthorizedAccessException)
                {
                    throw new VaultException(cause + " Files written by this install were rolled back.", StatusCodes.Status500InternalServerError);
                }

                throw;
            }

            var resourceWrites = written.Count(write => write.Path != cssPath && write.Path != manifestPath);
            return new AppearanceThemeInstall(RequireRoot(), name, ".obsidian/themes/" + name + "/theme.css", Version(css), css.Length, previous[cssPath] is not null, resourceWrites);
        }
        finally
        {
            gate.Release();
        }
    }

    private CommunityIdentity? CaptureThemeIdentity(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        try
        {
            using var stream = OpenCommunityFile(path);
            return CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle));
        }
        catch (Exception exception) when (exception is VaultException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task<List<string>> RestoreAppearanceThemeAsync(List<ThemeWrite> written, List<string> createdFolders)
    {
        var failures = new List<string>();
        for (var index = written.Count - 1; index >= 0; index--)
        {
            var write = written[index];
            try
            {
                if (write.Previous is null)
                {
                    await DeleteOwnedThemeFileAsync(write);
                }
                else
                {
                    await AtomicWriteAsync(write.Path, write.Previous, true, CancellationToken.None, write.Bytes);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or VaultException)
            {
                logger.LogError(exception, "Theme install rollback failed at {Path}", write.Path);
                failures.Add(write.Path + " (" + (exception is VaultException ? exception.Message : "changed or locked; retained") + ")");
            }
        }

        foreach (var folder in createdFolders.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                if (Directory.Exists(folder) && (File.GetAttributes(folder) & FileAttributes.ReparsePoint) == 0 && !Directory.EnumerateFileSystemEntries(folder).Any())
                {
                    Directory.Delete(folder);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(exception, "Theme install could not remove its new folder {Path}", folder);
            }
        }

        return failures;
    }

    private static async Task DeleteOwnedThemeFileAsync(ThemeWrite write)
    {
        if (!Path.Exists(write.Path))
        {
            return;
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new VaultException("This platform cannot confirm the identity of a file this install created; it was retained.", StatusCodes.Status409Conflict);
        }

        await using var stream = OpenCommunityDeletableFile(write.Path);
        var current = await ReadCommunityBoundedAsync(stream, AppearanceAssetBytes + 1L, CancellationToken.None);
        if ((write.Identity is not { } identity || CommunityIdentityOf(CommunityInformation(stream.SafeFileHandle)) != identity) || !current.AsSpan().SequenceEqual(write.Bytes))
        {
            throw new VaultException(write.Identity is null
                ? "The identity of a file this install created could not be confirmed; it was retained."
                : "A newer file occupies a path this install created; it was retained.", StatusCodes.Status409Conflict);
        }

        MarkCommunityFileDeleted(stream);
    }

    private static byte[] DecodeAppearanceThemeBytes(string? value, int limit, string label)
    {
        if (value is null || value.Length > ((limit + 2) / 3) * 4 || !Regex.IsMatch(value, @"\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\z", RegexOptions.NonBacktracking))
        {
            throw new VaultException(label + " must be valid Base64 within its size limit.");
        }

        var bytes = Convert.FromBase64String(value);
        if (bytes.Length == 0 || bytes.Length > limit)
        {
            throw new VaultException(label + " must be non-empty and within " + limit / 1024 + " KiB.", StatusCodes.Status413PayloadTooLarge);
        }

        return bytes;
    }
}
