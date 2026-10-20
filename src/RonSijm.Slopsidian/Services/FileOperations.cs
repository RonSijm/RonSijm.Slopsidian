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
public sealed record DeleteVaultFileRequest(string? Root, string Path, string? Version);
public sealed record DeleteVaultFileResult(VaultSnapshot Snapshot, string Path);

public static class VaultFileOperationEndpoints
{
    public static IEndpointRouteBuilder MapVaultFileOperations(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/files/info", (string? root, string path, VaultService vault, CancellationToken cancellationToken) => vault.GetFileInfoAsync(root, path, cancellationToken));
        app.MapPost("/api/files/folders", (CreateVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/edit", (EditVaultFilesRequest request, VaultService vault, CancellationToken cancellationToken) => vault.EditFilesAsync(request, cancellationToken));
        app.MapPost("/api/files/rename", (RenameVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RenameFileAsync(request, cancellationToken));
        app.MapPost("/api/files/trash", (TrashVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.TrashFileAsync(request, cancellationToken));
        app.MapPost("/api/files/delete", (DeleteVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteFileAsync(request, cancellationToken));
        return app;
    }
}
