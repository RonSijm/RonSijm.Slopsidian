using System.Text;

namespace RonSijm.Slopsidian.Services;

public sealed record VaultRevision(string Root, long Revision);
public sealed record MetadataIssue(string Path, string Message);
public sealed record MetadataDocuments(string Root, long Revision, IReadOnlyList<VaultDocument> Documents, IReadOnlyList<MetadataIssue> Errors);

public sealed partial class VaultService
{
    public async Task<VaultRevision> GetRevisionAsync(string? expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            var directory = RequireRoot();
            watch.RequireHealthy(directory);
            return new VaultRevision(directory, watch.Revision);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<MetadataDocuments> ReadMetadataDocumentsAsync(string? expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            var directory = RequireRoot();
            watch.RequireHealthy(directory);
            var revision = watch.Revision;
            var documents = new List<VaultDocument>();
            var errors = new List<MetadataIssue>();
            foreach (var file in Scan(directory).Files.Where(file => file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase)))
            {
                var path = Resolve(file.Path);
                try
                {
                    documents.Add(Document(path, await File.ReadAllBytesAsync(path, cancellationToken)));
                }
                catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
                {
                    throw new VaultException("The vault changed while indexing " + file.Path + ". Refresh the index again.", StatusCodes.Status409Conflict);
                }
                catch (DecoderFallbackException exception)
                {
                    logger.LogWarning(exception, "Cannot index non-UTF-8 Markdown file {Path}", file.Path);
                    errors.Add(new MetadataIssue(file.Path, "This Markdown file is not UTF-8 and could not be indexed."));
                }
            }

            return new MetadataDocuments(directory, revision, documents, errors);
        }
        finally
        {
            gate.Release();
        }
    }
}
