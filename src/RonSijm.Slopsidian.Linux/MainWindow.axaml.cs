using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using AvaloniaEdit.Document;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow : Window
{
    public NativeWorkspace Workspace { get; } = new();
    private readonly DispatcherTimer refreshTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer previewTimer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private CancellationTokenSource? search;
    private bool busy;
    private bool loadingDocument;
    private bool selecting;
    private bool closeApproved;
    private long revision;

    public MainWindow()
    {
        InitializeComponent();
        Editor.TextChanged += (_, _) =>
        {
            if (loadingDocument) return;
            Workspace.Text = Editor.Text;
            UpdateStatus();
            previewTimer.Stop();
            previewTimer.Start();
        };
        previewTimer.Tick += (_, _) => { previewTimer.Stop(); if (EditorTabs.SelectedIndex == 1) RenderReading(); };
        refreshTimer.Tick += async (_, _) =>
        {
            if (busy || Workspace.Snapshot.Root is null || revision == Workspace.Revision) return;
            await RunAsync(RefreshWorkspaceAsync, clearError: false);
        };
        refreshTimer.Start();
        AddHandler(KeyDownEvent, HandleKey, RoutingStrategies.Tunnel);
        Closing += OnClosing;
        Closed += (_, _) => { refreshTimer.Stop(); previewTimer.Stop(); search?.Cancel(); Workspace.Dispose(); };
    }

    public Task OpenVaultAsync(string directory) => RunAsync(async () =>
    {
        if (!await ConfirmEditsAsync()) return;
        await Workspace.OpenVaultAsync(directory);
        if (!string.IsNullOrEmpty(SearchBox.Text)) SearchBox.Text = "";
        VaultName.Text = Workspace.Snapshot.Name;
        VaultPath.Text = Workspace.Snapshot.Root;
        ToolTip.SetTip(VaultPath, Workspace.Snapshot.Root);
        revision = Workspace.Revision;
        LoadEditor();
        await UpdateSearchAsync();
    });

    private async void ChooseVault(object? sender, RoutedEventArgs args)
    {
        if (busy) return;
        try
        {
            var folders = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions { Title = "Open a Slopsidian or Obsidian vault", AllowMultiple = false });
            var path = folders.FirstOrDefault()?.TryGetLocalPath();
            if (path is not null) await OpenVaultAsync(path);
        }
        catch (Exception exception) { ShowError(exception); }
    }

    private async void NewNote(object? sender, RoutedEventArgs args) => await RunAsync(async () =>
    {
        if (!await ConfirmEditsAsync()) return;
        var path = await AskNoteNameAsync();
        if (path is null) return;
        try { await Workspace.CreateNoteAsync(path); }
        finally { LoadEditor(); }
        await UpdateSearchAsync();
        EditorTabs.SelectedIndex = 0;
        Editor.Focus();
    });

    private async void Save(object? sender, RoutedEventArgs args) => await RunAsync(async () =>
    {
        await Workspace.SaveAsync();
        UpdateStatus();
    });

    private async void Refresh(object? sender, RoutedEventArgs args) => await RunAsync(RefreshWorkspaceAsync);

    private async Task RefreshWorkspaceAsync()
    {
        // Capture before scanning so changes arriving during the scan schedule another refresh.
        var observedRevision = Workspace.Revision;
        await Workspace.RefreshAsync();
        revision = observedRevision;
        await UpdateSearchAsync();
        if (Workspace.Document is not null && !Workspace.IsDirty)
        {
            var current = Workspace.Document;
            await Workspace.OpenNoteAsync(current.File.Path);
            if (Workspace.Document!.Version != current.Version) LoadEditor();
        }
    }

    private async void NoteSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (selecting || NoteList.SelectedItem is not NoteResult note) return;
        if (busy) { RestoreSelection(); return; }
        if (note.Path == Workspace.Document?.File.Path) return;
        await RunAsync(async () =>
        {
            if (!await ConfirmEditsAsync()) { RestoreSelection(); return; }
            try { await Workspace.OpenNoteAsync(note.Path); LoadEditor(); }
            finally { RestoreSelection(); }
        });
    }

    private async void SearchChanged(object? sender, TextChangedEventArgs args)
    {
        if (SearchBox is null || Workspace.Snapshot.Root is null) return;
        await UpdateSearchAsync(debounce: true);
    }

    private async Task UpdateSearchAsync(bool debounce = false)
    {
        search?.Cancel();
        var cancellation = new CancellationTokenSource();
        search = cancellation;
        var query = SearchBox.Text ?? "";
        try
        {
            if (debounce) await Task.Delay(250, cancellation.Token);
            SearchStatus.Text = "Searching…";
            var results = await Task.Run(() => Workspace.SearchAsync(query, cancellation.Token), cancellation.Token);
            cancellation.Token.ThrowIfCancellationRequested();
            selecting = true;
            try { NoteList.ItemsSource = results; RestoreSelection(); }
            finally { selecting = false; }
            SearchStatus.Text = results.Count == 0 ? "No matching notes." : $"{results.Count} {(results.Count == 1 ? "note" : "notes")}";
        }
        catch (OperationCanceledException) { }
        catch (Exception exception) { if (!cancellation.IsCancellationRequested) ShowError(exception); }
        finally { if (ReferenceEquals(search, cancellation)) search = null; cancellation.Dispose(); }
    }

    private void RestoreSelection()
    {
        var previous = selecting;
        selecting = true;
        NoteList.SelectedItem = (NoteList.ItemsSource as IReadOnlyList<NoteResult>)?.FirstOrDefault(note => note.Path == Workspace.Document?.File.Path);
        selecting = previous;
    }

    private void LoadEditor()
    {
        loadingDocument = true;
        try { Editor.Document = new TextDocument(Workspace.Text); }
        finally { loadingDocument = false; }
        var hasDocument = Workspace.Document is not null;
        EmptyPanel.IsVisible = !hasDocument;
        if (Workspace.Snapshot.Root is not null)
        {
            EmptyTitle.Text = "Choose your next note";
            EmptyDescription.Text = "Select a note from the list, or start a new one. Search finds both note names and their contents.";
            EmptyHint.Text = "Ctrl+N creates a note. Ctrl+P takes you to search.";
        }
        EditorTabs.IsVisible = hasDocument;
        NoteTitle.Text = Workspace.Document?.File.Path ?? "Choose a note or create one";
        RenderReading();
        RestoreSelection();
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        Title = (Workspace.IsDirty ? "* " : "") + (Workspace.Document?.File.Name ?? "Slopsidian Native") + " — Slopsidian";
        SaveButton.IsEnabled = !busy && Workspace.IsDirty;
        NewNoteButton.IsEnabled = !busy && Workspace.Snapshot.Root is not null;
        RefreshButton.IsEnabled = !busy && Workspace.Snapshot.Root is not null;
        SearchBox.IsEnabled = Workspace.Snapshot.Root is not null;
        EditorStatus.Text = Workspace.Document is null ? "No note open"
            : (Workspace.IsDirty ? "Unsaved changes" : "Saved") + "  ·  " + Workspace.Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length + " words";
    }

    private void ModeChanged(object? sender, SelectionChangedEventArgs args)
    {
        if (EditorTabs is not null && ReadingContent is not null && EditorTabs.SelectedIndex == 1) RenderReading();
    }

    private void RenderReading() => NativeMarkdown.Render(ReadingContent, Workspace.Text, Navigate);

    private async void Navigate(string link) => await RunAsync(async () =>
    {
        if (Uri.TryCreate(link, UriKind.Absolute, out var url))
        {
            if (url.Scheme is not ("http" or "https")) throw new InvalidOperationException("Only web links and local Markdown note links can be opened.");
            Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
            return;
        }
        var path = Workspace.ResolveNoteLink(link);
        if (path == Workspace.Document?.File.Path) return;
        if (!await ConfirmEditsAsync()) return;
        await Workspace.OpenNoteAsync(path);
        LoadEditor();
    });

    public async Task RunAsync(Func<Task> operation, bool clearError = true)
    {
        if (busy) return;
        busy = true;
        Editor.IsReadOnly = true;
        if (clearError) ErrorPanel.IsVisible = false;
        OpenVaultButton.IsEnabled = false;
        UpdateStatus();
        try { await operation(); }
        catch (Exception exception) { ShowError(exception); }
        finally { busy = false; Editor.IsReadOnly = false; OpenVaultButton.IsEnabled = true; UpdateStatus(); }
    }

    private void ShowError(Exception exception)
    {
        ErrorText.Text = exception.Message;
        ErrorPanel.IsVisible = true;
    }

    private async Task<bool> ConfirmEditsAsync()
    {
        if (!Workspace.IsDirty) return true;
        var choice = await ConfirmAsync("Save your changes?", $"{Workspace.Document!.File.Path} has unsaved changes.", "Save", "Discard changes");
        if (choice == "Save") { await Workspace.SaveAsync(); UpdateStatus(); return true; }
        if (choice == "Discard changes") { Workspace.DiscardEdits(); LoadEditor(); return true; }
        return false;
    }

    private async Task<string?> AskNoteNameAsync()
    {
        var input = new TextBox { Watermark = "Note name or folder/note.md" };
        var dialog = Dialog("New note", out var content, out var actions);
        content.Children.Add(new TextBlock { Text = "Name", Margin = new Thickness(0, 0, 0, 8) });
        content.Children.Add(input);
        content.Children.Add(new TextBlock { Text = "Use / to create notes in subfolders.", Foreground = Brush.Parse("#a3a3a3"), Margin = new Thickness(0, 10, 0, 0) });
        var create = new Button { Content = "Create note", Classes = { "create" }, IsDefault = true };
        create.Click += (_, _) => { if (!string.IsNullOrWhiteSpace(input.Text)) dialog.Close(input.Text.Trim()); };
        actions.Children.Add(create);
        dialog.Opened += (_, _) => input.Focus();
        return await dialog.ShowDialog<string?>(this);
    }

    private async Task<string?> ConfirmAsync(string title, string message, params string[] choices)
    {
        var dialog = Dialog(title, out var content, out var actions);
        content.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap });
        foreach (var choice in choices)
        {
            var button = new Button { Content = choice };
            button.Click += (_, _) => dialog.Close(choice);
            actions.Children.Add(button);
        }
        return await dialog.ShowDialog<string?>(this);
    }

    private static Window Dialog(string title, out StackPanel content, out StackPanel actions)
    {
        var dialog = new Window { Title = title, Width = 500, SizeToContent = SizeToContent.Height, CanResize = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        var layout = new StackPanel { Margin = new Thickness(24), Spacing = 24 };
        content = new StackPanel();
        actions = new StackPanel { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 8, HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Right };
        var cancel = new Button { Content = "Cancel", IsCancel = true };
        cancel.Click += (_, _) => dialog.Close();
        actions.Children.Add(cancel);
        layout.Children.Add(content);
        layout.Children.Add(actions);
        dialog.Content = layout;
        return dialog;
    }

    private async void OnClosing(object? sender, WindowClosingEventArgs args)
    {
        if (closeApproved) return;
        args.Cancel = true;
        if (busy) return;
        await RunAsync(async () =>
        {
            if (!await ConfirmEditsAsync()) return;
            closeApproved = true;
        });
        if (closeApproved) Close();
    }

    private void HandleKey(object? sender, KeyEventArgs args)
    {
        if (args.KeyModifiers == KeyModifiers.Control)
        {
            switch (args.Key)
            {
                case Key.O: args.Handled = true; ChooseVault(this, new()); break;
                case Key.S when Workspace.Document is not null: args.Handled = true; Save(this, new()); break;
                case Key.N when Workspace.Snapshot.Root is not null: args.Handled = true; NewNote(this, new()); break;
                case Key.P: args.Handled = true; SearchBox.Focus(); SearchBox.SelectAll(); break;
            }
        }
        else if (args.Key == Key.F5 && Workspace.Snapshot.Root is not null) { args.Handled = true; Refresh(this, new()); }
    }
}
