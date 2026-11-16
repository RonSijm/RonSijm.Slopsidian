using System.Text;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed partial class NativeWorkspace
{
    public async Task RenameAsync(NativeTab tab, string newPath, bool updateLinks)
    {
        if (HasDirtyTabs) { throw new InvalidOperationException("Save all drafts before renaming files and updating references."); }
        if (newPath == tab.Path) { return; }
        var edits = updateLinks ? await RenameReferencesAsync(tab.Path, newPath) : [];
        var result = await vault.RenameFileAsync(new(RequireRoot(), tab.Path, newPath, tab.Document.Version, edits));
        Snapshot = result.Snapshot;
        foreach (var document in result.Documents)
        {
            var open = document.File.Path == result.NewPath ? tab : tabs.FirstOrDefault(item => item.Path == document.File.Path);
            open?.Reload(document);
        }
        draftMetadata.Clear();
        await IndexAsync();
    }

    private async Task<IReadOnlyList<VaultFileEdit>> RenameReferencesAsync(string oldPath, string newPath)
    {
        var edits = new List<VaultFileEdit>();
        foreach (var path in Notes.Select(note => note.Path))
        {
            var document = await vault.ReadAsync(path, expectedRoot: RequireRoot());
            var parsed = NativeMetadata.Parse(path, document.Content);
            if (parsed.PropertyError is not null) { throw new InvalidOperationException("Correct the properties in " + path + " before updating references."); }
            var nextSource = path == oldPath ? newPath : path;
            var updated = RewriteRenameReferences(document, parsed.Links, nextSource, oldPath, newPath);
            if (updated != document.Content) { edits.Add(new VaultFileEdit(path, document.Version, updated)); }
        }
        return edits;
    }

    private string RewriteRenameReferences(VaultDocument document, IReadOnlyList<NativeLink> links, string nextSource, string oldPath, string newPath)
    {
        var changes = new Dictionary<int, (int Length, string Text)>();
        foreach (var link in links)
        {
            var replacement = RenameLinkReplacement(document.File.Path, nextSource, link, oldPath, newPath);
            if (replacement is null) { continue; }
            if (link.TargetOffset < 0 || link.TargetLength <= 0) { throw new InvalidOperationException("This reference has no editable source range: " + link.Target); }
            changes[link.TargetOffset] = (link.TargetLength, replacement);
        }
        var updated = new StringBuilder(document.Content);
        foreach (var change in changes.OrderByDescending(pair => pair.Key))
        {
            updated.Remove(change.Key, change.Value.Length).Insert(change.Key, change.Value.Text);
        }
        return updated.ToString();
    }

    private string? RenameLinkReplacement(string source, string nextSource, NativeLink link, string oldPath, string newPath)
    {
        var target = ResolveLinkTarget(source, link.Target, link.Markdown);
        var pathPart = link.Target.Split('#', 2)[0];
        var movedRelative = nextSource != source && pathPart.Length > 0 && !link.Target.StartsWith('/');
        if (target != oldPath && !movedRelative) { return null; }
        if (target is null) { throw new InvalidOperationException("Resolve this link before moving its note: " + link.Target); }
        var destination = target == oldPath ? newPath : target;
        var suffix = link.Target.Contains('#') ? link.Target[link.Target.IndexOf('#')..] : "";
        if (link.Markdown) { return MarkdownPath(nextSource, destination) + suffix; }
        var replacement = "/" + destination;
        if (!pathPart.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && replacement.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) { replacement = replacement[..^3]; }
        return replacement + suffix;
    }

    private static string MarkdownPath(string source, string destination)
    {
        var parent = System.IO.Path.GetDirectoryName(source) ?? "";
        var relative = System.IO.Path.GetRelativePath(System.IO.Path.Combine("/", parent), System.IO.Path.Combine("/", destination));
        return string.Join('/', relative.Split('/').Select(Uri.EscapeDataString));
    }

    public async Task TrashAsync(NativeTab tab)
    {
        if (tab.IsDirty) { throw new InvalidOperationException("Save or discard this draft before moving it to trash."); }
        var result = await vault.TrashFileAsync(new(RequireRoot(), tab.Path, tab.Document.Version));
        Snapshot = result.Snapshot;
        CloseTab(tab);
        await IndexAsync();
    }
}
