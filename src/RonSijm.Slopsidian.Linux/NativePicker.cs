using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Input;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeChoice(string Name, string Detail, string Value);

public sealed class NativePicker : Window
{
    private readonly NativeChoice[] choices;
    private readonly TextBox query = new() { PlaceholderText = "Type to search" };
    private readonly ListBox results = new() { BorderThickness = new Thickness(0) };

    public NativePicker(string title, IEnumerable<NativeChoice> items)
    {
        choices = items.ToArray();
        Title = title;
        Width = 620;
        Height = 480;
        MinWidth = 400;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var layout = new Grid { Margin = new Thickness(20), RowDefinitions = new RowDefinitions("Auto,Auto,*,Auto") };
        layout.Children.Add(new TextBlock { Text = title, FontSize = 18, FontWeight = Avalonia.Media.FontWeight.SemiBold, Margin = new Thickness(0, 0, 0, 16) });
        Grid.SetRow(query, 1);
        query.Margin = new Thickness(0, 0, 0, 12);
        layout.Children.Add(query);
        results.ItemTemplate = new FuncDataTemplate<NativeChoice>((choice, _) => new StackPanel
        {
            Spacing = 4,
            Margin = new Thickness(0, 5),
            Children =
            {
                new TextBlock { Text = choice?.Name, TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis },
                new TextBlock { Text = choice?.Detail, Classes = { "muted" }, FontSize = 12, TextWrapping = Avalonia.Media.TextWrapping.Wrap }
            }
        });
        Grid.SetRow(results, 2);
        layout.Children.Add(results);
        var hint = new TextBlock { Text = "Enter to open · Esc to cancel", Classes = { "muted" }, FontSize = 12, Margin = new Thickness(0, 12, 0, 0) };
        Grid.SetRow(hint, 3);
        layout.Children.Add(hint);
        Content = layout;
        query.TextChanged += (_, _) => Filter();
        results.DoubleTapped += (_, _) => Accept();
        KeyDown += HandleKey;
        Opened += (_, _) => query.Focus();
        Filter();
    }

    private void Filter()
    {
        var terms = (query.Text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        results.ItemsSource = choices.Where(choice => terms.All(term => choice.Name.Contains(term, StringComparison.OrdinalIgnoreCase) || choice.Detail.Contains(term, StringComparison.OrdinalIgnoreCase))).Take(100).ToArray();
        results.SelectedIndex = results.ItemCount > 0 ? 0 : -1;
    }

    private void Accept()
    {
        if (results.SelectedItem is NativeChoice choice) { Close(choice); }
    }

    private void HandleKey(object? sender, KeyEventArgs args)
    {
        switch (args.Key)
        {
            case Key.Escape: args.Handled = true; Close(); break;
            case Key.Enter: args.Handled = true; Accept(); break;
            case Key.Down: args.Handled = true; MoveSelection(1); break;
            case Key.Up: args.Handled = true; MoveSelection(-1); break;
        }
    }

    private void MoveSelection(int direction)
    {
        if (results.ItemCount == 0) { return; }
        results.SelectedIndex = Math.Clamp(results.SelectedIndex + direction, 0, results.ItemCount - 1);
        if (results.SelectedItem is not null) { results.ScrollIntoView(results.SelectedItem); }
    }
}
