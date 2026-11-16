using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class CanvasDocumentTests
{
    private const string Initial = """
        {
            "pluginData": {"retain": [1, "Café", true]},
            "nodes": [
                {"id":"a","type":"text","x":10.0,"y":20,"width":400,"height":240,"text":"# First\r\nKeep me","unknown":{"value":3}},
                {"id":"b","type":"file","x":500,"y":20,"width":400,"height":240,"file":"Notes/Other.md","subpath":"#Heading"}
            ],
            "edges": [{"id":"e","fromNode":"a","toNode":"b","label":"Related","unknown":true}]
        }
        """;

    [Fact]
    public void MovingAndResizingPreserveUnknownFieldsAndTheOriginalLineEndingStyle()
    {
        var source = Initial.Replace("\n", "\r\n", StringComparison.Ordinal) + "\r\n";
        var model = new NativeCanvasDocument(source);
        Assert.True(model.MoveCards(["a"], 15, -5));
        Assert.True(model.UpdateCard("a", node => node["width"] = 600));
        Assert.Equal(25, model.GetCards()[0].X);
        Assert.Equal(15, model.GetCards()[0].Y);
        Assert.Equal(600, model.GetCards()[0].Width);
        Assert.EndsWith("\r\n", model.Source);
        Assert.DoesNotContain("\n", model.Source.Replace("\r\n", "", StringComparison.Ordinal));
        using var document = JsonDocument.Parse(model.Source);
        Assert.Equal("Café", document.RootElement.GetProperty("pluginData").GetProperty("retain")[1].GetString());
        Assert.Equal(3, document.RootElement.GetProperty("nodes")[0].GetProperty("unknown").GetProperty("value").GetInt32());
        Assert.True(document.RootElement.GetProperty("edges")[0].GetProperty("unknown").GetBoolean());
        Assert.Equal("# First\r\nKeep me", model.GetCards()[0].Text);
    }

    [Fact]
    public void NoOpEditsKeepTheOriginalSourceExactly()
    {
        var model = new NativeCanvasDocument(Initial);
        Assert.False(model.MoveCards(["a"], 0, 0));
        Assert.Equal(Initial, model.Source);
    }

    [Fact]
    public void RejectedMutationsRetainTheSourceAndGraph()
    {
        var model = new NativeCanvasDocument(Initial);
        Assert.Throws<InvalidDataException>(() => model.UpdateCard("a", node => node["width"] = 0));
        Assert.Equal(Initial, model.Source);
        Assert.Throws<InvalidDataException>(() => model.Connect("a", "missing"));
        Assert.Equal(Initial, model.Source);
        Assert.Equal(2, model.GetCards().Count);
        Assert.Single(model.GetConnections());
    }

    [Fact]
    public void DeletingACardAlsoRemovesItsConnections()
    {
        var model = new NativeCanvasDocument(Initial);
        Assert.True(model.RemoveCards(["a"]));
        Assert.Equal("b", Assert.Single(model.GetCards()).Id);
        Assert.Empty(model.GetConnections());
    }

    [Fact]
    public void ClipboardGraphsReceiveFreshIdsWhileRetainingInternalLinksAndUnknownData()
    {
        var model = new NativeCanvasDocument(Initial);
        var copied = model.CopySelection(["a", "b"]);
        var pasted = model.Paste(copied);
        Assert.Equal(2, pasted.Count);
        Assert.Equal(4, model.GetCards().Count);
        Assert.Equal(4, model.GetCards().Select(card => card.Id).Distinct(StringComparer.Ordinal).Count());
        var edge = model.GetConnections().Single(connection => connection.Id != "e");
        Assert.Contains(edge.From, pasted);
        Assert.Contains(edge.To, pasted);
        Assert.Equal(40, model.GetCards().Single(card => card.Id == edge.From).X);
        using var document = JsonDocument.Parse(model.Source);
        Assert.Equal(3, document.RootElement.GetProperty("nodes")[2].GetProperty("unknown").GetProperty("value").GetInt32());
    }

    [Fact]
    public void UnknownCardTypesAndUnrelatedFieldsAreRetainedWithoutBeingReinterpreted()
    {
        var root = JsonNode.Parse(Initial)!.AsObject();
        root["nodes"]![0]!["subpath"] = 42;
        root["nodes"]!.AsArray().Add(new JsonObject { ["id"] = "future", ["type"] = "future-card", ["x"] = 0, ["y"] = 0, ["width"] = 10, ["height"] = 10, ["pluginState"] = new JsonObject { ["keep"] = true } });
        var model = new NativeCanvasDocument(root.ToJsonString());
        Assert.Equal("future-card", model.GetCards()[2].Type);
        model.MoveCards(["future"], 5, 5);
        var saved = JsonNode.Parse(model.Source)!;
        Assert.Equal(42, saved["nodes"]![0]!["subpath"]!.GetValue<int>());
        Assert.True(saved["nodes"]![2]!["pluginState"]!["keep"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"nodes\":null,\"edges\":[]}")]
    [InlineData("{\"nodes\":[],\"nodes\":[],\"edges\":[]}")]
    [InlineData("{\"nodes\":[],\"edges\":[],\"unknown\":9007199254740992}")]
    public void DamagedOrLossyCanvasDocumentsAreRefused(string source) => Assert.Throws<InvalidDataException>(() => new NativeCanvasDocument(source));

    [Theory]
    [InlineData("x", "0.5")]
    [InlineData("x", "10000001")]
    [InlineData("y", "-10000001")]
    [InlineData("width", "0")]
    [InlineData("height", "null")]
    [InlineData("color", "\"#١٢٣\"")]
    public void InvalidCardGeometryAndColorsCannotBeApplied(string key, string value)
    {
        var model = new NativeCanvasDocument(Initial);
        Assert.Throws<InvalidDataException>(() => model.UpdateCard("a", node => node[key] = JsonNode.Parse(value)));
        Assert.Equal(Initial, model.Source);
    }
}
