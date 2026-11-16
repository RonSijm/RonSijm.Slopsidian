using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

/// <summary>A native widget board with transient gestures and one committed edit per drag.</summary>
public sealed class NativeCanvasSurface : Grid, IDisposable
{
    private readonly Canvas world = new() { ClipToBounds = false, RenderTransformOrigin = RelativePoint.TopLeft };
    private readonly NativeCanvasEdgeLayer edgeLayer;
    private readonly CanvasSelectionLayer overlay;
    private readonly Func<NativeCanvasCard, Control> content;
    private readonly Dictionary<string, Border> frames = new(StringComparer.Ordinal);
    private readonly HashSet<string> selected = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Rect> transient = new(StringComparer.Ordinal);
    private Dictionary<string, NativeCanvasCard> cardIndex = new(StringComparer.Ordinal);
    private NativeCanvasCard[] cards = [];
    private Point pan;
    private double zoom = 1;
    private Point dragStart;
    private Point previousPointer;
    private Point insertion;
    private DragKind drag;
    private string? resizeId;
    private Rect? selectionBox;
    private bool holdingSpace;
    private bool needsFit = true;

    public NativeCanvasSurface(Func<NativeCanvasCard, Control> createContent)
    {
        content = createContent;
        Focusable = true;
        ClipToBounds = true;
        Background = NativePalette.Brush("SurfaceBrush");
        AutomationProperties.SetName(this, "Canvas board");
        edgeLayer = new NativeCanvasEdgeLayer(NodeBounds);
        world.Children.Add(edgeLayer);
        overlay = new CanvasSelectionLayer(this) { IsHitTestVisible = false };
        Children.Add(world);
        Children.Add(overlay);
        AddHandler(PointerPressedEvent, Pressed, RoutingStrategies.Tunnel);
        AddHandler(PointerMovedEvent, Moved, RoutingStrategies.Tunnel);
        AddHandler(PointerReleasedEvent, Released, RoutingStrategies.Tunnel);
        AddHandler(PointerWheelChangedEvent, Wheel, RoutingStrategies.Tunnel);
        PointerCaptureLost += (_, _) => CancelGesture();
        DoubleTapped += (_, args) =>
        {
            if (IsInteractive(args.Source) || holdingSpace) { return; }
            var hit = Hit(World(args.GetPosition(this)));
            if (hit is not null) { EditRequested?.Invoke(hit.Id); args.Handled = true; }
        };
        SizeChanged += (_, _) => { if (needsFit) { Fit(); } else { SyncVisible(); } };
    }

    public bool SnapToGrid { get; set; } = true;
    public bool WheelZoom { get; set; }
    public double Zoom => zoom;
    public Point InsertionPoint => insertion;
    public Point ViewCenter => World(new Point(Bounds.Width / 2, Bounds.Height / 2));
    public event Action? SelectionChanged;
    public event Action? CameraChanged;
    public event Action<string>? EditRequested;
    public event Action<IReadOnlyList<string>, int, int>? CardsMoved;
    public event Action<string, int, int>? CardResized;
    public event Action? DeleteRequested;
    public event Action? CopyRequested;
    public event Action? PasteRequested;
    public event Action<bool>? UndoRequested;

    public IReadOnlyList<string> GetSelection() => selected.ToArray();

    public void SetData(IReadOnlyList<NativeCanvasCard> nextCards, IReadOnlyList<NativeCanvasConnection> nextConnections)
    {
        CancelGesture();
        cards = nextCards.ToArray();
        cardIndex = cards.ToDictionary(card => card.Id, StringComparer.Ordinal);
        selected.IntersectWith(cards.Select(card => card.Id));
        edgeLayer.SetConnections(nextConnections);
        ClearFrames();
        if (needsFit && Bounds.Width > 0 && Bounds.Height > 0) { Fit(); }
        else { SyncVisible(); }
        SelectionChanged?.Invoke();
    }

    public void Select(IEnumerable<string> ids)
    {
        selected.Clear();
        selected.UnionWith(ids.Where(cardIndex.ContainsKey));
        UpdateSelection();
    }

    public void Fit()
    {
        if (Bounds.Width <= 0 || Bounds.Height <= 0) { return; }
        needsFit = false;
        var area = cards.Length == 0 ? new Rect(-200, -120, 400, 240) : cards.Select(Box).Aggregate((left, right) => left.Union(right));
        zoom = Math.Clamp(Math.Min((Bounds.Width - 80) / Math.Max(1, area.Width), (Bounds.Height - 80) / Math.Max(1, area.Height)), 0.02, 1);
        pan = new Point(Bounds.Width / 2 - area.Center.X * zoom, Bounds.Height / 2 - area.Center.Y * zoom);
        insertion = area.Center;
        UpdateCamera();
    }

