using System.Text.Json.Nodes;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using AvaloniaEdit.Document;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeCanvasView : UserControl, IDisposable
{
    private readonly NativeWorkspace workspace;
    private readonly NativeTab tab;
    private readonly TextDocument source;
    private readonly string root;
    private readonly long epoch;
    private readonly Action<string> openPath;
    private readonly Action<string, string, bool> navigate;
    private readonly NativeCanvasSurface surface;
    private readonly TextBlock status = new() { Classes = { "muted" }, TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel error = new() { Spacing = 16, Margin = new Thickness(32), IsVisible = false };
    private readonly TextBlock errorText = new() { TextWrapping = TextWrapping.Wrap, Classes = { "error" } };
    private readonly TextBlock zoom = new() { VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } };
    private readonly NativeCanvasInspector inspector;
    private readonly ContentControl inspectorHost = new();
    private readonly Grid boardLayout = new() { ColumnDefinitions = new ColumnDefinitions("*,260") };
    private readonly Flyout inspectorFlyout = new() { Placement = PlacementMode.BottomEdgeAlignedRight };
    private readonly Button inspectorToggle;
    private NativeCanvasDocument? model;
    private bool disposed;
    private bool stale;
    private bool compact;
    private bool changingPanel;
    private bool? inspectorExpanded;

    public NativeCanvasView(NativeWorkspace selectedWorkspace, NativeTab selectedTab, TextDocument document, Action showSource, Action<string> openFile, Action<string, string, bool> navigateLink)
    {
        workspace = selectedWorkspace; tab = selectedTab; source = document;
        root = workspace.Snapshot.Root ?? throw new InvalidOperationException("Open a vault first.");
        epoch = workspace.VaultEpoch;
        openPath = openFile;
        navigate = navigateLink;
        surface = new NativeCanvasSurface(CardContent) { Name = "CanvasBoard" };
        inspector = new NativeCanvasInspector(ApplyInspectorChange, surface.SelectConnection);
        inspectorHost.Content = inspector;
        inspectorToggle = Button("Inspector", "CanvasInspector", ToggleInspector);
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        var toolbar = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(12, 8), ItemSpacing = 8, LineSpacing = 8 };
        toolbar.Children.Add(Button("Text card", "CanvasAddText", () => AddCard("text")));
        toolbar.Children.Add(Button("Note", "CanvasAddFile", () => AddCard("file")));
        toolbar.Children.Add(Button("Website", "CanvasAddLink", () => AddCard("link")));
        toolbar.Children.Add(Button("Group", "CanvasAddGroup", () => AddCard("group")));
        toolbar.Children.Add(inspectorToggle);
        toolbar.Children.Add(Button("Connect", "CanvasConnect", ConnectSelection));
        toolbar.Children.Add(Button("Delete", "CanvasDelete", DeleteSelection));
        toolbar.Children.Add(Button("Undo", "CanvasUndo", () => Undo(false)));
        toolbar.Children.Add(Button("Redo", "CanvasRedo", () => Undo(true)));
        toolbar.Children.Add(Button("Fit", "CanvasFit", surface.Fit));
        layout.Children.Add(toolbar);
        var content = new Grid();
        content.Children.Add(surface);
        error.Children.Add(new TextBlock { Text = "Canvas source needs attention", FontSize = 22, FontWeight = FontWeight.SemiBold });
        error.Children.Add(errorText);
        error.Children.Add(Button("Edit Canvas source", "CanvasInvalidSource", showSource));
        content.Children.Add(error);
        boardLayout.Children.Add(content);
        Grid.SetColumn(inspectorHost, 1); boardLayout.Children.Add(inspectorHost);
        Grid.SetRow(boardLayout, 1); layout.Children.Add(boardLayout);
        var footer = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto,Auto,Auto"), Margin = new Thickness(12, 8), ColumnSpacing = 8 };
        footer.Children.Add(status);
        Grid.SetColumn(zoom, 1); footer.Children.Add(zoom);
        var smaller = Button("Zoom out", "CanvasZoomOut", () => surface.ZoomBy(1 / 1.2)); Grid.SetColumn(smaller, 2); footer.Children.Add(smaller);
        var larger = Button("Zoom in", "CanvasZoomIn", () => surface.ZoomBy(1.2)); Grid.SetColumn(larger, 3); footer.Children.Add(larger);
        Grid.SetRow(footer, 2); layout.Children.Add(footer);
        Content = layout;
        surface.CardsMoved += (ids, x, y) => Change(current => current.MoveCards(ids, x, y));
        surface.CardResized += (id, width, height) => Change(current => current.UpdateCard(id, node => { node["width"] = width; node["height"] = height; }));
        surface.SelectionChanged += UpdateSelection;
        surface.CameraChanged += () => zoom.Text = Math.Round(surface.Zoom * 100) + "%";
        surface.EditRequested += _ => Run(OpenInspector);
        surface.ConnectionEditRequested += _ => Run(OpenInspector);
        surface.DeleteRequested += () => Run(DeleteSelection);
        surface.CopyRequested += async () => await RunAsync(CopyAsync);
        surface.PasteRequested += async () => await RunAsync(PasteAsync);
        surface.UndoRequested += redo => Run(() => Undo(redo));
        source.TextChanged += SourceChanged;
        SizeChanged += (_, _) => UpdateInspectorLayout();
        inspectorFlyout.Opened += (_, _) => { if (!changingPanel) { inspectorExpanded = true; } };
        inspectorFlyout.Closed += (_, _) => { if (compact && !changingPanel) { inspectorExpanded = false; } };
        AttachedToVisualTree += (_, _) => { if (stale) { ReloadModel(); } };
        ReloadModel();
    }

    private Button Button(string text, string name, Action action)
    {
        var result = new Button { Content = text, Name = name };
        result.Click += (_, _) => Run(action);
        return result;
    }
    private void Run(Action action) { try { Guard(); action(); } catch (Exception exception) { status.Text = exception.Message; } }
    private async Task RunAsync(Func<Task> action) { try { Guard(); await action(); } catch (Exception exception) { status.Text = exception.Message; } }
    private void SourceChanged(object? sender, EventArgs args)
    {
        if (!IsEffectivelyVisible || TopLevel.GetTopLevel(this) is null) { stale = true; return; }
        ReloadModel();
    }
    private void ReloadModel()
    {
        stale = false;
        try
        {
            model = new NativeCanvasDocument(source.Text);
            surface.IsVisible = true; error.IsVisible = false;
            surface.SetData(model.GetCards(), model.GetConnections());
            status.Text = CountLabel(model.GetCards().Count, "card") + " · " + CountLabel(model.GetConnections().Count, "connection");
        }
        catch (InvalidDataException exception)
        {
            model = null;
            UpdateSelection();
            surface.IsVisible = false; error.IsVisible = true; errorText.Text = exception.Message;
            status.Text = "The original Canvas source is retained.";
        }
    }

    private static string CountLabel(int count, string noun) => count + " " + noun + (count == 1 ? "" : "s");

    private void Guard()
    {
        if (disposed || workspace.Snapshot.Root != root || workspace.VaultEpoch != epoch || !workspace.Tabs.Contains(tab)) { throw new InvalidOperationException("This Canvas view is no longer open in its original vault."); }
        if (source.Text != tab.Text) { throw new InvalidOperationException("This Canvas changed outside this view. Reopen its tab before applying changes."); }
    }
    private NativeCanvasDocument RequireModel() { Guard(); return model ?? throw new InvalidDataException("Correct the Canvas source before editing the board."); }
    private void Change(Func<NativeCanvasDocument, bool> mutation) => Run(() =>
    {
        var current = RequireModel();
        if (mutation(current)) { source.Text = current.Source; }
    });

    public void RefreshTheme() { surface.RefreshTheme(); inspector.RefreshTheme(); }

    private void UpdateSelection()
    {
        var selected = surface.GetSelection();
        var card = selected.Count == 1 ? model?.GetCards().FirstOrDefault(item => item.Id == selected[0]) : null;
        var edge = model?.GetConnections().FirstOrDefault(item => item.Id == surface.SelectedConnectionId);
        inspector.Update(card, edge, selected.Count, model?.GetConnections() ?? []);
    }

    private void ApplyInspectorChange(bool connection, string id, string key, JsonNode? value)
    {
        var current = RequireModel();
        void Apply(JsonObject node) { if (value is null) { node.Remove(key); } else { node[key] = value.DeepClone(); } }
        var changed = connection ? current.UpdateConnection(id, Apply) : current.UpdateCard(id, Apply);
        if (changed) { source.Text = current.Source; }
    }

    private void ToggleInspector()
    {
        if (compact) { return; } // The native button's attached flyout owns compact toggling.
        inspectorExpanded = !(inspectorExpanded ?? true);
        UpdateInspectorLayout();
    }
    private void OpenInspector() { inspectorExpanded = true; UpdateInspectorLayout(); }

    private void UpdateInspectorLayout()
    {
        var nextCompact = Bounds.Width < 650;
        var show = inspectorExpanded ?? !nextCompact;
        changingPanel = true;
        try
        {
            if (nextCompact != compact)
            {
                inspectorFlyout.Hide(); inspectorFlyout.Content = null; inspectorHost.Content = null;
                compact = nextCompact;
                inspectorToggle.Flyout = compact ? inspectorFlyout : null;
                if (compact) { inspectorFlyout.Content = inspector; }
                else { inspectorHost.Content = inspector; }
            }
            inspector.Width = compact ? 260 : double.NaN;
            inspector.MaxHeight = compact ? Math.Max(150, Bounds.Height - 100) : double.PositiveInfinity;
            inspectorHost.IsVisible = !compact && show;
            boardLayout.ColumnDefinitions[1].Width = new GridLength(!compact && show ? 260 : 0);
            if (compact && show && !inspectorFlyout.IsOpen && TopLevel.GetTopLevel(this) is not null) { inspectorFlyout.ShowAt(inspectorToggle); }
            else if (!show) { inspectorFlyout.Hide(); }
        }
        finally { changingPanel = false; }
    }

    private void AddCard(string type) => _ = RunAsync(() => CreateCardAsync(type));

    private async Task CreateCardAsync(string type)
    {
        _ = RequireModel();
        var point = surface.ViewCenter;
        var text = type switch { "text" => "New card", "group" => "Group", _ => "" };
        var card = new NativeCanvasCard("", type, (int)Math.Round(point.X - 200), (int)Math.Round(point.Y - 120), 400, 240, text, "", null, "", "", "");
        var before = source.Text;
        var owner = TopLevel.GetTopLevel(this) as Window ?? throw new InvalidOperationException("Open the Canvas in a window before creating cards.");
        await NativeCanvasCardDialog.EditAsync(owner, card, changed =>
        {
            Guard();
            if (source.Text != before) { throw new InvalidOperationException("The Canvas changed while this card editor was open. Reopen it before creating the card; your input is retained here."); }
            if (type == "file" && string.IsNullOrWhiteSpace(changed.Target)) { throw new InvalidDataException("Enter the card's file path inside this vault."); }
            if (type == "link" && (!Uri.TryCreate(changed.Target, UriKind.Absolute, out var address) || address.Scheme is not ("http" or "https"))) { throw new InvalidDataException("Enter an HTTP or HTTPS website address."); }
            var current = RequireModel();
            var value = type is "file" or "link" ? changed.Target : changed.Text;
            var id = current.AddCard(type, value, changed.X, changed.Y);
            current.UpdateCard(id, node => ApplyCard(node, changed));
            source.Text = current.Source;
            surface.Select([id]);
        });
    }
    private static void ApplyCard(JsonObject node, NativeCanvasCard card)
    {
        node["x"] = card.X; node["y"] = card.Y; node["width"] = card.Width; node["height"] = card.Height;
        Optional(node, "color", card.Color);
        switch (card.Type)
        {
            case "text": node["text"] = card.Text; break;
            case "file": node["file"] = card.Target; Optional(node, "subpath", card.Subpath); break;
            case "link": node["url"] = card.Target; break;
            case "group": node["label"] = card.Text; Optional(node, "background", card.Background); Optional(node, "backgroundStyle", card.BackgroundStyle); break;
        }
    }
    private static void Optional(JsonObject node, string key, string? value) { if (string.IsNullOrEmpty(value)) { node.Remove(key); } else { node[key] = value; } }
    private void ConnectSelection()
    {
        var selected = surface.GetSelection();
        if (selected.Count != 2) { throw new InvalidOperationException("Select two cards to connect them."); }
        var current = RequireModel(); current.Connect(selected[0], selected[1]); source.Text = current.Source;
    }
    private void DeleteSelection() => Change(current => surface.SelectedConnectionId is { } edge ? current.RemoveConnection(edge) : current.RemoveCards(surface.GetSelection()));
    private void Undo(bool redo) { Guard(); if (redo) { source.UndoStack.Redo(); } else { source.UndoStack.Undo(); } }
    private async Task CopyAsync()
    {
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (surface.GetSelection().Count == 0) { throw new InvalidOperationException("Select cards to copy."); }
        if (clipboard is not null) { await clipboard.SetTextAsync(RequireModel().CopySelection(surface.GetSelection())); }
    }
    private async Task PasteAsync()
    {
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clipboard is null) { return; }
        var pasted = await clipboard.TryGetTextAsync();
        if (string.IsNullOrWhiteSpace(pasted)) { return; }
        var current = RequireModel(); var ids = current.Paste(pasted); source.Text = current.Source; surface.Select(ids);
    }
    private ScrollViewer CardContent(NativeCanvasCard card)
    {
        var stack = new StackPanel { Spacing = 10 };
        switch (card.Type)
        {
            case "text": NativeMarkdown.Render(stack, card.Text, link => Run(() => navigate(tab.Path, link, false)), link => Run(() => navigate(tab.Path, link, true))); break;
            case "group": stack.Children.Add(new TextBlock { Text = card.Text, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap }); break;
            case "file":
                var open = new Button { Content = card.Target + card.Subpath, HorizontalAlignment = HorizontalAlignment.Left };
                open.Click += (_, _) => Run(() => { if (card.Subpath.Length > 0) { navigate(card.Target, card.Subpath, false); } else { openPath(card.Target); } });
                stack.Children.Add(open);
                break;
            case "link":
                var website = new Button { Content = card.Target, HorizontalAlignment = HorizontalAlignment.Left };
                website.Click += (_, _) => Run(() => navigate(tab.Path, card.Target, true));
                stack.Children.Add(website);
                break;
            default: stack.Children.Add(new TextBlock { Text = "Unsupported card type: " + card.Type + ". Its data is retained in Source.", TextWrapping = TextWrapping.Wrap }); break;
        }
        return new ScrollViewer { Content = stack, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
    }
    public void Dispose() { disposed = true; source.TextChanged -= SourceChanged; inspectorFlyout.Hide(); surface.Dispose(); }
}
