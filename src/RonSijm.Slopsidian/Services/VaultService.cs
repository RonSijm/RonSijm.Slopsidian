using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService(ILogger<VaultService> logger, VaultWatch watch) : IVaultHost
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly Regex PluginId = new("^[a-zA-Z0-9][a-zA-Z0-9_-]*$", RegexOptions.CultureInvariant);
    private static readonly Regex ReservedName = new("^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\\.)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex WorkspaceId = new("^[a-zA-Z0-9_-]{1,64}$", RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions WorkspaceJson = new(JsonSerializerDefaults.Web) { WriteIndented = true, MaxDepth = 256 };
    private readonly SemaphoreSlim gate = new(1, 1);
    private string? root;

    public async Task<VaultSnapshot> OpenAsync(string path, CancellationToken cancellationToken = default)
    {
        var candidate = ExistingDirectory(path);
        await gate.WaitAsync(cancellationToken);
        try
        {
            EnsureNotLinked(candidate);
            var snapshot = Scan(candidate);
            watch.Select(candidate);
            root = candidate;
            logger.LogInformation("Opened vault {Vault}", candidate);
            return snapshot;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultSnapshot> CreateAsync(CreateVaultRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 255 || InvalidPathSegment(request.Name))
        {
            throw new VaultException("Enter a valid vault name without folder separators, hidden or reserved names, or trailing dots/spaces.");
        }

        var parent = ExistingDirectory(request.ParentPath);
        var candidate = Path.Combine(parent, request.Name);
        var temporary = Path.Combine(parent, ".slopsidian-new-" + Guid.NewGuid().ToString("N") + ".tmp");
        await gate.WaitAsync(cancellationToken);
        try
        {
            EnsureNotLinked(parent);
            if (Path.Exists(candidate))
            {
                throw new VaultException("A file or folder with that name already exists. Open an existing vault instead.", StatusCodes.Status409Conflict);
            }

            Directory.CreateDirectory(temporary);
            try
            {
                Directory.Move(temporary, candidate);
            }
            catch (IOException) when (Path.Exists(candidate))
            {
                throw new VaultException("A file or folder with that name already exists. Open an existing vault instead.", StatusCodes.Status409Conflict);
            }

            var snapshot = Scan(candidate);
            watch.Select(candidate);
            root = candidate;
            logger.LogInformation("Created vault {Vault}", candidate);
            return snapshot;
        }
        finally
        {
            try
            {
                if (Directory.Exists(temporary))
                {
                    Directory.Delete(temporary);
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(exception, "Cannot remove temporary vault directory {Path}", temporary);
            }

            gate.Release();
        }
    }

    public async Task<VaultSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (root is null)
            {
                return new VaultSnapshot(null, "No vault selected", [], []);
            }

            return Scan(root);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultDocument> ReadAsync(string path, CancellationToken cancellationToken = default, string? expectedRoot = null)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (expectedRoot is not null)
            {
                RequireCoreRoot(expectedRoot);
            }

            var fullPath = Resolve(path);
            if (!File.Exists(fullPath))
            {
                throw new VaultException("The requested file does not exist.", StatusCodes.Status404NotFound);
            }

            var bytes = await File.ReadAllBytesAsync(fullPath, cancellationToken);
            return Document(fullPath, bytes);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultResource> ReadResourceAsync(string path, string expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (!string.Equals(RequireRoot(), expectedRoot, StringComparison.Ordinal))
            {
                throw new VaultException("The selected vault changed before its image could be read.", StatusCodes.Status409Conflict);
            }

            var fullPath = Resolve(path);
            if (!File.Exists(fullPath))
            {
                throw new VaultException("The requested image does not exist.", StatusCodes.Status404NotFound);
            }

            var contentType = Path.GetExtension(fullPath).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".webp" => "image/webp",
                ".avif" => "image/avif",
                ".m4a" or ".mp4" => "audio/mp4",
                ".webm" => "audio/webm",
                ".ogg" => "audio/ogg",
                ".mp3" => "audio/mpeg",
                ".wav" => "audio/wav",
                _ => throw new VaultException("Reading view supports local raster images and M4A, WebM, Ogg, MP3 and WAV audio.", StatusCodes.Status415UnsupportedMediaType)
            };
            if (contentType.StartsWith("audio/", StringComparison.Ordinal) && new FileInfo(fullPath).Length > MaximumBinaryBytes) { throw new VaultException("Audio resources support files up to 16 MiB.", StatusCodes.Status413PayloadTooLarge); }
            var bytes = await File.ReadAllBytesAsync(fullPath, cancellationToken);
            if (contentType.StartsWith("audio/", StringComparison.Ordinal) && bytes.Length > MaximumBinaryBytes) { throw new VaultException("Audio resources support files up to 16 MiB.", StatusCodes.Status413PayloadTooLarge); }
            return new VaultResource(contentType, Convert.ToBase64String(bytes));
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultDocument> WriteAsync(WriteFileRequest request, bool create, CancellationToken cancellationToken = default)
    {
        if (request.Content is null)
        {
            throw new VaultException("File content must be a string.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            var fullPath = Resolve(request.Path);
            if (request.Root is not null)
            {
                RequireCoreRoot(request.Root);
            }

            var exists = File.Exists(fullPath);
            if (create && Path.Exists(fullPath))
            {
                throw new VaultException("A file already exists at that path.", StatusCodes.Status409Conflict);
            }

            if (!create && !exists)
            {
                throw new VaultException("The file was removed. Create a new note instead.", StatusCodes.Status404NotFound);
            }

            byte[] existing = [];
            if (!create)
            {
                if (request.Version is null)
                {
                    throw new VaultException("Saving an existing file requires its last-read version.", StatusCodes.Status428PreconditionRequired);
                }

                existing = await File.ReadAllBytesAsync(fullPath, cancellationToken);
                if (!string.Equals(Version(existing), request.Version, StringComparison.Ordinal))
                {
                    throw new VaultException("This file changed on disk. Your unsaved text is retained; reopen the file after resolving the conflict.", StatusCodes.Status409Conflict);
                }
            }

            var content = Utf8.GetBytes(request.Content);
            byte[] bytes = existing.AsSpan().StartsWith(Encoding.UTF8.Preamble)
                ? [.. Encoding.UTF8.Preamble, .. content]
                : content;
            await AtomicWriteAsync(fullPath, bytes, !create, cancellationToken);
            return Document(fullPath, bytes);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<PluginSource> GetPluginAsync(string id, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var folder = ResolvePlugin(id);
            var manifest = ReadManifest(folder);
            var code = Path.Combine(folder, "main.js");
            EnsureNotLinked(code);
            if (!File.Exists(code))
            {
                throw new VaultException("The plugin is missing main.js.", StatusCodes.Status404NotFound);
            }

            var css = Path.Combine(folder, "styles.css");
            EnsureNotLinked(css);
            var styles = File.Exists(css)
                ? await File.ReadAllTextAsync(css, cancellationToken)
                : null;
            return new PluginSource(manifest, await File.ReadAllTextAsync(code, cancellationToken), styles);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<JsonElement?> ReadPluginDataAsync(string id, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var path = Path.Combine(ResolvePlugin(id), "data.json");
            EnsureNotLinked(path);
            if (!File.Exists(path))
            {
                return null;
            }

            var json = await File.ReadAllTextAsync(path, cancellationToken);
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task WritePluginDataAsync(string id, JsonElement data, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var path = Path.Combine(ResolvePlugin(id), "data.json");
            EnsureNotLinked(path);
            await AtomicWriteAsync(path, Utf8.GetBytes(data.GetRawText()), true, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<WorkspaceLayout?> ReadWorkspaceAsync(CancellationToken cancellationToken = default, string? expectedRoot = null)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (expectedRoot is not null)
            {
                RequireCoreRoot(expectedRoot);
            }

            var path = WorkspacePath();
            if (!File.Exists(path))
            {
                return null;
            }

            var json = await File.ReadAllTextAsync(path, cancellationToken);
            var layout = JsonSerializer.Deserialize<WorkspaceLayout>(json, WorkspaceJson);
            if (layout is null)
            {
                throw new VaultException("The saved workspace must contain a layout.", StatusCodes.Status422UnprocessableEntity);
            }

            ValidateWorkspace(layout);
            return layout;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task WriteWorkspaceAsync(WorkspaceLayout layout, CancellationToken cancellationToken = default, string? expectedRoot = null)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (expectedRoot is not null)
            {
                RequireCoreRoot(expectedRoot);
            }

            ValidateWorkspace(layout);
            await AtomicWriteAsync(WorkspacePath(), JsonSerializer.SerializeToUtf8Bytes(layout, WorkspaceJson), true, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<WorkspaceLayout> ValidateWorkspaceAsync(WorkspaceLayout layout, string expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            ValidateWorkspace(layout);
            return layout;
        }
        finally
        {
            gate.Release();
        }
    }

    private string WorkspacePath()
    {
        var configuration = Path.Combine(RequireRoot(), ".obsidian");
        var path = Path.Combine(configuration, "vault-dotnet-workspace.json");
        EnsureNotLinked(configuration);
        EnsureNotLinked(path);
        return path;
    }

    private void ValidateWorkspace(WorkspaceLayout layout)
    {
        if (layout.Version != 1 || layout.Main is null || layout.Main.Type != "split")
        {
            throw new VaultException("The workspace must have version 1 and a root split.");
        }

        if (layout.Views is not null && layout.Views.Any(entry => string.IsNullOrWhiteSpace(entry.Key) || entry.Key.Length > 256 || entry.Key.Contains('\0') || entry.Value.ValueKind != JsonValueKind.Object))
        {
            throw new VaultException("Workspace view states need valid names and JSON object values.");
        }

        var identifiers = new HashSet<string>(StringComparer.Ordinal);
        var leaves = new HashSet<string>(StringComparer.Ordinal);
        void Visit(WorkspaceNode node, int depth = 0)
        {
            if (node is null || depth > 64 || identifiers.Count >= 4096 || string.IsNullOrWhiteSpace(node.Id) || !WorkspaceId.IsMatch(node.Id) || !identifiers.Add(node.Id))
            {
                throw new VaultException("Workspace items need unique valid identifiers.");
            }

            if (node.Dimension is { ValueKind: not JsonValueKind.Null } dimension
                && (dimension.ValueKind != JsonValueKind.Number || !dimension.TryGetDouble(out var size) || !double.IsFinite(size) || size <= 0 || size > 100))
            {
                throw new VaultException("Pane dimensions must be numbers greater than zero and at most 100.");
            }

            if (node.Type == "leaf")
            {
                if (node.Children is not null || node.State is null || string.IsNullOrWhiteSpace(node.State.Type) || node.State.Type.Length > 256 || node.State.Type.Any(char.IsControl))
                {
                    throw new VaultException("Workspace leaves need a valid view type and cannot contain children.");
                }

                if (node.State.State is { ValueKind: not (JsonValueKind.Object or JsonValueKind.Null) })
                {
                    throw new VaultException("View state must be a JSON object.");
                }

                if (node.State.State is { ValueKind: JsonValueKind.Object } data)
                {
                    ValidateViewData(data);
                }

                if (node.State.Type is "markdown" or "empty")
                {
                    string? file = null;
                    string? mode = null;
                    if (node.State.State is { ValueKind: JsonValueKind.Object } note)
                    {
                        foreach (var field in note.EnumerateObject().Where(field => field.Name is "file" or "mode"))
                        {
                            if (field.Value.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                            {
                                throw new VaultException("Markdown file paths and view modes must be text.");
                            }

                            if (field.Name == "file")
                            {
                                file = field.Value.GetString();
                            }
                            else
                            {
                                mode = field.Value.GetString();
                            }
                        }

                        if (node.State.Type == "markdown" && note.TryGetProperty("source", out var source) && source.ValueKind is not (JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null))
                        {
                            throw new VaultException("A Markdown view's source flag must be Boolean.");
                        }
                    }

                    if (mode is not (null or "source" or "preview"))
                    {
                        throw new VaultException("A Markdown view mode must be source or preview.");
                    }

                    if (node.State.Type == "markdown")
                    {
                        if (string.IsNullOrWhiteSpace(file))
                        {
                            throw new VaultException("A Markdown leaf needs a vault file path.");
                        }

                        _ = Resolve(file);
                        if (!string.Equals(Path.GetExtension(file), ".md", StringComparison.OrdinalIgnoreCase))
                        {
                            throw new VaultException("A Markdown leaf must refer to a Markdown file.");
                        }
                    }
                    else if (file is not null || mode == "preview")
                    {
                        throw new VaultException("An empty workspace leaf cannot contain a file or a reading view.");
                    }
                }

                leaves.Add(node.Id);
                return;
            }

            if (node.Children is not { Count: > 0 } || node.State is not null)
            {
                throw new VaultException("Workspace containers need at least one child and cannot contain a view state.");
            }

            if (node.Type == "tabs")
            {
                if (node.CurrentTab < 0 || node.CurrentTab >= node.Children.Count || node.Children.Any(child => child is null || child.Type != "leaf"))
                {
                    throw new VaultException("A tab group must contain leaves and a valid selected tab.");
                }
            }
            else if (node.Type != "split" || node.Direction is not ("vertical" or "horizontal") || node.Children.Any(child => child is null || child.Type is not ("tabs" or "split")))
            {
                throw new VaultException("A split needs a valid direction and tab-group or split children.");
            }

            foreach (var child in node.Children)
            {
                Visit(child, depth + 1);
            }
        }

        Visit(layout.Main);
        foreach (var sidebar in new[] { layout.Left, layout.Right })
        {
            if (sidebar is not null && (!double.IsFinite(sidebar.Width) || sidebar.Width < 160 || sidebar.Width > 600))
            {
                throw new VaultException("Sidebar widths must be between 160 and 600 pixels.");
            }

            if (sidebar?.Root is { } sideRoot)
            {
                if (sideRoot.Type != "split")
                {
                    throw new VaultException("A sidedock requires a root split.");
                }

                Visit(sideRoot);
            }
        }

        if (string.IsNullOrWhiteSpace(layout.Active) || !leaves.Contains(layout.Active))
        {
            throw new VaultException("The active workspace item must identify a leaf in this layout.");
        }
    }

    private static void ValidateViewData(JsonElement value, int depth = 0)
    {
        if (depth > 32 || value.ValueKind == JsonValueKind.Number && (!value.TryGetDouble(out var number) || !double.IsFinite(number)))
        {
            throw new VaultException("View state must contain finite JSON values within 32 levels of nesting.");
        }

        if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var field in value.EnumerateObject())
            {
                ValidateViewData(field.Value, depth + 1);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in value.EnumerateArray())
            {
                ValidateViewData(child, depth + 1);
            }
        }
    }

    private VaultSnapshot Scan(string directory)
    {
        var files = new List<VaultFile>();
        var folders = new List<string>();
        var pending = new Stack<string>();
        pending.Push(directory);
        while (pending.Count > 0)
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(pending.Pop()))
            {
                if (Path.GetFileName(entry).StartsWith('.'))
                {
                    continue;
                }

                EnsureNotLinked(entry);
                if (Directory.Exists(entry))
                {
                    folders.Add(Path.GetRelativePath(directory, entry).Replace('\\', '/'));
                    pending.Push(entry);
                }
                else
                {
                    files.Add(Describe(directory, entry));
                }
            }
        }

        var plugins = new List<PluginManifest>();
        var configuration = Path.Combine(directory, ".obsidian");
        var pluginDirectory = Path.Combine(configuration, "plugins");
        EnsureNotLinked(configuration);
        EnsureNotLinked(pluginDirectory);
        if (Directory.Exists(pluginDirectory))
        {
            foreach (var folder in Directory.EnumerateDirectories(pluginDirectory))
            {
                EnsureNotLinked(folder);
                try
                {
                    plugins.Add(ReadManifest(folder));
                }
                catch (Exception exception) when (exception is JsonException or VaultException or IOException or UnauthorizedAccessException)
                {
                    logger.LogWarning(exception, "Cannot read plugin manifest in {Directory}", folder);
                    var id = Path.GetFileName(folder);
                    plugins.Add(new PluginManifest(id, id, "", "", true, exception.Message));
                }
            }
        }

        return new VaultSnapshot(directory, Path.GetFileName(directory), files.OrderBy(file => file.Path, StringComparer.OrdinalIgnoreCase).ToArray(), plugins.OrderBy(plugin => plugin.Name, StringComparer.OrdinalIgnoreCase).ToArray(), folders.Order(StringComparer.OrdinalIgnoreCase).ToArray());
    }

    public async Task<VaultAdapterStat?> StatAdapterPathAsync(string expectedRoot, string path, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireFileOperationRoot(expectedRoot);
            var fullPath = Resolve(path, allowHidden: true, allowRoot: true);
            FileAttributes attributes;
            try
            {
                attributes = File.GetAttributes(fullPath);
            }
            catch (FileNotFoundException)
            {
                return null;
            }
            catch (DirectoryNotFoundException)
            {
                return null;
            }

            EnsureNotLinked(fullPath);
            FileSystemInfo info = (attributes & FileAttributes.Directory) != 0 ? new DirectoryInfo(fullPath) : new FileInfo(fullPath);
            var type = info is DirectoryInfo ? "folder" : "file";
            var size = info is FileInfo file ? file.Length : 0;
            return new VaultAdapterStat(type, new DateTimeOffset(info.CreationTimeUtc).ToUnixTimeMilliseconds(), new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(), size);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultAdapterListing> ListAdapterFolderAsync(string expectedRoot, string path, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var directory = RequireFileOperationRoot(expectedRoot);
            var fullPath = Resolve(path, allowHidden: true, allowRoot: true);
            ValidateFileOperationDirectory(fullPath);
            if (!Directory.Exists(fullPath))
            {
                throw new VaultException("The requested adapter folder does not exist.", StatusCodes.Status404NotFound);
            }

            var files = new List<string>();
            var folders = new List<string>();
            foreach (var entry in Directory.EnumerateFileSystemEntries(fullPath))
            {
                cancellationToken.ThrowIfCancellationRequested();
                EnsureNotLinked(entry);
                var relative = Path.GetRelativePath(directory, entry).Replace('\\', '/');
                if ((File.GetAttributes(entry) & FileAttributes.Directory) != 0)
                {
                    folders.Add(relative);
                }
                else
                {
                    files.Add(relative);
                }
            }

            return new VaultAdapterListing(files, folders);
        }
        finally
        {
            gate.Release();
        }
    }

    private string Resolve(string path, bool allowHidden = false, bool allowRoot = false)
    {
        var directory = RequireRoot();
        if (allowRoot && path is "" or "/")
        {
            EnsureNotLinked(directory);
            return directory;
        }

        if (string.IsNullOrWhiteSpace(path))
        {
            throw new VaultException("A relative vault file path is required.");
        }

        var segments = path.Replace('\\', '/').Split('/');
        if (Path.IsPathRooted(path) || segments.Any(segment => InvalidPathSegment(segment, allowHidden)))
        {
            throw new VaultException("Use a valid relative Windows vault path without hidden, reserved, or traversal segments.");
        }

        var result = directory;
        foreach (var segment in segments)
        {
            result = Path.Combine(result, segment);
            EnsureNotLinked(result);
        }

        return result;
    }

    private static bool InvalidPathSegment(string segment, bool allowHidden = false) => string.IsNullOrEmpty(segment) || segment is "." or ".." || !allowHidden && segment.StartsWith('.') || segment.EndsWith('.') || segment.EndsWith(' ') || ReservedName.IsMatch(segment) || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0;

    private static string ExistingDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path) || path.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
        {
            throw new VaultException("Select an existing folder using its absolute directory path.");
        }

        var candidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (!Directory.Exists(candidate))
        {
            throw new VaultException("The selected folder does not exist.", StatusCodes.Status404NotFound);
        }

        EnsureNotLinked(candidate);
        return candidate;
    }

    private string ResolvePlugin(string id)
    {
        if (!PluginId.IsMatch(id))
        {
            throw new VaultException("Invalid plugin identifier.");
        }

        var configuration = Path.Combine(RequireRoot(), ".obsidian");
        var plugins = Path.Combine(configuration, "plugins");
        var directory = Path.Combine(plugins, id);
        EnsureNotLinked(configuration);
        EnsureNotLinked(plugins);
        EnsureNotLinked(directory);
        if (!Directory.Exists(directory))
        {
            throw new VaultException("The plugin directory does not exist.", StatusCodes.Status404NotFound);
        }

        return directory;
    }

    private string RequireRoot()
    {
        if (root is null)
        {
            throw new VaultException("Open a vault first.", StatusCodes.Status409Conflict);
        }

        return root;
    }

    private static PluginManifest ReadManifest(string directory)
    {
        var path = Path.Combine(directory, "manifest.json");
        EnsureNotLinked(path);
        using var json = JsonDocument.Parse(File.ReadAllText(path));
        var manifest = json.RootElement;
        var id = RequiredString(manifest, "id");
        if (!PluginId.IsMatch(id) || !string.Equals(id, Path.GetFileName(directory), StringComparison.Ordinal))
        {
            throw new VaultException("The manifest id must be a valid identifier matching its plugin folder.");
        }

        var author = manifest.TryGetProperty("author", out var authorValue) && authorValue.ValueKind == JsonValueKind.String ? authorValue.GetString() : null;
        var authorUrl = manifest.TryGetProperty("authorUrl", out var authorUrlValue) && authorUrlValue.ValueKind == JsonValueKind.String ? authorUrlValue.GetString() : null;
        var minAppVersion = manifest.TryGetProperty("minAppVersion", out var minAppVersionValue) && minAppVersionValue.ValueKind == JsonValueKind.String ? minAppVersionValue.GetString() : null;
        return new PluginManifest(id, RequiredString(manifest, "name"), RequiredString(manifest, "version"), RequiredString(manifest, "description"), manifest.TryGetProperty("isDesktopOnly", out var desktopOnly) && desktopOnly.ValueKind == JsonValueKind.True, Author: author, AuthorUrl: authorUrl, MinAppVersion: minAppVersion);
    }

    private static string RequiredString(JsonElement manifest, string name)
    {
        if (manifest.ValueKind != JsonValueKind.Object || !manifest.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
        {
            throw new VaultException($"The plugin manifest is missing a valid {name}.");
        }

        return property.GetString()!;
    }

    private static void EnsureNotLinked(string path)
    {
        if (Path.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new VaultException("Symbolic links and junctions are not supported by this prototype: " + path);
        }
    }

    private static VaultFile Describe(string directory, string path)
    {
        var info = new FileInfo(path);
        var extension = info.Extension.TrimStart('.');
        return new VaultFile(Path.GetRelativePath(directory, path).Replace('\\', '/'), info.Name, Path.GetFileNameWithoutExtension(path), extension, new VaultFileStat(new DateTimeOffset(info.CreationTimeUtc).ToUnixTimeMilliseconds(), new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(), info.Length));
    }

    private VaultDocument Document(string path, byte[] bytes)
    {
        var offset = bytes.AsSpan().StartsWith(Encoding.UTF8.Preamble) ? 3 : 0;
        return new VaultDocument(Describe(RequireRoot(), path), Utf8.GetString(bytes, offset, bytes.Length - offset), Version(bytes), offset == 3);
    }

    private static string Version(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private async Task AtomicWriteAsync(string destination, byte[] bytes, bool overwrite, CancellationToken cancellationToken)
    {
        var parent = Path.GetDirectoryName(destination)!;
        Directory.CreateDirectory(parent);
        var temporary = Path.Combine(parent, ".vault-prototype-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            await File.WriteAllBytesAsync(temporary, bytes, cancellationToken);
            if (overwrite && File.Exists(destination))
            {
                File.Replace(temporary, destination, null);
            }
            else
            {
                File.Move(temporary, destination);
            }
        }
        finally
        {
            if (File.Exists(temporary))
            {
                try
                {
                    File.Delete(temporary);
                }
                catch (IOException exception)
                {
                    logger.LogWarning(exception, "Cannot remove temporary write file {Path}", temporary);
                }
            }
        }
    }
}
