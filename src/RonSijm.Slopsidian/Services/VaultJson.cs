using System.Globalization;
using System.Text.Json;

namespace RonSijm.Slopsidian.Services;

/// <summary>Protects JSON shared with JavaScript clients from lossy numeric round-trips.</summary>
public static class VaultJson
{
    public static void ValidateRoundTrip(JsonElement value, string description = "Vault configuration", bool rejectDuplicateKeys = false)
        => Validate(value, description, rejectDuplicateKeys, 0);

    private static void Validate(JsonElement value, string description, bool rejectDuplicateKeys, int depth)
    {
        if (depth > 256)
        {
            throw new VaultException(description + " exceeds the supported nesting limit.", StatusCodes.Status422UnprocessableEntity);
        }

        if (value.ValueKind == JsonValueKind.Number)
        {
            var raw = value.GetRawText();
            if (!value.TryGetDouble(out var number) || !double.IsFinite(number) || double.IsInteger(number) && Math.Abs(number) > 9007199254740991 || number == 0 && raw.TakeWhile(character => character is not ('e' or 'E')).Any(character => character is >= '1' and <= '9') || NumberIdentity(raw) != NumberIdentity(number.ToString("R", CultureInfo.InvariantCulture)))
            {
                throw new VaultException(description + " contains a number that cannot safely round-trip through the editor; the original file was retained.", StatusCodes.Status422UnprocessableEntity);
            }
        }
        else if (value.ValueKind == JsonValueKind.Object)
        {
            HashSet<string>? keys = rejectDuplicateKeys ? new(StringComparer.Ordinal) : null;
            foreach (var property in value.EnumerateObject())
            {
                if (keys is not null && !keys.Add(property.Name))
                {
                    throw new VaultException(description + " contains duplicate JSON fields; the original file was retained.", StatusCodes.Status422UnprocessableEntity);
                }
                Validate(property.Value, description, rejectDuplicateKeys, depth + 1);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                Validate(item, description, rejectDuplicateKeys, depth + 1);
            }
        }
    }

    private static string NumberIdentity(string value)
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
