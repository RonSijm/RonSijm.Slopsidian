using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Avalonia.Input;
using Avalonia.Interactivity;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow
{
    private async void ChooseVault(object? sender, RoutedEventArgs args) => await ChooseVaultAsync();

    private Task ChooseVaultAsync() => RunAsync(async () =>
    {
        var choice = await new NativeVaultDialog(profile.State.RecentVaults).ShowDialog<NativeVaultChoice?>(this);
        if (choice is null || !await ConfirmAllEditsAsync()) { return; }
        await PersistProfileAsync();
        if (choice.CreateName is not null)
        {
            var snapshot = await Workspace.Vault.CreateAsync(new CreateVaultRequest(choice.CreateName, choice.Path), CancellationToken.None);
            await Workspace.OpenVaultAsync(snapshot.Root!);
        }
        else { await Workspace.OpenVaultAsync(choice.Path); }
        await FinishVaultOpenAsync();
    });

    private async void NewNote(object? sender, RoutedEventArgs args) => await NewNoteAsync();

    private Task NewNoteAsync() => RunAsync(async () =>
    {
        var path = await AskTextAsync("New note", "Note name or folder/note.md", "", "Create note");
        if (path is null) { return; }
        if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) { path += ".md"; }
        var configuration = await Workspace.Vault.ReadConfigurationAsync("app", Workspace.Snapshot.Root, CancellationToken.None);
        path = NativeFileSettings.Read(configuration.Data).NotePath(path, Workspace.ActiveTab?.Path, Workspace.Snapshot);
        await Workspace.CreateTabAsync(path);
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        LoadEditor();
        EditorTabs.SelectedIndex = 0;
        Editor.TextArea.Focus();
    });

    private async void NewFolder(object? sender, RoutedEventArgs args) => await NewFolderAsync();

    private Task NewFolderAsync() => RunAsync(async () =>
    {
        var path = await AskTextAsync("New folder", "Folder path", "", "Create folder");
        if (path is null) { return; }
        await Workspace.Vault.CreateFolderAsync(new CreateVaultFolderRequest(Workspace.Snapshot.Root, path), CancellationToken.None);
        await RefreshWorkspaceAsync();
    });

    private async void QuickSwitcher(object? sender, RoutedEventArgs args) => await QuickSwitcherAsync();

    private Task QuickSwitcherAsync() => RunAsync(async () =>
    {
        var choices = Workspace.Notes.Select(note => new NativeChoice(note.Basename, note.Path, note.Path));
        var choice = await new NativePicker("Quick switcher", choices).ShowDialog<NativeChoice?>(this);
        if (choice is null) { return; }
        await Workspace.OpenTabAsync(choice.Value);
        LoadEditor();
    });

    private async void CommandPalette(object? sender, RoutedEventArgs args) => await CommandPaletteAsync();

    private async Task CommandPaletteAsync()
    {
        if (busy) { return; }
        var commands = Commands();
        var choice = await new NativePicker("Command palette", commands.Select(command => new NativeChoice(command.Name, command.Shortcut, command.Id))).ShowDialog<NativeChoice?>(this);
        if (choice is not null) { await commands.Single(command => command.Id == choice.Value).Execute(); }
    }

    private IReadOnlyList<NativeCommand> Commands() =>
    [
        new("file:new", "Create a new note", "Ctrl+N", NewNoteAsync),
        new("vault:open", "Open or create a vault", "Ctrl+Shift+O", ChooseVaultAsync),
        new("switcher:open", "Quick switcher: Open another note", "Ctrl+O", QuickSwitcherAsync),
        new("file:save", "Save current file", "Ctrl+S", SaveAsync),
        new("file:reload", "Reload current file", "", ReloadCurrentAsync),
        new("daily-notes:open", "Daily notes: Open today's note", "", OpenDailyNoteAsync),
        new("templates:insert", "Templates: Insert template", "", InsertTemplateAsync),
        new("draft-recovery:open", "Recover unsaved drafts for missing files", "", OpenDraftRecoveryAsync),
        new("file-recovery:open", "File recovery: Open saved versions", "", OpenRecoveryAsync),
        new("file-recovery:snapshot-current", "File recovery: Save recovery snapshot", "", SaveRecoverySnapshotAsync),
        new("graph:open", "Graph view: Open graph", "", OpenGraphAsync),
        new("bookmarks:add", "Bookmarks: Bookmark current file", "", BookmarkCurrentAsync),
        new("workspace:split", "Split workspace right", "", () => ExecuteSynchronous(() => SplitEditor(this, new RoutedEventArgs()))),
        new("workspace:toggle-left", "Toggle left sidebar", "", () => ExecuteSynchronous(() => ToggleLeft(this, new RoutedEventArgs()))),
        new("workspace:toggle-right", "Toggle right sidebar", "", () => ExecuteSynchronous(() => ToggleRight(this, new RoutedEventArgs()))),
        new("settings:open", "Open settings", "Ctrl+,", OpenSettingsAsync),
        new("random-note:open", "Random note: Open random note", "", RandomNoteAsync),
        new("workspaces:save", "Workspaces: Save current workspace", "", SaveWorkspaceAsync),
        new("workspaces:load", "Workspaces: Load workspace", "", LoadWorkspaceAsync)
    ];

    private static Task ExecuteSynchronous(Action action)
    {
        action();
        return Task.CompletedTask;
    }

    private async void OpenDailyNote(object? sender, RoutedEventArgs args) => await OpenDailyNoteAsync();

    private Task OpenDailyNoteAsync() => RunAsync(async () =>
    {
        var settings = await CoreSettingsAsync("daily-notes");
        var format = settings.Settings["format"]?.ToString() ?? "YYYY-MM-DD";
        var title = MomentDate(DateTime.Now, format);
        var folder = settings.Settings["folder"]?.ToString() ?? "";
        var path = (folder.Length == 0 ? "" : folder.TrimEnd('/') + "/") + title + ".md";
        if (Workspace.Snapshot.Files.Any(file => file.Path == path)) { await Workspace.OpenTabAsync(path); }
        else
        {
            var content = await TemplateContentAsync(settings.Settings["template"]?.ToString(), title);
            await Workspace.CreateTabAsync(path, content);
            FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        }
        LoadEditor();
    });

    private async void InsertTemplate(object? sender, RoutedEventArgs args) => await InsertTemplateAsync();

    private Task InsertTemplateAsync() => RunAsync(async () =>
    {
        if (Workspace.Document is null) { return; }
        var settings = await CoreSettingsAsync("templates");
        var folder = settings.Settings["folder"]?.ToString()?.Trim('/') ?? "";
        var choices = Workspace.Notes.Where(note => folder.Length == 0 || note.Path.StartsWith(folder + "/", StringComparison.Ordinal))
            .Select(note => new NativeChoice(note.Basename, note.Path, note.Path));
        var choice = await new NativePicker("Insert template", choices).ShowDialog<NativeChoice?>(this);
        if (choice is null) { return; }
        var content = await TemplateContentAsync(choice.Value, Workspace.Document.File.Basename);
        Editor.Document.Replace(Editor.SelectionStart, Editor.SelectionLength, content);
        EditorTabs.SelectedIndex = 0;
    });

    private async Task<CorePluginState> CoreSettingsAsync(string id)
    {
        var snapshot = await Workspace.Vault.ReadCorePluginsAsync(CancellationToken.None);
        var plugin = snapshot.Plugins.Single(item => item.Id == id);
        if (!plugin.Enabled) { throw new InvalidOperationException(plugin.Name + " is disabled in Core plugins settings."); }
        return plugin;
    }

    private async Task<string> TemplateContentAsync(string? path, string title)
    {
        if (string.IsNullOrWhiteSpace(path)) { return ""; }
        if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) { path += ".md"; }
        var document = await Workspace.Vault.ReadAsync(path, cancellationToken: CancellationToken.None, expectedRoot: Workspace.Snapshot.Root);
        return Regex.Replace(document.Content, @"\{\{(?<kind>date|time|title)(?::(?<format>[^}]+))?\}\}", match =>
        {
            var kind = match.Groups["kind"].Value;
            if (kind == "title") { return title; }
            var defaultFormat = kind == "date" ? "YYYY-MM-DD" : "HH:mm";
            var format = match.Groups["format"].Success ? match.Groups["format"].Value : defaultFormat;
            return MomentDate(DateTime.Now, format);
        }, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
    }

    private static string MomentDate(DateTime date, string format)
    {
        var converted = Regex.Replace(format, @"YYYY|YY|DD|D", match => match.Value switch { "YYYY" => "yyyy", "YY" => "yy", "DD" => "dd", _ => "d" }, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
        return date.ToString(converted, CultureInfo.CurrentCulture);
    }

    private async void BookmarkCurrent(object? sender, RoutedEventArgs args) => await BookmarkCurrentAsync();

    private Task BookmarkCurrentAsync() => RunAsync(async () =>
    {
        if (Workspace.Document is null) { return; }
        var key = Workspace.Snapshot.Root + "\0" + Workspace.Document.File.Path;
        profile.State = profile.State with { Bookmarks = profile.State.Bookmarks.Append(key).Distinct(StringComparer.Ordinal).ToArray() };
        UpdateBookmarks();
        await PersistProfileAsync();
    });

    private void UpdateBookmarks()
    {
        var prefix = Workspace.Snapshot.Root + "\0";
        BookmarkList.ItemsSource = profile.State.Bookmarks.Where(key => key.StartsWith(prefix, StringComparison.Ordinal)).Select(key => new NoteResult(key[prefix.Length..])).ToArray();
    }

    private async Task RandomNoteAsync() => await RunAsync(async () =>
    {
        var notes = Workspace.Notes.ToArray();
        if (notes.Length == 0) { return; }
        await Workspace.OpenTabAsync(notes[Random.Shared.Next(notes.Length)].Path);
        LoadEditor();
    });

    private async Task SaveWorkspaceAsync() => await RunAsync(async () =>
    {
        var name = await AskTextAsync("Save workspace", "Workspace name", "", "Save workspace");
        if (name is null || Workspace.Snapshot.Root is null) { return; }
        SaveEditorView();
        var workspaces = new Dictionary<string, NativeSession>(profile.State.Workspaces, StringComparer.Ordinal)
        {
            [NativeProfile.WorkspaceKey(Workspace.Snapshot.Root, name)] = Workspace.CaptureSession()
        };
        profile.State = profile.State with { Workspaces = workspaces };
        await PersistProfileAsync();
    });

    private async Task LoadWorkspaceAsync() => await RunAsync(async () =>
    {
        var root = Workspace.Snapshot.Root;
        if (root is null) { return; }
        var prefix = NativeProfile.WorkspaceKey(root, "");
        var choices = profile.State.Workspaces.Where(pair => pair.Key.StartsWith(prefix, StringComparison.Ordinal))
            .Select(pair => new NativeChoice(pair.Key[prefix.Length..], pair.Value.Tabs.Count + " tabs", pair.Key));
        var choice = await new NativePicker("Load workspace", choices).ShowDialog<NativeChoice?>(this);
        if (choice is null) { return; }
        await Workspace.RestoreSessionAsync(profile.State.Workspaces[choice.Value]);
        LoadEditor();
    });

    private void Navigate(string link) => _ = NavigateAsync(link);

    private void NavigateMarkdown(string link) => _ = NavigateAsync(link, true);

    private Task NavigateAsync(string link, bool markdown = false) => RunAsync(async () =>
    {
        var path = Workspace.ResolveLinkTarget(Workspace.ActiveTab?.Path ?? "", link, markdown);
        if (path is null && !link.StartsWith('/') && Uri.TryCreate(link, UriKind.Absolute, out var url))
        {
            if (url.Scheme is not ("http" or "https")) { throw new InvalidOperationException("Only web links and vault note links can be opened."); }
            Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true });
            return;
        }
        await Workspace.OpenTabAsync(path ?? Workspace.ResolveNoteLink(link, markdown));
        LoadEditor();
        NavigateToHeading(link, markdown);
    });

    private void NavigateToHeading(string link, bool markdown)
    {
        var anchor = link.Split('#', 2);
        if (anchor.Length > 1 && Workspace.Document is not null)
        {
            var fragment = markdown ? Uri.UnescapeDataString(anchor[1]) : anchor[1];
            var heading = Workspace.MetadataFor(Workspace.Document.File.Path).Headings.FirstOrDefault(item => item.Title.Equals(fragment, StringComparison.OrdinalIgnoreCase) || item.Title.Replace(' ', '-').Equals(fragment, StringComparison.OrdinalIgnoreCase));
            if (heading is not null) { JumpToOffset(heading.Offset); }
        }
    }

    private void AddNavigation(string path)
    {
        if (suppressHistory || navigationIndex >= 0 && navigation[navigationIndex] == path) { return; }
        if (navigationIndex + 1 < navigation.Count) { navigation.RemoveRange(navigationIndex + 1, navigation.Count - navigationIndex - 1); }
        navigation.Add(path);
        navigationIndex = navigation.Count - 1;
    }

    private async void NavigateBack(object? sender, RoutedEventArgs args) => await NavigateHistoryAsync(-1);
    private async void NavigateForward(object? sender, RoutedEventArgs args) => await NavigateHistoryAsync(1);
    private async Task NavigateHistoryAsync(int direction)
    {
        var target = navigationIndex + direction;
        if (target < 0 || target >= navigation.Count) { return; }
        await RunAsync(async () =>
        {
            suppressHistory = true;
            try { await Workspace.OpenTabAsync(navigation[target]); navigationIndex = target; LoadEditor(); }
            finally { suppressHistory = false; }
        });
    }

    private async void ReloadCurrent(object? sender, RoutedEventArgs args) => await ReloadCurrentAsync();

    private Task ReloadCurrentAsync() => RunAsync(async () =>
    {
        var tab = Workspace.ActiveTab;
        if (tab is null) { return; }
        if (tab.IsDirty && await ConfirmAsync("Reload from disk?", "Discard the draft in " + tab.Path + "?", "Reload and discard") != "Reload and discard") { return; }
        await Workspace.ReloadTabAsync(tab, discardDraft: true);
        LoadEditor();
    });

    private async void FileActions(object? sender, RoutedEventArgs args)
    {
        if (busy || Workspace.Document is null) { return; }
        var choices = new[]
        {
            new NativeChoice("Rename or move", "Update note links together with the file", "rename"),
            new NativeChoice("Move to vault trash", "Keep the saved file in .trash", "trash"),
            new NativeChoice("Save a copy", "Create a new note without overwriting an existing file", "copy"),
            new NativeChoice("Copy relative path", Workspace.Document.File.Path, "path"),
            new NativeChoice("Show in file manager", "Open the containing folder", "reveal"),
            new NativeChoice("File recovery", "Preview and restore saved versions", "recovery"),
            new NativeChoice("Reload from disk", "Reopen the saved version", "reload")
        };
        var choice = await new NativePicker("File actions", choices).ShowDialog<NativeChoice?>(this);
        if (choice is null) { return; }
        switch (choice.Value)
        {
            case "rename": await RenameCurrentAsync(); break;
            case "trash": await TrashCurrentAsync(); break;
            case "reload": await ReloadCurrentAsync(); break;
            case "recovery": await OpenRecoveryAsync(); break;
            case "path": if (Clipboard is not null) { await Clipboard.SetTextAsync(Workspace.Document.File.Path); } break;
            case "reveal": Process.Start(new ProcessStartInfo(System.IO.Path.GetDirectoryName(System.IO.Path.Combine(Workspace.Snapshot.Root!, Workspace.Document.File.Path))!) { UseShellExecute = true }); break;
            case "copy": await SaveCopyAsync(); break;
        }
    }

    private Task RenameCurrentAsync() => RunAsync(async () =>
    {
        var tab = Workspace.ActiveTab;
        if (tab is null || !await ConfirmAllEditsAsync()) { return; }
        var path = await AskTextAsync("Rename or move", "New path inside the vault", tab.Path, "Rename");
        if (path is null || path == tab.Path) { return; }
        var update = await ConfirmAsync("Update links?", "Update links in Markdown notes as part of the rename?", "Rename and update links", "Rename only");
        if (update is null) { return; }
        await Workspace.RenameAsync(tab, path, update == "Rename and update links");
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        LoadEditor();
        await PersistProfileAsync();
    });

    private Task TrashCurrentAsync() => RunAsync(async () =>
    {
        var tab = Workspace.ActiveTab;
        if (tab is null || !await ConfirmTabEditsAsync(tab)) { return; }
        var choice = await ConfirmAsync("Move to vault trash?", "Move " + tab.Path + " to the vault's .trash folder?", "Move to trash");
        if (choice != "Move to trash") { return; }
        await Workspace.TrashAsync(tab);
        buffers.Remove(tab);
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        LoadEditor();
        await PersistProfileAsync();
    });

    private async Task SaveCopyAsync() => await RunAsync(async () =>
    {
        var text = Workspace.Text;
        var path = await AskTextAsync("Save a copy", "New note path", Workspace.Document!.File.Basename + " copy.md", "Create copy");
        if (path is null) { return; }
        await Workspace.CreateTabAsync(path, text);
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        LoadEditor();
    });

    private void HandleKey(object? sender, KeyEventArgs args)
    {
        if (args.KeyModifiers == (KeyModifiers.Control | KeyModifiers.Shift) && args.Key == Key.O) { args.Handled = true; ChooseVault(this, new RoutedEventArgs()); return; }
        if (args.KeyModifiers == KeyModifiers.Alt)
        {
            if (args.Key == Key.Left) { args.Handled = true; NavigateBack(this, new RoutedEventArgs()); }
            if (args.Key == Key.Right) { args.Handled = true; NavigateForward(this, new RoutedEventArgs()); }
            return;
        }
        if (args.KeyModifiers == KeyModifiers.Control)
        {
            switch (args.Key)
            {
                case Key.O: args.Handled = true; QuickSwitcher(this, new RoutedEventArgs()); break;
                case Key.P: args.Handled = true; CommandPalette(this, new RoutedEventArgs()); break;
                case Key.N when Workspace.Snapshot.Root is not null: args.Handled = true; NewNote(this, new RoutedEventArgs()); break;
                case Key.S when Workspace.Document is not null: args.Handled = true; Save(this, new RoutedEventArgs()); break;
                case Key.OemComma: args.Handled = true; OpenSettings(this, new RoutedEventArgs()); break;
            }
        }
        else if (args.Key == Key.F5 && Workspace.Snapshot.Root is not null) { args.Handled = true; Refresh(this, new RoutedEventArgs()); }
    }

    private sealed record NativeCommand(string Id, string Name, string Shortcut, Func<Task> Execute);
}
