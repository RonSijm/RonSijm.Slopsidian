using System.Globalization;
using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

internal sealed class NativeCanvasInspector : Border
{
    private static readonly string[] Sides = ["Automatic", "top", "right", "bottom", "left"];
    private static readonly string[] Ends = ["Default", "none", "arrow"];
    private readonly Action<bool, string, string, JsonNode?> apply;
    private readonly StackPanel fields = new() { Spacing = 14 };
    private readonly TextBlock heading = new() { FontSize = 20, FontWeight = FontWeight.SemiBold };
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap, Classes = { "error" } };
    private readonly ComboBox connections = new() { Name = "CanvasConnectionPicker", PlaceholderText = "Select a connection", HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Dictionary<string, Control> inputs = new(StringComparer.Ordinal);
    private string selection = "";
    private bool updating;

    public NativeCanvasInspector(Action<bool, string, string, JsonNode?> applyChange, Action<string> selectConnection)
    {
        apply = applyChange;
        Name = "CanvasSelectionInspector";
        AutomationProperties.SetName(this, "Canvas selection");
        Padding = new Thickness(16);
        BorderThickness = new Thickness(1, 0, 0, 0);
        AutomationProperties.SetName(connections, "Canvas connections");
        connections.SelectionChanged += (_, _) => { if (!updating && connections.SelectedItem is ConnectionChoice choice) { selectConnection(choice.Id); } };
        var content = new StackPanel { Spacing = 20, Children = { heading, connections, fields, error } };
        Child = new ScrollViewer { Content = content, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        RefreshTheme();
    }

    public void RefreshTheme() { Background = NativePalette.Brush("SidebarBrush"); BorderBrush = NativePalette.Brush("DividerBrush"); }

    public void Update(NativeCanvasCard? card, NativeCanvasConnection? connection, int count, IReadOnlyList<NativeCanvasConnection> available)
    {
        var key = connection is null ? "card:" + card?.Id + ":" + card?.Type : "edge:" + connection.Id;
        var changed = key != selection;
        selection = key;
        updating = true;
        try
        {
            UpdateConnections(available, connection?.Id);
            if (changed) { fields.Children.Clear(); inputs.Clear(); error.Text = ""; }
            var cardTitle = card?.Type == "group" ? "Group" : "Canvas selection";
            heading.Text = connection is null ? cardTitle : "Connection";
            if (card is null && connection is null)
            {
                fields.Children.Clear(); inputs.Clear();
                fields.Children.Add(new TextBlock { Text = count > 0 ? count + " cards selected. Shift+click changes the selection; Connect joins two cards." : "Select a card or connection to edit its properties.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } });
                return;
            }
            var id = connection?.Id ?? card!.Id;
            UpdateFields(connection is null ? CardFields(card!) : ConnectionFields(connection), connection is not null, id);
        }
        finally { updating = false; }
    }

    private void UpdateConnections(IReadOnlyList<NativeCanvasConnection> available, string? selected)
    {
        var choices = available.Select((edge, index) => new ConnectionChoice(edge.Id, edge.Label.Length > 0 ? edge.Label : "Connection " + (index + 1))).ToArray();
        connections.ItemsSource = choices;
        connections.IsVisible = choices.Length > 0;
        connections.SelectedItem = choices.FirstOrDefault(choice => choice.Id == selected);
    }

    private void UpdateFields(IEnumerable<Field> definitions, bool connection, string id)
    {
        foreach (var field in definitions)
        {
            if (!inputs.TryGetValue(field.Key, out var input))
            {
                input = Input(field, connection, id);
                input.Name = "CanvasField_" + field.Key;
                AutomationProperties.SetName(input, field.Label);
                inputs.Add(field.Key, input);
                fields.Children.Add(new StackPanel { Spacing = 8, Children = { new TextBlock { Text = field.Label, TextWrapping = TextWrapping.Wrap }, input } });
            }
            if (!input.IsKeyboardFocusWithin) { Refresh(input, field); }
        }
    }

    private Control Input(Field field, bool connection, string id)
    {
        if (field.Options is { } options)
        {
            var choice = new ComboBox { ItemsSource = options, HorizontalAlignment = HorizontalAlignment.Stretch };
            choice.SelectionChanged += (_, _) => Change(connection, id, field.Key, () => choice.SelectedIndex <= 0 ? null : JsonValue.Create(choice.SelectedItem as string));
            return choice;
        }
        if (field.Minimum is { } minimum)
        {
            var number = new NumericUpDown { Minimum = minimum, Maximum = 10_000_000, Increment = 1, FormatString = "0" };
            number.ValueChanged += (_, _) => Change(connection, id, field.Key, () => Integer(number));
            return number;
        }
        var text = new TextBox { AcceptsReturn = field.Key == "text", TextWrapping = TextWrapping.Wrap, MinHeight = field.Key == "text" ? 150 : 32 };
        text.PropertyChanged += (_, args) =>
        {
            if (args.Property == TextBox.TextProperty) { Change(connection, id, field.Key, () => TextValue(field, text.Text)); }
        };
        return text;
    }

    private static JsonValue Integer(NumericUpDown input) => input.Value is decimal value && decimal.IsInteger(value) ? JsonValue.Create((int)value) : throw new InvalidDataException("Canvas geometry must use whole numbers.");
    private static JsonValue? TextValue(Field field, string? value) => field.Optional && string.IsNullOrEmpty(value) ? null : JsonValue.Create(value ?? "");

    private static void Refresh(Control input, Field field)
    {
        switch (input)
        {
            case ComboBox choice: choice.SelectedIndex = Math.Max(0, Array.IndexOf(field.Options!, field.Value)); break;
            case NumericUpDown number: number.Value = int.Parse(field.Value, CultureInfo.InvariantCulture); break;
            case TextBox text: text.Text = field.Value; break;
        }
    }

    private void Change(bool connection, string id, string key, Func<JsonNode?> value)
    {
        if (updating) { return; }
        try { apply(connection, id, key, value()); error.Text = ""; }
        catch (Exception exception) { error.Text = exception.Message; }
    }

    private static IEnumerable<Field> ConnectionFields(NativeCanvasConnection edge)
    {
        yield return new("label", "Connection label", edge.Label);
        yield return new("fromSide", "From side", edge.FromSide, Options: Sides);
        yield return new("toSide", "To side", edge.ToSide, Options: Sides);
        yield return new("fromEnd", "From end", edge.FromEnd, Options: Ends);
        yield return new("toEnd", "To end", edge.ToEnd, Options: Ends);
        yield return new("color", "Color (preset 1–6 or hex)", edge.Color ?? "", Optional: true);
    }

    private static IEnumerable<Field> CardFields(NativeCanvasCard card)
    {
        switch (card.Type)
        {
            case "text": yield return new("text", "Card Markdown", card.Text); break;
            case "file": yield return new("file", "Vault file path", card.Target); yield return new("subpath", "Heading or block", card.Subpath, Optional: true); break;
            case "link": yield return new("url", "Website URL", card.Target); break;
            case "group":
                yield return new("label", "Group label", card.Text);
                yield return new("background", "Group background image", card.Background, Optional: true);
                yield return new("backgroundStyle", "Background style", card.BackgroundStyle, Options: ["Default", "cover", "ratio", "repeat"]);
                break;
        }
        yield return new("x", "X", card.X.ToString(CultureInfo.InvariantCulture), Minimum: -10_000_000);
        yield return new("y", "Y", card.Y.ToString(CultureInfo.InvariantCulture), Minimum: -10_000_000);
        yield return new("width", "Width", card.Width.ToString(CultureInfo.InvariantCulture), Minimum: 1);
        yield return new("height", "Height", card.Height.ToString(CultureInfo.InvariantCulture), Minimum: 1);
        yield return new("color", "Color (preset 1–6 or hex)", card.Color ?? "", Optional: true);
    }

    private sealed record Field(string Key, string Label, string Value, string[]? Options = null, int? Minimum = null, bool Optional = false);
    private sealed record ConnectionChoice(string Id, string Label)
    {
        public override string ToString() => Label;
    }
}
