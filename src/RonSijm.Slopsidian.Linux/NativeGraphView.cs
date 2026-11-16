using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeGraphNode(string Path, string Label);
public sealed record NativeGraphEdge(string Source, string Target);

public sealed class NativeGraphView : UserControl
{
    private readonly GraphSurface surface;
    private readonly TextBox filter = new() { PlaceholderText = "Filter notes", Width = 250 };
    private readonly TextBlock status = new() { Classes = { "muted" }, VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center };
    private readonly NativeGraphNode[] nodes;
    private readonly NativeGraphEdge[] edges;

    public NativeGraphView(IEnumerable<NativeGraphNode> graphNodes, IEnumerable<NativeGraphEdge> graphEdges, Action<string> open)
    {
        nodes = graphNodes.ToArray();
        edges = graphEdges.ToArray();
        surface = new GraphSurface(open);
        var layout = new Grid { RowDefinitions = new RowDefinitions("Auto,*") };
        var controls = new StackPanel { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 16, Margin = new Thickness(20, 14) };
        controls.Children.Add(filter);
        var reset = new Button { Content = "Reset view" };
        reset.Click += (_, _) => surface.ResetView();
        controls.Children.Add(reset);
        controls.Children.Add(status);
        layout.Children.Add(controls);
        Grid.SetRow(surface, 1);
        layout.Children.Add(surface);
        Content = layout;
        filter.TextChanged += (_, _) => RefreshGraph();
        RefreshGraph();
    }

