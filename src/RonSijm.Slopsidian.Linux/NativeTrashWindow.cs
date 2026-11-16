using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Layout;
using Avalonia.Media;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeTrashWindow : Window
{
    private readonly NativeWorkspace workspace;
    private readonly string root;
    private readonly long epoch;
    private readonly ListBox entries = new() { Name = "TrashEntries", SelectionMode = SelectionMode.Multiple };
    private readonly ComboBox folder = new() { Name = "TrashDestination", MinWidth = 200 };
    private readonly TextBox preview = new() { Name = "TrashPreview", IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("DejaVu Sans Mono, monospace") };
    private readonly TextBlock status = new() { Name = "TrashStatus", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } };
    private readonly StackPanel review = new() { Spacing = 10, IsVisible = false };
    private readonly Button prepare;
    private readonly Button reload;
    private bool busy;

    public NativeTrashWindow(NativeWorkspace selectedWorkspace)
    {
        workspace = selectedWorkspace;
        root = workspace.Snapshot.Root ?? throw new InvalidOperationException("Open a vault first.");
        epoch = workspace.VaultEpoch;
        Title = "Vault trash — Slopsidian";
        Width = 1040;
        Height = 760;
        MinWidth = 780;
        MinHeight = 580;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var layout = new Grid { Margin = new Thickness(24), RowDefinitions = new RowDefinitions("Auto,Auto,*,Auto,Auto,Auto"), RowSpacing = 16 };
        layout.Children.Add(new StackPanel
        {
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = "Vault trash", FontSize = 24, FontWeight = FontWeight.SemiBold },
                new TextBlock { Text = "Preview UTF-8 Markdown notes from this vault’s .trash folder. Choose up to 20 notes and an existing destination folder before reviewing a restore.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } }
            }
        });
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        reload = MakeButton("Reload trash", "TrashReload", ReloadAsync);
        toolbar.Children.Add(reload);
        toolbar.Children.Add(new TextBlock { Text = "Restore folder", VerticalAlignment = VerticalAlignment.Center });
        folder.ItemsSource = (workspace.Snapshot.Folders ?? []).Prepend("/").Distinct(StringComparer.Ordinal).ToArray();
        folder.SelectedIndex = 0;
        toolbar.Children.Add(folder);
        Add(layout, toolbar, 1);
        var content = new Grid { ColumnDefinitions = new ColumnDefinitions("300,*"), ColumnSpacing = 16 };
        content.Children.Add(entries);
        Grid.SetColumn(preview, 1);
        content.Children.Add(preview);
        Add(layout, content, 2);
        Add(layout, status, 3);
        Add(layout, review, 4);
        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        prepare = MakeButton("Review restore…", "TrashPrepare", ReviewAsync);
        footer.Children.Add(prepare);
        var close = new Button { Content = "Close", IsCancel = true };
        close.Click += (_, _) => Close();
        footer.Children.Add(close);
        Add(layout, footer, 5);
        Content = layout;
        AutomationProperties.SetName(entries, "Vault trash notes");
        AutomationProperties.SetName(folder, "Destination folder for restored notes");
        AutomationProperties.SetName(preview, "Selected trash note text");
        entries.ItemTemplate = new FuncDataTemplate<VaultTrashEntry>((entry, _) => new StackPanel
        {
            Spacing = 4,
            Margin = new Thickness(0, 6),
            Children = { new TextBlock { Text = entry?.Name, TextWrapping = TextWrapping.Wrap }, new TextBlock { Text = entry?.Size + " bytes", Classes = { "muted" }, FontSize = 12 } }
        });
        entries.SelectionChanged += async (_, _) => { if (!busy) { await RunAsync(PreviewAsync); } };
        folder.SelectionChanged += (_, _) => HideReview();
        Opened += async (_, _) => await RunAsync(ReloadAsync);
        Closing += (_, args) => args.Cancel = busy;
    }

    private static void Add(Grid layout, Control child, int row) { Grid.SetRow(child, row); layout.Children.Add(child); }
    private Button MakeButton(string text, string name, Func<Task> operation)
    {
        var result = new Button { Content = text, Name = name };
        result.Click += async (_, _) => await RunAsync(operation);
        return result;
    }

    private async Task RunAsync(Func<Task> operation)
    {
        if (busy) { return; }
        busy = true;
        SetEnabled(false);
        status.Classes.Remove("error");
        try { Guard(); await operation(); }
        catch (Exception exception) { status.Text = exception.Message; status.Classes.Add("error"); }
        finally { busy = false; SetEnabled(true); }
    }

    private void SetEnabled(bool enabled)
    {
        entries.IsEnabled = enabled;
        folder.IsEnabled = enabled;
        reload.IsEnabled = enabled;
        review.IsEnabled = enabled;
        prepare.IsEnabled = enabled && entries.SelectedItems?.Count > 0;
    }

    private async Task ReloadAsync()
    {
        var listing = await workspace.Vault.ListTrashAsync(root, CancellationToken.None);
        Guard();
        entries.ItemsSource = listing.Entries;
        entries.SelectedIndex = listing.Entries.Count > 0 ? 0 : -1;
        await PreviewAsync();
        var noun = listing.Entries.Count == 1 ? "note" : "notes";
        status.Text = listing.Entries.Count + " restorable " + noun + (listing.Ignored > 0 ? " · " + listing.Ignored + " unsupported entries retained" : "") + ". Existing files will never be overwritten.";
    }

    private async Task PreviewAsync()
    {
        HideReview();
        preview.Text = "";
        if (entries.SelectedItem is not VaultTrashEntry entry) { return; }
        var document = await workspace.Vault.PreviewTrashAsync(root, entry.Path, entry.Token, CancellationToken.None);
        Guard();
        preview.Text = document.Content;
    }

    private async Task ReviewAsync()
    {
        RequireClean();
        var selected = entries.SelectedItems?.OfType<VaultTrashEntry>().Select(entry => new VaultTrashSelection(entry.Path, entry.Token)).ToArray() ?? [];
        var plan = await workspace.Vault.ReviewTrashRestoreAsync(new(root, folder.SelectedItem as string ?? "/", selected), CancellationToken.None);
        Guard();
        RequireClean();
        review.Children.Clear();
        var noun = plan.Items.Count == 1 ? "note" : "notes";
        review.Children.Add(new TextBlock { Text = "Restore " + plan.Items.Count + " " + noun + "?", FontSize = 18, FontWeight = FontWeight.SemiBold });
        var paths = new SelectableTextBlock { Text = string.Join('\n', plan.Items.Select(item => item.TrashPath + " → " + item.NewPath)), TextWrapping = TextWrapping.Wrap };
        review.Children.Add(new ScrollViewer { Content = paths, MaxHeight = 130 });
        review.Children.Add(MakeButton("Restore reviewed notes", "TrashConfirm", () => RestoreAsync(plan)));
        review.IsVisible = true;
        status.Text = "Review the destination paths. Changes to files or folders invalidate this review.";
    }

    private async Task RestoreAsync(VaultTrashRestoreReview plan)
    {
        var restored = 0;
        Exception? failure = null;
        foreach (var item in plan.Items)
        {
            try
            {
                Guard();
                RequireClean();
                await workspace.Vault.RestoreTrashAsync(new(root, plan.Token, item.TrashPath), CancellationToken.None);
                restored++;
            }
            catch (Exception exception) { failure = exception; break; }
        }
        try { await ReloadAsync(); }
        catch (Exception exception) { failure ??= exception; }
        var noun = restored == 1 ? "note" : "notes";
        status.Text = "Restored " + restored + " " + noun + ".";
        if (failure is not null) { status.Text += " " + failure.Message; status.Classes.Add("error"); }
    }

    private void HideReview() { review.Children.Clear(); review.IsVisible = false; }
    private void Guard()
    {
        if (workspace.Snapshot.Root != root || workspace.VaultEpoch != epoch) { throw new InvalidOperationException("This trash window belongs to a previous vault session. Reopen vault trash."); }
    }
    private void RequireClean()
    {
        if (workspace.HasDirtyTabs || workspace.OrphanedDrafts.Count > 0) { throw new InvalidOperationException("Save or recover unsaved drafts before restoring notes from trash. Their text was retained."); }
    }
}