    public void ZoomBy(double factor) => ZoomAt(factor, new Point(Bounds.Width / 2, Bounds.Height / 2));

    public void RefreshTheme()
    {
        Background = NativePalette.Brush("SurfaceBrush");
        ClearFrames();
        SyncVisible();
        edgeLayer.InvalidateVisual();
        overlay.InvalidateVisual();
    }

    private static Rect Between(Point first, Point second) => new(Math.Min(first.X, second.X), Math.Min(first.Y, second.Y), Math.Abs(first.X - second.X), Math.Abs(first.Y - second.Y));

    private void ClearFrames()
    {
        foreach (var frame in frames.Values) { RemoveFrame(frame); }
        frames.Clear();
    }

    private void RemoveFrame(Border frame)
    {
        world.Children.Remove(frame);
        if (frame.Child is IDisposable lifetime) { lifetime.Dispose(); }
    }

    public void Dispose() => ClearFrames();

    private void SyncVisible()
    {
        if (Bounds.Width <= 0 || Bounds.Height <= 0) { return; }
        var topLeft = World(new Point(-200, -200));
        var lowerRight = World(new Point(Bounds.Width + 200, Bounds.Height + 200));
        var visible = new Rect(topLeft, lowerRight);
        edgeLayer.SetViewport(visible);
        var wanted = cards.Where(card => NodeBounds(card.Id)?.Intersects(visible) == true).ToDictionary(card => card.Id, StringComparer.Ordinal);
        foreach (var id in frames.Keys.Where(id => !wanted.ContainsKey(id)).ToArray()) { RemoveFrame(frames[id]); frames.Remove(id); }
        foreach (var card in wanted.Values)
        {
            if (!frames.TryGetValue(card.Id, out var frame))
            {
                frame = new Border { Tag = card.Id, Child = content(card), CornerRadius = new CornerRadius(6), BorderThickness = new Thickness(1), Padding = new Thickness(10), ClipToBounds = true };
                frame.ZIndex = card.Type == "group" ? -1 : 1;
                frames.Add(card.Id, frame);
                world.Children.Add(frame);
            }
            PositionFrame(card.Id, frame);
            ColorFrame(card, frame);
        }
        edgeLayer.InvalidateVisual();
        overlay.InvalidateVisual();
    }

    private void ColorFrame(NativeCanvasCard card, Border frame)
    {
        frame.BorderBrush = selected.Contains(card.Id) ? NativePalette.Brush("AccentBrush") : NativeCanvasPalette.Brush(card.Color, "DividerBrush");
        frame.BorderThickness = new Thickness(selected.Contains(card.Id) ? 2 : 1);
        frame.Background = card.Type == "group" ? NativeCanvasPalette.GroupBrush(card.Color) : NativePalette.Brush("SidebarBrush");
    }

    private void PositionFrame(string id, Border frame)
    {
        var box = NodeBounds(id)!.Value;
        Canvas.SetLeft(frame, box.X);
        Canvas.SetTop(frame, box.Y);
        frame.Width = box.Width;
        frame.Height = box.Height;
    }

    private Rect? NodeBounds(string id)
    {
        if (transient.TryGetValue(id, out var box)) { return box; }
        return cardIndex.TryGetValue(id, out var card) ? Box(card) : null;
    }
    private static Rect Box(NativeCanvasCard card) => new(card.X, card.Y, card.Width, card.Height);
    private Point World(Point point) => new((point.X - pan.X) / zoom, (point.Y - pan.Y) / zoom);
    private Rect Screen(Rect box) => new(box.X * zoom + pan.X, box.Y * zoom + pan.Y, box.Width * zoom, box.Height * zoom);
    private NativeCanvasCard? Hit(Point point) => cards.Reverse().FirstOrDefault(card => card.Type != "group" && NodeBounds(card.Id)!.Value.Contains(point))
        ?? cards.Reverse().FirstOrDefault(card => NodeBounds(card.Id)!.Value.Contains(point));

    private void UpdateCamera()
    {
        world.RenderTransform = new MatrixTransform(new Matrix(zoom, 0, 0, zoom, pan.X, pan.Y));
        SyncVisible();
        CameraChanged?.Invoke();
    }

    private void ZoomAt(double factor, Point anchor)
    {
        var before = World(anchor);
        zoom = Math.Clamp(zoom * factor, 0.02, 4);
        pan = new Point(anchor.X - before.X * zoom, anchor.Y - before.Y * zoom);
        UpdateCamera();
    }

