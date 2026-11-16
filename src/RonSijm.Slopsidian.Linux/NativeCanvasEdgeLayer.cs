using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

internal sealed class NativeCanvasEdgeLayer(Func<string, Rect?> bounds) : Control
{
    private NativeCanvasConnection[] connections = [];
    private string? selected;
    private Point origin;
    private Rect viewport;

    public void SetConnections(IEnumerable<NativeCanvasConnection> value) { connections = value.ToArray(); InvalidateVisual(); }
    public bool Contains(string id) => connections.Any(edge => edge.Id == id);
    public void Select(string? id) { selected = id; InvalidateVisual(); }

    public string? Hit(Point point, double tolerance)
    {
        foreach (var edge in connections.Reverse())
        {
            if (bounds(edge.From) is not { } from || bounds(edge.To) is not { } to) { continue; }
            var (start, end) = Endpoints(edge, from, to);
            if (!NativeCanvasGeometry.Between(start, end).Inflate(170 + tolerance).Contains(point)) { continue; }
            if (NativeCanvasGeometry.DistanceToSegment(point, start, end) <= tolerance) { return edge.Id; }
            if (edge.Label.Length > 0 && LabelBounds(LabelText(edge.Label), Middle(start, end)).Inflate(tolerance).Contains(point)) { return edge.Id; }
        }
        return null;
    }
    public void SetViewport(Rect viewport)
    {
        this.viewport = viewport;
        origin = viewport.Position;
        Canvas.SetLeft(this, origin.X);
        Canvas.SetTop(this, origin.Y);
        Width = viewport.Width;
        Height = viewport.Height;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        foreach (var edge in connections)
        {
            if (bounds(edge.From) is { } from && bounds(edge.To) is { } to && from.Union(to).Inflate(500).Intersects(viewport)) { DrawConnection(context, edge, from, to); }
        }
    }

    private void DrawConnection(DrawingContext context, NativeCanvasConnection edge, Rect from, Rect to)
    {
        var (source, target) = Endpoints(edge, from, to);
        var start = source - new Vector(origin.X, origin.Y);
        var end = target - new Vector(origin.X, origin.Y);
        var brush = selected == edge.Id ? NativePalette.Brush("AccentBrush") : NativeCanvasPalette.Brush(edge.Color, "MutedBrush");
        var pen = new Pen(brush, selected == edge.Id ? 3 : 1.5);
        context.DrawLine(pen, start, end);
        var length = NativeCanvasGeometry.Distance(start, end);
        var direction = length > 0 ? (end - start) / length : new Vector(1, 0);
        if (edge.FromEnd == "arrow") { Arrow(context, pen, start, direction); }
        if (edge.ToEnd != "none") { Arrow(context, pen, end, -direction); }
        if (edge.Label.Length > 0) { DrawLabel(context, edge.Label, Middle(start, end)); }
    }

    private void DrawLabel(DrawingContext context, string label, Point middle)
    {
        var text = LabelText(label);
        var box = LabelBounds(text, middle);
        context.DrawRectangle(NativePalette.Brush("SurfaceBrush"), null, box);
        context.DrawText(text, new Point(box.X + 4, box.Y + 2));
    }

    private FormattedText LabelText(string label) => new(label.Length > 120 ? label[..120] + "…" : label, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
            new Typeface(TextElement.GetFontFamily(this)), 12, NativePalette.Brush("TextBrush"))
    { MaxTextWidth = 300, MaxTextHeight = 50, Trimming = TextTrimming.CharacterEllipsis };

    private static Rect LabelBounds(FormattedText text, Point middle) => new(middle.X - text.Width / 2 - 4, middle.Y - text.Height - 10, text.Width + 8, text.Height + 4);

    private static void Arrow(DrawingContext context, Pen pen, Point tip, Vector direction)
    {
        var cross = new Vector(-direction.Y, direction.X);
        context.DrawLine(pen, tip, tip + direction * 10 + cross * 4);
        context.DrawLine(pen, tip, tip + direction * 10 - cross * 4);
    }

    private static Point Middle(Point start, Point end) => new((start.X + end.X) / 2, (start.Y + end.Y) / 2);
    private static (Point Start, Point End) Endpoints(NativeCanvasConnection edge, Rect from, Rect to)
    {
        var delta = to.Center - from.Center;
        var horizontal = delta.X > 0 ? "right" : "left";
        var vertical = delta.Y > 0 ? "bottom" : "top";
        var automatic = Math.Abs(delta.X) > Math.Abs(delta.Y) ? horizontal : vertical;
        var fromSide = edge.FromSide.Length > 0 ? edge.FromSide : automatic;
        var toSide = edge.ToSide.Length > 0 ? edge.ToSide : fromSide switch { "right" => "left", "left" => "right", "top" => "bottom", _ => "top" };
        return (Endpoint(from, fromSide), Endpoint(to, toSide));
    }
    private static Point Endpoint(Rect box, string side) => side switch { "top" => new(box.Center.X, box.Top), "bottom" => new(box.Center.X, box.Bottom), "left" => new(box.Left, box.Center.Y), _ => new(box.Right, box.Center.Y) };
}

internal static class NativeCanvasGeometry
{
    public static Rect Between(Point first, Point second) => new(Math.Min(first.X, second.X), Math.Min(first.Y, second.Y), Math.Abs(first.X - second.X), Math.Abs(first.Y - second.Y));
    public static double DistanceToSegment(Point point, Point start, Point end)
    {
        var direction = end - start;
        var squared = direction.X * direction.X + direction.Y * direction.Y;
        if (squared == 0) { return Distance(point, start); }
        var offset = point - start;
        var position = Math.Clamp((offset.X * direction.X + offset.Y * direction.Y) / squared, 0, 1);
        return Distance(point, start + direction * position);
    }
    public static double Distance(Point first, Point second)
    {
        var x = first.X - second.X;
        var y = first.Y - second.Y;
        return Math.Sqrt(x * x + y * y);
    }
}

internal static class NativeCanvasPalette
{
    public static IBrush Brush(string? value, string fallback) => value is null ? NativePalette.Brush(fallback) : new SolidColorBrush(ColorOf(value));
    public static IBrush GroupBrush(string? value)
    {
        if (value is null) { return Brushes.Transparent; }
        var color = ColorOf(value);
        return new SolidColorBrush(Color.FromArgb((byte)(color.A / 8), color.R, color.G, color.B));
    }

    // Canvas uses CSS #RGBA/#RRGGBBAA; Avalonia's parser expects alpha first.
    private static Color ColorOf(string value)
    {
        var hex = (value switch { "1" => "#e85d75", "2" => "#ed9855", "3" => "#d4bf56", "4" => "#72b47b", "5" => "#56b4be", "6" => "#a78bfa", _ => value }).TrimStart('#');
        if (hex.Length is 3 or 4) { hex = string.Concat(hex.Select(character => new string(character, 2))); }
        var alpha = hex.Length == 8 ? Byte(hex, 6) : (byte)255;
        return Color.FromArgb(alpha, Byte(hex, 0), Byte(hex, 2), Byte(hex, 4));
    }
    private static byte Byte(string hex, int offset) => byte.Parse(hex.AsSpan(offset, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
}
