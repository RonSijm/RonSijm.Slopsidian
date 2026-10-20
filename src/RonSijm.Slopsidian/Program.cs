using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using RonSijm.Slopsidian.Components;
using RonSijm.Slopsidian.Services;

var builder = WebApplication.CreateBuilder(args);
var token = Environment.GetEnvironmentVariable("SLOPSIDIAN_TOKEN");
if (string.IsNullOrWhiteSpace(token))
{
    throw new InvalidOperationException("Start this application through its Electron launcher.");
}

builder.Services.AddSingleton<VaultService>();
builder.Services.AddSingleton<IVaultHost>(services => services.GetRequiredService<VaultService>());
builder.Services.AddSingleton<VaultWatch>();
builder.Services.AddHttpClient<CommunityDownloads>(client => client.Timeout = TimeSpan.FromSeconds(30)).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
builder.Services.AddRazorComponents().AddInteractiveServerComponents();
builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = TimeSpan.FromSeconds(5));
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.MaxDepth = 256);
var app = builder.Build();
var expectedToken = Encoding.UTF8.GetBytes(token);

app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new { error = "The host encountered an unexpected error. Check its terminal log." });
}));
app.Use(async (context, next) =>
{
    var supplied = Encoding.UTF8.GetBytes(context.Request.Headers["X-Vault-Token"].ToString());
    if (!CryptographicOperations.FixedTimeEquals(supplied, expectedToken))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    var frameAncestors = context.Request.Path == "/mermaid-frame.html" ? "'self'" : "'none'";
    context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:* https://raw.githubusercontent.com https://api.github.com https://release-assets.githubusercontent.com https://objects.githubusercontent.com; font-src 'self' data:; object-src 'none'; frame-ancestors " + frameAncestors;
    try
    {
        await next(context);
    }
    catch (VaultException exception)
    {
        app.Logger.LogWarning(exception, "Rejected vault request {Path}", context.Request.Path);
        context.Response.StatusCode = exception.StatusCode;
        await context.Response.WriteAsJsonAsync(new { error = exception.Message });
    }
    catch (JsonException exception)
    {
        app.Logger.LogWarning(exception, "Invalid JSON in vault data");
        context.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
        await context.Response.WriteAsJsonAsync(new { error = "The requested JSON file is invalid: " + exception.Message });
    }
});
app.UseAntiforgery();