    private void Wheel(object? sender, PointerWheelEventArgs args)
    {
        if (WheelZoom || args.KeyModifiers.HasFlag(KeyModifiers.Control)) { ZoomAt(Math.Pow(1.15, args.Delta.Y), args.GetPosition(this)); }
        else { pan += new Vector(args.Delta.X * 48, args.Delta.Y * 48); UpdateCamera(); }
        args.Handled = true;
    }

    private void Pressed(object? sender, PointerPressedEventArgs args)
    {
        var point = args.GetPosition(this);
        insertion = World(point);
        var buttons = args.GetCurrentPoint(this).Properties;
        if (buttons.IsMiddleButtonPressed || buttons.IsLeftButtonPressed && holdingSpace)
        {
            Focus(); drag = DragKind.Pan; previousPointer = point; args.Pointer.Capture(this); args.Handled = true; return;
        }
        var hit = Hit(insertion);
        if (buttons.IsRightButtonPressed) { if (hit is not null && !selected.Contains(hit.Id)) { Select([hit.Id]); } return; }
        if (!buttons.IsLeftButtonPressed || IsInteractive(args.Source)) { return; }
        Focus();
        dragStart = insertion;
        if (hit is null) { BeginRectangle(args.KeyModifiers); }
        else { BeginCardDrag(hit, args.KeyModifiers, point); }
        args.Pointer.Capture(this);
        args.Handled = true;
    }

    private static bool IsInteractive(object? source)
    {
        if (source is not Control control) { return false; }
        return Interactive(control) || Avalonia.VisualTree.VisualExtensions.GetVisualAncestors(control).OfType<Control>().Any(Interactive);
    }

    private static bool Interactive(Control control) => control is Button or TextBox or ComboBox or Avalonia.Controls.Primitives.ScrollBar or Avalonia.Controls.Primitives.Thumb;

    private void BeginRectangle(KeyModifiers modifiers)
    {
        if (!modifiers.HasFlag(KeyModifiers.Shift)) { selected.Clear(); }
        selectionBox = new Rect(dragStart, dragStart);
        drag = DragKind.Rectangle;
        UpdateSelection();
    }

    private void BeginCardDrag(NativeCanvasCard card, KeyModifiers modifiers, Point point)
    {
        if (zoom >= 0.25 && selected.Count == 1 && selected.Contains(card.Id) && NativeCanvasGeometry.Distance(Screen(Box(card)).BottomRight, point) < 12)
        {
            resizeId = card.Id;
            drag = DragKind.Resize;
            return;
        }
        if (modifiers.HasFlag(KeyModifiers.Shift))
        {
            if (!selected.Add(card.Id)) { selected.Remove(card.Id); }
        }
        else if (!selected.Contains(card.Id)) { selected.Clear(); selected.Add(card.Id); }
        if (card.Type == "group" && selected.Contains(card.Id))
        {
            var group = Box(card);
            selected.UnionWith(cards.Where(child => child.Id != card.Id && group.Contains(Box(child))).Select(child => child.Id));
        }
        drag = selected.Contains(card.Id) ? DragKind.Move : DragKind.None;
        UpdateSelection();
    }

    private void Moved(object? sender, PointerEventArgs args)
    {
        var point = args.GetPosition(this);
        insertion = World(point);
        switch (drag)
        {
            case DragKind.Pan: pan += point - previousPointer; previousPointer = point; UpdateCamera(); break;
            case DragKind.Move: PreviewMove(insertion, args.KeyModifiers); break;
            case DragKind.Resize: PreviewResize(insertion, args.KeyModifiers); break;
            case DragKind.Rectangle: selectionBox = Between(dragStart, insertion); overlay.InvalidateVisual(); break;
        }
        if (drag != DragKind.None) { args.Handled = true; }
    }

    private void PreviewMove(Point point, KeyModifiers modifiers)
    {
        var anchor = cards.FirstOrDefault(card => selected.Contains(card.Id));
        if (anchor is null) { return; }
        var delta = point - dragStart;
        var dx = Rounded(delta.X); var dy = Rounded(delta.Y);
        if (SnapToGrid && !modifiers.HasFlag(KeyModifiers.Alt)) { dx = Rounded((anchor.X + dx) / 20d) * 20 - anchor.X; dy = Rounded((anchor.Y + dy) / 20d) * 20 - anchor.Y; }
        transient.Clear();
        foreach (var card in cards.Where(card => selected.Contains(card.Id))) { transient[card.Id] = new Rect(card.X + dx, card.Y + dy, card.Width, card.Height); }
        RefreshTransient();
    }

