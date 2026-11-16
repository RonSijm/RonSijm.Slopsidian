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
        foreach (var note in Notes)
        {
            var document = await vault.ReadAsync(note.Path, expectedRoot: RequireRoot());
            var parsed = NativeMetadata.Parse(note.Path, document.Content);
            if (parsed.PropertyError is not null) { throw new InvalidOperationException("Correct the properties in " + note.Path + " before updating references."); }
            var nextSource = note.Path == oldPath ? newPath : note.Path;
            var changes = new Dictionary<int, (int Length, string Text)>();
            foreach (var link in parsed.Links)
            {
                var target = ResolveLinkTarget(note.Path, link.Target, link.Markdown);
                var movedRelative = nextSource != note.Path && link.Target.Split('#')[0].Length > 0 && !link.Target.StartsWith('/');
                if (target != oldPath && !movedRelative) { continue; }
                if (target is null) { throw new InvalidOperationException("Resolve this link before moving its note: " + link.Target); }
                var destination = target == oldPath ? newPath : target;
                var suffix = link.Target.Contains('#') ? link.Target[link.Target.IndexOf('#')..] : "";
                var replacement = link.Markdown ? MarkdownPath(nextSource, destination) : "/" + destination;
                if (!link.Markdown && !link.Target.Split('#')[0].EndsWith(".md", StringComparison.OrdinalIgnoreCase) && replacement.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) { replacement = replacement[..^3]; }
                if (link.TargetOffset < 0 || link.TargetLength <= 0) { throw new InvalidOperationException("This reference has no editable source range: " + link.Target); }
                changes[link.TargetOffset] = (link.TargetLength, replacement + suffix);
            }
            var updated = new StringBuilder(document.Content);
            foreach (var change in changes.OrderByDescending(pair => pair.Key))
            {
                updated.Remove(change.Key, change.Value.Length).Insert(change.Key, change.Value.Text);
            }
            if (changes.Count > 0) { edits.Add(new VaultFileEdit(note.Path, document.Version, updated.ToString())); }
        }
        return edits;
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
