using System.Security.Cryptography;
using System.Text.Json;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    public async Task<VaultConfigurationDocument> ReadConfigurationAsync(string id, string? expectedRoot, CancellationToken cancellationToken = default)
    {
        ValidateConfigurationId(id);
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(expectedRoot);
            return await ConfigurationDocumentAsync(id, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<VaultConfigurationDocument> WriteConfigurationAsync(string id, WriteConfigurationRequest request, CancellationToken cancellationToken = default)
    {
        ValidateConfigurationId(id);
        if (request.Data.ValueKind != JsonValueKind.Object)
        {
            throw new VaultException("Vault configuration must be a JSON object.");
        }

        VaultJson.ValidateRoundTrip(request.Data);
        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(request.Root);
            var before = await ConfigurationDocumentAsync(id, cancellationToken);
            if (before.Version is not null && request.Version is null)
            {
                throw new VaultException("Saving existing configuration requires its last-read version.", StatusCodes.Status428PreconditionRequired);
            }

            if (before.Version != request.Version)
            {
                throw new VaultException("The configuration changed on disk. Reload it before saving; the existing file was retained.", StatusCodes.Status409Conflict);
            }

            var path = CorePath(id);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(request.Data, WorkspaceJson);
            byte[]? expectedBytes = null;
            if (File.Exists(path))
            {
                var current = await File.ReadAllBytesAsync(path, cancellationToken);
                expectedBytes = current;
                if (Convert.ToHexStringLower(SHA256.HashData(current)) != request.Version)
                {
                    throw new VaultException("The configuration changed while saving. Reload it before retrying.", StatusCodes.Status409Conflict);
                }

                if (current.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }))
                {
                    bytes = [0xef, 0xbb, 0xbf, .. bytes];
                }
            }

            try
            {
                await AtomicWriteAsync(path, bytes, before.Version is not null, cancellationToken, expectedBytes);
            }
            catch (WritePreconditionException)
            {
                throw new VaultException("The configuration changed while saving. Reload it before retrying; the existing file was retained.", StatusCodes.Status409Conflict);
            }
            return new VaultConfigurationDocument(RequireRoot(), id, request.Data.Clone(), Convert.ToHexStringLower(SHA256.HashData(bytes)));
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<VaultConfigurationDocument> ConfigurationDocumentAsync(string id, CancellationToken cancellationToken)
    {
        var path = CorePath(id);
        if (Directory.Exists(path))
        {
            throw new VaultException("The configuration path is a folder, not a file: " + id, StatusCodes.Status409Conflict);
        }

        if (!File.Exists(path))
        {
            return new VaultConfigurationDocument(RequireRoot(), id, JsonSerializer.SerializeToElement(new { }), null);
        }

        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        var offset = bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }) ? 3 : 0;
        using var document = JsonDocument.Parse(bytes.AsMemory(offset), new JsonDocumentOptions { MaxDepth = 256 });
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new VaultException("Vault configuration must contain a JSON object: " + id, StatusCodes.Status422UnprocessableEntity);
        }

        VaultJson.ValidateRoundTrip(document.RootElement);
        return new VaultConfigurationDocument(RequireRoot(), id, document.RootElement.Clone(), Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }

    private static void ValidateConfigurationId(string id)
    {
        if (id is not ("app" or "appearance" or "hotkeys" or "types" or "vault-dotnet-workspaces" or "vault-dotnet-recovery" or "vault-dotnet-web-history" or "vault-dotnet-web-filters") && !CorePlugins.Definitions.Any(definition => definition.Id == id))
        {
            throw new VaultException("Unsupported vault configuration: " + id, StatusCodes.Status404NotFound);
        }
    }
}
