using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeCanvasCard(string Id, string Type, int X, int Y, int Width, int Height, string Text, string Target, string? Color, string Subpath, string Background, string BackgroundStyle);
public sealed record NativeCanvasConnection(string Id, string From, string To, string FromSide, string ToSide, string FromEnd, string ToEnd, string? Color, string Label);

/// <summary>Validated Canvas JSON; edits preserve unknown fields and source newline/indent style.</summary>
public sealed class NativeCanvasDocument
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, MaxDepth = 256 };
    private static readonly string[] Sides = ["top", "right", "bottom", "left"];
    private static readonly string[] Ends = ["none", "arrow"];
    private static readonly Regex ColorPattern = new(@"\A(?:[1-6]|#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8}))\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private readonly string newline;
    private readonly string indent;
    private readonly string trailing;
    private JsonObject data;

    public NativeCanvasDocument(string source)
    {
        data = Parse(source);
        Source = source;
        newline = source.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        var indentation = Regex.Match(source, "\\r?\\n([ \\t]+)\\\"", RegexOptions.NonBacktracking).Groups[1].Value;
        indent = indentation.Length == 0 ? "\t" : indentation[..Math.Min(10, indentation.Length)];
        trailing = source.EndsWith('\n') ? newline : "";
    }

    public string Source { get; private set; }
    public IReadOnlyList<NativeCanvasCard> GetCards() => Nodes(data).Select(node => new NativeCanvasCard(Text(node, "id"), Text(node, "type"), Coordinate(node, "x"), Coordinate(node, "y"), Coordinate(node, "width", 1), Coordinate(node, "height", 1),
        CardText(node), Target(node), Tint(node), FileSubpath(node), GroupText(node, "background"), GroupText(node, "backgroundStyle"))).ToArray();

    public IReadOnlyList<NativeCanvasConnection> GetConnections() => Edges(data).Select(edge => new NativeCanvasConnection(Text(edge, "id"), Text(edge, "fromNode"), Text(edge, "toNode"),
        Option(edge, "fromSide", Sides, ""), Option(edge, "toSide", Sides, ""), Option(edge, "fromEnd", Ends, ""), Option(edge, "toEnd", Ends, ""), Tint(edge), Text(edge, "label", true))).ToArray();

    public string AddCard(string type, string text, int x, int y)
    {
        var id = Guid.NewGuid().ToString("N");
        Change(copy =>
        {
            var node = new JsonObject { ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["width"] = 400, ["height"] = 240 };
            var key = type switch { "text" => "text", "file" => "file", "link" => "url", "group" => "label", _ => throw new InvalidDataException("Choose a text, file, link or group card.") };
            node[key] = text;
            copy["nodes"]!.AsArray().Add(node);
        });
        return id;
    }

    public bool UpdateCard(string id, Action<JsonObject> update) => Change(copy => update(Find(Nodes(copy), id)));
    public bool UpdateConnection(string id, Action<JsonObject> update) => Change(copy => update(Find(Edges(copy), id)));

    public bool MoveCards(IEnumerable<string> ids, int dx, int dy)
    {
        var selected = ids.ToHashSet(StringComparer.Ordinal);
        return Change(copy =>
        {
            foreach (var node in Nodes(copy).Where(node => selected.Contains(Text(node, "id"))))
            {
                node["x"] = checked(Coordinate(node, "x") + dx);
                node["y"] = checked(Coordinate(node, "y") + dy);
            }
        });
    }

    public bool RemoveCards(IEnumerable<string> ids)
    {
        var selected = ids.ToHashSet(StringComparer.Ordinal);
        return Change(copy =>
        {
            Remove(copy["nodes"]!.AsArray(), node => selected.Contains(Text(node, "id")));
            Remove(copy["edges"]!.AsArray(), edge => selected.Contains(Text(edge, "fromNode")) || selected.Contains(Text(edge, "toNode")));
        });
    }

    public bool RemoveConnection(string id) => Change(copy => Remove(copy["edges"]!.AsArray(), edge => Text(edge, "id") == id));

    public string Connect(string from, string to)
    {
        var id = Guid.NewGuid().ToString("N");
        Change(copy => copy["edges"]!.AsArray().Add(new JsonObject { ["id"] = id, ["fromNode"] = from, ["toNode"] = to, ["fromSide"] = "right", ["toSide"] = "left", ["toEnd"] = "arrow" }));
        return id;
    }

    public string CopySelection(IEnumerable<string> ids)
    {
        var selected = ids.ToHashSet(StringComparer.Ordinal);
        var nodes = new JsonArray(Nodes(data).Where(node => selected.Contains(Text(node, "id"))).Select(node => node.DeepClone()).ToArray());
        var edges = new JsonArray(Edges(data).Where(edge => selected.Contains(Text(edge, "fromNode")) && selected.Contains(Text(edge, "toNode"))).Select(edge => edge.DeepClone()).ToArray());
        return new JsonObject { ["nodes"] = nodes, ["edges"] = edges }.ToJsonString(JsonOptions);
    }

    public IReadOnlyList<string> Paste(string source, int dx = 30, int dy = 30)
    {
        var insertion = Parse(source);
        var ids = Nodes(insertion).ToDictionary(node => Text(node, "id"), _ => Guid.NewGuid().ToString("N"), StringComparer.Ordinal);
        Change(copy =>
        {
            foreach (var original in Nodes(insertion))
            {
                var node = original.DeepClone().AsObject();
                node["id"] = ids[Text(original, "id")];
                node["x"] = checked(Coordinate(original, "x") + dx);
                node["y"] = checked(Coordinate(original, "y") + dy);
                copy["nodes"]!.AsArray().Add(node);
            }
            foreach (var original in Edges(insertion))
            {
                var edge = original.DeepClone().AsObject();
                edge["id"] = Guid.NewGuid().ToString("N");
                edge["fromNode"] = ids[Text(original, "fromNode")];
                edge["toNode"] = ids[Text(original, "toNode")];
                copy["edges"]!.AsArray().Add(edge);
            }
        });
        return ids.Values.ToArray();
    }

    private bool Change(Action<JsonObject> mutation)
    {
        var copy = data.DeepClone().AsObject();
        mutation(copy);
        Validate(copy);
        if (JsonNode.DeepEquals(data, copy)) { return false; }
        var text = Format(copy);
        data = copy;
        Source = text;
        return true;
    }

    private string Format(JsonObject value)
    {
        var lines = value.ToJsonString(JsonOptions).Split('\n');
        for (var index = 0; index < lines.Length; index++)
        {
            var spaces = lines[index].TakeWhile(character => character == ' ').Count();
            lines[index] = string.Concat(Enumerable.Repeat(indent, spaces / 2)) + lines[index][spaces..];
        }
        return string.Join(newline, lines) + trailing;
    }

    private static JsonObject Parse(string source)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(source)) { return new JsonObject { ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() }; }
            using var document = JsonDocument.Parse(source, new JsonDocumentOptions { MaxDepth = 256 });
            VaultJson.ValidateRoundTrip(document.RootElement, "Canvas", rejectDuplicateKeys: true);
            var value = JsonNode.Parse(document.RootElement.GetRawText(), documentOptions: new JsonDocumentOptions { MaxDepth = 256 })?.AsObject()
                ?? throw new InvalidDataException("Canvas source must contain a JSON object.");
            if (!value.ContainsKey("nodes")) { value["nodes"] = new JsonArray(); }
            if (!value.ContainsKey("edges")) { value["edges"] = new JsonArray(); }
            Validate(value);
            return value;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or FormatException or VaultException)
        {
            throw new InvalidDataException("Invalid Canvas source. " + exception.Message + " The source was retained.", exception);
        }
    }

    private static void Validate(JsonObject value)
    {
        if (value["nodes"] is not JsonArray nodes || value["edges"] is not JsonArray edges) { throw new InvalidDataException("Canvas nodes and edges must be arrays."); }
        if (nodes.Count > 5000 || edges.Count > 20000) { throw new InvalidDataException("This canvas exceeds 5,000 cards or 20,000 connections."); }
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in Nodes(value))
        {
            RequireId(node, ids);
            ValidateCard(node);
        }
        var edgeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var edge in Edges(value))
        {
            RequireId(edge, edgeIds);
            if (!ids.Contains(Text(edge, "fromNode")) || !ids.Contains(Text(edge, "toNode"))) { throw new InvalidDataException("A Canvas connection references a missing card."); }
            _ = Option(edge, "fromSide", Sides, "right");
            _ = Option(edge, "toSide", Sides, "left");
            _ = Option(edge, "fromEnd", Ends, "none");
            _ = Option(edge, "toEnd", Ends, "arrow");
            _ = Tint(edge);
            _ = Text(edge, "label", true);
        }
        using var document = JsonDocument.Parse(value.ToJsonString(JsonOptions), new JsonDocumentOptions { MaxDepth = 256 });
        VaultJson.ValidateRoundTrip(document.RootElement, "Canvas", rejectDuplicateKeys: true);
    }

    private static void ValidateCard(JsonObject node)
    {
        var type = Text(node, "type");
        if (type.Length == 0) { throw new InvalidDataException("A Canvas card needs a type."); }
        _ = Coordinate(node, "x"); _ = Coordinate(node, "y");
        _ = Coordinate(node, "width", 1); _ = Coordinate(node, "height", 1);
        _ = Tint(node);
        switch (type)
        {
            case "text": _ = Text(node, "text"); break;
            case "link": _ = Text(node, "url"); break;
            case "file":
                _ = Text(node, "file");
                var subpath = Text(node, "subpath", true);
                if (subpath.Length > 0 && !subpath.StartsWith('#')) { throw new InvalidDataException("Canvas file subpaths must start with #."); }
                break;
            case "group": _ = Text(node, "label", true); _ = Text(node, "background", true); _ = Text(node, "backgroundStyle", true); break;
        }
    }

    private static IEnumerable<JsonObject> Nodes(JsonObject value) => Objects(value["nodes"]!.AsArray());
    private static IEnumerable<JsonObject> Edges(JsonObject value) => Objects(value["edges"]!.AsArray());
    private static IEnumerable<JsonObject> Objects(JsonArray values) => values.Select(value => value as JsonObject ?? throw new InvalidDataException("Canvas elements must be JSON objects."));
    private static JsonObject Find(IEnumerable<JsonObject> values, string id) => values.FirstOrDefault(node => Text(node, "id") == id) ?? throw new InvalidOperationException("This Canvas element no longer exists.");
    private static void RequireId(JsonObject node, HashSet<string> ids)
    {
        var id = Text(node, "id");
        if (id.Length == 0 || !ids.Add(id)) { throw new InvalidDataException("Canvas element IDs must be nonempty and unique."); }
    }
    private static string Text(JsonObject node, string key, bool optional = false)
    {
        if (optional && !node.ContainsKey(key)) { return ""; }
        if (node[key] is JsonValue value && value.TryGetValue<string>(out var text) && text is not null) { return text; }
        throw new InvalidDataException("Canvas " + key + " must be text.");
    }
    private static int Coordinate(JsonObject node, string key, int minimum = -10_000_000)
    {
        if (!double.TryParse(node[key]?.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || !double.IsFinite(number) || !double.IsInteger(number) || number < minimum || number > 10_000_000)
        {
            throw new InvalidDataException("Canvas " + key + " must be an integer between " + minimum + " and 10000000.");
        }
        return (int)number;
    }
    private static string? Tint(JsonObject node)
    {
        if (!node.ContainsKey("color")) { return null; }
        var color = Text(node, "color");
        if (!ColorPattern.IsMatch(color)) { throw new InvalidDataException("Canvas colors must be a preset 1–6 or a hexadecimal color."); }
        return color;
    }
    private static string Option(JsonObject node, string key, string[] allowed, string fallback)
    {
        if (!node.ContainsKey(key)) { return fallback; }
        var value = Text(node, key);
        return allowed.Contains(value, StringComparer.Ordinal) ? value : throw new InvalidDataException("Unsupported Canvas " + key + ".");
    }
    private static string CardText(JsonObject node) => Text(node, "type") switch { "text" => Text(node, "text"), "group" => Text(node, "label", true), _ => "" };
    private static string FileSubpath(JsonObject node) => Text(node, "type") == "file" ? Text(node, "subpath", true) : "";
    private static string GroupText(JsonObject node, string key) => Text(node, "type") == "group" ? Text(node, key, true) : "";
    private static string Target(JsonObject node) => Text(node, "type") switch { "file" => Text(node, "file"), "link" => Text(node, "url"), _ => "" };
    private static void Remove(JsonArray array, Func<JsonObject, bool> match)
    {
        for (var index = array.Count - 1; index >= 0; index--) { if (array[index] is JsonObject node && match(node)) { array.RemoveAt(index); } }
    }
}
