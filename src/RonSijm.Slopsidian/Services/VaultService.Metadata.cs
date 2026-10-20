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
            var markdown = Scan(directory).Files.Where(file => file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase)).ToArray();
            var results = new (VaultDocument? Document, Exception? Failure)[markdown.Length];
            // Keep error and document ordering deterministic while overlapping bounded file reads.
            await Parallel.ForEachAsync(Enumerable.Range(0, markdown.Length), new ParallelOptions
            {
                MaxDegreeOfParallelism = Math.Clamp(Environment.ProcessorCount * 2, 4, 16),
                CancellationToken = cancellationToken
            }, async (index, token) =>
            {
                try
                {
                    var path = Resolve(markdown[index].Path);
                    results[index] = (Document(path, await File.ReadAllBytesAsync(path, token)), null);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    results[index] = (null, exception);
                }
            });

            if (!string.Equals(RequireRoot(), directory, StringComparison.Ordinal))
            {
                throw new VaultException("The vault root changed while indexing. Refresh the index again.", StatusCodes.Status409Conflict);
            }

            var documents = new List<VaultDocument>(markdown.Length);
            var errors = new List<MetadataIssue>();
            for (var index = 0; index < markdown.Length; index++)
            {
                var (document, failure) = results[index];
                switch (failure)
                {
                    case null when document is not null:
                        documents.Add(document);
                        break;
                    case null:
                        throw new InvalidOperationException("A metadata read completed without a document or an error.");
                    case FileNotFoundException or DirectoryNotFoundException:
                        throw new VaultException("The vault changed while indexing " + markdown[index].Path + ". Refresh the index again.", StatusCodes.Status409Conflict);
                    case DecoderFallbackException:
                        logger.LogWarning(failure, "Cannot index non-UTF-8 Markdown file {Path}", markdown[index].Path);
                        errors.Add(new MetadataIssue(markdown[index].Path, "This Markdown file is not UTF-8 and could not be indexed."));
                        break;
                    default:
                        System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
                        break;
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
