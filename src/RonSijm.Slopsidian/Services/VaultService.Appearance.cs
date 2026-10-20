using System.Security.Cryptography;
using System.Text;

namespace RonSijm.Slopsidian.Services;

public sealed record AppearanceAsset(string Root, string Path, string ContentType, string Base64, string Version, int Size);

public sealed partial class VaultService
{
    private const int AppearanceAssetBytes = 8 * 1024 * 1024;
    private static readonly Dictionary<string, string> AppearanceAssetTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".woff2"] = "font/woff2", [".woff"] = "font/woff", [".ttf"] = "font/ttf", [".otf"] = "font/otf",
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp", [".avif"] = "image/avif",
    };

    public async Task<AppearanceAsset> ReadAppearanceAssetAsync(string expectedRoot, string path, CancellationToken cancellationToken = default)
    {
        var parts = path.Split('/');
        var themeAsset = parts.Length >= 4 && parts.Length <= 10 && parts[0] == ".obsidian" && parts[1] == "themes";
        var snippetAsset = parts.Length >= 3 && parts.Length <= 9 && parts[0] == ".obsidian" && parts[1] == "snippets";
        if (!(themeAsset || snippetAsset) || parts.Skip(2).Any(part => part.StartsWith('.') || InvalidPathSegment(part)))
        {
            throw new VaultException("Appearance assets must be non-hidden files inside an installed theme folder or the snippets folder.");
        }

        if (!AppearanceAssetTypes.TryGetValue(System.IO.Path.GetExtension(path), out var contentType))
        {
            throw new VaultException("This appearance asset format is not supported. Use woff2, woff, ttf, otf, png, jpg, gif, webp or avif.", StatusCodes.Status415UnsupportedMediaType);
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireFileOperationRoot(expectedRoot);
            var fullPath = Resolve(path, allowHidden: true);
            if (!File.Exists(fullPath))
            {
                throw new VaultException("This appearance asset is missing: " + path, StatusCodes.Status404NotFound);
            }

            await using var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 8192, FileOptions.Asynchronous);
            if (stream.Length > AppearanceAssetBytes)
            {
                throw new VaultException("Each appearance asset must be at most 8 MiB.", StatusCodes.Status413PayloadTooLarge);
            }

            var bytes = new byte[checked((int)stream.Length)];
            await stream.ReadExactlyAsync(bytes, cancellationToken);
            if (!AppearanceAssetMagicMatches(contentType, bytes))
            {
                throw new VaultException("The resource content does not match its file extension: " + path, StatusCodes.Status415UnsupportedMediaType);
            }

            return new AppearanceAsset(RequireRoot(), path, contentType, Convert.ToBase64String(bytes), Convert.ToHexStringLower(SHA256.HashData(bytes)), bytes.Length);
        }
        finally
        {
            gate.Release();
        }
    }

    private static bool AppearanceAssetMagicMatches(string contentType, byte[] bytes)
    {
        bool At(int offset, string text) => bytes.Length >= offset + text.Length && Encoding.Latin1.GetBytes(text).AsSpan().SequenceEqual(bytes.AsSpan(offset, text.Length));
        return contentType switch
        {
            "font/woff2" => At(0, "wOF2"),
            "font/woff" => At(0, "wOFF"),
            "font/otf" => At(0, "OTTO"),
            "font/ttf" => At(0, "\0\u0001\0\0") || At(0, "true"),
            "image/png" => bytes.Length > 0 && bytes[0] == 0x89 && At(1, "PNG\r\n"),
            "image/jpeg" => bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            "image/gif" => At(0, "GIF87a") || At(0, "GIF89a"),
            "image/webp" => At(0, "RIFF") && At(8, "WEBP"),
            "image/avif" => At(4, "ftyp") && (At(8, "avif") || At(8, "avis")),
            _ => false,
        };
    }

    public async Task<AppearanceStylesheet> ReadAppearanceCssAsync(string expectedRoot, string path, CancellationToken cancellationToken = default)
    {
        var parts = path.Split('/');
        if (!(parts.Length == 4 && parts[0] == ".obsidian" &&         parts[1] == "themes" && (parts[3] == "theme.css" || parts[3] == "manifest.json")
            || parts.Length == 3 && parts[0] == ".obsidian" && parts[1] == "snippets" && parts[2].EndsWith(".css", StringComparison.OrdinalIgnoreCase)))
        {
            throw new VaultException("Only installed theme.css and top-level CSS snippet files can be loaded.");
        }

        var name = parts.Length == 4 ? parts[2] : parts[2][..^4];
        if (name.Length > 200 || InvalidPathSegment(name))
        {
            throw new VaultException("Use a theme or snippet name without hidden, reserved, traversal or invalid path characters.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireFileOperationRoot(expectedRoot);
            var fullPath = Resolve(path, allowHidden: true);
            if (!File.Exists(fullPath))
            {
                throw new VaultException("This appearance stylesheet is missing: " + path, StatusCodes.Status404NotFound);
            }

            // manifest.json is read only for its exact-byte review version; it is not CSS and is not decoded.
            var manifestOnly = parts.Length == 4 && parts[3] == "manifest.json";
            var limit = manifestOnly ? AppearanceThemeManifestBytes : 1024 * 1024;
            await using var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 8192, FileOptions.Asynchronous);
            if (stream.Length > limit)
            {
                throw new VaultException(manifestOnly ? "A theme manifest must be at most 64 KiB." : "Each appearance stylesheet must be at most 1 MiB.", StatusCodes.Status413PayloadTooLarge);
            }

            var bytes = new byte[checked((int)stream.Length)];
            await stream.ReadExactlyAsync(bytes, cancellationToken);
            string content;
            if (manifestOnly)
            {
                content = "";
            }
            else try
            {
                content = new UTF8Encoding(false, true).GetString(bytes);
            }
            catch (DecoderFallbackException)
            {
                throw new VaultException("Appearance CSS must be valid UTF-8 text.", StatusCodes.Status415UnsupportedMediaType);
            }

            return new AppearanceStylesheet(RequireRoot(), path, content, Convert.ToHexStringLower(SHA256.HashData(bytes)), bytes.Length);
        }
        finally
        {
            gate.Release();
        }
    }
}
