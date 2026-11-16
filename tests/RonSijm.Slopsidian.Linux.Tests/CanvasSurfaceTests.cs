using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class CanvasSurfaceTests
{
    [AvaloniaFact]
    public void NativeCardDraggingCommitsOnceAtReleaseAndRetainsTheSourceDuringTheGesture()
    {
        var model = Model();
        using var surface = new NativeCanvasSurface(card => new TextBlock { Text = card.Text }) { SnapToGrid = false };
        var window = new Window { Content = surface, Width = 900, Height = 640 };
        try
        {
            surface.SetData(model.GetCards(), model.GetConnections());
            var commits = 0;
            surface.CardsMoved += (ids, x, y) => { commits++; model.MoveCards(ids, x, y); surface.SetData(model.GetCards(), model.GetConnections()); };
            window.Show();
            window.UpdateLayout();
            var frame = surface.GetVisualDescendants().OfType<Border>().Single(border => border.Tag as string == "a");
            var start = frame.TranslatePoint(new Point(120, 80), window)!.Value;
            var end = new Point(start.X + 33 * surface.Zoom, start.Y + 11 * surface.Zoom);
            var original = model.Source;
            window.MouseDown(start, MouseButton.Left);
            window.MouseMove(end);
            Assert.Equal(original, model.Source);
            Assert.Equal(0, commits);
            window.MouseUp(end, MouseButton.Left);
            Assert.Equal(1, commits);
            Assert.Equal(43, model.GetCards()[0].X);
            Assert.Equal(31, model.GetCards()[0].Y);
        }
        finally { window.Close(); }
    }

    [AvaloniaFact]
    public void NativeResizeHandleUpdatesDimensionsWithoutMovingTheCard()
    {
        var model = Model();
        using var surface = new NativeCanvasSurface(card => new TextBlock { Text = card.Text }) { SnapToGrid = false };
        var window = new Window { Content = surface, Width = 900, Height = 640 };
        try
        {
            surface.SetData(model.GetCards(), model.GetConnections());
            surface.Select(["a"]);
            surface.CardResized += (id, width, height) => model.UpdateCard(id, node => { node["width"] = width; node["height"] = height; });
            window.Show();
            window.UpdateLayout();
            var frame = surface.GetVisualDescendants().OfType<Border>().Single(border => border.Tag as string == "a");
            var start = frame.TranslatePoint(new Point(frame.Bounds.Width - 2, frame.Bounds.Height - 2), window)!.Value;
            var end = new Point(start.X + 50 * surface.Zoom, start.Y + 30 * surface.Zoom);
            window.MouseDown(start, MouseButton.Left);
            window.MouseMove(end);
            window.MouseUp(end, MouseButton.Left);
            var card = model.GetCards()[0];
            Assert.Equal(450, card.Width);
            Assert.Equal(270, card.Height);
            Assert.Equal(10, card.X);
            Assert.Equal(20, card.Y);
        }
        finally { window.Close(); }
    }

    [AvaloniaFact]
    public void NativeBoardKeyboardSelectAllAndDeleteOperateOnTheSelectedCards()
    {
        var model = Model();
        using var surface = new NativeCanvasSurface(card => new TextBlock { Text = card.Text });
        var window = new Window { Content = surface, Width = 900, Height = 640 };
        try
        {
            surface.SetData(model.GetCards(), model.GetConnections());
            surface.DeleteRequested += () => model.RemoveCards(surface.GetSelection());
            window.Show();
            window.UpdateLayout();
            Assert.True(surface.Focus());
            window.KeyPressQwerty(PhysicalKey.A, RawInputModifiers.Control);
            window.KeyReleaseQwerty(PhysicalKey.A, RawInputModifiers.Control);
            Assert.Equal(2, surface.GetSelection().Count);
            window.KeyPressQwerty(PhysicalKey.Delete, RawInputModifiers.None);
            window.KeyReleaseQwerty(PhysicalKey.Delete, RawInputModifiers.None);
            Assert.Empty(model.GetCards());
            Assert.Empty(model.GetConnections());
        }
        finally { window.Close(); }
    }

    [AvaloniaFact]
    public void AutomaticVerticalConnectionCanBeSelectedInsideAGroupWithoutDraggingItsCards()
    {
        var model = new NativeCanvasDocument("""
            {"nodes":[
              {"id":"group","type":"group","x":0,"y":0,"width":600,"height":900},
              {"id":"a","type":"text","x":100,"y":100,"width":300,"height":200,"text":"First"},
              {"id":"b","type":"text","x":100,"y":600,"width":300,"height":200,"text":"Second"}
            ],"edges":[{"id":"edge","fromNode":"a","toNode":"b","label":"Continue"}]}
            """);
        using var surface = new NativeCanvasSurface(card => new TextBlock { Text = card.Text });
        var window = new Window { Content = surface, Width = 900, Height = 640 };
        try
        {
            surface.SetData(model.GetCards(), model.GetConnections());
            window.Show(); window.UpdateLayout();
            var moves = 0;
            surface.CardsMoved += (_, _, _) => moves++;
            foreach (var factor in new[] { 1d, 0.5 })
            {
                surface.ZoomBy(factor); window.UpdateLayout();
                var frames = surface.GetVisualDescendants().OfType<Border>().Where(border => border.Tag is string).ToDictionary(border => (string)border.Tag!);
                var start = frames["a"].TranslatePoint(new Point(150, 200), window)!.Value;
                var end = frames["b"].TranslatePoint(new Point(150, 0), window)!.Value;
                var point = new Point((start.X + end.X) / 2 + 6, (start.Y + end.Y) / 2);
                window.MouseDown(point, MouseButton.Left); window.MouseUp(point, MouseButton.Left);
                Assert.Equal("edge", surface.SelectedConnectionId);
                Assert.Empty(surface.GetSelection());
            }
            Assert.Equal(0, moves);
            string? edited = null;
            surface.ConnectionEditRequested += id => edited = id;
            window.KeyPressQwerty(PhysicalKey.Enter, RawInputModifiers.None); window.KeyReleaseQwerty(PhysicalKey.Enter, RawInputModifiers.None);
            Assert.Equal("edge", edited);
            surface.Select(["a"]);
            Assert.Null(surface.SelectedConnectionId);
            surface.SelectConnection("edge");
            model.RemoveConnection("edge"); surface.SetData(model.GetCards(), model.GetConnections());
            Assert.Null(surface.SelectedConnectionId);
        }
        finally { window.Close(); }
    }

    private static NativeCanvasDocument Model() => new("""
        {"nodes":[
          {"id":"a","type":"text","x":10,"y":20,"width":400,"height":240,"text":"First native card"},
          {"id":"b","type":"text","x":500,"y":20,"width":400,"height":240,"text":"Second native card"}
        ],"edges":[{"id":"edge","fromNode":"a","toNode":"b"}]}
        """);
}
