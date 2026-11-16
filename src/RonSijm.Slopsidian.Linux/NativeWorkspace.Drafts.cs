using System.Text;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed partial class NativeWorkspace
{
    public async Task<NativeTab> RecoverDraftAsync(NativeTabState draft, string newPath)
    {
        if (!orphanedDrafts.Contains(draft) || draft.Draft is null) { throw new InvalidOperationException("This draft is no longer awaiting recovery."); }
        if (string.IsNullOrWhiteSpace(newPath)) { throw new InvalidOperationException("Enter a new file path for the draft."); }
        if (System.IO.Path.GetExtension(newPath).Length == 0) { newPath += ".md"; }
        var root = RequireRoot();
        var epoch = VaultEpoch;
        var content = new UTF8Encoding(false, true).GetBytes(draft.Draft);
        if (draft.HasBom) { content = [0xef, 0xbb, 0xbf, .. content]; }
        var created = await vault.CreateBinaryAsync(new(newPath, Convert.ToBase64String(content), root), CancellationToken.None);
        RequireDraftSession(root, epoch);
        await RefreshAsync();
        RequireDraftSession(root, epoch);
        var tab = new NativeTab(new VaultDocument(created.File, draft.Draft, created.Version, draft.HasBom))
        {
            Caret = Math.Clamp(draft.Caret, 0, draft.Draft.Length),
            ScrollOffset = draft.ScrollOffset,
            Reading = draft.Reading,
            Pinned = draft.Pinned
        };
        tabs.Add(tab);
        ActiveTab = tab;
        orphanedDrafts.Remove(draft);
        FileObserved?.Invoke(newPath);
        return tab;
    }

    private void RequireDraftSession(string root, long epoch)
    {
        if (Snapshot.Root != root || VaultEpoch != epoch) { throw new InvalidOperationException("The vault changed after saving the recovered copy. Reopen its original vault to inspect the saved file."); }
    }

    public void DiscardOrphanedDraft(NativeTabState draft)
    {
        if (!orphanedDrafts.Remove(draft)) { throw new InvalidOperationException("This draft is no longer awaiting recovery."); }
    }
}
