using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Layout;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeDraftRecoveryWindow : Window
{
    private readonly NativeWorkspace workspace;
    private readonly Func<Task> persist;
    private readonly ListBox drafts = new() { Name = "DraftRecoveryList" };
    private readonly TextBox preview = new() { Name = "DraftRecoveryPreview", IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("DejaVu Sans Mono, monospace") };
    private readonly TextBox destination = new() { Name = "DraftRecoveryDestination", Watermark = "New file path inside the vault" };
    private readonly TextBlock status = new() { Name = "DraftRecoveryStatus", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } };
    private readonly StackPanel confirmation = new() { Spacing = 10, IsVisible = false };
    private readonly Button save;
    private readonly Button discard;
    private bool busy;

    public NativeDraftRecoveryWindow(NativeWorkspace selectedWorkspace, Func<Task> persistProfile)
    {
        workspace = selectedWorkspace;
        persist = persistProfile;
        Title = "Recover unsaved drafts — Slopsidian";
        Width = 960;
        Height = 720;
        MinWidth = 760;
        MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var layout = new Grid { Margin = new Thickness(24), RowDefinitions = new RowDefinitions("Auto,*,Auto,Auto,Auto"), RowSpacing = 16 };
        layout.Children.Add(new StackPanel
        {
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = "Recover unsaved drafts", FontSize = 24, FontWeight = FontWeight.SemiBold },
                new TextBlock { Text = "These drafts were retained because their original files are missing. Preview a draft and save it to a free path in this vault.", TextWrapping = TextWrapping.Wrap, Classes = { "muted" } }
            }
        });
        var content = new Grid { ColumnDefinitions = new ColumnDefinitions("240,*"), ColumnSpacing = 16 };
        content.Children.Add(drafts);
        Grid.SetColumn(preview, 1);
        content.Children.Add(preview);
        Grid.SetRow(content, 1);
        layout.Children.Add(content);
        var path = new StackPanel { Spacing = 8, Children = { new TextBlock { Text = "Save as" }, destination } };
        Grid.SetRow(path, 2);
        layout.Children.Add(path);
        var feedback = new StackPanel { Spacing = 12, Children = { status, confirmation } };
        Grid.SetRow(feedback, 3);
        layout.Children.Add(feedback);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Spacing = 8 };
        discard = new Button { Content = "Discard draft…", Name = "DraftRecoveryDiscard" };
        discard.Click += (_, _) => ConfirmDiscard();
        save = new Button { Content = "Save recovered copy", Name = "DraftRecoverySave", IsDefault = true };
        save.Click += async (_, _) => await SaveAsync();
        var close = new Button { Content = "Close", IsCancel = true };
        close.Click += (_, _) => Close();
        actions.Children.Add(discard);
        actions.Children.Add(save);
        actions.Children.Add(close);
        Grid.SetRow(actions, 4);
        layout.Children.Add(actions);
        Content = layout;
        AutomationProperties.SetName(drafts, "Retained unsaved drafts");
        AutomationProperties.SetName(preview, "Retained draft text");
        AutomationProperties.SetName(destination, "Recovered file path inside the vault");
        drafts.ItemTemplate = new FuncDataTemplate<NativeTabState>((draft, _) => new TextBlock { Text = draft?.Path, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6) });
        drafts.SelectionChanged += (_, _) => SelectDraft();
        Closing += (_, args) => args.Cancel = busy;
        Reload();
    }

    private void Reload()
    {
        drafts.ItemsSource = workspace.OrphanedDrafts.ToArray();
        drafts.SelectedIndex = drafts.ItemCount > 0 ? 0 : -1;
        SelectDraft();
        status.Text = drafts.ItemCount == 0 ? "All retained drafts have been handled." : drafts.ItemCount + " retained drafts. Existing files will never be overwritten.";
    }

    private void SelectDraft()
    {
        var selected = drafts.SelectedItem as NativeTabState;
        preview.Text = selected?.Draft ?? "";
        destination.Text = selected?.Path ?? "";
        save.IsEnabled = selected is not null;
        discard.IsEnabled = selected is not null;
        confirmation.Children.Clear();
        confirmation.IsVisible = false;
    }

    private Task SaveAsync() => RunAsync(async () =>
    {
        if (drafts.SelectedItem is not NativeTabState selected) { return; }
        var recovered = await workspace.RecoverDraftAsync(selected, destination.Text ?? "");
        await persist();
        Reload();
        status.Text = "Saved " + recovered.Path + ".";
    });

    private void ConfirmDiscard()
    {
        if (drafts.SelectedItem is not NativeTabState selected || busy) { return; }
        confirmation.Children.Clear();
        confirmation.Children.Add(new TextBlock { Text = "Discard the retained draft for " + selected.Path + "?", FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        var accept = new Button { Content = "Discard this draft", Name = "DraftRecoveryConfirmDiscard", HorizontalAlignment = HorizontalAlignment.Left };
        accept.Click += async (_, _) => await RunAsync(async () =>
        {
            workspace.DiscardOrphanedDraft(selected);
            await persist();
            Reload();
        });
        confirmation.Children.Add(accept);
        confirmation.IsVisible = true;
    }

    private async Task RunAsync(Func<Task> operation)
    {
        if (busy) { return; }
        busy = true;
        drafts.IsEnabled = false;
        destination.IsEnabled = false;
        save.IsEnabled = false;
        discard.IsEnabled = false;
        confirmation.IsEnabled = false;
        status.Classes.Remove("error");
        try { await operation(); }
        catch (Exception exception) { status.Text = exception.Message; status.Classes.Add("error"); }
        finally
        {
            busy = false;
            drafts.IsEnabled = true;
            destination.IsEnabled = true;
            confirmation.IsEnabled = true;
            save.IsEnabled = drafts.SelectedItem is not null;
            discard.IsEnabled = drafts.SelectedItem is not null;
        }
    }
}
