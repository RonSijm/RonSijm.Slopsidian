using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

internal static class NativeCanvasCardDialog
{
    public static Task<bool> EditAsync(Window owner, NativeCanvasCard card, Action<NativeCanvasCard> apply)
    {
        var dialog = new Window { Icon = owner.Icon, Title = "Edit Canvas card", Width = 620, Height = 720, MinWidth = 480, MinHeight = 500, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        var layout = new Grid { Margin = new Thickness(24), RowDefinitions = new RowDefinitions("Auto,*,Auto,Auto"), RowSpacing = 16 };
        layout.Children.Add(new TextBlock { Text = "Edit " + card.Type + " card", FontSize = 24, FontWeight = FontWeight.SemiBold });
        var fields = new StackPanel { Spacing = 16 };
        var x = Number(card.X, -10_000_000); var y = Number(card.Y, -10_000_000);
        var width = Number(card.Width, 1); var height = Number(card.Height, 1);
        var geometry = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*,*,*"), ColumnSpacing = 12 };
        AddGeometry(geometry, "X", x, 0); AddGeometry(geometry, "Y", y, 1); AddGeometry(geometry, "Width", width, 2); AddGeometry(geometry, "Height", height, 3);
        fields.Children.Add(geometry);
        var color = new TextBox { Text = card.Color ?? "", Watermark = "Default, preset 1–6, or a hexadecimal color" };
        Field(fields, "Color", color);
        var text = new TextBox { Text = card.Text, AcceptsReturn = card.Type == "text", TextWrapping = TextWrapping.Wrap, MinHeight = card.Type == "text" ? 220 : 32 };
        var target = new TextBox { Text = card.Target };
        var subpath = new TextBox { Text = card.Subpath, Watermark = "#Heading or #^block" };
        var background = new TextBox { Text = card.Background };
        var backgroundStyle = new TextBox { Text = card.BackgroundStyle };
        switch (card.Type)
        {
            case "text": Field(fields, "Markdown text", text); break;
            case "file": Field(fields, "File path inside the vault", target); Field(fields, "Section or block (optional)", subpath); break;
            case "link": Field(fields, "Website address", target); break;
            case "group": Field(fields, "Group label", text); Field(fields, "Background image path (optional)", background); Field(fields, "Background style (optional)", backgroundStyle); break;
            default: fields.Children.Add(new TextBlock { Text = "This card type is preserved. Its custom fields can be edited in Source.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } }); break;
        }
        var scroll = new ScrollViewer { Content = fields };
        Grid.SetRow(scroll, 1); layout.Children.Add(scroll);
        var error = new TextBlock { TextWrapping = TextWrapping.Wrap, Classes = { "error" } };
        Grid.SetRow(error, 2); layout.Children.Add(error);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        var cancel = new Button { Content = "Cancel", IsCancel = true };
        cancel.Click += (_, _) => dialog.Close(false);
        var save = new Button { Content = "Apply card changes", IsDefault = true };
        save.Click += (_, _) =>
        {
            try
            {
                var tint = string.IsNullOrWhiteSpace(color.Text) ? null : color.Text.Trim();
                var changed = card with
                {
                    X = Integer(x),
                    Y = Integer(y),
                    Width = Integer(width),
                    Height = Integer(height),
                    Color = tint,
                    Text = text.Text ?? "",
                    Target = target.Text ?? "",
                    Subpath = subpath.Text ?? "",
                    Background = background.Text ?? "",
                    BackgroundStyle = backgroundStyle.Text ?? ""
                };
                apply(changed);
                dialog.Close(true);
            }
            catch (Exception exception) { error.Text = exception.Message; }
        };
        actions.Children.Add(cancel); actions.Children.Add(save);
        Grid.SetRow(actions, 3); layout.Children.Add(actions);
        dialog.Content = layout;
        return dialog.ShowDialog<bool>(owner);
    }

    private static NumericUpDown Number(int value, int minimum) => new() { Value = value, Minimum = minimum, Maximum = 10_000_000, Increment = 1, FormatString = "0" };
    private static int Integer(NumericUpDown input) => input.Value is decimal value && decimal.IsInteger(value) ? (int)value : throw new InvalidDataException("Canvas geometry must use whole numbers.");
    private static void AddGeometry(Grid layout, string label, Control control, int column)
    {
        var field = new StackPanel { Spacing = 8, Children = { new TextBlock { Text = label }, control } };
        Grid.SetColumn(field, column); layout.Children.Add(field);
    }
    private static void Field(StackPanel fields, string label, Control control) => fields.Children.Add(new StackPanel { Spacing = 8, Children = { new TextBlock { Text = label }, control } });
}
