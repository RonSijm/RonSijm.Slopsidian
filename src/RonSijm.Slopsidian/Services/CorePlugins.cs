using System.Text.Json;
using System.Text.Json.Nodes;

namespace RonSijm.Slopsidian.Services;

public sealed record CorePluginDefinition(string Id, string Name, bool? DefaultOn);
public sealed record CoreSettingField(string Key, string Label, string Type, IReadOnlyList<string>? Options = null, bool Visible = true, double? Minimum = null, double? Maximum = null, double? Step = null);
public sealed record CorePluginState(string Id, string Name, bool Implemented, bool ConfiguredEnabled, bool Enabled, string SettingsSupport, IReadOnlyList<CoreSettingField> Fields, JsonObject Settings);
public sealed record CorePluginSnapshot(string? Root, IReadOnlyList<CorePluginState> Plugins);
public sealed record CoreEnableRequest(string? Root, bool? Enabled);
public sealed record CoreSettingsRequest(string? Root, JsonElement Values);

public static class CorePlugins
{
    public static IReadOnlyList<CorePluginDefinition> Definitions { get; } = LoadDefinitions();

    public static IReadOnlyList<string> LegacyIds { get; } =
    [
        "file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link",
        "tag-pane", "page-preview", "daily-notes", "templates", "note-composer",
        "command-palette", "slash-command", "editor-status", "starred", "markdown-importer",
        "zk-prefixer", "random-note", "outline", "word-count", "slides", "audio-recorder",
        "workspaces", "file-recovery", "publish", "sync"
    ];

    private static readonly HashSet<string> Implemented = new(StringComparer.Ordinal)
    {
        "file-explorer", "command-palette", "switcher", "outline", "word-count",
        "daily-notes", "templates", "zk-prefixer", "random-note", "outgoing-link",
        "global-search", "tag-pane", "backlink", "footnotes", "bookmarks", "workspaces", "properties", "graph", "canvas", "page-preview",
        "slash-command", "slides", "markdown-importer", "note-composer", "webviewer", "bases", "file-recovery", "audio-recorder", "editor-status"
    };

    private static readonly HashSet<string> WithoutSettings = new(StringComparer.Ordinal)
    {
        "file-explorer", "outline", "word-count", "random-note", "outgoing-link",
        "global-search", "tag-pane", "footnotes", "bookmarks", "workspaces", "properties", "graph", "slash-command", "slides", "markdown-importer", "bases", "audio-recorder", "editor-status"
    };

    public static bool IsImplemented(string id) => Implemented.Contains(id);

    public static CorePluginDefinition Definition(string id)
    {
        var definition = Definitions.FirstOrDefault(item => item.Id == id);
        if (definition is null)
        {
            throw new VaultException("Unknown core plugin: " + id, 404);
        }

        return definition;
    }

    public static IReadOnlyList<CoreSettingField> Fields(string id)
    {
        var result = id switch
        {
            "switcher" => new CoreSettingField[]
            {
                new("showExistingOnly", "Show existing files only", "checkbox"),
                new("showAttachments", "Show attachments", "checkbox"),
                new("showAllFileTypes", "Show all file types", "checkbox")
            },
            "daily-notes" => new CoreSettingField[]
            {
                new("format", "Date format", "text"),
                new("folder", "New file location", "text"),
                new("template", "Template file location", "text")
            },
            "templates" => new CoreSettingField[]
            {
                new("folder", "Template folder location", "text"),
                new("dateFormat", "Date format", "text"),
                new("timeFormat", "Time format", "text")
            },
            "zk-prefixer" => new CoreSettingField[]
            {
                new("format", "Unique prefix format", "text"),
                new("folder", "New file location", "text"),
                new("template", "Template file location", "text")
            },
            "note-composer" => new CoreSettingField[]
            {
                new("replacementText", "Text after extraction", "select", ["link", "embed", "none"]),
                new("template", "Template file location", "text"),
                new("askBeforeMerging", "Confirm before merging notes", "checkbox")
            },
            "command-palette" => new CoreSettingField[] { new("pinned", "Pinned commands", "commands") },
            "file-recovery" => new CoreSettingField[]
            {
                new("intervalMinutes", "Snapshot interval (minutes)", "number"),
                new("keepDays", "History retention (days)", "number")
            },
            "webviewer" => new CoreSettingField[]
            {
                new("openExternalURLs", "Open external web links in Web viewer", "checkbox"),
                new("enableAdblocking", "Block ads (reload pages after changing)", "checkbox"),
                new("readerFont", "Reader font", "select", ["serif", "sans-serif", "monospace", "custom"]),
                new("readerCustomFont", "Reader custom font family", "text"),
                new("readerWidth", "Reader article width", "select", ["narrow", "standard", "wide", "custom"]),
                new("readerCustomWidth", "Reader custom width (ch)", "number", Minimum: 40, Maximum: 120, Step: 1),
                new("readerFontSize", "Reader font size (px)", "number", Minimum: 14, Maximum: 32, Step: 1),
                new("readerLineHeight", "Reader line spacing", "number", Minimum: 1.2, Maximum: 2.4, Step: 0.1),
                new("readerParagraphSpacing", "Reader paragraph spacing (em)", "number", Minimum: 0, Maximum: 3, Step: 0.1),
                new("readerLetterSpacing", "Reader letter spacing (em)", "number", Minimum: 0, Maximum: 0.2, Step: 0.01),
                new("homepage", "Homepage", "text"),
                new("searchEngine", "Search engine (duckduckgo/brave/bing/google/custom)", "text"),
                new("customSearchEngine", "Custom search address (%s is the query)", "text"),
                new("markdownPath", "Clipped article folder (empty for vault root)", "text"),
                new("clipIncludeProperties", "Add note properties to new clips by default", "checkbox"),
                new("clipDefaultTags", "Default clipping tags (comma-separated; applied to new previews)", "text")
            },
            "backlink" => new CoreSettingField[] { new("backlinkInDocument", "Backlinks in document", "checkbox") },
            "page-preview" => new CoreSettingField[]
            {
                new("preview", "Require modifier key: Reading view", "checkbox"),
                new("editor", "Require modifier key: Editor", "checkbox"),
                new("search", "Require modifier key: Search", "checkbox"),
                new("tab-header", "Require modifier key: Tab headers", "checkbox")
            },
            "canvas" => new CoreSettingField[]
            {
                new("newFileLocation", "New canvas location", "select", ["root", "current", "folder"]),
                new("newFileFolderPath", "New canvas folder", "text"),
                new("defaultWheelBehavior", "Mouse wheel behavior", "select", ["pan", "zoom"]),
                new("defaultModDragBehavior", "Ctrl/Cmd-drag in empty space", "select", ["menu", "card", "note", "media", "webpage", "group"]),
                new("cardLabelVisibility", "Card labels", "select", ["always", "hover", "never"]),
                new("snapToGrid", "Snap to grid", "checkbox"),
                new("snapToObjects", "Snap to objects", "checkbox"),
                new("zoomBreakpoint", "Zoom threshold for card contents", "range", Minimum: -0.7, Maximum: 2.4, Step: 0.01)
            },
            _ => []
        };
        return result;
    }

