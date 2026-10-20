using System.Text;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

/// <summary>
/// Host-side mirror of the client appearance CSS policy used before a reviewed theme is written: strict UTF-8 size/NUL checks,
/// no imports, image-set(), image() or src(), and only quoted/unquoted relative url() values inside the theme folder.
/// This is lexical validation, not complete CSS parsing.
/// </summary>
internal static partial class AppearanceCssPolicy
{
    public const int CssBytes = 1024 * 1024;
    public const int ResourceCount = 64;

    private static VaultException Fail(string message) => new(message, StatusCodes.Status415UnsupportedMediaType);

    private static bool Identifier(char c) => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' || c >= 128;

    private static bool Newline(char c) => c is '\n' or '\r' or '\f';

    private static bool Space(char c) => c is '\t' or '\n' or '\r' or '\f' or ' ';

    private static (string Value, int Next) Escape(string text, int index, bool inString)
    {
        if (index + 1 < text.Length && Newline(text[index + 1]))
        {
            if (!inString)
            {
                throw Fail("CSS identifiers must not contain escaped newlines.");
            }

            return ("", index + (text[index + 1] == '\r' && index + 2 < text.Length && text[index + 2] == '\n' ? 3 : 2));
        }

        var length = 0;
        while (length < 6 && index + 1 + length < text.Length && char.IsAsciiHexDigit(text[index + 1 + length]))
        {
            length++;
        }

        if (length > 0)
        {
            var code = Convert.ToInt32(text.Substring(index + 1, length), 16);
            var next = index + 1 + length;
            if (next < text.Length && Space(text[next]))
            {
                next += text[next] == '\r' && next + 1 < text.Length && text[next + 1] == '\n' ? 2 : 1;
            }

            return (code == 0 || code > 0x10ffff || code is >= 0xd800 and <= 0xdfff ? "\ufffd" : char.ConvertFromUtf32(code), next);
        }

        if (index + 1 >= text.Length)
        {
            throw Fail("The CSS ends with an incomplete escape.");
        }

        return (text[index + 1].ToString(), index + 2);
    }

    private static (string Value, int End) Url(string text, int open)
    {
        var index = open + 1;
        while (index < text.Length && Space(text[index]))
        {
            index++;
        }

        var value = new StringBuilder();
        var quote = index < text.Length ? text[index] : '\0';
        if (quote is '"' or '\'')
        {
            index++;
            while (index < text.Length && text[index] != quote)
            {
                if (text[index] == '\\' || Newline(text[index]))
                {
                    throw Fail("Appearance resource URLs must not contain escapes or newlines.");
                }

                value.Append(text[index++]);
            }

            if (index == text.Length)
            {
                throw Fail("The CSS contains an unterminated resource URL.");
            }

            index++;
        }
        else
        {
            while (index < text.Length && text[index] != ')' && !Space(text[index]))
            {
                if (text[index] is '"' or '\'' or '(' or '\\' || text[index] < 0x20 || text[index] == 0x7f)
                {
                    throw Fail("Appearance resource URLs contain an unsafe unquoted character.");
                }

                value.Append(text[index++]);
            }
        }

        while (index < text.Length && Space(text[index]))
        {
            index++;
        }

        if (index >= text.Length || text[index] != ')')
        {
            throw Fail("The CSS contains a malformed resource URL.");
        }

        return (value.ToString(), index + 1);
    }

