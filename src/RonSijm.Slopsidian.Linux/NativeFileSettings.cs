using System.Text.Json;
using System.Text.Json.Nodes;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeFileSettings(string NewFileLocation = "root", string NewFileFolderPath = "/",
    string NewLinkFormat = "shortest", bool UseMarkdownLinks = false, string AttachmentFolderPath = "/", string TrashOption = "local")
{
    public static NativeFileSettings Read(JsonElement data) => new(
        Text(data, "newFileLocation", "root"), Text(data, "newFileFolderPath", "/"), Text(data, "newLinkFormat", "shortest"),
        data.TryGetProperty("useMarkdownLinks", out var value) && value.ValueKind == JsonValueKind.True,
        Text(data, "attachmentFolderPath", "/"), Text(data, "trashOption", "local"));

    private static string Text(JsonElement data, string key, string fallback) =>
        data.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : fallback;

    public JsonElement Apply(JsonElement previous)
    {
        if (NewFileLocation is not ("root" or "current" or "folder") || NewLinkFormat is not ("shortest" or "relative" or "absolute") || TrashOption is not ("local" or "system"))
        {
            throw new InvalidOperationException("Choose a supported note location, link format and trash destination.");
        }
        ValidateFolder(NewFileFolderPath, false);
        ValidateFolder(AttachmentFolderPath, true);
        var data = JsonNode.Parse(previous.GetRawText())!.AsObject();
        data["newFileLocation"] = NewFileLocation;
        data["newFileFolderPath"] = NewFileFolderPath;
        data["newLinkFormat"] = NewLinkFormat;
        data["useMarkdownLinks"] = UseMarkdownLinks;
        data["attachmentFolderPath"] = AttachmentFolderPath;
        data["trashOption"] = TrashOption;
        return JsonSerializer.SerializeToElement(data);
    }

    public string NotePath(string name, string? activePath, VaultSnapshot snapshot)
    {
        if (name.Contains('/') || name.Contains('\\')) { return name; }
        var folder = NewFileLocation switch
        {
            "current" => Path.GetDirectoryName(activePath)?.Replace('\\', '/') ?? "",
            "folder" when NewFileFolderPath != "/" && snapshot.Folders?.Contains(NewFileFolderPath, StringComparer.Ordinal) == true => NewFileFolderPath,
            _ => ""
        };
        return folder.Length == 0 ? name : folder + "/" + name;
    }

    private static void ValidateFolder(string folder, bool relative)
    {
        if (folder == "/" || relative && folder == "./") { return; }
        var path = relative && folder.StartsWith("./", StringComparison.Ordinal) ? folder[2..] : folder;
        if (string.IsNullOrWhiteSpace(path) || path.Contains('\\') || Path.IsPathRooted(path)
            || path.Split('/').Any(part => string.IsNullOrWhiteSpace(part) || part is "." or ".." || part.StartsWith('.')))
        {
            throw new InvalidOperationException("Use a folder inside the vault, / for its root, or ./ for a note-relative attachment folder.");
        }
    }
}
