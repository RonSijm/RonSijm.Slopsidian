using System.Text;

namespace RonSijm.Slopsidian.Linux;

internal static class NativeSearchLexer
{
    internal static string[] Tokenize(string query)
    {
        var tokens = new List<string>();
        var index = 0;
        while (index < query.Length)
        {
            if (char.IsWhiteSpace(query[index])) { index++; continue; }
            var start = index;
            if (query[index] is '(' or ')' or '-') { index++; }
            else if (query[index] == '[') { index = PropertyEnd(query, index); }
            else { index = TermEnd(query, index); }
            tokens.Add(query[start..index]);
            if (tokens.Count > 256) { throw new InvalidOperationException("Search supports up to 256 terms."); }
        }
        return tokens.ToArray();
    }

    private static int TermEnd(string query, int start)
    {
        var boundary = ScopeBoundary(query[start..]);
        var valueStart = boundary >= 0 ? start + boundary + 1 : start;
        return ValueEnd(query, valueStart, false);
    }

    internal static int ScopeBoundary(string token)
    {
        if (token.Length == 0 || !char.IsAsciiLetter(token[0])) { return -1; }
        var index = 1;
        while (index < token.Length && (char.IsAsciiLetter(token[index]) || token[index] == '-')) { index++; }
        return index < token.Length && token[index] == ':' ? index : -1;
    }

    private static int PropertyEnd(string query, int start)
    {
        var index = SkipSpace(query, start + 1);
        if (index >= query.Length) { throw new InvalidOperationException("Close the property query with ]."); }
        if (query[index] is '\'' or '"') { index = QuotedEnd(query, index); }
        else { while (index < query.Length && query[index] is not (':' or ']')) { index++; } }
        index = SkipSpace(query, index);
        if (index < query.Length && query[index] == ':') { index = ValueEnd(query, SkipSpace(query, index + 1), true); }
        index = SkipSpace(query, index);
        if (index >= query.Length || query[index] != ']') { throw new InvalidOperationException("Close the property query with ]."); }
        return index + 1;
    }

    private static int ValueEnd(string query, int start, bool property)
    {
        if (start >= query.Length) { return start; }
        return query[start] switch
        {
            '\'' or '"' => QuotedEnd(query, start),
            '/' => RegexEnd(query, start),
            _ => BareEnd(query, start, property)
        };
    }

    private static int BareEnd(string query, int start, bool property)
    {
        var index = start;
        while (index < query.Length)
        {
            var character = query[index];
            if (property ? character == ']' : char.IsWhiteSpace(character) || character is '(' or ')') { break; }
            if (character == '\\' && index + 1 < query.Length) { index++; }
            index++;
        }
        if (index == start && !property) { throw new InvalidOperationException("Enter a search value after the operator."); }
        return index;
    }

    private static int QuotedEnd(string query, int start)
    {
        var quote = query[start];
        var index = start + 1;
        while (index < query.Length)
        {
            if (query[index] == '\\' && index + 1 < query.Length) { index += 2; continue; }
            if (query[index] == quote) { return index + 1; }
            index++;
        }
        throw new InvalidOperationException("Close the search quote.");
    }

    private static int RegexEnd(string query, int start)
    {
        var characterClass = false;
        var index = start + 1;
        while (index < query.Length)
        {
            var character = query[index];
            if (character == '\\' && index + 1 < query.Length) { index += 2; continue; }
            if (character == '[') { characterClass = true; }
            else if (character == ']') { characterClass = false; }
            else if (character == '/' && !characterClass)
            {
                index++;
                while (index < query.Length && char.IsAsciiLetter(query[index])) { index++; }
                return index;
            }
            index++;
        }
        throw new InvalidOperationException("Close the regular expression with /.");
    }

    internal static (string Key, string Value, bool ExistsOnly) PropertyParts(string input)
    {
        input = input.Trim();
        var quoted = input.StartsWith('\'') || input.StartsWith('"');
        var boundary = quoted ? QuotedEnd(input, 0) : input.IndexOf(':');
        if (boundary < 0) { boundary = input.Length; }
        var key = input[..boundary].Trim();
        if (quoted) { key = Unquote(key); }
        if (key.Length == 0) { throw new InvalidOperationException("Enter a property name inside []."); }
        var remaining = input[boundary..].TrimStart();
        if (remaining.Length == 0) { return (key, "", true); }
        if (!remaining.StartsWith(':')) { throw new InvalidOperationException("Use [property:value] to search a property."); }
        return (key, remaining[1..].Trim(), false);
    }

    internal static string Unquote(string value)
    {
        if (value.Length < 2 || value[^1] != value[0]) { throw new InvalidOperationException("Close the search quote."); }
        return value[1..^1].Replace("\\" + value[0], value[0].ToString(), StringComparison.Ordinal).Replace("\\\\", "\\", StringComparison.Ordinal);
    }

    internal static string UnescapeBare(string value)
    {
        var result = new StringBuilder();
        var index = 0;
        while (index < value.Length)
        {
            if (value[index] == '\\' && index + 1 < value.Length && (char.IsWhiteSpace(value[index + 1]) || "()[]\\".Contains(value[index + 1]))) { index++; }
            result.Append(value[index++]);
        }
        return result.ToString();
    }

    private static int SkipSpace(string text, int index)
    {
        while (index < text.Length && char.IsWhiteSpace(text[index])) { index++; }
        return index;
    }
}
