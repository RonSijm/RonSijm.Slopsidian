using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RonSijm.Slopsidian.Linux;

public sealed record NativeTabState(string Path, int Caret, double ScrollOffset, bool Reading, bool Pinned, string? Draft, string Version, bool HasBom = false, string? ViewMode = null);
public sealed record NativeSession(string Root, string? Active, IReadOnlyList<NativeTabState> Tabs);
public sealed record NativePreferences
{
    public string Theme { get; init; } = "dark";
    public double FontSize { get; init; } = 16;
    public bool LineNumbers { get; init; } = true;
    public bool WordWrap { get; init; } = true;
    public bool Autosave { get; init; } = true;
    public string DefaultMode { get; init; } = "source";
    public double LeftWidth { get; init; } = 260;
    public double RightWidth { get; init; } = 260;
}

public sealed record NativeProfileState
{
    public int Version { get; init; } = 1;
    public NativePreferences Preferences { get; init; } = new();
    public IReadOnlyList<string> RecentVaults { get; init; } = [];
    public IReadOnlyList<string> Bookmarks { get; init; } = [];
    public IReadOnlyDictionary<string, NativeSession> Workspaces { get; init; } = new Dictionary<string, NativeSession>();
    public NativeSession? Session { get; init; }
    public IReadOnlyDictionary<string, NativeSession> VaultSessions { get; init; } = new Dictionary<string, NativeSession>();
}

/// <summary>Private application state; never writes profile data into .obsidian.</summary>
public sealed class NativeProfile(string? directory = null) : IDisposable
{
    private const int MaximumBytes = 32 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly SemaphoreSlim gate = new(1, 1);
    public NativeProfileState State { get; set; } = new();
    public string? DirectoryPath => directory;
    public static string DefaultDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Slopsidian", "native");

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (directory is null)
        {
            return;
        }
        var file = Path.Combine(directory, "state.json");
        if (!File.Exists(file))
        {
            return;
        }
        if (new FileInfo(file).Length > MaximumBytes)
        {
            throw new InvalidDataException("The native profile exceeds its supported size. Existing recovery data was retained.");
        }
        var json = await File.ReadAllTextAsync(file, cancellationToken);
        var state = JsonSerializer.Deserialize<NativeProfileState>(json, JsonOptions) ?? throw new InvalidDataException("The native profile is empty.");
        if (state.Version != 1)
        {
            throw new InvalidDataException("This native profile uses an unsupported version. It was not changed.");
        }
        Validate(state);
        State = state;
    }

    public async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        if (directory is null)
        {
            return;
        }
        var bytes = JsonSerializer.SerializeToUtf8Bytes(State, JsonOptions);
        if (bytes.Length > MaximumBytes)
        {
            throw new InvalidDataException("Recovery drafts exceed the native profile limit. Save your notes before closing.");
        }
        await gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(directory);
            if (OperatingSystem.IsLinux())
            {
                File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
            var temporary = Path.Combine(directory, ".state-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Options = FileOptions.Asynchronous };
                if (OperatingSystem.IsLinux())
                {
                    options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
                }
                await using (var stream = new FileStream(temporary, options))
                {
                    await stream.WriteAsync(bytes, cancellationToken);
                    await stream.FlushAsync(cancellationToken);
                    stream.Flush(true);
                }
                File.Move(temporary, Path.Combine(directory, "state.json"), true);
            }
            finally
            {
                File.Delete(temporary);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public static void Validate(NativeProfileState state)
    {
        if (state.Preferences is null || state.RecentVaults is null || state.Bookmarks is null || state.Workspaces is null || state.VaultSessions is null)
        {
            throw new InvalidDataException("The native profile contains invalid state. Existing recovery data was retained.");
        }
        var preferences = state.Preferences;
        if (!double.IsFinite(preferences.FontSize) || !double.IsFinite(preferences.LeftWidth) || !double.IsFinite(preferences.RightWidth)
            || state.RecentVaults.Any(string.IsNullOrWhiteSpace) || state.Bookmarks.Any(key => key is null))
        {
            throw new InvalidDataException("The native profile contains invalid preferences or paths.");
        }
        var sessions = state.Workspaces.Values.Concat(state.VaultSessions.Values);
        if (state.Session is not null) { sessions = sessions.Append(state.Session); }
        if (sessions.Any(InvalidSession))
        {
            throw new InvalidDataException("The native profile contains an invalid recovery session. It was not changed.");
        }
    }

    private static bool InvalidSession(NativeSession? session) => session is null || string.IsNullOrWhiteSpace(session.Root)
        || session.Tabs is null || session.Tabs.Any(tab => tab is null || string.IsNullOrWhiteSpace(tab.Path)
            || tab.Version is null || !double.IsFinite(tab.ScrollOffset));

    public static string WorkspaceKey(string root, string name) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(root))) + ":" + name;
    public void Dispose() => gate.Dispose();
}
