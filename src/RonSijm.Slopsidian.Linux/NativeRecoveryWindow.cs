using System.Globalization;
using System.Text;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Layout;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeRecoveryWindow : Window
{
    private readonly NativeWorkspace workspace;
    private readonly TextBox search = new() { Name = "RecoverySearch", Watermark = "Search file history" };
    private readonly ListBox files = new() { Name = "RecoveryFiles" };
    private readonly ListBox versions = new() { Name = "RecoveryVersions" };
    private readonly TextBox preview = Preview("Snapshot preview", "RecoveryPreview");
    private readonly TextBlock status = new() { Name = "RecoveryStatus", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } };
    private readonly StackPanel review = new() { Name = "RecoveryReview", Spacing = 10, IsVisible = false };
    private readonly StackPanel toolbar = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly Button restore;
    private NativeRecoveryIndex? index;
    private NativeRecoverySnapshot? selected;
    private string? preferredPath;
    private bool busy;

    public NativeRecoveryWindow(NativeWorkspace selectedWorkspace)
    {
        workspace = selectedWorkspace;
        preferredPath = workspace.Document?.File.Path;
        Title = "File recovery — Slopsidian";
        Width = 1120;
        Height = 820;
        MinWidth = 860;
        MinHeight = 620;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var layout = new Grid { Margin = new Thickness(24), RowDefinitions = new RowDefinitions("Auto,Auto,Auto,*,Auto,Auto"), RowSpacing = 14 };
        layout.Children.Add(new StackPanel
        {
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = "File recovery", FontSize = 24, FontWeight = FontWeight.SemiBold },
                new TextBlock { Text = "Saved Markdown, Canvas and Bases versions from this vault. Unsaved drafts remain in the native app profile.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } }
            }
        });
        toolbar.Children.Add(Action("Snapshot current file", "RecoveryCapture", CaptureCurrentAsync));
        toolbar.Children.Add(Action("Reload history", "RecoveryReload", ReloadAsync));
        toolbar.Children.Add(Action("Clear history…", "RecoveryClear", ConfirmClearAsync));
        Add(layout, toolbar, 1);
        Add(layout, status, 2);
        var columns = new Grid { ColumnDefinitions = new ColumnDefinitions("230,220,*"), ColumnSpacing = 14 };
        var fileColumn = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), RowSpacing = 10 };
        fileColumn.Children.Add(search);
        Add(fileColumn, files, 1);
        columns.Children.Add(fileColumn);
        Grid.SetColumn(versions, 1);
        columns.Children.Add(versions);
        var snapshot = new Grid { RowDefinitions = new RowDefinitions("Auto,*"), RowSpacing = 10 };
        snapshot.Children.Add(new TextBlock { Text = "Snapshot text", FontWeight = FontWeight.SemiBold });
        Add(snapshot, preview, 1);
        Grid.SetColumn(snapshot, 2);
        columns.Children.Add(snapshot);
        Add(layout, columns, 3);
        Add(layout, review, 4);
        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        footer.Children.Add(Action("Copy snapshot", "RecoveryCopy", CopyAsync));
        restore = Action("Review restore…", "RecoveryPrepare", ReviewAsync);
        footer.Children.Add(restore);
        var close = new Button { Content = "Close", IsCancel = true };
        close.Click += (_, _) => Close();
        footer.Children.Add(close);
        Add(layout, footer, 5);
        Content = layout;
        AutomationProperties.SetName(search, "Search file history");
        AutomationProperties.SetName(files, "Files with saved versions");
        AutomationProperties.SetName(versions, "Saved versions");
        files.ItemTemplate = new FuncDataTemplate<string>((path, _) => new TextBlock { Text = path, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6) });
        versions.ItemTemplate = new FuncDataTemplate<NativeRecoverySnapshot>((entry, _) => new TextBlock
        {
            Text = SnapshotLabel(entry),
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 6)
        });
        files.SelectionChanged += (_, _) => ShowVersions();
        versions.SelectionChanged += (_, _) => ShowSnapshot();
        search.TextChanged += (_, _) => FilterFiles();
        Opened += async (_, _) => await RunAsync(ReloadAsync);
        Closing += (_, args) => args.Cancel = busy;
    }

    private static void Add(Grid layout, Control child, int row) { Grid.SetRow(child, row); layout.Children.Add(child); }

    private Button Action(string title, string name, Func<Task> operation)
    {
        var button = new Button { Content = title, Name = name };
        button.Click += async (_, _) => await RunAsync(operation);
        return button;
    }

    private async Task RunAsync(Func<Task> operation)
    {
        if (busy) { return; }
        busy = true;
        SetEnabled(false);
        status.Classes.Remove("error");
        try { await operation(); }
        catch (Exception exception) { status.Text = exception.Message; status.Classes.Add("error"); }
        finally { busy = false; SetEnabled(true); }
    }

    private void SetEnabled(bool enabled)
    {
        toolbar.IsEnabled = enabled;
        files.IsEnabled = enabled;
        versions.IsEnabled = enabled;
        search.IsEnabled = enabled;
        review.IsEnabled = enabled;
        restore.IsEnabled = enabled && selected is not null;
    }

    private async Task ReloadAsync()
    {
        index = await workspace.Recovery.ListAsync();
        FilterFiles();
        status.Text = index.Snapshots.Count == 0 ? "No snapshots yet. Open or save a file, or save a snapshot manually." : index.Snapshots.Count + " saved versions. Select a file and version to preview.";
    }

    private void FilterFiles()
    {
        var previous = files.SelectedItem as string ?? preferredPath;
        var paths = index?.Snapshots.Select(entry => entry.Path).Distinct(StringComparer.Ordinal).Where(path => path.Contains(search.Text ?? "", StringComparison.OrdinalIgnoreCase)).Order(StringComparer.Ordinal).ToArray() ?? [];
        files.ItemsSource = paths;
        files.SelectedItem = paths.Contains(previous, StringComparer.Ordinal) ? previous : paths.FirstOrDefault();
        ShowVersions();
    }

    private void ShowVersions()
    {
        preferredPath = files.SelectedItem as string ?? preferredPath;
        var snapshots = index?.Snapshots.Where(entry => entry.Path == files.SelectedItem as string).ToArray() ?? [];
        var prior = selected?.Id;
        versions.ItemsSource = snapshots;
        versions.SelectedItem = snapshots.FirstOrDefault(entry => entry.Id == prior) ?? snapshots.FirstOrDefault();
        ShowSnapshot();
    }

    private void ShowSnapshot()
    {
        selected = versions.SelectedItem as NativeRecoverySnapshot;
        preview.Text = selected?.Content ?? "";
        restore.IsEnabled = !busy && selected is not null;
        review.Children.Clear();
        review.IsVisible = false;
    }

    private async Task CaptureCurrentAsync()
    {
        var path = workspace.Document?.File.Path ?? throw new InvalidOperationException("Open a file before saving a snapshot.");
        var result = await workspace.Recovery.CaptureAsync(path, force: true);
        await ReloadAsync();
        status.Text = result switch { NativeCaptureResult.Added => "Snapshot saved.", null => "The current file no longer exists.", _ => "The saved file matches its latest snapshot." };
    }

    private async Task CopyAsync()
    {
        if (selected is not null && Clipboard is not null) { await Clipboard.SetTextAsync(selected.Content); status.Text = "Snapshot copied."; }
    }

    private async Task ReviewAsync()
    {
        if (selected is null) { return; }
        var plan = await workspace.Recovery.ReviewAsync(selected.Id);
        preview.Text = plan.Snapshot.Content;
        review.Children.Clear();
        review.Children.Add(new TextBlock { Text = plan.Before is null ? "Recreate " + plan.Snapshot.Path + "?" : "Replace " + plan.Snapshot.Path + "?", FontSize = 18, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        review.Children.Add(new TextBlock { Text = plan.Before is null ? "The original path will be recreated. A file appearing there invalidates this review." : "Current saved text is shown below. A recovery copy will be saved before replacement. External changes invalidate this review.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } });
        if (plan.Before is not null)
        {
            var before = Preview("Current saved text before restore", "RecoveryBefore");
            before.Text = plan.Before.Content;
            before.Height = 130;
            review.Children.Add(before);
        }
        var confirm = Action(plan.Before is null ? "Recreate file" : "Restore this version", "RecoveryConfirm", async () =>
        {
            await workspace.Recovery.RestoreAsync(plan);
            await ReloadAsync();
            status.Text = "Restored " + plan.Snapshot.Path + ".";
        });
        review.Children.Add(confirm);
        review.IsVisible = true;
        status.Text = "Review the snapshot and current saved text before restoring.";
    }

    private Task ConfirmClearAsync()
    {
        if (index is null) { return Task.CompletedTask; }
        var confirmation = index;
        review.Children.Clear();
        review.Children.Add(new TextBlock { Text = "Clear all " + confirmation.Snapshots.Count + " saved versions?", FontSize = 18, FontWeight = FontWeight.SemiBold });
        review.Children.Add(new TextBlock { Text = "This removes saved-file history from this vault. Your notes and unsaved drafts are retained.", TextWrapping = TextWrapping.Wrap });
        review.Children.Add(Action("Clear saved history", "RecoveryConfirmClear", async () =>
        {
            await workspace.Recovery.ClearAsync(confirmation);
            await ReloadAsync();
            status.Text = "Saved-file history cleared.";
        }));
        review.IsVisible = true;
        return Task.CompletedTask;
    }

    private static TextBox Preview(string label, string name)
    {
        var input = new TextBox { Name = name, IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("Cascadia Mono, DejaVu Sans Mono, monospace") };
        AutomationProperties.SetName(input, label);
        return input;
    }

    private static string SnapshotLabel(NativeRecoverySnapshot? entry)
    {
        if (entry is null) { return ""; }
        var encoding = entry.HasBom ? " · BOM" : "";
        return Timestamp(entry.Timestamp) + "\n" + Encoding.UTF8.GetByteCount(entry.Content) + " bytes · " + entry.Reason + encoding;
    }

    private static string Timestamp(long value) => value <= DateTimeOffset.MaxValue.ToUnixTimeMilliseconds()
        ? DateTimeOffset.FromUnixTimeMilliseconds(value).ToLocalTime().ToString("g", CultureInfo.CurrentCulture)
        : value.ToString(CultureInfo.CurrentCulture);
}
