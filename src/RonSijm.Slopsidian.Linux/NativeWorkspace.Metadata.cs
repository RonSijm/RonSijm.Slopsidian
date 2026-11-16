using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed partial class NativeWorkspace
{
    private Dictionary<string, NativeMetadata> metadata = new Dictionary<string, NativeMetadata>();
    private readonly Dictionary<string, (string Text, NativeMetadata Value)> draftMetadata = new(StringComparer.Ordinal);
    public IReadOnlyList<MetadataIssue> MetadataErrors { get; private set; } = [];
    public IReadOnlyDictionary<string, NativeMetadata> Metadata => metadata;

    public async Task IndexAsync(CancellationToken cancellationToken = default)
    {
        var root = RequireRoot();
        var source = await vault.ReadMetadataDocumentsAsync(root, cancellationToken);
        var next = await Task.Run(() => source.Documents.ToDictionary(document => document.File.Path,
            document => NativeMetadata.Parse(document.File.Path, document.Content), StringComparer.Ordinal), cancellationToken);
        if (Snapshot.Root == root)
        {
            metadata = next;
            draftMetadata.Clear();
            MetadataErrors = source.Errors;
        }
    }

    public NativeMetadata MetadataFor(string path)
    {
        var open = tabs.FirstOrDefault(tab => tab.Path == path);
        if (open is not null)
        {
            if (draftMetadata.TryGetValue(path, out var cached) && cached.Text == open.Text) { return cached.Value; }
            var parsed = NativeMetadata.Parse(path, open.Text);
            draftMetadata[path] = (open.Text, parsed);
            return parsed;
        }
        return metadata.TryGetValue(path, out var result) ? result : NativeMetadata.Parse(path, "");
    }

    public IReadOnlyList<NativeLocation> Backlinks(string target)
    {
        var result = new List<NativeLocation>();
        foreach (var entry in Notes)
        {
            var references = MetadataFor(entry.Path).Links.Where(link => ResolveLinkTarget(entry.Path, link.Target, link.Markdown) == target);
            result.AddRange(references.Select(link => new NativeLocation(entry.Basename, entry.Path, link.Offset, link.Target)));
        }
        return result;
    }

    public string? ResolveLinkTarget(string sourcePath, string link, bool markdown = false)
    {
        var raw = link.Split('#', 2)[0];
        var decoded = (markdown ? Uri.UnescapeDataString(raw) : raw).Trim().Replace('\\', '/');
        var rooted = decoded.StartsWith('/');
        var target = decoded.TrimStart('/');
        if (target.Length == 0)
        {
            return sourcePath;
        }
        var path = System.IO.Path.HasExtension(target) ? target : target + ".md";
        var parent = System.IO.Path.GetDirectoryName(sourcePath)?.Replace('\\', '/') ?? "";
        var relative = System.IO.Path.GetRelativePath("/", System.IO.Path.GetFullPath(System.IO.Path.Combine("/", parent, path))).Replace('\\', '/');
        var explicitRelative = target.StartsWith("./", StringComparison.Ordinal) || target.StartsWith("../", StringComparison.Ordinal);
        VaultFile? file;
        if (rooted) { file = Snapshot.Files.FirstOrDefault(item => item.Path == path); }
        else if (explicitRelative) { file = Snapshot.Files.FirstOrDefault(item => item.Path == relative); }
        else if (target.Contains('/'))
        {
            file = Snapshot.Files.FirstOrDefault(item => item.Path == path) ?? Snapshot.Files.FirstOrDefault(item => item.Path == relative);
        }
        else
        {
            file = Snapshot.Files.FirstOrDefault(item => item.Path == relative) ?? Snapshot.Files.FirstOrDefault(item => item.Path == path);
        }
        if (file is not null)
        {
            return file.Path;
        }
        if (rooted || explicitRelative || target.Contains('/')) { return null; }
        var matches = Snapshot.Files.Where(item => item.Name == path || MetadataFor(item.Path).Aliases.Contains(target, StringComparer.Ordinal)).ToArray();
        return matches.Length == 1 ? matches[0].Path : null;
    }
}