    public static string SettingsSupport(string id)
    {
        if (Fields(id).Count > 0)
        {
            return "implemented";
        }

        if (WithoutSettings.Contains(id))
        {
            return "none";
        }

        return "unimplemented";
    }

    public static JsonObject DefaultSettings(string id)
    {
        var result = id switch
        {
            "switcher" => new JsonObject { ["showExistingOnly"] = false, ["showAttachments"] = true, ["showAllFileTypes"] = false },
            "daily-notes" => new JsonObject { ["format"] = "YYYY-MM-DD", ["folder"] = "", ["template"] = "", ["autorun"] = false },
            "templates" => new JsonObject { ["folder"] = "", ["dateFormat"] = "YYYY-MM-DD", ["timeFormat"] = "HH:mm" },
            "zk-prefixer" => new JsonObject { ["format"] = "YYYYMMDDHHmm", ["folder"] = "", ["template"] = "" },
            "note-composer" => new JsonObject { ["replacementText"] = "link", ["template"] = "", ["askBeforeMerging"] = true },
            "command-palette" => new JsonObject { ["pinned"] = null },
            "file-recovery" => new JsonObject { ["intervalMinutes"] = 5, ["keepDays"] = 7 },
            "webviewer" => new JsonObject { ["openExternalURLs"] = true, ["enableAdblocking"] = true, ["readerFont"] = "serif", ["readerCustomFont"] = "Georgia", ["readerWidth"] = "standard", ["readerCustomWidth"] = 72, ["readerFontSize"] = 19, ["readerLineHeight"] = 1.7, ["readerParagraphSpacing"] = 1, ["readerLetterSpacing"] = 0, ["homepage"] = "", ["searchEngine"] = "duckduckgo", ["customSearchEngine"] = "https://duckduckgo.com/?q=%s", ["markdownPath"] = "", ["clipIncludeProperties"] = false, ["clipDefaultTags"] = "" },
            "backlink" => new JsonObject { ["backlinkInDocument"] = false },
            "canvas" => new JsonObject { ["newFileLocation"] = "root", ["newFileFolderPath"] = "", ["defaultWheelBehavior"] = "pan", ["defaultModDragBehavior"] = "menu", ["cardLabelVisibility"] = "always", ["snapToGrid"] = true, ["snapToObjects"] = true, ["zoomBreakpoint"] = 0 },
            _ => new JsonObject()
        };
        return result;
    }

    private static IReadOnlyList<CorePluginDefinition> LoadDefinitions()
    {
        using var stream = typeof(CorePlugins).Assembly.GetManifestResourceStream("RonSijm.Slopsidian.CorePlugins.json")
            ?? throw new InvalidOperationException("The core-plugin catalog is missing from the application.");
        using var document = JsonDocument.Parse(stream);
        var definitions = document.RootElement.GetProperty("plugins").Deserialize<CorePluginDefinition[]>(new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("The core-plugin catalog contains no definitions.");
        if (definitions.Length != definitions.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count())
        {
            throw new InvalidOperationException("The core-plugin catalog contains duplicate identifiers.");
        }

        return definitions;
    }
}
