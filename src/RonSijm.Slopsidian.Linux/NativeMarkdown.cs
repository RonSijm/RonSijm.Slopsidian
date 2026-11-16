using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;
using Markdig;
using Markdig.Helpers;
using Markdig.Parsers;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace RonSijm.Slopsidian.Linux;

/// <summary>Markdown rendered as Avalonia controls, without HTML, scripts or a WebView.</summary>
public static class NativeMarkdown
{
    private static readonly MarkdownPipeline Pipeline = CreatePipeline();
    private static IBrush Muted => NativePalette.Brush("MutedBrush");
    private static IBrush Accent => NativePalette.Brush("AccentBrush");

    private static MarkdownPipeline CreatePipeline()
    {
        var builder = new MarkdownPipelineBuilder();
        builder.InlineParsers.Insert(0, new WikiLinkParser());
        return builder.Build();
    }

    public static void Render(Panel target, string markdown, Action<string> navigate)
    {
        target.Children.Clear();
        // Work on a bounded reading view; editing and saving always retain the entire document.
        if (markdown.Length > 1_000_000)
        {
            target.Children.Add(new TextBlock { Text = "This note is too large for the reading view. Use Source to edit it.", TextWrapping = TextWrapping.Wrap });
            return;
        }
        foreach (var block in Markdown.Parse(markdown, Pipeline))
        {
            target.Children.Add(RenderBlock(block, navigate));
        }

        if (target.Children.Count == 0)
        {
            target.Children.Add(new TextBlock { Text = "This note is empty. Start writing in the Source tab.", Foreground = Muted });
        }
    }

    private static Control RenderBlock(Block block, Action<string> navigate)
    {
        switch (block)
        {
            case HeadingBlock heading:
                var title = Text(heading.Inline, navigate);
                title.FontSize = heading.Level switch { 1 => 30, 2 => 24, 3 => 20, _ => 17 };
                title.LineHeight = title.FontSize * 1.4;
                title.FontWeight = FontWeight.SemiBold;
                title.Margin = new Thickness(0, 16, 0, 2);
                return title;
            case ParagraphBlock paragraph:
                return Text(paragraph.Inline, navigate);
            case CodeBlock code:
                return new Border
                {
                    Background = NativePalette.Brush("SidebarBrush"),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(16),
                    Child = new SelectableTextBlock { Text = code.Lines.ToString(), FontFamily = new FontFamily("DejaVu Sans Mono, monospace"), FontSize = 14, TextWrapping = TextWrapping.Wrap }
                };
            case QuoteBlock quote:
                var quoted = new StackPanel { Spacing = 10, Margin = new Thickness(16, 0, 0, 0) };
                foreach (var child in quote)
                {
                    quoted.Children.Add(RenderBlock(child, navigate));
                }

                return quoted;
            case ListBlock list:
                return RenderList(list, navigate);
            case ThematicBreakBlock:
                return new Border { Height = 1, Background = NativePalette.Brush("DividerBrush"), Margin = new Thickness(0, 12) };
            case HtmlBlock html:
                // Raw HTML is visible text; never execute or fetch it.
                return new SelectableTextBlock { Text = html.Lines.ToString(), Foreground = Muted, TextWrapping = TextWrapping.Wrap };
            default:
                return new SelectableTextBlock { Text = block.ToString(), TextWrapping = TextWrapping.Wrap };
        }
    }

    private static StackPanel RenderList(ListBlock list, Action<string> navigate)
    {
        var items = new StackPanel { Spacing = 8 };
        var number = int.TryParse(list.OrderedStart, out var start) ? start : 1;
        foreach (var item in list.OfType<ListItemBlock>())
        {
            var row = new Grid { ColumnDefinitions = new ColumnDefinitions("28,*") };
            row.Children.Add(new TextBlock { Text = list.IsOrdered ? $"{number++}." : "•", Foreground = Muted, FontSize = 16 });
            var contents = new StackPanel { Spacing = 8 };
            Grid.SetColumn(contents, 1);
            foreach (var child in item)
            {
                contents.Children.Add(RenderBlock(child, navigate));
            }

            row.Children.Add(contents);
            items.Children.Add(row);
        }
        return items;
    }