    private void PreviewResize(Point point, KeyModifiers modifiers)
    {
        var card = cards.FirstOrDefault(card => card.Id == resizeId);
        if (card is null) { return; }
        var width = Rounded(card.Width + point.X - dragStart.X); var height = Rounded(card.Height + point.Y - dragStart.Y);
        if (SnapToGrid && !modifiers.HasFlag(KeyModifiers.Alt)) { width = Rounded(width / 20d) * 20; height = Rounded(height / 20d) * 20; }
        transient[card.Id] = new Rect(card.X, card.Y, Math.Clamp(width, 1, 10_000_000), Math.Clamp(height, 1, 10_000_000));
        RefreshTransient();
    }

    private static int Rounded(double value) => (int)Math.Clamp(Math.Round(value, MidpointRounding.AwayFromZero), -10_000_000, 10_000_000);
    private void RefreshTransient()
    {
        foreach (var pair in frames) { PositionFrame(pair.Key, pair.Value); }
        edgeLayer.InvalidateVisual();
        overlay.InvalidateVisual();
    }

    private void Released(object? sender, PointerReleasedEventArgs args)
    {
        var kind = drag;
        var moving = cards.FirstOrDefault(card => transient.ContainsKey(card.Id));
        var movedBox = moving is null ? default(Rect?) : transient[moving.Id];
        var resize = resizeId;
        var rectangle = selectionBox;
        var selection = selected.ToArray();
        CancelGesture();
        args.Pointer.Capture(null);
        if (kind == DragKind.Move && moving is not null && movedBox is { } moved) { CardsMoved?.Invoke(selection, Rounded(moved.X - moving.X), Rounded(moved.Y - moving.Y)); }
        else if (kind == DragKind.Resize && resize is not null && movedBox is { } resized) { CardResized?.Invoke(resize, Rounded(resized.Width), Rounded(resized.Height)); }
        else if (kind == DragKind.Rectangle && rectangle is { } region) { selected.UnionWith(cards.Where(card => region.Intersects(Box(card))).Select(card => card.Id)); UpdateSelection(); }
        if (kind != DragKind.None) { args.Handled = true; }
    }

    private void CancelGesture()
    {
        drag = DragKind.None;
        resizeId = null;
        selectionBox = null;
        transient.Clear();
        RefreshTransient();
    }

    private void UpdateSelection()
    {
        foreach (var card in cards) { if (frames.TryGetValue(card.Id, out var frame)) { ColorFrame(card, frame); } }
        overlay.InvalidateVisual();
        SelectionChanged?.Invoke();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Handled) { return; }
        if (e.Key == Key.Space) { holdingSpace = true; e.Handled = true; return; }
        if (e.KeyModifiers.HasFlag(KeyModifiers.Control)) { HandleControlKey(e); return; }
        switch (e.Key)
        {
            case Key.Delete: DeleteRequested?.Invoke(); e.Handled = true; break;
            case Key.Enter: if (selected.FirstOrDefault() is { } id) { EditRequested?.Invoke(id); e.Handled = true; } break;
            case Key.Escape: CancelGesture(); Select([]); e.Handled = true; break;
        }
    }

    private void HandleControlKey(KeyEventArgs args)
    {
        switch (args.Key)
        {
            case Key.A: Select(cards.Select(card => card.Id)); break;
            case Key.C: CopyRequested?.Invoke(); break;
            case Key.V: PasteRequested?.Invoke(); break;
            case Key.Z: UndoRequested?.Invoke(args.KeyModifiers.HasFlag(KeyModifiers.Shift)); break;
            case Key.Y: UndoRequested?.Invoke(true); break;
            default: return;
        }
        args.Handled = true;
    }

    protected override void OnLostFocus(FocusChangedEventArgs e) { base.OnLostFocus(e); holdingSpace = false; }

    protected override void OnKeyUp(KeyEventArgs e) { base.OnKeyUp(e); if (e.Key == Key.Space) { holdingSpace = false; } }

    private sealed class CanvasSelectionLayer(NativeCanvasSurface board) : Control
    {
        public override void Render(DrawingContext context)
        {
            var accent = NativePalette.Brush("AccentBrush");
            var pen = new Pen(accent, 1.5);
            if (board.selectionBox is { } selection) { context.DrawRectangle(null, pen, board.Screen(selection)); }
            if (board.zoom < 0.25) { return; }
            foreach (var id in board.selected)
            {
                if (board.NodeBounds(id) is not { } bounds) { continue; }
                var point = board.Screen(bounds).BottomRight;
                context.FillRectangle(accent, new Rect(point.X - 4, point.Y - 4, 8, 8));
            }
        }
    }
    private enum DragKind { None, Pan, Move, Resize, Rectangle }
}
