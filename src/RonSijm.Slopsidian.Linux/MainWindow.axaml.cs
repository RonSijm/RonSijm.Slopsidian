using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using AvaloniaEdit.Document;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow : Window
{
    private readonly NativeProfile profile;
    private readonly Dictionary<NativeTab, TextDocument> buffers = [];
    private readonly DispatcherTimer refreshTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer previewTimer = new() { Interval = TimeSpan.FromMilliseconds(300) };
    private readonly DispatcherTimer profileTimer = new() { Interval = TimeSpan.FromMilliseconds(800) };
    private readonly DispatcherTimer autosaveTimer = new() { Interval = TimeSpan.FromMilliseconds(1500) };
    private readonly List<string> navigation = [];
    private int navigationIndex = -1;
    private CancellationTokenSource? search;
    private NativeTab? displayedTab;
    private bool busy;
    private bool loadingDocument;
    private bool selecting;
    private bool closeApproved;
    private bool profileWritable = true;
    private bool suppressHistory;
    private long revision;

    public MainWindow() : this(new NativeProfile()) { }

    public MainWindow(NativeProfile appProfile)
    {
        profile = appProfile;
        InitializeComponent();
        DocumentTabs.ItemsSource = Workspace.Tabs;
        Editor.TextChanged += EditorChanged;
        previewTimer.Tick += async (_, _) =>
        {
            previewTimer.Stop();
            UpdateInspector();
            if (EditorTabs.SelectedIndex == 1) { RenderReading(); }
            if (SplitPane.IsVisible) { RenderSplit(); }
            if (!string.IsNullOrWhiteSpace(SearchBox.Text)) { await UpdateSearchAsync(); }
        };
        profileTimer.Tick += async (_, _) => { profileTimer.Stop(); await PersistProfileSafelyAsync(); };
        Workspace.FileObserved += QueueRecovery;
        recoveryTimer.Tick += async (_, _) => await CaptureRecoveryAsync();
        recoveryTimer.Start();
        autosaveTimer.Tick += async (_, _) => await AutosaveAsync();
        refreshTimer.Tick += async (_, _) =>
        {
            if (!busy && Workspace.Snapshot.Root is not null && revision != Workspace.Revision)
            {
                await RunAsync(RefreshWorkspaceAsync, clearError: false);
            }
        };
        refreshTimer.Start();
        AddHandler(KeyDownEvent, HandleKey, RoutingStrategies.Tunnel);
        Closing += OnClosing;
        Closed += OnClosed;
        SizeChanged += (_, _) => AdaptSidebars();
    }

    public NativeWorkspace Workspace { get; } = new();

    public async Task InitializeAsync(string? directory)
    {
        try { await profile.LoadAsync(CancellationToken.None); }
        catch (Exception exception) when (exception is IOException or System.Text.Json.JsonException or InvalidDataException)
        {
            profileWritable = false;
            ShowError(exception);
        }
        ApplyPreferences();
        var initial = directory ?? profile.State.Session?.Root;
        if (initial is not null)
        {
            await OpenVaultAsync(initial);
        }
        else
        {
            ChooseVault(this, new RoutedEventArgs());
        }
    }

    public Task OpenVaultAsync(string directory) => RunAsync(async () =>
    {
        if (!await ConfirmAllEditsAsync()) { return; }
        await PersistProfileAsync();
        await Workspace.OpenVaultAsync(directory);
        await FinishVaultOpenAsync();
    });

    private async Task FinishVaultOpenAsync()
    {
        pendingRecovery.Clear();
        buffers.Clear();
        displayedTab = null;
        navigation.Clear();
        navigationIndex = -1;
        var root = Workspace.Snapshot.Root;
        var previous = profile.State.VaultSessions.GetValueOrDefault(root!) ?? profile.State.Session;
        if (previous is not null && previous.Root == root) { await Workspace.RestoreSessionAsync(previous); }
        var recent = new[] { root! }.Concat(profile.State.RecentVaults).Distinct(StringComparer.Ordinal).Take(20).ToArray();
        profile.State = profile.State with { RecentVaults = recent };
        VaultName.Text = Workspace.Snapshot.Name;
        ToolTip.SetTip(VaultName, root);
        VaultPath.Text = root;
        ToolTip.SetTip(VaultPath, root);
        revision = Workspace.Revision;
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        if (!string.IsNullOrEmpty(SearchBox.Text)) { SearchBox.Text = ""; }
        await Workspace.IndexAsync(CancellationToken.None);
        LoadEditor();
        UpdateBookmarks();
        await UpdateSearchAsync();
        await PersistProfileAsync();
    }

    private void EditorChanged(object? sender, EventArgs args)
    {
        if (loadingDocument) { return; }
        Workspace.Text = Editor.Text;
        UpdateStatus();
        RestartTimer(previewTimer);
        RestartTimer(profileTimer);
        if (profile.State.Preferences.Autosave) { RestartTimer(autosaveTimer); }
    }

    private static void RestartTimer(DispatcherTimer timer)
    {
        timer.Stop();
        timer.Start();
    }

    private async Task AutosaveAsync()
    {
        autosaveTimer.Stop();
        if (!profile.State.Preferences.Autosave || !Workspace.HasDirtyTabs) { return; }
        if (busy) { autosaveTimer.Start(); return; }
        await RunAsync(async () =>
        {
            foreach (var tab in Workspace.Tabs.Where(item => item.IsDirty && !item.ExternalChange).ToArray())
            {
                try { await Workspace.SaveTabAsync(tab); }
                catch (VaultException exception) when (exception.StatusCode == 409)
                {
                    tab.ExternalChange = true;
                    ShowError(exception);
                }
            }
            await PersistProfileAsync();
        }, clearError: false);
    }

    private async void Save(object? sender, RoutedEventArgs args) => await SaveAsync();

    private Task SaveAsync() => RunAsync(async () =>
    {
        await Workspace.SaveAsync();
        await PersistProfileAsync();
    });

    private async void Refresh(object? sender, RoutedEventArgs args) => await RunAsync(RefreshWorkspaceAsync);

    private async Task RefreshWorkspaceAsync()
    {
        revision = Workspace.Revision;
        await Workspace.RefreshAsync();
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        foreach (var tab in Workspace.Tabs.Where(tab => Workspace.Snapshot.Files.Any(file => file.Path == tab.Path)))
        {
            await Workspace.ReloadTabAsync(tab);
        }
        foreach (var tab in Workspace.Tabs.Where(tab => Workspace.Snapshot.Files.All(file => file.Path != tab.Path)))
        {
            tab.ExternalChange = true;
        }
        await Workspace.IndexAsync(CancellationToken.None);
        LoadEditor();
        await UpdateSearchAsync();
    }

    private void SaveEditorView()
    {
        if (displayedTab is null) { return; }
        displayedTab.Caret = Editor.CaretOffset;
        displayedTab.ScrollOffset = Editor.VerticalOffset;
        displayedTab.Reading = EditorTabs.SelectedIndex == 1;
    }

    private void LoadEditor()
    {
        SaveEditorView();
        var tab = Workspace.ActiveTab;
        loadingDocument = true;
        try
        {
            if (tab is not null)
            {
                if (!buffers.TryGetValue(tab, out var buffer))
                {
                    buffer = new TextDocument(tab.Text);
                    buffers.Add(tab, buffer);
                }
                else if (buffer.Text != tab.Text)
                {
                    buffer.Text = tab.Text;
                    buffer.UndoStack.ClearAll();
                }
                Editor.Document = buffer;
                Editor.CaretOffset = Math.Clamp(tab.Caret, 0, buffer.TextLength);
                Editor.ScrollToVerticalOffset(tab.ScrollOffset);
                EditorTabs.SelectedIndex = tab.Reading ? 1 : 0;
                NoteTitle.Text = tab.Path;
                AddNavigation(tab.Path);
            }
            else
            {
                Editor.Document = new TextDocument();
                NoteTitle.Text = "No file open";
            }
            displayedTab = tab;
            selecting = true;
            DocumentTabs.SelectedItem = tab;
            selecting = false;
            EmptyPanel.IsVisible = tab is null;
            EditorTabs.IsVisible = tab is not null;
            EmptyDescription.Text = Workspace.Snapshot.Root is null ? "Open a vault to start working with your notes." : "Create a new note with Ctrl+N, or open a note with Ctrl+O.";
        }
        finally { loadingDocument = false; }
        if (EditorTabs.SelectedIndex == 1) { RenderReading(); }
        RestoreSelection();
        UpdateInspector();
        UpdateStatus();
        RestartTimer(profileTimer);
    }

    private void UpdateStatus()
    {
        Title = (Workspace.IsDirty ? "* " : "") + (Workspace.Document?.File.Basename ?? "Slopsidian") + " — Slopsidian Native";
        SaveButton.IsEnabled = !busy && Workspace.IsDirty;
        NewNoteButton.IsEnabled = !busy && Workspace.Snapshot.Root is not null;
        RefreshButton.IsEnabled = !busy && Workspace.Snapshot.Root is not null;
        SearchBox.IsEnabled = Workspace.Snapshot.Root is not null;
        var state = Workspace.IsDirty ? "Unsaved changes" : "Saved";
        if (Workspace.ActiveTab?.ExternalChange == true) { state = "Changed on disk · draft retained"; }
        EditorStatus.Text = Workspace.Document is null ? "No note open" : state + "  ·  " + CountWords(Workspace.Text) + " words";
    }

    private static int CountWords(string text)
    {
        var count = 0;
        var inside = false;
        foreach (var character in text)
        {
            if (char.IsWhiteSpace(character)) { inside = false; }
            else if (!inside) { count++; inside = true; }
        }
        return count;
    }

    private void ModeChanged(object? sender, SelectionChangedEventArgs args)
    {
        if (loadingDocument || EditorTabs is null || ReadingContent is null) { return; }
        if (Workspace.ActiveTab is not null) { Workspace.ActiveTab.Reading = EditorTabs.SelectedIndex == 1; }
        if (EditorTabs.SelectedIndex == 1) { RenderReading(); }
    }

    private void RenderReading() => NativeMarkdown.Render(ReadingContent, Workspace.Text, Navigate, NavigateMarkdown);
    private void RenderSplit()
    {
        SplitTitle.Text = Workspace.Document?.File.Basename;
        NativeMarkdown.Render(SplitContent, Workspace.Text, Navigate, NavigateMarkdown);
    }

    private async Task PersistProfileAsync()
    {
        if (!profileWritable || Workspace.Snapshot.Root is null) { return; }
        SaveEditorView();
        var session = Workspace.CaptureSession();
        var sessions = new Dictionary<string, NativeSession>(profile.State.VaultSessions, StringComparer.Ordinal) { [session.Root] = session };
        profile.State = profile.State with { Session = session, VaultSessions = sessions };
        await profile.SaveAsync(CancellationToken.None);
    }

    private async Task PersistProfileSafelyAsync()
    {
        try { await PersistProfileAsync(); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException) { ShowError(exception); }
    }

    public async Task RunAsync(Func<Task> operation, bool clearError = true)
    {
        if (busy) { return; }
        busy = true;
        Editor.IsReadOnly = true;
        if (clearError) { ErrorPanel.IsVisible = false; }
        OpenVaultButton.IsEnabled = false;
        UpdateStatus();
        try { await recoveryTask; await operation(); }
        catch (Exception exception) { ShowError(exception); }
        finally
        {
            busy = false;
            Editor.IsReadOnly = false;
            OpenVaultButton.IsEnabled = true;
            UpdateStatus();
        }
    }

    private void ShowError(Exception exception)
    {
        ErrorText.Text = exception.Message;
        ErrorPanel.IsVisible = true;
    }
    private void DismissError(object? sender, RoutedEventArgs args) => ErrorPanel.IsVisible = false;

    private async Task<bool> ConfirmTabEditsAsync(NativeTab tab)
    {
        if (!tab.IsDirty) { return true; }
        var choice = await ConfirmAsync("Save your changes?", tab.Path + " has unsaved changes.", "Save", "Discard changes");
        if (choice == "Save") { await Workspace.SaveTabAsync(tab); return true; }
        if (choice != "Discard changes") { return false; }
        tab.Reload(tab.Document);
        return true;
    }

    private async Task<bool> ConfirmAllEditsAsync()
    {
        foreach (var tab in Workspace.Tabs.Where(item => item.IsDirty).ToArray())
        {
            if (!await ConfirmTabEditsAsync(tab)) { return false; }
        }
        return true;
    }

    private async void OnClosing(object? sender, WindowClosingEventArgs args)
    {
        if (closeApproved) { return; }
        args.Cancel = true;
        if (busy) { return; }
        await RunAsync(async () =>
        {
            StopTimers();
            if (!await ConfirmAllEditsAsync())
            {
                return;
            }
            await PersistProfileAsync();
            closeApproved = true;
        });
        if (closeApproved) { Close(); }
        else
        {
            refreshTimer.Start();
            recoveryTimer.Start();
            if (profile.State.Preferences.Autosave) { RestartTimer(autosaveTimer); }
            RestartTimer(profileTimer);
        }
    }

    private void StopTimers()
    {
        refreshTimer.Stop();
        previewTimer.Stop();
        profileTimer.Stop();
        autosaveTimer.Stop();
        recoveryTimer.Stop();
    }

    private void OnClosed(object? sender, EventArgs args)
    {
        StopTimers();
        search?.Cancel();
        search?.Dispose();
        Workspace.Dispose();
        profile.Dispose();
    }
}
