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

public static class VaultFileOperationEndpoints
{
    public static IEndpointRouteBuilder MapVaultFileOperations(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/files/info", (string? root, string path, VaultService vault, CancellationToken cancellationToken) => vault.GetFileInfoAsync(root, path, cancellationToken));
        app.MapPost("/api/files/folders", (CreateVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/edit", (EditVaultFilesRequest request, VaultService vault, CancellationToken cancellationToken) => vault.EditFilesAsync(request, cancellationToken));
        app.MapPost("/api/files/rename", (RenameVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RenameFileAsync(request, cancellationToken));
        app.MapPost("/api/files/trash", (TrashVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.TrashFileAsync(request, cancellationToken));
        app.MapPost("/api/files/system-trash", (SystemTrashVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.SystemTrashFileAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/system-trash", (SystemTrashVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.SystemTrashFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/delete", (DeleteVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteFileAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/rename", (RenameVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RenameFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/delete", (DeleteVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteFolderAsync(request, cancellationToken));
        app.MapPut("/api/binary", (ModifyBinaryRequest request, VaultService vault, CancellationToken cancellationToken) => vault.ModifyBinaryAsync(request, cancellationToken));
        return app;
    }
}