    /// <summary>Validates the stylesheet and returns every url() value in source order.</summary>
    public static IReadOnlyList<string> Urls(string text)
    {
        if (Encoding.UTF8.GetByteCount(text) > CssBytes)
        {
            throw Fail("Each appearance stylesheet must be at most 1 MiB.");
        }

        if (text.Contains('\0'))
        {
            throw Fail("Appearance CSS must not contain null characters.");
        }

        var urls = new List<string>();
        for (var index = 0; index < text.Length;)
        {
            if (string.CompareOrdinal(text, index, "/*", 0, 2) == 0)
            {
                var end = text.IndexOf("*/", index + 2, StringComparison.Ordinal);
                index = end < 0 ? throw Fail("The CSS contains an unterminated comment.") : end + 2;
            }
            else if (text[index] is '"' or '\'')
            {
                var quote = text[index++];
                while (index < text.Length && text[index] != quote)
                {
                    if (Newline(text[index]))
                    {
                        throw Fail("CSS strings must not contain unescaped newlines.");
                    }

                    index = text[index] == '\\' ? Escape(text, index, true).Next : index + 1;
                }

                if (index == text.Length)
                {
                    throw Fail("The CSS contains an unterminated string.");
                }

                index++;
            }
            else if (text[index] is '@' or '\\' || Identifier(text[index]))
            {
                var atRule = text[index] == '@';
                if (atRule)
                {
                    index++;
                }

                var name = new StringBuilder();
                while (index < text.Length && (text[index] == '\\' || Identifier(text[index])))
                {
                    if (text[index] == '\\')
                    {
                        var escaped = Escape(text, index, false);
                        name.Append(escaped.Value);
                        index = escaped.Next;
                    }
                    else
                    {
                        name.Append(text[index++]);
                    }
                }

                var normalized = name.ToString().ToLowerInvariant();
                var call = index < text.Length && text[index] == '(';
                if (!atRule && call && normalized == "url")
                {
                    var token = Url(text, index);
                    urls.Add(token.Value);
                    index = token.End;
                    continue;
                }

                if (atRule && normalized == "import" || !atRule && call && normalized is "image-set" or "-webkit-image-set" or "image" or "src")
                {
                    throw Fail("Imports, image-set(), src() and image() are not supported, even with local resources enabled.");
                }
            }
            else
            {
                index++;
            }
        }

        return urls;
    }

    [GeneratedRegex(@"^[a-z][a-z0-9+.-]*:", RegexOptions.IgnoreCase)]
    private static partial Regex Scheme();

    [GeneratedRegex("[\\\\%?#\\x00-\\x1f\\x7f]")]
    private static partial Regex Forbidden();

    [GeneratedRegex("[\\\\/<>:\"|?*\\x00-\\x1f\\x7f]")]
    private static partial Regex InvalidName();

    [GeneratedRegex(@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)", RegexOptions.IgnoreCase)]
    private static partial Regex Reserved();

    /// <summary>Resolves one stylesheet-relative URL to a path relative to the theme folder; it cannot leave the folder.</summary>
    public static string Resource(string raw)
    {
        if (string.IsNullOrEmpty(raw) || raw.Length > 400 || Scheme().IsMatch(raw) || raw.StartsWith('/') || Forbidden().IsMatch(raw))
        {
            throw Fail("Only relative local resource paths are supported; remote, absolute, encoded, query or fragment URLs are refused: " + Truncate(raw));
        }

        var segments = raw.Split('/');
        if (segments.Where((segment, index) => segment is ".." or "" || segment == "." && index > 0).Any())
        {
            throw Fail("Resource paths must not contain traversal or empty segments: " + Truncate(raw));
        }

        var parts = segments.Where(segment => segment != ".").ToArray();
        if (parts.Length is 0 or > 7)
        {
            throw Fail("Resource paths must stay within seven folders of the theme: " + Truncate(raw));
        }

        foreach (var part in parts)
        {
            if (part.StartsWith('.') || part.Length > 200 || string.IsNullOrWhiteSpace(part) || part.EndsWith('.') || part.EndsWith(' ') || InvalidName().IsMatch(part) || Reserved().IsMatch(part))
            {
                throw Fail("Hidden or invalid resource path segments are refused: " + Truncate(raw));
            }
        }

        return string.Join('/', parts);
    }

    private static string Truncate(string value) => value.Length > 80 ? value[..80] : value;
}