app.MapGet("/api/health", () => new { application = "Slopsidian", runtime = RuntimeInformation.FrameworkDescription, compatibility = "experimental-subset" });
app.MapGet("/api/vault", (VaultService vault, CancellationToken cancellationToken) => vault.GetSnapshotAsync(cancellationToken));
app.MapPost("/api/vault/open", (OpenVaultRequest request, VaultService vault, CancellationToken cancellationToken) => vault.OpenAsync(request.Path, cancellationToken));
app.MapPost("/api/vault/create", (CreateVaultRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateAsync(request, cancellationToken));
app.MapGet("/api/file", (string path, string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadAsync(path, cancellationToken, root));
app.MapGet("/api/resource", (string path, string root, VaultService vault, CancellationToken cancellationToken) => vault.ReadResourceAsync(path, root, cancellationToken));
app.MapGet("/api/adapter/stat", async (string path, string root, VaultService vault, CancellationToken cancellationToken) =>
{
    var metadata = await vault.StatAdapterPathAsync(root, path, cancellationToken);
    IResult response = metadata is null ? Results.Text("null", "application/json") : Results.Json(metadata);
    return response;
});
app.MapGet("/api/adapter/list", (string path, string root, VaultService vault, CancellationToken cancellationToken) => vault.ListAdapterFolderAsync(root, path, cancellationToken));
app.MapPost("/api/adapter/folder", (CreateVaultFolderRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateAdapterFolderAsync(request, cancellationToken));
app.MapPost("/api/binary", (CreateBinaryRequest request, VaultService vault, CancellationToken cancellationToken) => vault.CreateBinaryAsync(request, cancellationToken));
app.MapGet("/api/binary", (string path, string root, VaultService vault, CancellationToken cancellationToken) => vault.ReadBinaryAsync(path, root, cancellationToken));
app.MapPost("/api/file", (WriteFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.WriteAsync(request, true, cancellationToken));
app.MapPut("/api/file", (WriteFileRequest request, VaultService vault, CancellationToken cancellationToken) => vault.WriteAsync(request, false, cancellationToken));
app.MapGet("/api/vault/revision", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.GetRevisionAsync(root, cancellationToken));
app.MapGet("/api/metadata/documents", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadMetadataDocumentsAsync(root, cancellationToken));
app.MapVaultFileOperations();
app.MapGet("/api/configuration/{id}", (string id, string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadConfigurationAsync(id, root, cancellationToken));
app.MapPut("/api/configuration/{id}", (string id, WriteConfigurationRequest request, VaultService vault, CancellationToken cancellationToken) => vault.WriteConfigurationAsync(id, request, cancellationToken));
app.MapGet("/api/core", (VaultService vault, CancellationToken cancellationToken) => vault.ReadCorePluginsAsync(cancellationToken));
app.MapPut("/api/core/{id}", (string id, CoreEnableRequest request, VaultService vault, CancellationToken cancellationToken) => vault.SetCoreEnabledAsync(id, request, cancellationToken));
app.MapPut("/api/core/{id}/settings", (string id, CoreSettingsRequest request, VaultService vault, CancellationToken cancellationToken) => vault.WriteCoreSettingsAsync(id, request, cancellationToken));
app.MapGet("/api/workspace", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadWorkspaceAsync(cancellationToken, root));
app.MapGet("/api/workspace/original", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadOriginalWorkspaceAsync(root, cancellationToken));
app.MapPost("/api/workspace/validate", (string root, WorkspaceLayout layout, VaultService vault, CancellationToken cancellationToken) => vault.ValidateWorkspaceAsync(layout, root, cancellationToken));
app.MapPut("/api/workspace", async (string? root, WorkspaceLayout layout, VaultService vault, CancellationToken cancellationToken) =>
{
    await vault.WriteWorkspaceAsync(layout, cancellationToken, root);
    return Results.NoContent();
});
app.MapGet("/api/plugins/{id}", (string id, VaultService vault, CancellationToken cancellationToken) => vault.GetPluginAsync(id, cancellationToken));
app.MapPost("/api/community-download", async (CommunityDownloadRequest request, CommunityDownloads downloads, HttpContext context, CancellationToken cancellationToken) =>
{
    var result = await downloads.ReadAsync(request, cancellationToken);
    context.Response.StatusCode = result.Status;
    context.Response.ContentType = "application/octet-stream";
    await context.Response.Body.WriteAsync(result.Bytes, cancellationToken);
});
app.MapGet("/api/community-plugins", (string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadCommunityPluginsAsync(root, cancellationToken));
app.MapPut("/api/community-plugins", (WriteCommunityPluginConfigurationRequest request, VaultService vault, CancellationToken cancellationToken) => vault.WriteCommunityPluginsAsync(request, cancellationToken));
app.MapGet("/api/community-plugins/{id}", (string id, string? root, VaultService vault, CancellationToken cancellationToken) => vault.ReadInstalledCommunityPluginAsync(id, root, cancellationToken));
app.MapPost("/api/community-plugins/{id}", (string id, CommunityPluginInstallRequest request, VaultService vault, CancellationToken cancellationToken) => vault.InstallCommunityPluginAsync(id, request, cancellationToken));
app.MapDelete("/api/community-plugins/{id}", (string id, [Microsoft.AspNetCore.Mvc.FromBody] DeleteCommunityPluginRequest request, VaultService vault, CancellationToken cancellationToken) => vault.DeleteCommunityPluginAsync(id, request, cancellationToken));
app.MapGet("/api/plugins/{id}/data", (string id, VaultService vault, CancellationToken cancellationToken) => vault.ReadPluginDataAsync(id, cancellationToken));
app.MapPut("/api/plugins/{id}/data", async (string id, JsonElement data, VaultService vault, CancellationToken cancellationToken) =>
{
    await vault.WritePluginDataAsync(id, data, cancellationToken);
    return Results.NoContent();
});

app.MapStaticAssets();
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();

var initialVault = Environment.GetEnvironmentVariable("SLOPSIDIAN_VAULT");
if (!string.IsNullOrWhiteSpace(initialVault))
{
    await app.Services.GetRequiredService<VaultService>().OpenAsync(initialVault);
}

app.Lifetime.ApplicationStarted.Register(() =>
{
    var server = app.Services.GetRequiredService<IServer>();
    var addresses = server.Features.Get<IServerAddressesFeature>()!;
    Console.WriteLine("VAULT_READY " + addresses.Addresses.Single());
});
if (Environment.GetEnvironmentVariable("SLOPSIDIAN_PARENT") == "1")
{
    _ = Task.Run(async () =>
    {
        var line = await Console.In.ReadLineAsync();
        if (line is not null && line != "shutdown")
        {
            app.Logger.LogWarning("Unexpected parent control message; stopping the owned host.");
        }

        app.Lifetime.StopApplication();
    });
}

await app.RunAsync();
