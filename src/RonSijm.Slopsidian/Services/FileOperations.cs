namespace RonSijm.Slopsidian.Services;

public static class VaultFileOperationEndpoints
{
    public static IEndpointRouteBuilder MapVaultFileOperations(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/files/info", (string? root, string path, VaultService vault, CancellationToken cancellationToken) => vault.GetFileInfoAsync(root, path, cancellationToken));
        app.MapPost("/api/files/folders", (CreateVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/edit", (EditVaultFilesRequest request, VaultService vault, CancellationToken cancellationToken) => vault.EditFilesAsync(request, cancellationToken));
        app.MapPost("/api/files/rename", (RenameVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RenameFileAsync(request, cancellationToken));
        app.MapPost("/api/files/trash", (TrashVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.TrashFileAsync(request, cancellationToken));
        app.MapGet("/api/files/trash/list", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.ListTrashAsync(root, cancellationToken));
        app.MapGet("/api/files/trash/preview", (string? root, string path, string token, VaultService vault, CancellationToken cancellationToken) => vault.PreviewTrashAsync(root, path, token, cancellationToken));
        app.MapPost("/api/files/trash/review", (VaultTrashReviewRequest request, VaultService vault, CancellationToken cancellationToken) => vault.ReviewTrashRestoreAsync(request, cancellationToken));
        app.MapPost("/api/files/trash/restore", (VaultTrashRestoreRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RestoreTrashAsync(request, cancellationToken));
        app.MapPost("/api/files/system-trash", (SystemTrashVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.SystemTrashFileAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/system-trash", (SystemTrashVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.SystemTrashFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/delete", (DeleteVaultFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteFileAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/rename", (RenameVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.RenameFolderAsync(request, cancellationToken));
        app.MapPost("/api/files/folders/delete", (DeleteVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteFolderAsync(request, cancellationToken));
        app.MapPut("/api/binary", (ModifyBinaryRequest request, VaultService vault, CancellationToken cancellationToken) => vault.ModifyBinaryAsync(request, cancellationToken));
        return app;
    }
}
