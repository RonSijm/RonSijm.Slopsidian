using Avalonia;
using AvaloniaEdit.Document;

namespace RonSijm.Slopsidian.Linux;

public partial class MainWindow
{
    private readonly Dictionary<NativeTab, NativeCanvasView> canvasViews = [];

    private void ConfigureDocumentView(NativeTab tab, TextDocument buffer)
    {
        var canvas = tab.Document.File.Extension.Equals("canvas", StringComparison.OrdinalIgnoreCase);
        ReadingModeTab.IsVisible = !canvas;
        CanvasModeTab.IsVisible = canvas;
        if (canvas)
        {
            if (!canvasViews.TryGetValue(tab, out var view))
            {
                view = new NativeCanvasView(Workspace, tab, buffer, () => ShowCanvasSource(tab),
                    path => _ = OpenPathAsync(path), (source, link, markdown) => _ = NavigateAsync(link, markdown, source));
                canvasViews.Add(tab, view);
            }
            CanvasHost.Content = view;
        }
        else { CanvasHost.Content = null; }
        EditorTabs.SelectedIndex = tab.ViewMode switch { "canvas" when canvas => 2, "reading" when !canvas => 1, _ => 0 };
        UpdateModeMargin();
    }

    private string CurrentViewMode() => EditorTabs.SelectedIndex switch { 2 => "canvas", 1 => "reading", _ => "source" };
    private void UpdateModeMargin() => EditorTabs.Margin = EditorTabs.SelectedIndex == 2 ? new Thickness(0) : new Thickness(24, 8, 24, 12);

    private void ShowCanvasSource(NativeTab tab)
    {
        if (!Workspace.Tabs.Contains(tab)) { return; }
        if (!ReferenceEquals(Workspace.ActiveTab, tab)) { Workspace.Activate(tab); LoadEditor(); }
        EditorTabs.SelectedIndex = 0;
        Editor.TextArea.Focus();
    }

    private void DisposeCanvasView(NativeTab tab)
    {
        if (canvasViews.Remove(tab, out var view)) { view.Dispose(); }
    }
    private void DisposeCanvasViews()
    {
        CanvasHost.Content = null;
        foreach (var view in canvasViews.Values) { view.Dispose(); }
        canvasViews.Clear();
    }

    private string CanvasFolder(RonSijm.Slopsidian.Services.CorePluginState options)
    {
        var location = options.Settings["newFileLocation"]?.ToString() ?? "root";
        var folder = location switch
        {
            "current" => System.IO.Path.GetDirectoryName(Workspace.ActiveTab?.Path)?.Replace('\\', '/') ?? "",
            "folder" => options.Settings["newFileFolderPath"]?.ToString() ?? "",
            _ => ""
        };
        if (folder.Length > 0 && folder != "/" && !(Workspace.Snapshot.Folders ?? []).Contains(folder, StringComparer.Ordinal))
        {
            throw new InvalidOperationException("The configured Canvas folder does not exist: " + folder);
        }
        return folder;
    }

    private Task NewCanvasAsync() => RunAsync(async () =>
    {
        if (Workspace.Snapshot.Root is null) { return; }
        var folder = CanvasFolder(await CoreSettingsAsync("canvas"));
        var initial = (folder.Length > 0 && folder != "/" ? folder.TrimEnd('/') + "/" : "") + "Untitled.canvas";
        var path = await AskTextAsync("New Canvas", "Canvas path inside the vault", initial, "Create Canvas");
        if (path is null) { return; }
        if (System.IO.Path.GetExtension(path).Length == 0) { path += ".canvas"; }
        if (!System.IO.Path.GetExtension(path).Equals(".canvas", StringComparison.OrdinalIgnoreCase)) { throw new InvalidOperationException("Canvas files must use the .canvas extension."); }
        await Workspace.CreateTabAsync(path, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}\n");
        FileTree.ItemsSource = NativeFileNode.FromSnapshot(Workspace.Snapshot);
        LoadEditor();
        await PersistProfileAsync();
    });
}
