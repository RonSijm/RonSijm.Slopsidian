using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public enum NativeCaptureResult { Added, Unchanged, Waiting }
public sealed record NativeRecoverySnapshot(string Id, string Path, long Timestamp, string Content, bool HasBom, string? SourceVersion, string Reason, string Fingerprint);

/// <summary>Preserves the existing client's versioned vault-dotnet-recovery history.</summary>
public sealed class NativeRecoveryHistory
{
    public const string ConfigurationId = "vault-dotnet-recovery";
    private const int FileLimit = 1024 * 1024;
    private const int TotalLimit = 32 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, MaxDepth = 256 };
    private static readonly Regex Identifier = new(@"\A[a-zA-Z0-9_-]{1,64}\z", RegexOptions.NonBacktracking);
    private static readonly Regex Version = new(@"\A[a-f0-9]{64}\z", RegexOptions.NonBacktracking);
    private static readonly Regex ForbiddenSegment = new(@"[<>:""\\|?*\x00-\x1f]|\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\z)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private readonly JsonObject data;
    private readonly JsonArray snapshots;
    private readonly List<NativeRecoverySnapshot> entries = [];

    public NativeRecoveryHistory(JsonElement document)
    {
        try
        {
            if (document.ValueKind != JsonValueKind.Object) { throw new InvalidDataException("File-recovery history must contain an object. Existing history was retained."); }
            data = JsonNode.Parse(document.GetRawText(), documentOptions: new JsonDocumentOptions { MaxDepth = 256 })?.AsObject()
                ?? throw new InvalidDataException("File-recovery history is empty.");
            if (!data.ContainsKey("version") && !data.ContainsKey("snapshots")) { data["version"] = 1; data["snapshots"] = new JsonArray(); }
            if (Number(data, "version").CompareTo(1) != 0 || data["snapshots"] is not JsonArray array || array.Count > 1000)
            {
                throw new InvalidDataException("Unsupported or damaged file-recovery history. Existing history was retained.");
            }
            snapshots = array;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in snapshots)
            {
                var entry = Read(node);
                Validate(entry);
                if (!ids.Add(entry.Id)) { throw new InvalidDataException("Recovery snapshot IDs must be unique."); }
                entries.Add(entry);
            }
            CheckSize();
        }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException or JsonException or OverflowException)
        {
            throw new InvalidDataException("File-recovery history is damaged. Existing history was retained.", exception);
        }
    }

    public IReadOnlyList<NativeRecoverySnapshot> GetEntries() => entries.Select((entry, index) => (entry, index)).OrderByDescending(item => item.entry.Timestamp).ThenByDescending(item => item.index).Select(item => item.entry).ToArray();
    public JsonElement Data => JsonSerializer.SerializeToElement(data, JsonOptions);

    public NativeCaptureResult Capture(VaultDocument document, DateTimeOffset now, double intervalMinutes, bool force = false, string reason = "auto")
    {
        ValidateOptions(intervalMinutes, 7);
        var timestamp = now.ToUnixTimeMilliseconds();
        var prior = GetEntries().FirstOrDefault(entry => entry.Path == document.File.Path);
        if (prior is not null && prior.Content == document.Content && prior.HasBom == document.HasBom) { return NativeCaptureResult.Unchanged; }
        if (!force && prior is not null && timestamp - prior.Timestamp < intervalMinutes * 60_000) { return NativeCaptureResult.Waiting; }
        var entry = new NativeRecoverySnapshot(Guid.NewGuid().ToString("N"), document.File.Path, timestamp, document.Content, document.HasBom, document.Version, reason, "");
        Validate(entry);
        var node = JsonSerializer.SerializeToNode(new { id = entry.Id, path = entry.Path, ts = entry.Timestamp, content = entry.Content, hasBom = entry.HasBom, sourceVersion = entry.SourceVersion, reason = entry.Reason }, JsonOptions);
        snapshots.Add(node);
        try { CheckSize(); }
        catch { snapshots.RemoveAt(snapshots.Count - 1); throw; }
        entries.Add(Read(node));
        return NativeCaptureResult.Added;
    }

    public int Prune(DateTimeOffset now, double keepDays)
    {
        ValidateOptions(0, keepDays);
        var cutoff = now.AddDays(-keepDays).ToUnixTimeMilliseconds();
        var removed = 0;
        for (var index = entries.Count - 1; index >= 0; index--)
        {
            if (entries[index].Timestamp >= cutoff) { continue; }
            entries.RemoveAt(index);
            snapshots.RemoveAt(index);
            removed++;
        }
        return removed;
    }

    public void Clear() { entries.Clear(); snapshots.Clear(); }

    public static void ValidateOptions(double intervalMinutes, double keepDays)
    {
        if (!double.IsFinite(intervalMinutes) || intervalMinutes is < 0 or > 10080 || !double.IsFinite(keepDays) || keepDays is < 1 or > 3650)
        {
            throw new InvalidDataException("Recovery interval must be 0–10080 minutes and retention must be 1–3650 days.");
        }
    }

    private void CheckSize()
    {
        if (snapshots.Count > 1000 || Encoding.UTF8.GetByteCount(data.ToJsonString(JsonOptions)) > TotalLimit)
        {
            throw new InvalidDataException("File recovery is full (1000 snapshots or 32 MiB). Review retention before adding snapshots.");
        }
    }

    private static void Validate(NativeRecoverySnapshot entry)
    {
        if (!Identifier.IsMatch(entry.Id) || entry.Timestamp is < 0 or > 8640000000000000 || !ValidPath(entry.Path)
            || Encoding.UTF8.GetByteCount(entry.Content) > FileLimit || entry.SourceVersion is not null && !Version.IsMatch(entry.SourceVersion)
            || string.IsNullOrWhiteSpace(entry.Reason) || entry.Reason.Length > 64)
        {
            throw new InvalidDataException("Invalid file-recovery snapshot. Existing history was retained.");
        }
    }

    private static bool ValidPath(string path) => path.Length is > 0 and <= 4096 && !Path.IsPathRooted(path)
        && Path.GetExtension(path).ToLowerInvariant() is ".md" or ".canvas" or ".base"
        && path.Split('/').All(part => part.Length is > 0 and <= 255 && !part.StartsWith('.') && !part.EndsWith('.') && !part.EndsWith(' ') && !ForbiddenSegment.IsMatch(part));

    private static NativeRecoverySnapshot Read(JsonNode? node)
    {
        var value = node?.AsObject() ?? throw new InvalidDataException("A recovery snapshot is missing.");
        var timestamp = Number(value, "ts");
        if (!double.IsInteger(timestamp) || timestamp is < 0 or > 8640000000000000 || !value.ContainsKey("sourceVersion"))
        {
            throw new InvalidDataException("Invalid recovery snapshot metadata. Existing history was retained.");
        }
        var hasBom = value["hasBom"]?.GetValue<bool>() ?? throw new InvalidDataException("A recovery snapshot is missing its encoding flag.");
        var fingerprint = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToJsonString(JsonOptions))));
        return new NativeRecoverySnapshot(Required(value, "id"), Required(value, "path"), (long)timestamp, Required(value, "content"), hasBom,
            value["sourceVersion"]?.GetValue<string>(), Required(value, "reason"), fingerprint);
    }

    private static string Required(JsonObject value, string key) => value[key]?.GetValue<string>() ?? throw new InvalidDataException("A recovery snapshot is missing " + key + ".");
    private static double Number(JsonObject value, string key) => double.TryParse(value[key]?.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number)
        ? number : throw new InvalidDataException("A recovery snapshot has invalid numeric metadata: " + key + ".");
}
