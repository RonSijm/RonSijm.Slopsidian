using Microsoft.Extensions.Logging.Abstractions;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NoteResult(string Path, string Snippet = "")
{
    public string Name => System.IO.Path.GetFileNameWithoutExtension(Path);
    public bool HasSnippet => Snippet.Length > 0;
}

/// <summary>One native editor session. UI operations are serialized by the owning window.</summary>
public sealed class NativeWorkspace : IDisposable
{
    private readonly VaultWatch watch = new(NullLogger<VaultWatch>.Instance);
    private readonly VaultService vault;

    public NativeWorkspace() => vault = new(NullLogger<VaultService>.Instance, watch);

    public VaultSnapshot Snapshot { get; private set; } = new(null, "No vault selected", [], []);
    public VaultDocument? Document { get; private set; }
    public string Text { get; set; } = "";
    public bool IsDirty => Document is not null && !string.Equals(Text, Document.Content, StringComparison.Ordinal);
    public long Revision => watch.Revision;
    public IEnumerable<VaultFile> Notes => Snapshot.Files.Where(file => file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase));

    public async Task OpenVaultAsync(string directory)
    {
        RequireClean();
        var snapshot = await Task.Run(() => vault.OpenAsync(System.IO.Path.GetFullPath(directory)));
        Snapshot = snapshot;
        Document = null;
        Text = "";
    }

    public async Task OpenNoteAsync(string path)
    {
        RequireClean();
        if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a Markdown (.md) note.");
        var document = await vault.ReadAsync(path, expectedRoot: RequireRoot());
        Document = document;
        Text = document.Content;
    }

    public async Task SaveAsync()
    {
        var document = Document ?? throw new InvalidOperationException("Open a note before saving.");
        var text = Text;
        var saved = await vault.WriteAsync(new(document.File.Path, text, document.Version, RequireRoot()), false);
        Document = saved;
        // Text can change while the write is pending; those later edits stay dirty.
    }

    public async Task CreateNoteAsync(string path)
    {
        RequireClean();
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Enter a note name.");
        if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) path += ".md";
        var document = await vault.WriteAsync(new(path, "", null, RequireRoot()), true);
        Document = document;
        Text = document.Content;
        await RefreshAsync();
    }

    public async Task RefreshAsync() => Snapshot = await Task.Run(() => vault.GetSnapshotAsync());

    public void DiscardEdits() => Text = Document?.Content ?? "";

    public async Task<IReadOnlyList<NoteResult>> SearchAsync(string query, CancellationToken cancellationToken = default)
    {
        // Capture ownership before asynchronous reads. This never changes the editor document.
        var root = Snapshot.Root;
        var notes = Notes.ToArray();
        query = query.Trim();
        var results = new List<NoteResult>();
        foreach (var file in notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (query.Length == 0 || file.Path.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                results.Add(new(file.Path));
                continue;
            }
            // Avoid reading arbitrarily large attachments masquerading as notes on every search.
            if (file.Stat.Size > 4 * 1024 * 1024) continue;
            try
            {
                var content = Document?.File.Path == file.Path ? Text : (await vault.ReadAsync(file.Path, cancellationToken, root)).Content;
                var index = content.IndexOf(query, StringComparison.OrdinalIgnoreCase);
                if (index < 0) continue;
                var start = Math.Max(0, index - 35);
                var snippet = content.Substring(start, Math.Min(120, content.Length - start)).Replace('\r', ' ').Replace('\n', ' ');
                results.Add(new(file.Path, snippet));
            }
            catch (VaultException exception) when (exception.StatusCode == 404) { /* A concurrently removed note is absent. */ }
        }
        return results;
    }

    public string ResolveNoteLink(string link)
    {
        var target = link.Split('#', 2)[0];
        if (target.Length == 0 && Document is not null) return Document.File.Path;
        var decoded = Uri.UnescapeDataString(target).Replace('\\', '/');
        var withExtension = decoded.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? decoded : decoded + ".md";
        // Ordinary Markdown links are relative to the current note; wiki links also allow vault paths/basenames.
        var parent = System.IO.Path.GetDirectoryName(Document?.File.Path ?? "")?.Replace('\\', '/') ?? "";
        var relative = System.IO.Path.GetRelativePath("/", System.IO.Path.GetFullPath(System.IO.Path.Combine("/", parent, withExtension))).Replace('\\', '/');
        var notes = Notes.ToArray();
        var exact = notes.FirstOrDefault(note => note.Path == relative) ?? notes.FirstOrDefault(note => note.Path == withExtension);
        if (exact is not null) return exact.Path;
        var matches = notes.Where(note => note.Name == withExtension).ToArray();
        return matches.Length == 1 ? matches[0].Path : throw new InvalidOperationException(matches.Length > 1
            ? "More than one note has this name. Open it from the file list."
            : "This note was not found. Refresh the vault or create the note.");
    }

    private string RequireRoot() => Snapshot.Root ?? throw new InvalidOperationException("Open a vault first.");
    private void RequireClean()
    {
        if (IsDirty) throw new InvalidOperationException("Save or discard the current changes first.");
    }
    public void Dispose() => watch.Dispose();
}
