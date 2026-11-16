using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace RonSijm.Slopsidian.Linux;

internal sealed class NativeCanvasEdgeLayer(Func<string, Rect?> bounds) : Control
{
    private NativeCanvasConnection[] connections = [];
    private Point origin;
    private Rect viewport;

    public void SetConnections(IEnumerable<NativeCanvasConnection> value) { connections = value.ToArray(); InvalidateVisual(); }
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
        var start = Endpoint(from, edge.FromSide) - new Vector(origin.X, origin.Y);
        var end = Endpoint(to, edge.ToSide) - new Vector(origin.X, origin.Y);
        var distance = Math.Clamp(NativeCanvasGeometry.Distance(start, end) * 0.45, 40, 500);
        var first = start + Direction(edge.FromSide) * distance;
        var second = end + Direction(edge.ToSide) * distance;
        var brush = NativeCanvasPalette.Brush(edge.Color, "MutedBrush");
        var pen = new Pen(brush, 1.5);
        var geometry = new StreamGeometry();
        using (var path = geometry.Open()) { path.BeginFigure(start, false); path.CubicBezierTo(first, second, end); path.EndFigure(false); }
        context.DrawGeometry(null, pen, geometry);
        if (edge.FromEnd == "arrow") { Arrow(context, pen, start, Direction(edge.FromSide)); }
        if (edge.ToEnd == "arrow") { Arrow(context, pen, end, Direction(edge.ToSide)); }
        if (edge.Label.Length > 0) { DrawLabel(context, edge.Label, BezierMiddle(start, first, second, end)); }
    }

    private void DrawLabel(DrawingContext context, string label, Point middle)
    {
        var visible = label.Length > 120 ? label[..120] + "…" : label;
        var text = new FormattedText(visible, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
            new Typeface(TextElement.GetFontFamily(this)), 12, NativePalette.Brush("TextBrush"))
        { MaxTextWidth = 300, MaxTextHeight = 50, Trimming = TextTrimming.CharacterEllipsis };
        var point = new Point(middle.X - text.Width / 2, middle.Y - text.Height / 2);
        context.DrawRectangle(NativePalette.Brush("SurfaceBrush"), null, new Rect(point.X - 4, point.Y - 2, text.Width + 8, text.Height + 4));
        context.DrawText(text, point);
    }

    private static void Arrow(DrawingContext context, Pen pen, Point tip, Vector direction)
    {
        var cross = new Vector(-direction.Y, direction.X);
        context.DrawLine(pen, tip, tip + direction * 10 + cross * 4);
        context.DrawLine(pen, tip, tip + direction * 10 - cross * 4);
    }

    private static Point BezierMiddle(Point start, Point first, Point second, Point end) => new((start.X + 3 * first.X + 3 * second.X + end.X) / 8, (start.Y + 3 * first.Y + 3 * second.Y + end.Y) / 8);
    private static Point Endpoint(Rect box, string side) => side switch { "top" => new(box.Center.X, box.Top), "bottom" => new(box.Center.X, box.Bottom), "left" => new(box.Left, box.Center.Y), _ => new(box.Right, box.Center.Y) };
    private static Vector Direction(string side) => side switch { "top" => new(0, -1), "bottom" => new(0, 1), "left" => new(-1, 0), _ => new(1, 0) };
}

internal static class NativeCanvasGeometry
{
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
