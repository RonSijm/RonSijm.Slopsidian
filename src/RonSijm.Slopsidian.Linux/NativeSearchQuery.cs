using System.Globalization;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeSearchDocument(string Path, string Text, NativeMetadata Metadata);
public readonly record struct NativeSearchMatch(bool Success, int Offset = 0);

/// <summary>Bounded native parser for text, Boolean, regex and metadata searches.</summary>
public sealed class NativeSearchQuery
{
    private readonly Node expression;
    private NativeSearchQuery(Node root) => expression = root;
    public static NativeSearchQuery Parse(string query, bool matchCase = false)
    {
        if (query.Length > 8192) { throw new InvalidOperationException("Search queries support up to 8192 characters."); }
        return new NativeSearchQuery(new Parser(NativeSearchLexer.Tokenize(query), matchCase).Build());
    }
    public bool RequiresContents => expression.RequiresContents;
    public bool RequiresMetadata => expression.RequiresMetadata;
    public NativeSearchMatch Match(NativeSearchDocument document) => expression.Match(document);

    private abstract record Node
    {
        public virtual bool RequiresContents => true;
        public virtual bool RequiresMetadata => false;
        public abstract NativeSearchMatch Match(NativeSearchDocument document);
    }
    private sealed record Every : Node
    {
        public override NativeSearchMatch Match(NativeSearchDocument document) => new(true);
    }
    private sealed record Negate(Node Child) : Node
    {
        public override bool RequiresContents => Child.RequiresContents;
        public override bool RequiresMetadata => Child.RequiresMetadata;
        public override NativeSearchMatch Match(NativeSearchDocument document) => new(!Child.Match(document).Success);
    }
    private sealed record Boolean(Node Left, Node Right, bool Or) : Node
    {
        public override bool RequiresContents => Left.RequiresContents || Right.RequiresContents;
        public override bool RequiresMetadata => Left.RequiresMetadata || Right.RequiresMetadata;
        public override NativeSearchMatch Match(NativeSearchDocument document)
        {
            var left = Left.Match(document);
            if (Or && left.Success || !Or && !left.Success) { return left; }
            var right = Right.Match(document);
            return Or ? right : new NativeSearchMatch(right.Success, Math.Max(left.Offset, right.Offset));
        }
    }
    private sealed record Term(string Scope, string Value, Regex? Pattern, StringComparison Comparison, string? Key = null) : Node
    {
        public override bool RequiresContents => Scope is not ("path" or "file");
        public override bool RequiresMetadata => Scope is "tag" or "property" or "property-exists";
        public override NativeSearchMatch Match(NativeSearchDocument document)
        {
            if (Scope == "tag")
            {
                var wanted = Value.TrimStart('#');
                return new(document.Metadata.Tags.Any(tag => Pattern is not null ? Contains(tag) >= 0
                    : tag.Equals(wanted, StringComparison.OrdinalIgnoreCase) || tag.StartsWith(wanted + "/", StringComparison.OrdinalIgnoreCase)));
            }
            if (Scope is "property" or "property-exists")
            {
                var property = document.Metadata.Properties.FirstOrDefault(property => property.Key.Equals(Key, StringComparison.OrdinalIgnoreCase));
                return new(property is not null && (Scope == "property-exists" || PropertyMatches(property)));
            }
            var text = Scope switch { "path" => document.Path, "file" => System.IO.Path.GetFileName(document.Path), _ => document.Text };
            var offset = Contains(text);
            var success = offset >= 0;
            return new(success, Scope is "path" or "file" ? 0 : Math.Max(0, offset));
        }
        private bool PropertyMatches(NativeProperty property) => property.Values.Any(MatchesScalar);

        private bool MatchesScalar(NativePropertyValue scalar)
        {
            var text = scalar.Text;
            if (Pattern is not null) { return Contains(text) >= 0; }
            var plain = scalar.Plain;
            if (Value.Equals("true", StringComparison.OrdinalIgnoreCase) || Value.Equals("false", StringComparison.OrdinalIgnoreCase))
            {
                return plain && bool.TryParse(text, out var boolean) && boolean == bool.Parse(Value);
            }
            if (Value.Equals("null", StringComparison.OrdinalIgnoreCase)) { return plain && (text.Length == 0 || text is "~" or "null" or "Null" or "NULL"); }
            var comparison = NumericComparison.Match(Value);
            if (!comparison.Success) { return Contains(text) >= 0; }
            if (!plain || !double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)) { return false; }
            var bound = double.Parse(comparison.Groups[2].Value, CultureInfo.InvariantCulture);
            var order = number.CompareTo(bound);
            return comparison.Groups[1].Value switch { ">=" => order >= 0, "<=" => order <= 0, ">" => order > 0, "<" => order < 0, "!=" => order != 0, _ => order == 0 };
        }

