using System.Text;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    private const int TrashRecoveryBytes = 1024 * 1024;
    private sealed record TrashTicket(string Root, VaultTrashEntry Entry, FileIdentity Identity, FileIdentity TrashIdentity, DateTime Created, long Sequence);
    private sealed class TrashReview(string root, string folder, FileIdentity rootIdentity, FileIdentity folderIdentity, Dictionary<string, (TrashTicket Ticket, VaultTrashRestoreItem Item)> items, long sequence)
    {
        public string Root = root, Folder = folder;
        public FileIdentity RootIdentity = rootIdentity, FolderIdentity = folderIdentity;
        public DateTime Created = DateTime.UtcNow;
        public long Sequence = sequence;
        public Dictionary<string, (TrashTicket Ticket, VaultTrashRestoreItem Item)> Items = items;
        public HashSet<string> Used = new(StringComparer.Ordinal);
    }
    private readonly Dictionary<string, TrashTicket> trashTickets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TrashReview> trashReviews = new(StringComparer.Ordinal);
    private long trashRecoveryOrder;

    private void PruneTrashRecovery()
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-10);
        foreach (var key in trashTickets.Where(pair => pair.Value.Created < cutoff).Select(pair => pair.Key).ToArray()) trashTickets.Remove(key);
        foreach (var key in trashReviews.Where(pair => pair.Value.Created < cutoff).Select(pair => pair.Key).ToArray()) trashReviews.Remove(key);
        foreach (var key in trashTickets.OrderBy(pair => pair.Value.Sequence).Take(Math.Max(0, trashTickets.Count - 4096)).Select(pair => pair.Key).ToArray()) trashTickets.Remove(key);
        foreach (var key in trashReviews.OrderBy(pair => pair.Value.Sequence).Take(Math.Max(0, trashReviews.Count - 128)).Select(pair => pair.Key).ToArray()) trashReviews.Remove(key);
    }
    private static VaultException TrashChanged(string message) => new(message + " Refresh vault trash and review again.", StatusCodes.Status409Conflict);
    private static FileIdentity TrashIdentity(string path)
    {
        if (!OperatingSystem.IsWindows()) throw new VaultException("Identity-bound native trash recovery is supported by the Windows host only.", StatusCodes.Status501NotImplemented);
        EnsureNotLinked(path);
        return SystemTrash.IdentityOfPath(path) ?? throw TrashChanged("The file or folder identity could not be verified.");
    }
    private TrashTicket RequireTrashTicket(string root, string path, string token)
    {
        PruneTrashRecovery();
        if (!trashTickets.TryGetValue(token, out var ticket) || ticket.Root != root || ticket.Entry.Path != path) throw TrashChanged("This trash entry is no longer the listed entry.");
        return ticket;
    }
    private async Task<VaultTrashPreview> ReadTrashTicketAsync(TrashTicket ticket, CancellationToken cancellationToken)
    {
        var root = RequireFileOperationRoot(ticket.Root);
        var path = Resolve(ticket.Entry.Path, true);
        if (TrashIdentity(Path.Combine(root, ".trash")) != ticket.TrashIdentity || TrashIdentity(path) != ticket.Identity) throw TrashChanged("The trash folder or note was replaced.");
        RequireFileOperationFile(path);
        await using var stream = OpenFileOperationStream(path, false);
        if (OperatingSystem.IsWindows() && SystemTrash.IdentityOf(stream.SafeFileHandle) != ticket.Identity) throw TrashChanged("The trash note was replaced before its checked handle opened.");
        var size = stream.Length; var mtime = new DateTimeOffset(File.GetLastWriteTimeUtc(stream.SafeFileHandle)).ToUnixTimeMilliseconds();
        if (size != ticket.Entry.Size || mtime != ticket.Entry.Mtime || size > TrashRecoveryBytes) throw TrashChanged("The listed trash note changed.");
        var bytes = await ReadFileOperationBytesAsync(stream, cancellationToken);
        try { var document = Document(path, bytes); return new(root, ticket.Entry, document.Content, document.Version, document.HasBom); }
        catch (DecoderFallbackException) { throw new VaultException("Only valid UTF-8 Markdown trash notes can be previewed or restored.", StatusCodes.Status422UnprocessableEntity); }
    }
    public async Task<VaultTrashListing> ListTrashAsync(string? expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var root = RequireFileOperationRoot(expectedRoot); var trash = Path.Combine(root, ".trash"); PruneTrashRecovery(); _ = TrashIdentity(root);
            EnsureNotLinked(trash);
            if (!Path.Exists(trash)) return new(root, [], 0, true);
            if (!Directory.Exists(trash)) throw TrashChanged("The vault .trash path is not a folder.");
            ValidateFileOperationDirectory(trash); var trashIdentity = TrashIdentity(trash);
            var entries = new List<VaultTrashEntry>(); var ignored = 0; var count = 0; var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in Directory.EnumerateFileSystemEntries(trash))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (++count > 4096) throw new VaultException("Vault trash has more than 4096 entries; no entries were changed.", StatusCodes.Status413PayloadTooLarge);
                var name = Path.GetFileName(path);
                if (!names.Add(name)) throw TrashChanged("Vault trash contains ambiguous case-insensitive names.");
                var attributes = File.GetAttributes(path);
                if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 || !string.Equals(Path.GetExtension(name), ".md", StringComparison.OrdinalIgnoreCase)) { ignored++; continue; }
                try { _ = Resolve(name); } catch (VaultException) { ignored++; continue; }
                var info = new FileInfo(path); if (info.Length > TrashRecoveryBytes) { ignored++; continue; }
                if (entries.Count >= 500) throw new VaultException("Vault trash contains more than 500 Markdown notes; no entries were changed.", StatusCodes.Status413PayloadTooLarge);
                var entry = new VaultTrashEntry(".trash/" + name, name, info.Length, new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(), Guid.NewGuid().ToString("N"));
                trashTickets[entry.Token] = new(root, entry, TrashIdentity(path), trashIdentity, DateTime.UtcNow, ++trashRecoveryOrder); entries.Add(entry);
            }
            PruneTrashRecovery(); return new(root, entries.OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase).ToArray(), ignored, true);
        }
        finally { gate.Release(); }
    }
    public async Task<VaultTrashPreview> PreviewTrashAsync(string? expectedRoot, string path, string token, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try { var root = RequireFileOperationRoot(expectedRoot); return await ReadTrashTicketAsync(RequireTrashTicket(root, path, token), cancellationToken); }
        finally { gate.Release(); }
    }
    public async Task<VaultTrashRestoreReview> ReviewTrashRestoreAsync(VaultTrashReviewRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var root = RequireFileOperationRoot(request.Root); PruneTrashRecovery();
            if (request.Entries is not { Count: >= 1 and <= 20 }) throw new VaultException("Select 1–20 listed Markdown trash notes.");
            var selectedFolder = request.Folder == "/" ? root : Resolve(request.Folder);
            ValidateFileOperationDirectory(selectedFolder);
            if (!Directory.Exists(selectedFolder)) throw TrashChanged("Choose an existing restore folder.");
            var items = new Dictionary<string, (TrashTicket, VaultTrashRestoreItem)>(StringComparer.Ordinal);
            var destinations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in request.Entries)
            {
                var ticket = RequireTrashTicket(root, entry.Path, entry.Token); var preview = await ReadTrashTicketAsync(ticket, cancellationToken);
                var destination = Path.Combine(selectedFolder, ticket.Entry.Name);
                if (items.ContainsKey(entry.Path) || !destinations.Add(destination)) throw new VaultException("The trash selection contains duplicate destinations.");
                ValidateFileOperationDestination(Resolve(ticket.Entry.Path, true), destination);
                items[entry.Path] = (ticket, new(entry.Path, FileOperationRelativePath(destination), preview.Version));
            }
            var token = Guid.NewGuid().ToString("N"); var relative = selectedFolder == root ? "/" : FileOperationRelativePath(selectedFolder);
            trashReviews[token] = new(root, relative, TrashIdentity(root), TrashIdentity(selectedFolder), items, ++trashRecoveryOrder);
            PruneTrashRecovery();
            return new(root, token, relative, items.Values.Select(value => value.Item2).ToArray());
        }
        finally { gate.Release(); }
    }
    public async Task<VaultTrashRestoreResult> RestoreTrashAsync(VaultTrashRestoreRequest request, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var root = RequireFileOperationRoot(request.Root); PruneTrashRecovery();
            if (!trashReviews.TryGetValue(request.Token, out var review) || review.Root != root || !review.Items.TryGetValue(request.Path, out var selected) || !review.Used.Add(request.Path)) throw TrashChanged("This restore review is expired, foreign or already consumed.");
            var destinationFolder = review.Folder == "/" ? root : Resolve(review.Folder);
            var source = Resolve(selected.Item.TrashPath, true); var destination = Resolve(selected.Item.NewPath);
            void Guard()
            {
                if (TrashIdentity(root) != review.RootIdentity || TrashIdentity(destinationFolder) != review.FolderIdentity || TrashIdentity(Path.Combine(root, ".trash")) != selected.Ticket.TrashIdentity || TrashIdentity(source) != selected.Ticket.Identity) throw TrashChanged("The reviewed restore source or destination folder was replaced.");
                ValidateFileOperationDestination(source, destination);
            }
            Guard(); var preview = await ReadTrashTicketAsync(selected.Ticket, cancellationToken);
            if (preview.Version != selected.Item.Version) throw TrashChanged("The reviewed trash bytes changed.");
            void MovedHandle(FileStream stream)
            {
                // A path can be replaced after the original stream closes for rename. Verify the
                // actual reopened moved handle, rather than accepting same-byte replacement files.
                if (!OperatingSystem.IsWindows()) throw new VaultException("Identity-bound native trash recovery is supported by the Windows host only.", StatusCodes.Status501NotImplemented);
                if (SystemTrash.IdentityOf(stream.SafeFileHandle) != selected.Ticket.Identity || TrashIdentity(destination) != selected.Ticket.Identity
                    || TrashIdentity(root) != review.RootIdentity || TrashIdentity(destinationFolder) != review.FolderIdentity
                    || TrashIdentity(Path.Combine(root, ".trash")) != selected.Ticket.TrashIdentity) throw TrashChanged("The actual moved note or its containing folder no longer has the reviewed identity.");
            }
            var result = await MoveFileOperationAsync(source, destination, selected.Item.Version, [], cancellationToken, Guard, MovedHandle);
            var document = result.Documents.FirstOrDefault(document => document.File.Path == selected.Item.NewPath);
            if (document is null || document.Version != selected.Item.Version) throw TrashChanged("The restored note acknowledgement could not be verified; inspect its current location before retrying.");
            return new(result.Snapshot, selected.Item.TrashPath, selected.Item.NewPath, document);
        }
        finally { gate.Release(); }
    }
}
