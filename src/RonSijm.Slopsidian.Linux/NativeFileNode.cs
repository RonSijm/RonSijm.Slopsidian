using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeFileNode(string Name, string Path, bool IsFolder, IReadOnlyList<NativeFileNode> Children)
{
    public string Icon => IsFolder ? "folder" : System.IO.Path.GetExtension(Path).ToLowerInvariant() switch
    {
        ".canvas" => "layout-dashboard",
        ".base" => "table",
        ".png" or ".jpg" or ".jpeg" or ".svg" or ".gif" or ".webp" => "image",
        _ => "file"
    };

    public static IReadOnlyList<NativeFileNode> FromSnapshot(VaultSnapshot snapshot)
    {
        var folders = new Dictionary<string, List<NativeFileNode>>(StringComparer.Ordinal) { [""] = [] };
        foreach (var folder in snapshot.Folders ?? [])
        {
            folders.TryAdd(folder, []);
        }
        foreach (var file in snapshot.Files)
        {
            var parent = System.IO.Path.GetDirectoryName(file.Path)?.Replace('\\', '/') ?? "";
            if (!folders.TryGetValue(parent, out var children))
            {
                children = [];
                folders.Add(parent, children);
            }
            var name = file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase) ? file.Basename : file.Name;
            children.Add(new NativeFileNode(name, file.Path, false, []));
        }
        foreach (var path in folders.Keys.ToArray())
        {
            var parent = System.IO.Path.GetDirectoryName(path)?.Replace('\\', '/') ?? "";
            while (parent.Length > 0)
            {
                folders.TryAdd(parent, []);
                parent = System.IO.Path.GetDirectoryName(parent)?.Replace('\\', '/') ?? "";
            }
        }
        foreach (var folder in folders.Keys.Where(path => path.Length > 0).OrderByDescending(path => path.Count(character => character == '/')).ThenByDescending(path => path.Length))
        {
            var parent = System.IO.Path.GetDirectoryName(folder)?.Replace('\\', '/') ?? "";
            folders[parent].Add(new NativeFileNode(System.IO.Path.GetFileName(folder), folder, true, Sort(folders[folder])));
        }
        return Sort(folders[""]);
    }

    private static NativeFileNode[] Sort(IEnumerable<NativeFileNode> nodes) => nodes.OrderByDescending(node => node.IsFolder).ThenBy(node => node.Name, StringComparer.OrdinalIgnoreCase).ThenBy(node => node.Name, StringComparer.Ordinal).ToArray();
}
