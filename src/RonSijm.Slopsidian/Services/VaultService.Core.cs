using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;

namespace RonSijm.Slopsidian.Services;

public sealed partial class VaultService
{
    public async Task<CorePluginSnapshot> ReadCorePluginsAsync(CancellationToken cancellationToken = default)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            return await CoreSnapshotAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<CorePluginSnapshot> SetCoreEnabledAsync(string id, CoreEnableRequest request, CancellationToken cancellationToken = default)
    {
        _ = CorePlugins.Definition(id);
        if (!CorePlugins.IsImplemented(id))
        {
            throw new VaultException("This core plugin is not implemented yet: " + id, StatusCodes.Status501NotImplemented);
        }

        if (request.Enabled is null)
        {
            throw new VaultException("An explicit enabled state is required.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(request.Root);
            var configuration = await ReadCoreEnablementAsync(cancellationToken);
            configuration[id] = request.Enabled.Value;
            await WriteCoreObjectAsync("core-plugins", configuration, cancellationToken);
            return await CoreSnapshotAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<CorePluginSnapshot> WriteCoreSettingsAsync(string id, CoreSettingsRequest request, CancellationToken cancellationToken = default)
    {
        _ = CorePlugins.Definition(id);
        var fields = CorePlugins.Fields(id);
        if (fields.Count == 0)
        {
            throw new VaultException("This core plugin has no implemented settings page.", StatusCodes.Status501NotImplemented);
        }

        if (request.Values.ValueKind != JsonValueKind.Object)
        {
            throw new VaultException("Core settings must be a JSON object.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            RequireCoreRoot(request.Root);
            var values = await ReadCoreObjectAsync(id, cancellationToken);
            foreach (var property in request.Values.EnumerateObject())
            {
                var field = fields.FirstOrDefault(item => item.Key == property.Name);
                if (field is null && id == "page-preview" && !string.IsNullOrWhiteSpace(property.Name) && property.Name.Length <= 256 && !property.Name.Contains('\0'))
                {
                    field = new CoreSettingField(property.Name, property.Name, "checkbox");
                }

                if (field is null)
                {
                    throw new VaultException("Unknown core setting: " + property.Name);
                }

                values[property.Name] = ValidateCoreSetting(field, property.Value);
            }

            await WriteCoreObjectAsync(id, values, cancellationToken);
            return await CoreSnapshotAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    private void RequireCoreRoot(string? expected)
    {
        if (!string.Equals(expected, RequireRoot(), StringComparison.OrdinalIgnoreCase))
        {
            throw new VaultException("The selected vault changed. Reload before saving or performing file operations.", StatusCodes.Status409Conflict);
        }
    }

    private string CorePath(string id)
    {
        var configuration = Path.Combine(RequireRoot(), ".obsidian");
        var path = Path.Combine(configuration, id + ".json");
        EnsureNotLinked(configuration);
        EnsureNotLinked(path);
        return path;
    }

    private async Task WriteCoreObjectAsync(string id, JsonObject value, CancellationToken cancellationToken)
    {
        var path = CorePath(id);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, WorkspaceJson);
        if (File.Exists(path))
        {
            var existing = await File.ReadAllBytesAsync(path, cancellationToken);
            if (existing.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }))
            {
                bytes = [0xef, 0xbb, 0xbf, .. bytes];
            }
        }

        await AtomicWriteAsync(path, bytes, true, cancellationToken);
    }

    private async Task<JsonObject> ReadCoreObjectAsync(string id, CancellationToken cancellationToken)
    {
        var path = CorePath(id);
        if (!File.Exists(path))
        {
            return new JsonObject();
        }

        var node = JsonNode.Parse(await File.ReadAllTextAsync(path, cancellationToken));
        if (node is not JsonObject values)
        {
            throw new VaultException("The core settings file must contain a JSON object: " + id, StatusCodes.Status422UnprocessableEntity);
        }

        return values;
    }

    private async Task<JsonObject> ReadCoreEnablementAsync(CancellationToken cancellationToken)
    {
        var path = CorePath("core-plugins");
        if (!File.Exists(path))
        {
            return new JsonObject();
        }

        var node = JsonNode.Parse(await File.ReadAllTextAsync(path, cancellationToken));
        if (node is JsonObject configuration)
        {
            return configuration;
        }

        if (node is not JsonArray legacy || legacy.Any(item => item is not JsonValue value || !value.TryGetValue<string>(out _)))
        {
            throw new VaultException("Core plugin enablement must be an object or a legacy array of identifiers.", StatusCodes.Status422UnprocessableEntity);
        }

        var result = await ReadCoreObjectAsync("core-plugins-migration", cancellationToken);
        var enabled = legacy.Select(item => item!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        foreach (var id in CorePlugins.LegacyIds.Concat(enabled).Distinct(StringComparer.Ordinal))
        {
            result[id] = enabled.Contains(id);
        }

        return result;
    }

    private async Task<CorePluginSnapshot> CoreSnapshotAsync(CancellationToken cancellationToken)
    {
        var configuration = root is null ? new JsonObject() : await ReadCoreEnablementAsync(cancellationToken);
        var appSettings = root is null ? new JsonObject() : await ReadCoreObjectAsync("app", cancellationToken);
        var showUnsupportedFiles = false;
        if (appSettings.TryGetPropertyValue("showUnsupportedFiles", out var unsupported))
        {
            showUnsupportedFiles = ValidateCoreSetting(new CoreSettingField("showUnsupportedFiles", "Show unsupported files", "checkbox"), JsonSerializer.SerializeToElement(unsupported))!.GetValue<bool>();
        }

        var states = new List<CorePluginState>();
        foreach (var definition in CorePlugins.Definitions)
        {
            var wanted = definition.DefaultOn == true;
            if (configuration.TryGetPropertyValue(definition.Id, out var flag))
            {
                if (flag is not JsonValue value || !value.TryGetValue<bool>(out wanted))
                {
                    throw new VaultException("Core enablement must be a Boolean for " + definition.Id, StatusCodes.Status422UnprocessableEntity);
                }
            }

            var settings = CorePlugins.DefaultSettings(definition.Id);
            if (root is not null && CorePlugins.SettingsSupport(definition.Id) == "implemented")
            {
                var stored = await ReadCoreObjectAsync(definition.Id, cancellationToken);
                foreach (var property in stored)
                {
                    settings[property.Key] = property.Value?.DeepClone();
                }

                foreach (var field in CorePlugins.Fields(definition.Id))
                {
                    if (definition.Id != "page-preview" || settings.ContainsKey(field.Key))
                    {
                        settings[field.Key] = ValidateCoreSetting(field, JsonSerializer.SerializeToElement(settings[field.Key]));
                    }
                }
            }

            var implemented = CorePlugins.IsImplemented(definition.Id);
            var fields = CorePlugins.Fields(definition.Id).Select(field => definition.Id == "switcher" && field.Key == "showAllFileTypes" ? field with { Visible = showUnsupportedFiles } : field).ToArray();
            states.Add(new CorePluginState(definition.Id, definition.Name, implemented, wanted, root is not null && implemented && wanted, CorePlugins.SettingsSupport(definition.Id), fields, settings));
        }

        return new CorePluginSnapshot(root, states);
    }

    private JsonNode? ValidateCoreSetting(CoreSettingField field, JsonElement value)
    {
        if (field.Type is "number" or "range")
        {
            var minimum = field.Minimum ?? (field.Key == "keepDays" ? 1 : 0);
            var maximum = field.Maximum ?? (field.Key == "keepDays" ? 3650 : 10080);
            if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number) || number < minimum || number > maximum)
            {
                throw new VaultException($"The setting {field.Key} must be a number from {minimum} to {maximum}.");
            }
            if ((field.Key == "readerFontSize" && Math.Truncate(number) != number) || ((field.Key is "readerLineHeight" or "readerParagraphSpacing") && Math.Round(number * 10) / 10 != number))
            {
                throw new VaultException("Choose a Reader font size in whole pixels and line/paragraph spacing in steps of 0.1.");
            }
            if (field.Key == "readerLetterSpacing" && Math.Round(number * 100) / 100 != number)
            {
                throw new VaultException("Choose Reader letter spacing in steps of 0.01.");
            }
            if (field.Key == "readerCustomWidth" && Math.Truncate(number) != number)
            {
                throw new VaultException("Choose a Reader custom width in whole characters (ch).");
            }
            return JsonValue.Create(number);
        }
        if (field.Type == "commands")
        {
            if (value.ValueKind == JsonValueKind.Null)
            {
                return null;
            }

            if (value.ValueKind != JsonValueKind.Array)
            {
                throw new VaultException("Pinned commands must be an array of command identifiers or null.");
            }

            var identifiers = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String || item.GetString() is not { } identifier || string.IsNullOrWhiteSpace(identifier) || identifier.Contains('\0') || !identifiers.Add(identifier))
                {
                    throw new VaultException("Pinned commands must contain distinct, nonempty command identifiers.");
                }
            }

            return JsonNode.Parse(value.GetRawText());
        }

        if (field.Type == "checkbox")
        {
            if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                throw new VaultException("The setting must be a Boolean: " + field.Key);
            }

            return JsonValue.Create(value.GetBoolean())!;
        }

