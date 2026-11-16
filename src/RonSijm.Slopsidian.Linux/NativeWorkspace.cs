using System.Collections.ObjectModel;
using Microsoft.Extensions.Logging.Abstractions;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NoteResult(string Path, string Snippet = "", int Offset = 0)
{
    public string Name => System.IO.Path.GetFileNameWithoutExtension(Path);
    public bool HasSnippet => Snippet.Length > 0;
}

/// <summary>Vault ownership and independent editor drafts. The window serializes mutations.</summary>
public sealed partial class NativeWorkspace : IDisposable
{
    private readonly VaultWatch watch = new(NullLogger<VaultWatch>.Instance);
    private readonly VaultService vault;
    private readonly ObservableCollection<NativeTab> tabs = [];
    private readonly List<NativeTabState> orphanedDrafts = [];

    public NativeWorkspace()
    {
        vault = new VaultService(NullLogger<VaultService>.Instance, watch);
        Tabs = new ReadOnlyObservableCollection<NativeTab>(tabs);
    }

    public VaultService Vault => vault;
    public VaultSnapshot Snapshot { get; private set; } = new(null, "No vault selected", [], []);
    public ReadOnlyObservableCollection<NativeTab> Tabs { get; }
    public IReadOnlyList<NativeTabState> OrphanedDrafts => orphanedDrafts;
    public NativeTab? ActiveTab { get; private set; }
    public VaultDocument? Document => ActiveTab?.Document;
    public string Text
    {
        get => ActiveTab?.Text ?? "";
        set
        {
            if (ActiveTab is not null)
            {
                ActiveTab.Text = value;
            }
        }
    }
    public bool IsDirty => ActiveTab?.IsDirty ?? false;
    public bool HasDirtyTabs => tabs.Any(tab => tab.IsDirty);
    public long Revision => watch.Revision;
    public IEnumerable<VaultFile> Notes => Snapshot.Files.Where(file => file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase));

    public async Task OpenVaultAsync(string directory)
    {
        if (HasDirtyTabs)
        {
            throw new InvalidOperationException("Save or discard the open drafts before switching vaults.");
        }
        Snapshot = await Task.Run(() => vault.OpenAsync(System.IO.Path.GetFullPath(directory)));
        tabs.Clear();
        orphanedDrafts.Clear();
        metadata = new Dictionary<string, NativeMetadata>();
        draftMetadata.Clear();
        MetadataErrors = [];
        ActiveTab = null;
    }

    public async Task OpenNoteAsync(string path)
    {
        RequireClean();
        await OpenTabAsync(path);
    }

    public async Task<NativeTab> OpenTabAsync(string path)
    {
        var existing = tabs.FirstOrDefault(tab => tab.Path == path);
        if (existing is not null)
        {
            ActiveTab = existing;
            return existing;
        }
        var document = await vault.ReadAsync(path, expectedRoot: RequireRoot());
        var tab = new NativeTab(document);
        tabs.Add(tab);
        ActiveTab = tab;
        return tab;
    }

    public void Activate(NativeTab tab)
    {
        if (!tabs.Contains(tab))
        {
            throw new ArgumentException("The tab does not belong to this vault.", nameof(tab));
        }
        ActiveTab = tab;
    }

    public void CloseTab(NativeTab tab)
    {
        if (tab.IsDirty)
        {
            throw new InvalidOperationException("Save or discard this tab's draft before closing it.");
        }
        var index = tabs.IndexOf(tab);
        if (index < 0)
        {
            return;
        }
        tabs.RemoveAt(index);
        draftMetadata.Remove(tab.Path);
        if (ReferenceEquals(tab, ActiveTab))
        {
            ActiveTab = tabs.Count == 0 ? null : tabs[Math.Min(index, tabs.Count - 1)];
        }
    }

    public Task SaveAsync() => SaveTabAsync(ActiveTab ?? throw new InvalidOperationException("Open a note before saving."));

    public async Task SaveTabAsync(NativeTab tab)
    {
        if (!tabs.Contains(tab))
        {
            throw new InvalidOperationException("This tab is no longer open.");
        }
        var saved = await vault.WriteAsync(new WriteFileRequest(tab.Path, tab.Text, tab.Document.Version, RequireRoot()), false);
        tab.AcceptSaved(saved);
    }

    public async Task ReloadTabAsync(NativeTab tab, bool discardDraft = false)
    {
        var document = await vault.ReadAsync(tab.Path, expectedRoot: RequireRoot());
        if (tab.IsDirty && !discardDraft)
        {
            tab.ExternalChange = document.Version != tab.Document.Version;
            return;
        }
        if (document.Version != tab.Document.Version || discardDraft)
        {
            tab.Reload(document);
        }
    }

    public async Task CreateNoteAsync(string path)
    {
        RequireClean();
        await CreateTabAsync(path);
    }

    public async Task<NativeTab> CreateTabAsync(string path, string content = "")
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new InvalidOperationException("Enter a note name.");
        }
        if (System.IO.Path.GetExtension(path).Length == 0)
        {
            path += ".md";
        }
        var document = await vault.WriteAsync(new WriteFileRequest(path, content, null, RequireRoot()), true);
        var tab = new NativeTab(document);
        tabs.Add(tab);
        ActiveTab = tab;
        await RefreshAsync();
        return tab;
    }

    public async Task RefreshAsync() => Snapshot = await Task.Run(() => vault.GetSnapshotAsync());

    public void DiscardEdits()
    {
        if (ActiveTab is not null)
        {
            ActiveTab.Reload(ActiveTab.Document);
        }
    }

    public NativeSession CaptureSession()
    {
        var states = tabs.Select(tab => new NativeTabState(tab.Path, tab.Caret, tab.ScrollOffset, tab.Reading, tab.Pinned,
            tab.IsDirty ? tab.Text : null, tab.Document.Version)).ToArray();
        return new NativeSession(RequireRoot(), ActiveTab?.Path, states.Concat(orphanedDrafts).ToArray());
    }

    public async Task RestoreSessionAsync(NativeSession session)
    {
        if (session.Root != Snapshot.Root)
        {
            throw new InvalidOperationException("This workspace belongs to a different vault.");
        }
        foreach (var saved in session.Tabs)
        {
            if (tabs.Any(tab => tab.Path == saved.Path && tab.IsDirty)) { continue; }
            if (saved.Draft is not null) { orphanedDrafts.RemoveAll(draft => draft.Path == saved.Path); }
            if (Snapshot.Files.All(file => file.Path != saved.Path))
            {
                if (saved.Draft is not null)
                {
                    orphanedDrafts.Add(saved);
                }
                continue;
            }
            var tab = await OpenTabAsync(saved.Path);
            tab.Caret = Math.Clamp(saved.Caret, 0, saved.Draft?.Length ?? tab.Text.Length);
            tab.ScrollOffset = Math.Max(0, saved.ScrollOffset);
            tab.Reading = saved.Reading;
            tab.Pinned = saved.Pinned;
            if (saved.Draft is not null)
            {
                var changed = saved.Version != tab.Document.Version;
                tab.AcceptSaved(tab.Document with { Version = saved.Version });
                tab.Text = saved.Draft;
                tab.ExternalChange = changed;
            }
        }
        ActiveTab = tabs.FirstOrDefault(tab => tab.Path == session.Active) ?? tabs.FirstOrDefault();
    }

    public async Task<IReadOnlyList<NoteResult>> SearchAsync(string query, CancellationToken cancellationToken = default)
    {
        var root = Snapshot.Root;
        var notes = Notes.ToArray();
        var drafts = tabs.ToDictionary(tab => tab.Path, tab => tab.Text, StringComparer.Ordinal);
        query = query.Trim();
        var results = new List<NoteResult>();
        foreach (var file in notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (query.Length == 0 || file.Path.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                results.Add(new NoteResult(file.Path));
                continue;
            }
            if (file.Stat.Size > 4 * 1024 * 1024)
            {
                continue;
            }
            try
            {
                var content = drafts.TryGetValue(file.Path, out var draft) ? draft : (await vault.ReadAsync(file.Path, cancellationToken, root)).Content;
                var index = content.IndexOf(query, StringComparison.OrdinalIgnoreCase);
                if (index < 0)
                {
                    continue;
                }
                var start = Math.Max(0, index - 35);
                var snippet = content.Substring(start, Math.Min(120, content.Length - start)).Replace('\r', ' ').Replace('\n', ' ');
                results.Add(new NoteResult(file.Path, snippet, index));
            }
            catch (VaultException exception) when (exception.StatusCode == 404)
            {
                // A concurrently removed note is absent from the search result.
            }
        }
        return results;
    }

    public string ResolveNoteLink(string link)
    {
        var target = link.Split('#', 2)[0];
        if (target.Length == 0 && Document is not null)
        {
            return Document.File.Path;
        }
        var decoded = Uri.UnescapeDataString(target).Replace('\\', '/');
        var withExtension = decoded.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? decoded : decoded + ".md";
        var parent = System.IO.Path.GetDirectoryName(Document?.File.Path ?? "")?.Replace('\\', '/') ?? "";
        var relative = System.IO.Path.GetRelativePath("/", System.IO.Path.GetFullPath(System.IO.Path.Combine("/", parent, withExtension))).Replace('\\', '/');
        var notes = Notes.ToArray();
        var exact = notes.FirstOrDefault(note => note.Path == relative) ?? notes.FirstOrDefault(note => note.Path == withExtension);
        if (exact is not null)
        {
            return exact.Path;
        }
        var matches = notes.Where(note => note.Name == withExtension).ToArray();
        return matches.Length == 1 ? matches[0].Path : throw new InvalidOperationException(matches.Length > 1
            ? "More than one note has this name. Open it from the file list."
            : "This note was not found. Refresh the vault or create the note.");
    }

    private string RequireRoot() => Snapshot.Root ?? throw new InvalidOperationException("Open a vault first.");
    private void RequireClean()
    {
        if (IsDirty)
        {
            throw new InvalidOperationException("Save or discard the current changes first.");
        }
    }
    public void Dispose() => watch.Dispose();
}