        private static readonly Regex NumericComparison = new(@"\A(>=|<=|!=|>|<|=)\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\z", RegexOptions.NonBacktracking);

        private int Contains(string text)
        {
            if (Pattern is null) { return text.IndexOf(Value, Comparison); }
            try
            {
                var result = Pattern.Match(text);
                return result.Success ? result.Index : -1;
            }
            catch (RegexMatchTimeoutException) { throw new InvalidOperationException("This search expression took too long. Simplify the regular expression."); }
        }
    }

    private sealed class Parser(string[] tokens, bool matchCase)
    {
        private int index;
        public Node Build()
        {
            if (tokens.Length == 0) { return new Every(); }
            var node = ParseOr(0);
            if (index != tokens.Length) { throw new InvalidOperationException("Unexpected search token: " + tokens[index]); }
            return node;
        }
        private Node ParseOr(int depth)
        {
            var node = ParseAnd(depth);
            while (Take("OR")) { node = new Boolean(node, ParseAnd(depth), true); }
            return node;
        }
        private Node ParseAnd(int depth)
        {
            var node = ParseUnary(depth);
            while (index < tokens.Length && tokens[index] is not ("OR" or ")"))
            {
                Take("AND");
                node = new Boolean(node, ParseUnary(depth), false);
            }
            return node;
        }
        private Node ParseUnary(int depth)
        {
            if (depth > 24) { throw new InvalidOperationException("Search groups are nested too deeply."); }
            if (Take("NOT") || Take("-")) { return new Negate(ParseUnary(depth + 1)); }
            if (Take("("))
            {
                var node = ParseOr(depth + 1);
                if (!Take(")")) { throw new InvalidOperationException("Close the search group with )."); }
                return node;
            }
            if (index >= tokens.Length || tokens[index] is "AND" or "OR" or ")") { throw new InvalidOperationException("Enter a search term after the operator."); }
            return ParseTerm(tokens[index++]);
        }
        private bool Take(string value)
        {
            if (index >= tokens.Length || tokens[index] != value) { return false; }
            index++;
            return true;
        }
        private Term ParseTerm(string token)
        {
            var (scope, value, key) = ReadTermParts(token);
            if (scope is not ("" or "path" or "file" or "tag" or "content" or "property" or "property-exists")) { throw new InvalidOperationException("Unknown search operator: " + scope); }
            var quoted = value.StartsWith('"') || value.StartsWith('\'');
            if (quoted) { value = NativeSearchLexer.Unquote(value); }
            if (value.Length == 0 && scope is not ("property" or "property-exists")) { throw new InvalidOperationException("Enter a search value."); }
            Regex? pattern = null;
            if (!quoted && value.StartsWith('/')) { pattern = CompileRegex(value, matchCase); }
            else if (!quoted) { value = NativeSearchLexer.UnescapeBare(value); }
            var comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
            return new Term(scope, value, pattern, comparison, key);
        }
        private static (string Scope, string Value, string? Key) ReadTermParts(string token)
        {
            string? key = null;
            var scope = "";
            var value = token;
            if (token.StartsWith('[') && token.EndsWith(']'))
            {
                var pair = NativeSearchLexer.PropertyParts(token[1..^1]);
                key = pair.Key;
                scope = pair.ExistsOnly ? "property-exists" : "property";
                value = pair.Value;
            }
            else
            {
                var colon = NativeSearchLexer.ScopeBoundary(token);
                if (colon > 0) { scope = token[..colon].ToLowerInvariant(); value = token[(colon + 1)..]; }
            }
            return (scope, value, key);
        }

        private static Regex CompileRegex(string value, bool matchCase)
        {
            var end = value.LastIndexOf('/');
            if (end <= 0) { throw new InvalidOperationException("Close the regular expression with /."); }
            var flags = value[(end + 1)..];
            if (flags.Any(flag => !"gimsu".Contains(flag)) || flags.Distinct().Count() != flags.Length) { throw new InvalidOperationException("Regular expression flags must be unique: g, i, m, s or u."); }
            var options = RegexOptions.CultureInvariant;
            if (!matchCase || flags.Contains('i')) { options |= RegexOptions.IgnoreCase; }
            if (flags.Contains('m')) { options |= RegexOptions.Multiline; }
            if (flags.Contains('s')) { options |= RegexOptions.Singleline; }
            try { return new Regex(value[1..end], options, TimeSpan.FromMilliseconds(100)); }
            catch (ArgumentException exception) { throw new InvalidOperationException("Invalid search expression: " + exception.Message, exception); }
        }
    }
}
