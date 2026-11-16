using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeVaultChoice(string Path, string? CreateName = null);

public sealed class NativeVaultDialog : Window
{
    private readonly TextBox openPath = new() { PlaceholderText = "/home/you/Notes" };
    private readonly TextBox createName = new() { PlaceholderText = "My vault", MaxLength = 255 };
    private readonly TextBox createParent = new() { PlaceholderText = "Choose the parent folder" };
    private readonly TextBlock error = new() { Classes = { "error" }, TextWrapping = TextWrapping.Wrap };

    public NativeVaultDialog(IReadOnlyList<string> recent)
    {
        Title = "Open a vault";
        Width = 640;
        Height = recent.Count > 0 ? 760 : 600;
        MinWidth = 500;
        MinHeight = 500;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var content = new StackPanel { Margin = new Thickness(28), Spacing = 24 };
        content.Children.Add(new TextBlock { Text = "Open a vault", FontSize = 24, FontWeight = FontWeight.SemiBold });
        content.Children.Add(new TextBlock { Text = "A vault is a folder containing your notes. Open an existing folder or create a new one.", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
        if (recent.Count > 0) { content.Children.Add(RecentSection(recent)); }
        content.Children.Add(OpenSection());
        content.Children.Add(CreateSection());
        content.Children.Add(error);
        var cancel = new Button { Content = "Cancel", IsCancel = true, HorizontalAlignment = HorizontalAlignment.Right };
        cancel.Click += (_, _) => Close();
        content.Children.Add(cancel);
        Content = new ScrollViewer { Content = content, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
    }

    private StackPanel RecentSection(IEnumerable<string> recent)
    {
        var section = new StackPanel { Spacing = 10 };
        section.Children.Add(new TextBlock { Text = "Recent vaults", FontWeight = FontWeight.SemiBold });
        var choices = new StackPanel { Spacing = 6 };
        foreach (var path in recent.Take(8))
        {
            var button = new Button { HorizontalContentAlignment = HorizontalAlignment.Left, Content = new TextBlock { Text = System.IO.Path.GetFileName(path) + "  ·  " + path, TextTrimming = TextTrimming.CharacterEllipsis } };
            button.Click += (_, _) => Accept(path);
            choices.Children.Add(button);
        }
        section.Children.Add(new ScrollViewer { Content = choices, MaxHeight = 180 });
        return section;
    }

    private StackPanel OpenSection()
    {
        var section = new StackPanel { Spacing = 10 };
        section.Children.Add(new TextBlock { Text = "Open an existing vault", FontSize = 17, FontWeight = FontWeight.SemiBold });
        section.Children.Add(new TextBlock { Text = "Vault folder", Classes = { "muted" } });
        section.Children.Add(PathPicker(openPath));
        var open = new Button { Content = "Open vault", HorizontalAlignment = HorizontalAlignment.Left };
        open.Click += (_, _) => Accept(openPath.Text ?? "");
        section.Children.Add(open);
        return section;
    }

    private StackPanel CreateSection()
    {
        var section = new StackPanel { Spacing = 10 };
        section.Children.Add(new TextBlock { Text = "Create a new vault", FontSize = 17, FontWeight = FontWeight.SemiBold });
        section.Children.Add(new TextBlock { Text = "Vault name", Classes = { "muted" } });
        section.Children.Add(createName);
        section.Children.Add(new TextBlock { Text = "Parent folder", Classes = { "muted" }, Margin = new Thickness(0, 8, 0, 0) });
        section.Children.Add(PathPicker(createParent));
        var create = new Button
        {
            Classes = { "create" },
            HorizontalAlignment = HorizontalAlignment.Left,
            Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { new NativeIcon { Kind = "plus", Width = 16, Height = 16 }, new TextBlock { Text = "Create vault" } } }
        };
        create.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(createName.Text)) { error.Text = "Enter a vault name."; return; }
            if (!System.IO.Directory.Exists(createParent.Text)) { error.Text = "Choose an existing parent folder."; return; }
            Close(new NativeVaultChoice(System.IO.Path.GetFullPath(createParent.Text), createName.Text.Trim()));
        };
        section.Children.Add(create);
        return section;
    }

    private Grid PathPicker(TextBox input)
    {
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
        row.Children.Add(input);
        var browse = new Button { Content = "Browse…", Margin = new Thickness(8, 0, 0, 0) };
        Grid.SetColumn(browse, 1);
        browse.Click += async (_, _) =>
        {
            try
            {
                var choices = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions { Title = "Choose a vault folder", AllowMultiple = false });
                if (choices.Count > 0) { input.Text = choices[0].TryGetLocalPath(); }
            }
            catch (Exception exception) { error.Text = exception.Message; }
        };
        row.Children.Add(browse);
        return row;
    }

    private void Accept(string path)
    {
        if (!System.IO.Directory.Exists(path)) { error.Text = "The vault folder is unavailable. Choose another folder or reconnect its drive."; return; }
        Close(new NativeVaultChoice(System.IO.Path.GetFullPath(path)));
    }
}