        if (field.Key == "readerCustomFont")
        {
            return JsonValue.Create(ValidateReaderFontName(value));
        }
        if (field.Key == "clipDefaultTags")
        {
            return JsonValue.Create(ValidateClipTags(value));
        }

        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || text.Length > 1024 || text.Contains('\0'))
        {
            throw new VaultException("The setting must be a valid string: " + field.Key);
        }

        IReadOnlyList<string> choices = field.Options ?? (field.Key switch
        {
            "newFileLocation" => new[] { "root", "current", "folder" },
            "defaultWheelBehavior" => new[] { "pan", "zoom" },
            "cardLabelVisibility" => new[] { "always", "hover", "never" },
            "searchEngine" => new[] { "duckduckgo", "brave", "bing", "google", "custom" },
            _ => Array.Empty<string>()
        });
        if (choices.Count > 0 && !choices.Contains(text, StringComparer.Ordinal))
        {
            throw new VaultException("Invalid " + field.Key + ". Choose " + string.Join(", ", choices) + ".");
        }

        if (field.Key == "newFileFolderPath" && text == "/")
        {
            text = "";
        }

        if (field.Key == "customSearchEngine" && (!text.Contains("%s", StringComparison.Ordinal)
            || !Uri.TryCreate(text.Replace("%s", "query"), UriKind.Absolute, out var searchUrl)
            || searchUrl.Scheme is not ("http" or "https") || searchUrl.UserInfo.Length != 0))
        {
            throw new VaultException("The custom search address must use HTTP or HTTPS and contain %s.");
        }

        if ((field.Key is "folder" or "template" or "newFileFolderPath" or "markdownPath") && text.Length > 0)
        {
            if (Path.IsPathRooted(text))
            {
                throw new VaultException("Core locations must be relative to this vault.");
            }

            text = text.Replace('\\', '/').TrimEnd('/');
            _ = Resolve(text);
        }

        return JsonValue.Create(text)!;
    }

    private static string ValidateReaderFontName(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new VaultException("Choose a Reader custom font family of 1–100 characters, using a single local family name.");
        }
        string? text;
        try { text = value.GetString(); }
        catch (InvalidOperationException) { throw new VaultException("Choose a Reader custom font family with valid Unicode text."); }
        if (text is null || text.Length > 100) { throw new VaultException("Choose a Reader custom font family of 1–100 characters, using a single local family name."); }
        var name = text.Trim(' ');
        var hasLetter = false;
        foreach (var rune in name.EnumerateRunes())
        {
            hasLetter |= Rune.IsLetter(rune);
            var mark = Rune.GetUnicodeCategory(rune) is System.Globalization.UnicodeCategory.NonSpacingMark or System.Globalization.UnicodeCategory.SpacingCombiningMark or System.Globalization.UnicodeCategory.EnclosingMark;
            if (!Rune.IsLetter(rune) && !Rune.IsNumber(rune) && !mark && rune.Value is not (' ' or '.' or '_' or '\'' or '(' or ')' or '-'))
            {
                throw new VaultException("Choose a Reader custom font family using letters, numbers, spaces, periods, underscores, apostrophes, parentheses or hyphens.");
            }
        }
        if (!hasLetter) { throw new VaultException("Choose a Reader custom font family containing letters."); }
        return name;
    }

    private static string ValidateClipTags(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || text.Length > 2048)
        {
            throw new VaultException("Use at most 2,048 characters for tags.");
        }

        var tags = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in text.Split(','))
        {
            // ECMAScript trim whitespace matches the clipping dialog, including
            // BOM and excluding NEL. Enumerating runes also retains astral letters.
            var tag = entry.Trim(' ', '\t', '\n', '\v', '\f', '\r', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff');
            if (tag == "#") { throw new VaultException("Enter a tag name after #."); }
            if (tag.StartsWith('#')) { tag = tag[1..]; }
            if (tag.Length == 0) { continue; }
            var hasName = false;
            var valid = tag.Length <= 100 && !tag.Split('/').Any(part => part.Length == 0);
            foreach (var rune in tag.EnumerateRunes())
            {
                hasName |= Rune.IsLetter(rune) || rune.Value is '_' or '-';
                valid &= Rune.IsLetter(rune) || Rune.IsNumber(rune) || rune.Value is '_' or '/' or '-';
            }
            if (!valid || !hasName || !seen.Contains(tag) && tags.Count == 50)
            {
                throw new VaultException("Use up to 50 tags of at most 100 characters each, separated by commas. Tags need letters, underscores or hyphens; nested tags use single slashes.");
            }
            if (seen.Add(tag)) { tags.Add(tag); }
        }
        return string.Join(',', tags);
    }
}
