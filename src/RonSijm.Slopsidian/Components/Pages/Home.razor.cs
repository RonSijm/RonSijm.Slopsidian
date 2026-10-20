using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Components.Pages;

public partial class Home() : IAsyncDisposable
{
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
            if (snapshot.Root is null)
            {
                await ShowVaultChooserAsync();
            }
        });
        await InvokeAsync(StateHasChanged);
    }

    private Task ChooseVaultAsync() => RunAsync(ShowVaultChooserAsync);

    private async Task ShowVaultChooserAsync()
    {
        vaultToOpen = snapshot.Root ?? "";
        if (Vault.IsBrowser)
        {
            browserVaults = await Client.InvokeAsync<BrowserVaultState>("getBrowserVaults");
        }
        else if (string.IsNullOrEmpty(newVaultLocation) && snapshot.Root is not null)
        {
            newVaultLocation = Path.GetDirectoryName(snapshot.Root) ?? snapshot.Root;
        }

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
        if (!restored && first is not null)
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
    private Task TogglePluginAsync(string id, bool loaded) => RunAsync(() => Client.InvokeVoidAsync(loaded ? "disablePlugin" : "enablePlugin", id).AsTask());
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
        await InvokeAsync(StateHasChanged);
        await Client.InvokeVoidAsync("openDialog", "settings-dialog");
    }

    private void SetSettingsSection(string section)
    {
        settingsSection = section;
    }

    private async Task ShowSettingsAsync(string id)
    {
        await RunAsync(async () =>
        {
            settingsPlugin = id;
            settingsSection = "plugin";
            await InvokeAsync(StateHasChanged);
            await Client.InvokeVoidAsync("showSettings", id);
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
    public async Task OnPluginsChanged(PluginRuntimeStatus status)
    {
        pluginRuntime = status;
        await InvokeAsync(StateHasChanged);
    }

    [JSInvokable]
    public async Task OnVaultFilesChanged()
    {
        snapshot = await Vault.GetSnapshotAsync();
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
            error = exception.Message;
        }
        finally
        {
            busy = false;
        }
    }

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
