using System.Globalization;
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

        ValidateConfigurationData(request.Data);
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
            if (File.Exists(path))
            {
                var current = await File.ReadAllBytesAsync(path, cancellationToken);
                if (Convert.ToHexStringLower(SHA256.HashData(current)) != request.Version)
                {
                    throw new VaultException("The configuration changed while saving. Reload it before retrying.", StatusCodes.Status409Conflict);
                }

                if (current.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }))
                {
                    bytes = [0xef, 0xbb, 0xbf, .. bytes];
                }
            }

            await AtomicWriteAsync(path, bytes, before.Version is not null, cancellationToken);
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

        ValidateConfigurationData(document.RootElement);
        return new VaultConfigurationDocument(RequireRoot(), id, document.RootElement.Clone(), Convert.ToHexStringLower(SHA256.HashData(bytes)));
    }

    private static void ValidateConfigurationId(string id)
    {
        if (id is not ("app" or "appearance" or "types" or "vault-dotnet-workspaces" or "vault-dotnet-recovery" or "vault-dotnet-web-history") && !CorePlugins.Definitions.Any(definition => definition.Id == id))
        {
            throw new VaultException("Unsupported vault configuration: " + id, StatusCodes.Status404NotFound);
        }
    }

    private static void ValidateConfigurationData(JsonElement value, int depth = 0)
    {
        if (depth > 256)
        {
            throw new VaultException("Vault configuration exceeds the supported nesting limit.", StatusCodes.Status422UnprocessableEntity);
        }

        if (value.ValueKind == JsonValueKind.Number)
        {
            var raw = value.GetRawText();
            if (!value.TryGetDouble(out var number) || !double.IsFinite(number) || double.IsInteger(number) && Math.Abs(number) > 9007199254740991 || number == 0 && raw.TakeWhile(character => character is not ('e' or 'E')).Any(character => character is >= '1' and <= '9') || ConfigurationNumberIdentity(raw) != ConfigurationNumberIdentity(number.ToString("R", CultureInfo.InvariantCulture)))
            {
                throw new VaultException("Vault configuration contains a number that cannot safely round-trip through the editor; the original file was retained.", StatusCodes.Status422UnprocessableEntity);
            }
        }
        else if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in value.EnumerateObject())
            {
                ValidateConfigurationData(property.Value, depth + 1);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                ValidateConfigurationData(item, depth + 1);
            }
        }
    }

    private static string ConfigurationNumberIdentity(string value)
    {
        var parts = value.ToLowerInvariant().Split('e');
        var mantissa = parts[0];
        var dot = mantissa.IndexOf('.');
        var decimals = dot < 0 ? 0 : mantissa.Length - dot - 1;
        var digits = mantissa.Replace("-", "").Replace(".", "");
        var significant = digits.Trim('0');
        if (significant.Length == 0)
        {
            return "0";
        }

        var trailing = digits.Length - digits.TrimEnd('0').Length;
        var exponent = parts.Length == 2 ? long.Parse(parts[1], CultureInfo.InvariantCulture) : 0;
        var sign = mantissa.StartsWith('-') ? "-" : "";
        return sign + significant + "e" + (exponent - decimals + trailing).ToString(CultureInfo.InvariantCulture);
    }
}
