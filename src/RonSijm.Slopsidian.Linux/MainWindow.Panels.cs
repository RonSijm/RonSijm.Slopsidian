using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow
{
    private async void FileSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (selecting || busy || FileTree.SelectedItem is not NativeFileNode { IsFolder: false } node) { return; }
        await OpenPathAsync(node.Path);
    }

    private async void NoteSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (selecting || busy || NoteList.SelectedItem is not NoteResult note) { return; }
        await OpenPathAsync(note.Path, note.Offset);
    }

    private async void BookmarkSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (selecting || busy || BookmarkList.SelectedItem is not NoteResult note) { return; }
        await OpenPathAsync(note.Path);
    }

    private async void DocumentTabSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (selecting || busy || DocumentTabs.SelectedItem is not NativeTab tab) { return; }
        await RunAsync(() => { Workspace.Activate(tab); LoadEditor(); return Task.CompletedTask; });
    }

    private async void CloseDocumentTab(object? sender, RoutedEventArgs args)
    {
        args.Handled = true;
        if (sender is not Button { Tag: NativeTab tab }) { return; }
        await RunAsync(async () =>
        {
            if (!await ConfirmTabEditsAsync(tab)) { return; }
            Workspace.CloseTab(tab);
            DisposeCanvasView(tab);
            buffers.Remove(tab);
            LoadEditor();
            await PersistProfileAsync();
        });
    }

    private Task OpenPathAsync(string path, int? offset = null) => RunAsync(async () =>
    {
        await Workspace.OpenTabAsync(path);
        LoadEditor();
        if (offset is not null) { JumpToOffset(offset.Value); }
    });

    private async void SearchChanged(object? sender, TextChangedEventArgs args)
    {
        if (SearchBox is not null && Workspace.Snapshot.Root is not null) { await UpdateSearchAsync(debounce: true); }
    }

    private async Task UpdateSearchAsync(bool debounce = false)
    {
        if (search is not null) { await search.CancelAsync(); }
        using var cancellation = new CancellationTokenSource();
        search = cancellation;
        var query = SearchBox.Text ?? "";
        try
        {
            if (debounce) { await Task.Delay(250, cancellation.Token); }
            SearchStatus.Text = "Searching…";
            var results = await Workspace.SearchAsync(query, SearchMatchCase.IsChecked == true, cancellation.Token);
            cancellation.Token.ThrowIfCancellationRequested();
            selecting = true;
            NoteList.ItemsSource = results;
            RestoreSelection();
            selecting = false;
            SearchStatus.Text = query.Length == 0 ? "Enter a search query." : results.Count + " matching notes";
        }
        catch (OperationCanceledException) { /* A newer query owns the result list. */ }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested) { SearchStatus.Text = exception.Message; NoteList.ItemsSource = Array.Empty<NoteResult>(); }
        }
        finally
        {
            selecting = false;
            if (ReferenceEquals(search, cancellation)) { search = null; }
        }
    }

    private async void SearchOptionChanged(object? sender, RoutedEventArgs args)
    {
        if (SearchBox is not null && Workspace.Snapshot.Root is not null) { await UpdateSearchAsync(); }
    }

    private void RestoreSelection()
    {
        var previous = selecting;
        selecting = true;
        NoteList.SelectedItem = (NoteList.ItemsSource as IReadOnlyList<NoteResult>)?.FirstOrDefault(note => note.Path == Workspace.Document?.File.Path);
        selecting = previous;
    }

    private void UpdateInspector()
    {
        if (Workspace.Document is not { } document)
        {
            OutlineList.ItemsSource = Array.Empty<NativeHeading>();
            BacklinkList.ItemsSource = Array.Empty<NativeLocation>();
            OutgoingList.ItemsSource = Array.Empty<NativeLocation>();
            FootnoteList.ItemsSource = Array.Empty<NativeFootnote>();
            PropertyFields.Children.Clear();
            return;
        }
        var metadata = Workspace.MetadataFor(document.File.Path);
        OutlineList.ItemsSource = metadata.Headings;
        var backlinks = Workspace.Backlinks(document.File.Path);
        BacklinkList.ItemsSource = backlinks;
        OutgoingList.ItemsSource = metadata.Links.Select(link =>
        {
            var target = Workspace.ResolveLinkTarget(document.File.Path, link.Target);
            return new NativeLocation(link.Target, target ?? "", 0, target ?? "Unresolved note");
        }).ToArray();
        FootnoteList.ItemsSource = metadata.Footnotes;
        TagList.ItemsSource = Workspace.Notes.SelectMany(note => Workspace.MetadataFor(note.Path).Tags).GroupBy(tag => tag, StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase).Select(group => new NativeTag(group.Key, group.Count())).ToArray();
        BuildPropertyFields(metadata);
        MetadataStatus.Text = backlinks.Count + " backlinks  ·  " + metadata.Properties.Count + " properties";
    }

    private void BuildPropertyFields(NativeMetadata metadata)
    {
        PropertyFields.Children.Clear();
        PropertyFields.Children.Add(new TextBlock { Text = "Properties", FontWeight = FontWeight.SemiBold, Margin = new Thickness(0, 0, 0, 8) });
        if (metadata.PropertyError is not null)
        {
            PropertyFields.Children.Add(new TextBlock { Text = metadata.PropertyError, Classes = { "error" }, TextWrapping = TextWrapping.Wrap });
            return;
        }
        foreach (var property in metadata.Properties)
        {
            var field = new StackPanel { Spacing = 8, Margin = new Thickness(0, 0, 0, 8) };
            field.Children.Add(new TextBlock { Text = property.Key + " · " + property.Kind, Classes = { "muted" }, FontSize = 12 });
            var button = new Button { Content = new TextBlock { Text = property.Value, TextWrapping = TextWrapping.Wrap }, HorizontalContentAlignment = Avalonia.Layout.HorizontalAlignment.Left };
            button.Click += async (_, _) => await EditPropertyAsync(property.Key, property.Raw);
            field.Children.Add(button);
            PropertyFields.Children.Add(field);
        }
        var add = new Button { Content = "Add property", Classes = { "create" }, HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left };
        add.Click += async (_, _) =>
        {
            var key = await AskTextAsync("Add property", "Property name", "", "Continue");
            if (key is not null) { await EditPropertyAsync(key, "\"\""); }
        };
        PropertyFields.Children.Add(add);
    }

    private async Task EditPropertyAsync(string key, string raw) => await RunAsync(async () =>
    {
        var replacement = await AskTextAsync("Edit " + key, "YAML value", raw, "Apply");
        if (replacement is null) { return; }
        var updated = NativeFrontmatter.Set(Workspace.Text, key, replacement);
        Editor.Document.Replace(0, Editor.Document.TextLength, updated);
        UpdateInspector();
    });

    private void OutlineSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (OutlineList.SelectedItem is NativeHeading heading) { JumpToOffset(heading.Offset); }
    }

    private async void LocationSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (sender is ListBox { SelectedItem: NativeLocation location } && location.Path.Length > 0)
        {
            await OpenPathAsync(location.Path, location.Offset);
        }
    }

    private void FootnoteSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (FootnoteList.SelectedItem is NativeFootnote footnote) { JumpToOffset(footnote.Offset); }
    }

    private async void TagSelected(object? sender, SelectionChangedEventArgs args)
    {
        if (TagList.SelectedItem is not NativeTag tag) { return; }
        NavigationTabs.SelectedIndex = 1;
        SearchBox.Text = "tag:" + tag.Name;
        await UpdateSearchAsync();
    }

    private void InspectorChanged(object? sender, SelectionChangedEventArgs args)
    {
        if (!ReferenceEquals(args.Source, InspectorTabs)) { return; }
        if (OutlineList is not null && !loadingDocument) { UpdateInspector(); }
    }

    private void JumpToOffset(int offset)
    {
        Editor.CaretOffset = Math.Clamp(offset, 0, Editor.Document.TextLength);
        Editor.ScrollToLine(Editor.Document.GetLineByOffset(Editor.CaretOffset).LineNumber);
        if (Workspace.ActiveTab is not null) { Workspace.ActiveTab.Caret = Editor.CaretOffset; }
        EditorTabs.SelectedIndex = 0;
        Editor.TextArea.Focus();
    }

    private void ToggleLeft(object? sender, RoutedEventArgs args)
    {
        var column = WorkspaceGrid.ColumnDefinitions[1];
        column.Width = column.Width.Value > 0 ? new GridLength(0) : new GridLength(profile.State.Preferences.LeftWidth);
        LeftSidebar.IsVisible = column.Width.Value > 0;
        LeftSplitter.IsVisible = LeftSidebar.IsVisible;
    }

    private void ToggleRight(object? sender, RoutedEventArgs args)
    {
        var column = WorkspaceGrid.ColumnDefinitions[5];
        column.Width = column.Width.Value > 0 ? new GridLength(0) : new GridLength(profile.State.Preferences.RightWidth);
        RightSidebar.IsVisible = column.Width.Value > 0;
        RightSplitter.IsVisible = RightSidebar.IsVisible;
    }

    private void AdaptSidebars()
    {
        if (WorkspaceGrid is null) { return; }
        if (Bounds.Width < 1080 && RightSidebar.IsVisible) { ToggleRight(this, new RoutedEventArgs()); }
    }

    private void CollapseFolders(object? sender, RoutedEventArgs args)
    {
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
    }

    private void SplitEditor(object? sender, RoutedEventArgs args)
    {
        var visible = !SplitPane.IsVisible;
        SplitPane.IsVisible = visible;
        SplitDivider.IsVisible = visible;
        EditorArea.ColumnDefinitions[1].Width = new GridLength(visible ? 4 : 0);
        EditorArea.ColumnDefinitions[2].Width = visible ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        if (visible) { RenderSplit(); }
    }

    private sealed record NativeTag(string Name, int Count)
    {
        public override string ToString() => "#" + Name + "  " + Count;
    }
}
