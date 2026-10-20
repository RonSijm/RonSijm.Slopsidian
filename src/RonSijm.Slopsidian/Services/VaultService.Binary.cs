using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

public sealed record CreateBinaryRequest(string Path, string Base64, string? Root);
public sealed record VaultBinaryDocument(string Root, VaultFile File, string Base64, string Version);

public sealed partial class VaultService
{
    private const int MaximumBinaryBytes = 16 * 1024 * 1024;

    public async Task<VaultFileInfo> CreateBinaryAsync(CreateBinaryRequest request, CancellationToken cancellationToken)
    {
        if (request.Base64 is null || request.Base64.Length > ((MaximumBinaryBytes + 2) / 3) * 4 || !Regex.IsMatch(request.Base64, @"\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\z", RegexOptions.NonBacktracking))
        {
            throw new VaultException("Binary content must be valid Base64 within 16 MiB.");
        }
        var bytes = Convert.FromBase64String(request.Base64);
        if (bytes.Length > MaximumBinaryBytes || Convert.ToBase64String(bytes) != request.Base64)
        {
            throw new VaultException("Invalid or oversized Base64 binary content.");
        }
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(request.Root);
            var path = Resolve(request.Path);
            if (Path.Exists(path)) { throw new VaultException("A file or folder already exists at that path.", StatusCodes.Status409Conflict); }
            await AtomicWriteAsync(path, bytes, false, cancellationToken);
            return new VaultFileInfo(RequireRoot(), Describe(RequireRoot(), path), Version(bytes));
        }
        finally { gate.Release(); }
    }

    public async Task<VaultBinaryDocument> ReadBinaryAsync(string path, string root, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(root);
            var full = Resolve(path);
            if (!File.Exists(full)) { throw new VaultException("The requested binary file does not exist.", StatusCodes.Status404NotFound); }
            if (new FileInfo(full).Length > MaximumBinaryBytes) { throw new VaultException("Binary reads support files up to 16 MiB.", StatusCodes.Status413PayloadTooLarge); }
            var bytes = await File.ReadAllBytesAsync(full, cancellationToken);
            if (bytes.Length > MaximumBinaryBytes) { throw new VaultException("Binary reads support files up to 16 MiB.", StatusCodes.Status413PayloadTooLarge); }
            return new VaultBinaryDocument(RequireRoot(), Describe(RequireRoot(), full), Convert.ToBase64String(bytes), Version(bytes));
        }
        finally { gate.Release(); }
    }
}
