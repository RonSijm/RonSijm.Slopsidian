using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Components.Pages;

public partial class Home() : IAsyncDisposable
{
    [Parameter] public string? RemoteVault { get; set; }
    private string? openedRemoteRoute;
    private VaultSnapshot snapshot = new(null, "No vault selected", [], []);
    private PluginRuntimeStatus pluginRuntime = new([], []);
    private EditorStatus editor = new(null, false);
    private ElementReference editorElement;
    private IJSObjectReference? module;
    private DotNetObjectReference<Home>? reference;
    private string newNote = "";
    private string vaultToOpen = "";
    private string newVaultName = "";
    private string newVaultLocation = "";
    private BrowserVaultState browserVaults = new(false, []);
    private BrowserVaultChoice[] githubVaults = [];
    private string githubUrl = "https://github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example";
    private string githubRef = "";
    private string githubFolder = "";
    private bool githubCached;
    private string? error;
    private string settingsSection = "core";
    private string? settingsPlugin;
    private bool initialized;
    private bool busy;
    private IJSObjectReference Client => module ?? throw new InvalidOperationException("The editor has not initialized.");

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender)
        {
            return;
        }

        await RunAsync(async () =>
        {
            module = await JavaScript.InvokeAsync<IJSObjectReference>("import", "./js/editor-host.js");
            await Vault.ConfigureClientAsync(Client);
            reference = DotNetObjectReference.Create(this);
            await Client.InvokeVoidAsync("initialize", editorElement, reference);
            initialized = true;
            await LoadVaultAsync(await Vault.GetSnapshotAsync());
            if (RemoteVault is not null)
            {
                try
                {
                    await OpenLinkedVaultAsync();
                }
                catch (Exception exception) when (exception is JSException or VaultException)
                {
                    Logger.LogWarning(exception, "The linked GitHub vault could not be opened");
                    await LogClientErrorAsync(exception);
                    error = UserFacingError(exception);
                }
            }
            if (snapshot.Root is null)
            {
                await ShowVaultChooserAsync();
            }
        });
        await InvokeAsync(StateHasChanged);
    }

    private Task ChooseVaultAsync() => RunAsync(ShowVaultChooserAsync);

    protected override Task OnParametersSetAsync() => initialized && RemoteVault is not null && RemoteVault != openedRemoteRoute
        ? RunAsync(async () =>
        {
            // File history can introduce the route after mounting through the vault chooser.
            if (Vault.IsBrowser && await Client.InvokeAsync<bool>("isCurrentBrowserVaultLink")) { openedRemoteRoute = RemoteVault; return; }
            await OpenLinkedVaultAsync();
        }) : Task.CompletedTask;

    private async Task OpenLinkedVaultAsync()
    {
        openedRemoteRoute = RemoteVault;
        if (RemoteVault is null || !RemoteVault.StartsWith("github.com/", StringComparison.OrdinalIgnoreCase)) { throw new VaultException("Only public github.com remote vault links are supported."); }
        // Read the escaped pathname so a slash inside an encoded Git ref stays one segment.
        githubUrl = await Client.InvokeAsync<string>("getLinkedGitHubUrl");
        await ChangeVaultAsync(() => Client.InvokeAsync<VaultSnapshot>("openGitHubVault", new GitHubOpenRequest(githubUrl)).AsTask());
    }

    private static string UserFacingError(Exception exception) => System.Text.RegularExpressions.Regex.Replace(exception.Message.Split('\n', 2)[0].Trim(), @"^Host \d+:\s*", "");

    private async Task ShowVaultChooserAsync()
    {
        vaultToOpen = snapshot.Root ?? "";
        if (Vault.IsBrowser)
        {
            browserVaults = await Client.InvokeAsync<BrowserVaultState>("getBrowserVaults");
        }
        else if (string.IsNullOrEmpty(newVaultLocation) && snapshot.Root is not null && !snapshot.ReadOnly)
        {
            newVaultLocation = Path.GetDirectoryName(snapshot.Root) ?? snapshot.Root;
        }

        try { githubVaults = await Client.InvokeAsync<BrowserVaultChoice[]>("getGitHubVaults"); }
        catch (JSException exception) { Logger.LogDebug(exception, "GitHub recent-vault cache is unavailable"); githubVaults = []; }

        await InvokeAsync(StateHasChanged);
        var focus = Vault.IsBrowser ? "browser-open-vault" : "vault-open-path";
        await Client.InvokeVoidAsync("openDialog", "vault-dialog", focus);
    }

    private async Task BrowseVaultAsync(bool create)
    {
        await RunAsync(async () =>
        {
            var path = await Client.InvokeAsync<string?>("chooseVault", create ? "create" : "open");
            if (path is null)
            {
                return;
            }

            if (create)
            {
                newVaultLocation = path;
            }
            else
            {
                vaultToOpen = path;
            }
        });
    }

    private Task OpenVaultAsync() => RunAsync(() => ChangeVaultAsync(() => Vault.OpenAsync(vaultToOpen)));
    private Task CreateVaultAsync() => RunAsync(() => ChangeVaultAsync(() => Vault.CreateAsync(new CreateVaultRequest(newVaultName, newVaultLocation))));

    private Task OpenGitHubVaultAsync() => RunAsync(() => ChangeVaultAsync(() => Client.InvokeAsync<VaultSnapshot>("openGitHubVault",
        new GitHubOpenRequest(githubUrl, string.IsNullOrWhiteSpace(githubRef) ? null : githubRef,
            string.IsNullOrWhiteSpace(githubFolder) ? null : githubFolder, githubCached)).AsTask()));

    private Task OpenCachedGitHubVaultAsync(string id) => RunAsync(() => ChangeVaultAsync(() => Client.InvokeAsync<VaultSnapshot>("openGitHubVault", new GitHubOpenRequest(id, Cached: true)).AsTask()));

    private Task BrowseBrowserVaultAsync(bool create, string? recentId = null) => RunAsync(async () =>
    {
        var selected = await Client.InvokeAsync<string?>("chooseVault", create ? "create" : "open", recentId);
        if (selected is null)
        {
            return;
        }

        if (create)
        {
            await ChangeVaultAsync(() => Vault.CreateAsync(new CreateVaultRequest(newVaultName, selected)));
        }
        else
        {
            await ChangeVaultAsync(() => Vault.OpenAsync(selected));
        }
    });

    private async Task ChangeVaultAsync(Func<Task<VaultSnapshot>> open)
    {
        await Client.InvokeVoidAsync("prepareVaultChange");
        try
        {
            await LoadVaultAsync(await open());
            await Client.InvokeVoidAsync("closeDialog", "vault-dialog");
        }
        finally
        {
            await Client.InvokeVoidAsync("resumeEditing");
        }
    }

    private async Task LoadVaultAsync(VaultSnapshot value)
    {
        snapshot = value;
        var restored = await Client.InvokeAsync<bool>("setVault", snapshot);
        var first = snapshot.Files.FirstOrDefault(file => file.Extension.Equals("md", StringComparison.OrdinalIgnoreCase));
        if (!restored && first is not null && !snapshot.Lazy)
        {
            await Client.InvokeVoidAsync("openFile", first.Path);
        }
        await Client.InvokeVoidAsync("vaultReady");
    }

    private async Task CreateNoteAsync()
    {
        await RunAsync(async () =>
        {
            if (string.IsNullOrWhiteSpace(newNote))
            {
                throw new VaultException("Enter a name for the new Markdown note.");
            }

            var path = newNote.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? newNote : newNote + ".md";
            await Client.InvokeVoidAsync("createNote", path);
            newNote = "";
        });
    }

    private Task OpenNoteAsync(NoteOpenRequest request) => RunAsync(() => Client.InvokeVoidAsync("openFile", request.Path, request.NewTab).AsTask());
    private Task SaveNoteAsync() => WorkspaceActionAsync("workspace:save-file");
    private Task ReloadNoteAsync() => RunAsync(() => Client.InvokeVoidAsync("reloadCurrent").AsTask());
    private Task WorkspaceActionAsync(string id) => RunAsync(async () =>
    {
        if (!initialized)
        {
            throw new VaultException("The workspace is still initializing.");
        }

        await Client.InvokeVoidAsync("performAction", id);
    });
    private async Task ShowNewNoteAsync()
    {
        await RunAsync(async () =>
        {
            if (snapshot.ReadOnly) { throw new VaultException("This GitHub vault is read-only. Open a local vault to create notes."); }
            var suffix = 0;
            var name = "Untitled";
            while (snapshot.Files.Any(file => file.Path.Equals(name + ".md", StringComparison.OrdinalIgnoreCase)))
            {
                suffix++;
                name = "Untitled " + suffix;
            }

            newNote = name;
            await InvokeAsync(StateHasChanged);
            await Client.InvokeVoidAsync("openDialog", "new-note-dialog", "new-note-name");
        });
    }

    private Task OpenSettingsAsync() => RunAsync(() => ShowSettingsDialogAsync("core"));
    private Task OpenAboutAsync() => RunAsync(() => ShowSettingsDialogAsync("general"));

    private async Task ShowSettingsDialogAsync(string section)
    {
        settingsSection = section;
        await Client.InvokeVoidAsync("hideSettings");
        await InvokeAsync(StateHasChanged);
        await Client.InvokeVoidAsync("openDialog", "settings-dialog");
    }

    private Task SetSettingsSection(string section)
    {
        return RunAsync(async () =>
        {
            settingsSection = section;
            await Client.InvokeVoidAsync("hideSettings");
        });
    }

    private async Task ShowSettingsAsync(string id)
    {
        await RunAsync(async () =>
        {
            settingsPlugin = id;
            settingsSection = "plugin";
            await InvokeAsync(StateHasChanged);
            await Client.InvokeVoidAsync("showSettings", id);
            await Client.InvokeVoidAsync("openDialog", "settings-dialog");
        });
    }

    [JSInvokable]
    public async Task OnDesktopAction(string action)
    {
        if (action == "new-note")
        {
            await ShowNewNoteAsync();
        }
        else if (action == "settings")
        {
            await OpenSettingsAsync();
        }
        else if (action == "open-vault")
        {
            await ChooseVaultAsync();
        }
        else
        {
            throw new VaultException("Unknown desktop action: " + action);
        }

        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnEditorStateChanged(EditorStatus status)
    {
        editor = status;
        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnCommunityPluginSettings(string id)
    {
        await ShowSettingsAsync(id);
        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnPluginsChanged(PluginRuntimeStatus status)
    {
        pluginRuntime = status;
        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnGitHubMountRequested(GitHubOpenRequest request)
    {
        await RunAsync(() => ChangeVaultAsync(() => Client.InvokeAsync<VaultSnapshot>("openGitHubVault", request).AsTask()));
        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnVaultFilesChanged()
    {
        snapshot = snapshot.ReadOnly ? await Client.InvokeAsync<VaultSnapshot>("getGitHubSnapshot") : await Vault.GetSnapshotAsync();
        await InvokeAsync(StateHasChanged);
    }

    private async Task RunAsync(Func<Task> operation)
    {
        busy = true;
        error = null;
        try
        {
            await operation();
        }
        catch (Exception exception) when (exception is VaultException or JSException or IOException or UnauthorizedAccessException)
        {
            Logger.LogError(exception, "Vault operation failed");
            await LogClientErrorAsync(exception);
            error = UserFacingError(exception);
        }
        finally
        {
            busy = false;
        }
    }

    private async Task LogClientErrorAsync(Exception exception)
    {
        try { await JavaScript.InvokeVoidAsync("slopsidianDiagnostics.reportHostError", UserFacingError(exception), exception.ToString()); }
        catch (Exception loggingException) when (loggingException is JSException or JSDisconnectedException or TaskCanceledException)
        {
            Logger.LogError(loggingException, "Cannot persist the client error log; original error: {OriginalError}", exception.ToString());
        }
    }

    private Task DownloadErrorLogAsync() => RunAsync(() => JavaScript.InvokeVoidAsync("slopsidianDiagnostics.download").AsTask());

    public async ValueTask DisposeAsync()
    {
        reference?.Dispose();
        if (module is not null)
        {
            try
            {
                await module.DisposeAsync();
            }
            catch (JSDisconnectedException exception)
            {
                Logger.LogDebug(exception, "The desktop renderer disconnected during component disposal.");
            }
        }
    }
}
