using System.Text.Json;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    public async Task<VaultConfigurationDocument> ReadOriginalWorkspaceAsync(string? expectedRoot, CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            var path = CorePath("workspace");
            if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024)
            {
                throw new VaultException("The original workspace exceeds the supported 1 MiB size.", StatusCodes.Status413PayloadTooLarge);
            }
            return await ConfigurationDocumentAsync("workspace", cancellationToken);
        }
        catch (JsonException error)
        {
            throw new VaultException("The original workspace must contain valid JSON: " + error.Message, StatusCodes.Status422UnprocessableEntity);
        }
        finally { gate.Release(); }
    }
}
