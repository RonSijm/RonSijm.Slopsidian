using System.Globalization;
using System.Xml.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Data;
using Avalonia.Media;
using Avalonia.Platform;
using IconPath = Avalonia.Controls.Shapes.Path;

namespace RonSijm.Slopsidian.Linux;

/// <summary>Native geometry from the same SVG icon source used by the existing UI.</summary>
public sealed class NativeIcon : UserControl
{
    private static readonly Lazy<Dictionary<string, IReadOnlyList<Geometry>>> Shapes = new(LoadShapes);
    public static readonly StyledProperty<string> KindProperty = AvaloniaProperty.Register<NativeIcon, string>(nameof(Kind), "file");

    public NativeIcon()
    {
        Width = 18;
        Height = 18;
        IsHitTestVisible = false;
        Rebuild();
    }

    public string Kind
    {
        get => GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);
        if (change.Property == KindProperty)
        {
            Rebuild();
        }
    }

    private void Rebuild()
    {
        var shapes = Shapes.Value;
        var geometries = shapes.TryGetValue(Kind, out var result) ? result : shapes["file"];
        var canvas = new Canvas { Width = 24, Height = 24 };
        foreach (var geometry in geometries)
        {
            var shape = new IconPath
            {
                Data = geometry,
                StrokeThickness = 1.7,
                StrokeLineCap = PenLineCap.Round,
                StrokeJoin = PenLineJoin.Round,
                Fill = null
            };
            shape.Bind(Shape.StrokeProperty, new Binding(nameof(Foreground)) { Source = this });
            canvas.Children.Add(shape);
        }
        Content = new Viewbox { Child = canvas, Stretch = Stretch.Uniform };
    }

    private static Dictionary<string, IReadOnlyList<Geometry>> LoadShapes()
    {
        using var stream = AssetLoader.Open(new Uri($"avares://{typeof(NativeIcon).Assembly.GetName().Name}/Assets/icons.svg"));
        var document = XDocument.Load(stream);
        var shapes = new Dictionary<string, IReadOnlyList<Geometry>>(StringComparer.Ordinal);
        foreach (var symbol in document.Descendants().Where(node => node.Name.LocalName == "symbol"))
        {
            var geometries = symbol.Elements().Select(ParseGeometry).Where(geometry => geometry is not null).Cast<Geometry>().ToArray();
            shapes.Add((string)symbol.Attribute("id")!, geometries);
        }
        return shapes;
    }

    private static Geometry? ParseGeometry(XElement element) => element.Name.LocalName switch
    {
        "path" => Geometry.Parse((string)element.Attribute("d")!),
        "circle" => new EllipseGeometry(new Rect(Number(element, "cx") - Number(element, "r"), Number(element, "cy") - Number(element, "r"), Number(element, "r") * 2, Number(element, "r") * 2)),
        "rect" => new RectangleGeometry(new Rect(Number(element, "x"), Number(element, "y"), Number(element, "width"), Number(element, "height")), Number(element, "rx"), Number(element, "rx")),
        "line" => new LineGeometry(new Point(Number(element, "x1"), Number(element, "y1")), new Point(Number(element, "x2"), Number(element, "y2"))),
        _ => null
    };

    private static double Number(XElement element, string name) => double.Parse((string?)element.Attribute(name) ?? "0", CultureInfo.InvariantCulture);
}
