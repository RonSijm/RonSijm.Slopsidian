using Microsoft.JSInterop;

namespace RonSijm.Slopsidian.Services;

public interface IVaultHost
{
    bool IsBrowser => false;
    Task ConfigureClientAsync(IJSObjectReference client) => Task.CompletedTask;
    Task<VaultSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default);
    Task<VaultSnapshot> OpenAsync(string path, CancellationToken cancellationToken = default);
    Task<VaultSnapshot> CreateAsync(CreateVaultRequest request, CancellationToken cancellationToken = default);
}
