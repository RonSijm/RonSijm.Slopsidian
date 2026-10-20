using System.Text.Json;
using Microsoft.JSInterop;

namespace RonSijm.Slopsidian.Services;

public sealed class BrowserVaultHost(IJSRuntime javaScript) : IVaultHost, IAsyncDisposable
{
    private IJSObjectReference? module;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public bool IsBrowser => true;

    public async Task ConfigureClientAsync(IJSObjectReference client)
    {
        module = await javaScript.InvokeAsync<IJSObjectReference>("import", "./js/browser-host.js");
        var catalog = CorePlugins.Definitions.Select(definition => new
        {
            definition.Id,
            definition.Name,
            definition.DefaultOn,
            Implemented = definition.Id != "webviewer" && CorePlugins.IsImplemented(definition.Id),
            SettingsSupport = CorePlugins.SettingsSupport(definition.Id),
            Fields = CorePlugins.Fields(definition.Id),
            Settings = CorePlugins.DefaultSettings(definition.Id)
        });
        await module.InvokeVoidAsync("initialize", catalog, CorePlugins.LegacyIds);
        await client.InvokeVoidAsync("useBrowserHost", module);
    }

    public Task<VaultSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default) => RequestAsync<VaultSnapshot>("/api/vault", "GET", null, cancellationToken);
    public Task<VaultSnapshot> OpenAsync(string path, CancellationToken cancellationToken = default) => RequestAsync<VaultSnapshot>("/api/vault/open", "POST", new OpenVaultRequest(path), cancellationToken);
    public Task<VaultSnapshot> CreateAsync(CreateVaultRequest request, CancellationToken cancellationToken = default) => RequestAsync<VaultSnapshot>("/api/vault/create", "POST", request, cancellationToken);

    private async Task<T> RequestAsync<T>(string path, string method, object? body, CancellationToken cancellationToken)
    {
        var host = module ?? throw new InvalidOperationException("The browser vault host has not initialized.");
        var response = await host.InvokeAsync<BrowserResponse>("request", cancellationToken, path, method, body);
        if (response.Status >= 400)
        {
            throw new VaultException(response.Error ?? "The browser vault operation failed.", response.Status);
        }

        var result = response.Value.Deserialize<T>(Json);
        if (result is null)
        {
            throw new VaultException("The browser vault host returned an empty response.");
        }

        return result;
    }

    public async ValueTask DisposeAsync()
    {
        if (module is not null)
        {
            await module.DisposeAsync();
        }
    }

    private sealed record BrowserResponse(int Status, JsonElement Value, string? Error);
}
