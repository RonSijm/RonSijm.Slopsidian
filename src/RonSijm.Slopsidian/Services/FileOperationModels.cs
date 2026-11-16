namespace RonSijm.Slopsidian.Services;

public sealed record VaultFileInfo(string Root, VaultFile File, string Version);
public sealed record CreateVaultFolderRequest(string? Root, string Path);
public sealed record VaultFileEdit(string Path, string? Version, string Content, bool Create = false);
public sealed record EditVaultFilesRequest(string? Root, IReadOnlyList<VaultFileEdit>? Edits);
public sealed record EditVaultFilesResult(VaultSnapshot Snapshot, IReadOnlyList<VaultDocument> Documents);
public sealed record RenameVaultFileRequest(string? Root, string Path, string NewPath, string? Version, IReadOnlyList<VaultFileEdit>? Edits = null);
public sealed record RenameVaultFileResult(VaultSnapshot Snapshot, string OldPath, string NewPath, IReadOnlyList<VaultDocument> Documents);
public sealed record TrashVaultFileRequest(string? Root, string Path, string? Version, IReadOnlyList<VaultFileEdit>? Edits = null);
public sealed record TrashVaultFileResult(VaultSnapshot Snapshot, string Path, string TrashPath, IReadOnlyList<VaultDocument> Documents);
public sealed record VaultTrashEntry(string Path, string Name, long Size, long Mtime, string Token);
public sealed record VaultTrashListing(string Root, IReadOnlyList<VaultTrashEntry> Entries, int Ignored, bool CanRestore);
public sealed record VaultTrashPreview(string Root, VaultTrashEntry Entry, string Content, string Version, bool HasBom);
public sealed record VaultTrashSelection(string Path, string Token);
public sealed record VaultTrashReviewRequest(string? Root, string Folder, IReadOnlyList<VaultTrashSelection>? Entries);
public sealed record VaultTrashRestoreItem(string TrashPath, string NewPath, string Version);
public sealed record VaultTrashRestoreReview(string Root, string Token, string Folder, IReadOnlyList<VaultTrashRestoreItem> Items);
public sealed record VaultTrashRestoreRequest(string? Root, string Token, string Path);
public sealed record VaultTrashRestoreResult(VaultSnapshot Snapshot, string TrashPath, string NewPath, VaultDocument Document);
public sealed record SystemTrashVaultFileRequest(string? Root, string Path, string? Version);
public sealed record SystemTrashVaultFileResult(VaultSnapshot Snapshot, string Path, string? RecycledPath);
public sealed record SystemTrashVaultFolderRequest(string? Root, string Path, IReadOnlyList<FolderManifestEntry>? Manifest);
public sealed record SystemTrashVaultFolderResult(VaultSnapshot Snapshot, string Path, string? RecycledPath, IReadOnlyList<string> Files);
public sealed record DeleteVaultFileRequest(string? Root, string Path, string? Version);
public sealed record DeleteVaultFileResult(VaultSnapshot Snapshot, string Path);

public sealed record FolderManifestEntry(string Path, string? Version);
public sealed record VaultFolderMove(string OldPath, string NewPath);
public sealed record RenameVaultFolderRequest(string? Root, string Path, string NewPath, IReadOnlyList<FolderManifestEntry>? Manifest, IReadOnlyList<VaultFileEdit>? Edits = null);
public sealed record RenameVaultFolderResult(VaultSnapshot Snapshot, string OldPath, string NewPath, IReadOnlyList<VaultDocument> Documents, IReadOnlyList<VaultFolderMove> Files);
public sealed record DeleteVaultFolderRequest(string? Root, string Path, IReadOnlyList<FolderManifestEntry>? Manifest);
public sealed record DeleteVaultFolderResult(VaultSnapshot Snapshot, string Path, IReadOnlyList<string> DeletedFiles, IReadOnlyList<string> DeletedFolders);
public sealed record ModifyBinaryRequest(string Path, string Base64, string? Root, string? Version);