    private void RefreshGraph()
    {
        var query = filter.Text ?? "";
        var visible = nodes.Where(node => node.Path.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
        var paths = visible.Select(node => node.Path).ToHashSet(StringComparer.Ordinal);
        var links = edges.Where(edge => paths.Contains(edge.Source) && paths.Contains(edge.Target)).ToArray();
        surface.SetGraph(visible, links);
        status.Text = visible.Length + " notes · " + links.Length + " links";
    }

    private sealed class GraphSurface(Action<string> open) : Control
    {
        private NativeGraphNode[] graphNodes = [];
        private NativeGraphEdge[] graphEdges = [];
        private Dictionary<string, Point> positions = new(StringComparer.Ordinal);
        private double zoom = 1;
        private Point pan;
        private Point dragStart;
        private Point previousPointer;
        private string? draggedNode;
        private string? hover;
        private bool dragging;

        public void SetGraph(NativeGraphNode[] nodes, NativeGraphEdge[] edges)
        {
            graphNodes = nodes;
            graphEdges = edges;
            positions = Layout(nodes, edges);
            InvalidateVisual();
        }

        public void ResetView()
        {
            zoom = 1;
            pan = default;
            InvalidateVisual();
        }

        public override void Render(DrawingContext context)
        {
            var muted = NativePalette.Brush("MutedBrush");
            var accent = NativePalette.Brush("AccentBrush");
            var text = NativePalette.Brush("TextBrush");
            context.FillRectangle(NativePalette.Brush("SurfaceBrush"), new Rect(Bounds.Size));
            var pen = new Pen(muted, 0.6);
            DrawEdges(context, pen);
            foreach (var node in graphNodes)
            {
                var point = Screen(positions[node.Path]);
                var selected = node.Path == hover;
                var radius = selected ? 7 : 5;
                context.DrawEllipse(selected ? accent : muted, null, point, radius, radius);
                if (zoom < 0.45 && !selected) { continue; }
                var label = node.Label.Length > 42 ? node.Label[..39] + "…" : node.Label;
                var formatted = new FormattedText(label, CultureInfo.CurrentCulture, Avalonia.Media.FlowDirection.LeftToRight,
                    new Typeface(FontFamily.Default), 12, selected ? accent : text);
                context.DrawText(formatted, new Point(point.X + 9, point.Y - formatted.Height / 2));
            }
        }

        private void DrawEdges(DrawingContext context, Pen pen)
        {
            foreach (var edge in graphEdges)
            {
                if (positions.TryGetValue(edge.Source, out var source) && positions.TryGetValue(edge.Target, out var target))
                {
                    context.DrawLine(pen, Screen(source), Screen(target));
                }
            }
        }

        private static double Distance(Point delta) => Math.Sqrt(delta.X * delta.X + delta.Y * delta.Y);

        private Point Screen(Point point) => new(point.X * zoom + Bounds.Width / 2 + pan.X, point.Y * zoom + Bounds.Height / 2 + pan.Y);
        private string? Hit(Point point) => graphNodes.FirstOrDefault(node => Distance(Screen(positions[node.Path]) - point) < 11)?.Path;

        protected override void OnPointerPressed(PointerPressedEventArgs e)
        {
            base.OnPointerPressed(e);
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) { return; }
            dragStart = e.GetPosition(this);
            previousPointer = dragStart;
            draggedNode = Hit(dragStart);
            dragging = true;
            e.Pointer.Capture(this);
            e.Handled = true;
        }

        protected override void OnPointerMoved(PointerEventArgs e)
        {
            base.OnPointerMoved(e);
            var point = e.GetPosition(this);
            if (dragging)
            {
                var delta = point - previousPointer;
                if (draggedNode is null) { pan += delta; }
                else { positions[draggedNode] += delta / zoom; }
                previousPointer = point;
            }
            hover = Hit(point);
            Cursor = new Cursor(hover is null ? StandardCursorType.SizeAll : StandardCursorType.Hand);
            InvalidateVisual();
        }

        protected override void OnPointerReleased(PointerReleasedEventArgs e)
        {
            base.OnPointerReleased(e);
            if (dragging && draggedNode is not null && Distance(e.GetPosition(this) - dragStart) < 4) { open(draggedNode); }
            dragging = false;
            draggedNode = null;
            e.Pointer.Capture(null);
        }

        protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
        {
            base.OnPointerWheelChanged(e);
            var oldZoom = zoom;
            zoom = Math.Clamp(zoom * Math.Pow(1.15, e.Delta.Y), 0.15, 4);
            var point = e.GetPosition(this);
            var origin = new Point(Bounds.Width / 2 + pan.X, Bounds.Height / 2 + pan.Y);
            pan += (point - origin) * (1 - zoom / oldZoom);
            e.Handled = true;
            InvalidateVisual();
        }

        private static Dictionary<string, Point> Layout(NativeGraphNode[] nodes, NativeGraphEdge[] edges)
        {
            var positions = new Dictionary<string, Point>(StringComparer.Ordinal);
            for (var index = 0; index < nodes.Length; index++)
            {
                var angle = 2 * Math.PI * index / Math.Max(1, nodes.Length);
                var radius = nodes.Length < 2 ? 0 : Math.Max(90, Math.Sqrt(nodes.Length) * 48);
                positions[nodes[index].Path] = new Point(Math.Cos(angle) * radius, Math.Sin(angle) * radius);
            }
            // Bound interactive layout work; larger graphs retain a deterministic native layout.
            if (nodes.Length > 300) { return positions; }
            for (var iteration = 0; iteration < 60; iteration++)
            {
                var forces = nodes.ToDictionary(node => node.Path, _ => new Vector(), StringComparer.Ordinal);
                Repel(nodes, positions, forces);
                foreach (var edge in edges)
                {
                    var delta = positions[edge.Target] - positions[edge.Source];
                    var force = delta * 0.012;
                    forces[edge.Source] += force;
                    forces[edge.Target] -= force;
                }
                foreach (var path in nodes.Select(node => node.Path))
                {
                    var point = positions[path];
                    positions[path] = point + forces[path] - new Vector(point.X, point.Y) * 0.004;
                }
            }
            return positions;
        }

        private static void Repel(NativeGraphNode[] nodes, Dictionary<string, Point> positions, Dictionary<string, Vector> forces)
        {
            for (var left = 0; left < nodes.Length; left++)
            {
                for (var right = left + 1; right < nodes.Length; right++)
                {
                    var delta = positions[nodes[left].Path] - positions[nodes[right].Path];
                    var distance = Math.Max(15, Distance(delta));
                    var force = delta * (50_000 / (distance * distance * distance));
                    forces[nodes[left].Path] += force;
                    forces[nodes[right].Path] -= force;
                }
            }
        }
    }
}

internal static class NativePalette
{
    public static IBrush Brush(string key)
    {
        var application = Application.Current;
        if (application is not null && application.Resources.TryGetResource(key, application.ActualThemeVariant, out var value) && value is IBrush brush) { return brush; }
        return Brushes.Gray;
    }
}
