using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Avalonia;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.RepresentationModel;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeHeading(string Title, int Level, int Offset)
{
    public Thickness Indent => new((Level - 1) * 12, 4, 0, 4);
}
public sealed record NativeLink(string Target, int Offset, bool Embedded);
public sealed record NativeFootnote(string Id, string Text, int Offset);
public sealed record NativeProperty(string Key, string Value, string Kind, string Raw);
public sealed record NativeLocation(string Name, string Path, int Offset, string Context = "");

public sealed record NativeMetadata(
    string Path, IReadOnlyList<NativeHeading> Headings, IReadOnlyList<NativeLink> Links,
    IReadOnlyList<string> Tags, IReadOnlyList<string> Aliases,
    IReadOnlyList<NativeFootnote> Footnotes, IReadOnlyList<NativeProperty> Properties, string? PropertyError)
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().UsePreciseSourceLocation().UseYamlFrontMatter().UseAdvancedExtensions().Build();
    private static readonly Regex WikiLinks = new(@"!?\[\[(?<target>[^\]\r\n|]+)(?:\|[^\]\r\n]*)?\]\]", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
    private static readonly Regex TagsPattern = new(@"(?<![\p{L}\p{N}_/#])#(?<tag>[\p{L}\p{N}_/-]+)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
    private static readonly Regex FootnotesPattern = new(@"(?m)^\[\^(?<id>[^\]\r\n]+)\]:[ \t]*(?<text>[^\r\n]*)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));

    public static NativeMetadata Parse(string path, string content)
    {
        var document = Markdown.Parse(content, Pipeline);
        var ignored = document.Descendants<CodeBlock>().Select(block => block.Span)
            .Concat(document.Descendants<CodeInline>().Select(inline => inline.Span))
            .Concat(document.Descendants<HtmlBlock>().Select(block => block.Span)).ToArray();
        var frontmatter = NativeFrontmatter.Read(content);
        bool Visible(int offset) => !ignored.Any(span => offset >= span.Start && offset <= span.End) && (frontmatter is null || offset >= frontmatter.End);
        var headings = document.Descendants<HeadingBlock>().Select(heading => new NativeHeading(InlineText(heading.Inline), heading.Level, heading.Span.Start)).ToArray();
        var links = WikiLinks.Matches(content).Where(match => Visible(match.Index))
            .Select(match => new NativeLink(match.Groups["target"].Value.Trim(), match.Index, match.Value.StartsWith('!'))).ToList();
        links.AddRange(document.Descendants<LinkInline>().Where(link => link.Url is not null && !Uri.TryCreate(link.Url, UriKind.Absolute, out _))
            .Select(link => new NativeLink(Uri.UnescapeDataString(link.Url!), link.Span.Start, link.IsImage)));
        var tags = TagsPattern.Matches(content).Where(match => Visible(match.Index)).Select(match => match.Groups["tag"].Value)
            .Concat(frontmatter?.Values("tags") ?? []).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToArray();
        var footnotes = FootnotesPattern.Matches(content).Where(match => Visible(match.Index))
            .Select(match => new NativeFootnote(match.Groups["id"].Value, match.Groups["text"].Value, match.Index)).ToArray();
        return new NativeMetadata(path, headings, links, tags, frontmatter?.Values("aliases") ?? [], footnotes,
            frontmatter?.Properties ?? [], frontmatter?.Error);
    }

    private static string InlineText(ContainerInline? container)
    {
        var result = new StringBuilder();
        if (container is null)
        {
            return "";
        }
        foreach (var inline in container)
        {
            switch (inline)
            {
                case LiteralInline literal: result.Append(literal.Content.ToString()); break;
                case CodeInline code: result.Append(code.Content); break;
                case ContainerInline child: result.Append(InlineText(child)); break;
            }
        }
        return result.ToString();
    }
}

public sealed class NativeFrontmatter
{
    private static readonly Regex Pattern = new(@"\A---\r?\n(?<yaml>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|\z)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
    private readonly Match match;
    private readonly YamlMappingNode? mapping;
    private readonly Dictionary<string, (int Start, int End)> spans = new(StringComparer.Ordinal);
    private readonly int? flowClosingOffset;
    public IReadOnlyList<NativeProperty> Properties { get; }
    public string? Error { get; }
    public int End => match.Length;

    private NativeFrontmatter(Match source)
    {
        match = source;
        try
        {
            var stream = new YamlStream();
            stream.Load(new StringReader(source.Groups["yaml"].Value));
            mapping = stream.Documents.FirstOrDefault()?.RootNode as YamlMappingNode;
            if (mapping is not null) { (spans, flowClosingOffset) = PropertySpans(source.Groups["yaml"].Value); }
            if (mapping is null && source.Groups["yaml"].Value.Trim().Length > 0)
            {
                Error = "Properties must be a YAML mapping. Edit the frontmatter in Source to correct it.";
            }
            Properties = mapping?.Children.Where(entry => entry.Key is YamlScalarNode).Select(entry => Property((YamlScalarNode)entry.Key, entry.Value)).ToArray() ?? [];
        }
        catch (Exception exception) when (exception is YamlException or InvalidDataException)
        {
            Error = "Invalid frontmatter: " + exception.Message;
            Properties = [];
        }
    }

    public static NativeFrontmatter? Read(string content)
    {
        var source = Pattern.Match(content);
        return source.Success ? new NativeFrontmatter(source) : null;
    }

    public IReadOnlyList<string> Values(string key)
    {
        var entry = mapping?.Children.FirstOrDefault(item => item.Key is YamlScalarNode scalar && scalar.Value == key).Value;
        return entry switch
        {
            YamlSequenceNode sequence => sequence.Children.OfType<YamlScalarNode>().Select(node => node.Value ?? "").Where(value => value.Length > 0).ToArray(),
            YamlScalarNode scalar when !string.IsNullOrWhiteSpace(scalar.Value) => [scalar.Value],
            _ => []
        };
    }

    public static string Set(string content, string key, string rawValue)
    {
        if (string.IsNullOrWhiteSpace(key) || key.IndexOfAny(['\r', '\n', ':', '[', ']', '{', '}']) >= 0)
        {
            throw new InvalidOperationException("Enter a property name without YAML structural characters.");
        }
        var parsed = new YamlStream();
        parsed.Load(new StringReader(rawValue));
        if (parsed.Documents.Count != 1 || parsed.Documents[0].RootNode is not (YamlScalarNode or YamlSequenceNode))
        {
            throw new InvalidOperationException("Use a YAML scalar or a list value. Structured YAML remains editable in Source.");
        }
        var newline = content.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        var frontmatter = Read(content);
        if (frontmatter is null)
        {
            return "---" + newline + key + ": " + rawValue + newline + "---" + newline + content;
        }
        if (frontmatter.Error is not null)
        {
            throw new InvalidOperationException(frontmatter.Error);
        }
        if (frontmatter.spans.TryGetValue(key, out var span))
        {
            var start = frontmatter.match.Groups["yaml"].Index + span.Start;
            var end = frontmatter.match.Groups["yaml"].Index + span.End;
            return content[..start] + rawValue + content[end..];
        }
        var quotedKey = System.Text.Json.JsonSerializer.Serialize(key);
        if (frontmatter.flowClosingOffset is { } closing)
        {
            var index = frontmatter.match.Groups["yaml"].Index + closing;
            var separator = frontmatter.Properties.Count == 0 ? "" : ", ";
            return content[..index] + separator + quotedKey + ": " + rawValue + content[index..];
        }
        var insertion = frontmatter.match.Groups["yaml"].Index + frontmatter.match.Groups["yaml"].Length;
        return content[..insertion] + newline + quotedKey + ": " + rawValue + content[insertion..];
    }

    private NativeProperty Property(YamlScalarNode key, YamlNode value)
    {
        var yaml = match.Groups["yaml"].Value;
        var raw = spans.TryGetValue(key.Value ?? "", out var span) ? yaml[span.Start..span.End] : "";
        var text = value switch
        {
            YamlScalarNode scalar => scalar.Value ?? "",
            YamlSequenceNode sequence => string.Join(", ", sequence.Children.OfType<YamlScalarNode>().Select(node => node.Value)),
            _ => "Structured value"
        };
        var kind = value switch
        {
            YamlSequenceNode => "List",
            YamlMappingNode => "Mapping",
            YamlScalarNode scalar when scalar.Style == ScalarStyle.Plain && bool.TryParse(scalar.Value, out _) => "Checkbox",
            YamlScalarNode scalar when scalar.Style == ScalarStyle.Plain && double.TryParse(scalar.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out _) => "Number",
            _ => "Text"
        };
        return new NativeProperty(key.Value ?? "", text, kind, raw);
    }

    private static (Dictionary<string, (int Start, int End)> Spans, int? Closing) PropertySpans(string yaml)
    {
        var parser = new Parser(new StringReader(yaml));
        parser.Consume<StreamStart>();
        parser.Consume<DocumentStart>();
        var root = parser.Consume<MappingStart>();
        var result = new Dictionary<string, (int Start, int End)>(StringComparer.Ordinal);
        while (!parser.Accept<MappingEnd>(out _))
        {
            var key = parser.Consume<Scalar>();
            result[key.Value] = ConsumeValue(parser, yaml, 0);
        }
        int? closing = root.Style == MappingStyle.Flow && parser.Current is not null ? checked((int)parser.Current.Start.Index) : null;
        return (result, closing);
    }

    private static (int Start, int End) ConsumeValue(IParser parser, string yaml, int depth)
    {
        if (depth > 32) { throw new InvalidDataException("Frontmatter nesting exceeds the native property editor limit. Edit it in Source."); }
        var current = parser.Current ?? throw new InvalidDataException("Unexpected end of frontmatter.");
        var start = checked((int)current.Start.Index);
        var end = checked((int)current.End.Index);
        var sequence = current as SequenceStart;
        var mapping = current as MappingStart;
        parser.MoveNext();
        if (sequence is null && mapping is null) { return (start, end); }
        while (parser.Current is not (SequenceEnd or MappingEnd) && parser.Current is not null)
        {
            var child = ConsumeValue(parser, yaml, depth + 1);
            end = child.End;
        }
        var flow = sequence?.Style == SequenceStyle.Flow || mapping?.Style == MappingStyle.Flow;
        if (flow && parser.Current is not null)
        {
            end = checked((int)parser.Current.End.Index);
            var delimiter = sequence is not null ? ']' : '}';
            if (end < yaml.Length && yaml[end] == delimiter) { end++; }
        }
        parser.MoveNext();
        return (start, end);
    }
}
