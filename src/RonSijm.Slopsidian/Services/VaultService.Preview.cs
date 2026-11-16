namespace RonSijm.Slopsidian.Services;

public sealed record VaultPreviewDocument(VaultFile File, byte[] Bytes, string Version);

public sealed partial class VaultService
{
    /// <summary>Read a bounded preview through the same vault/path guards as document operations.</summary>
    public async Task<VaultPreviewDocument> ReadPreviewAsync(string path, string expectedRoot, int maximumBytes, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maximumBytes, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(maximumBytes, MaximumBinaryBytes);
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            var full = Resolve(path);
            await using var stream = OpenFileOperationStream(full, false);
            if (stream.Length > maximumBytes) { throw PreviewTooLarge(); }
            var bytes = await ReadPreviewBytesAsync(stream, maximumBytes, cancellationToken);
            return new VaultPreviewDocument(Describe(RequireRoot(), full), bytes, Version(bytes));
        }
        finally { gate.Release(); }
    }

    private static async Task<byte[]> ReadPreviewBytesAsync(FileStream stream, int maximumBytes, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream((int)Math.Min(stream.Length, maximumBytes));
        var buffer = new byte[Math.Min(maximumBytes + 1, 65536)];
        while (true)
        {
            // Read only one byte beyond the remaining allowance, even if the file grows.
            var available = Math.Min(buffer.Length, maximumBytes - (int)output.Length + 1);
            var count = await stream.ReadAsync(buffer.AsMemory(0, available), cancellationToken);
            if (count == 0) { return output.ToArray(); }
            if (output.Length + count > maximumBytes) { throw PreviewTooLarge(); }
            output.Write(buffer, 0, count);
        }
    }

    private static VaultException PreviewTooLarge() => new("This file is too large for the requested preview.", StatusCodes.Status413PayloadTooLarge);
}