    private static SelectableTextBlock Text(ContainerInline? source, Action<string> navigate)
    {
        var text = new SelectableTextBlock { FontSize = 16, LineHeight = 26, TextWrapping = TextWrapping.Wrap };
        if (source is not null)
        {
            AddInlines(text.Inlines!, source, navigate);
        }

        return text;
    }

    private static void AddInlines(InlineCollection destination, ContainerInline source, Action<string> navigate)
    {
        foreach (var inline in source)
        {
            switch (inline)
            {
                case LiteralInline literal:
                    destination.Add(new Run(literal.Content.ToString()));
                    break;
                case WikiLinkInline wiki:
                    var wikiButton = new Button
                    {
                        Content = wiki.Label,
                        Foreground = Accent,
                        Padding = new Thickness(0),
                        Background = Brushes.Transparent,
                        BorderThickness = new Thickness(0)
                    };
                    ToolTip.SetTip(wikiButton, wiki.Target);
                    wikiButton.Click += (_, _) => navigate(wiki.Target);
                    destination.Add(new InlineUIContainer(wikiButton));
                    break;
                case LineBreakInline:
                    destination.Add(new Run("\n"));
                    break;
                case CodeInline code:
                    destination.Add(new Run(code.Content) { FontFamily = new FontFamily("DejaVu Sans Mono, monospace"), Background = NativePalette.Brush("SidebarBrush") });
                    break;
                case EmphasisInline emphasis:
                    var span = new Span();
                    if (emphasis.DelimiterCount >= 2)
                    {
                        span.FontWeight = FontWeight.Bold;
                    }
                    else
                    {
                        span.FontStyle = FontStyle.Italic;
                    }

                    AddInlines(span.Inlines, emphasis, navigate);
                    destination.Add(span);
                    break;
                case LinkInline link when !link.IsImage:
                    var label = new TextBlock { Foreground = Accent, TextDecorations = TextDecorations.Underline, TextWrapping = TextWrapping.Wrap };
                    AddInlines(label.Inlines!, link, navigate);
                    var button = new Button { Content = label, Padding = new Thickness(0), Background = Brushes.Transparent, BorderThickness = new Thickness(0), Cursor = new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.Hand) };
                    ToolTip.SetTip(button, link.Url);
                    button.Click += (_, _) => navigate(link.Url ?? "");
                    destination.Add(new InlineUIContainer(button));
                    break;
                case LinkInline image:
                    destination.Add(new Run("[Image: " + image.Url + "]") { Foreground = Muted });
                    break;
                case HtmlInline html:
                    destination.Add(new Run(html.Tag));
                    break;
                case ContainerInline container:
                    AddInlines(destination, container, navigate);
                    break;
                default:
                    destination.Add(new Run(inline.ToString() ?? ""));
                    break;
            }
        }
    }

    private sealed class WikiLinkInline(string target, string label) : LeafInline
    {
        public string Target { get; } = target;
        public string Label { get; } = label;
    }

    private sealed class WikiLinkParser : InlineParser
    {
        public WikiLinkParser() => OpeningCharacters = ['['];

        public override bool Match(InlineProcessor processor, ref StringSlice slice)
        {
            if (slice.CurrentChar != '[' || slice.PeekChar(1) != '[')
            {
                return false;
            }

            var end = slice.Text.IndexOf("]]", slice.Start + 2, StringComparison.Ordinal);
            if (end < 0 || end > slice.End)
            {
                return false;
            }

            var value = slice.Text[(slice.Start + 2)..end];
            if (value.Length == 0 || value.IndexOfAny(['\n', '\r', '[', ']']) >= 0)
            {
                return false;
            }

            var parts = value.Split('|', 2);
            processor.Inline = new WikiLinkInline(parts[0], parts.Length == 2 ? parts[1] : parts[0]);
            slice.Start = end + 2;
            return true;
        }
    }
}
