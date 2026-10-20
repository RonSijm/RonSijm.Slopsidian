using System.Net;
using System.Text.RegularExpressions;

namespace RonSijm.Slopsidian.Services;

public sealed record CommunityDownloadRequest(string? Url, int Limit);
public sealed record CommunityDownloadResult(int Status, byte[] Bytes);

public sealed class CommunityDownloads(HttpClient client)
{
    public async Task<CommunityDownloadResult> ReadAsync(CommunityDownloadRequest request, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        var uri = InitialUri(request.Url);
        var maximum = Path.GetFileName(uri.AbsolutePath) switch
        {
            "community-plugins.json" => 8 * 1024 * 1024,
            "versions.json" => 512 * 1024,
            "manifest.json" => 64 * 1024,
            "main.js" => 16 * 1024 * 1024,
            "styles.css" => 4 * 1024 * 1024,
            _ => throw new VaultException("Unsupported plugin download.")
        };
        if (request.Limit <= 0 || request.Limit > maximum)
        {
            throw new VaultException("Invalid community download size limit.");
        }

        try
        {
            for (var redirects = 0; redirects < 6; redirects++)
            {
                using var message = new HttpRequestMessage(HttpMethod.Get, uri);
                message.Headers.UserAgent.ParseAdd("Slopsidian/0.1");
                using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Redirect or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
                {
                    if (response.Headers.Location is not { } location)
                    {
                        throw new VaultException("GitHub returned a redirect without a location.", StatusCodes.Status502BadGateway);
                    }

                    uri = new Uri(uri, location);
                    ValidateRedirect(uri);
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                {
                    var status = (int)response.StatusCode;
                    if (response.StatusCode == HttpStatusCode.Forbidden && response.Headers.TryGetValues("X-RateLimit-Remaining", out var values) && values.Contains("0"))
                    {
                        status = StatusCodes.Status429TooManyRequests;
                    }

                    return new CommunityDownloadResult(status, []);
                }

                if (response.Content.Headers.ContentLength > request.Limit)
                {
                    throw new VaultException("The GitHub file exceeds its supported size.", StatusCodes.Status413PayloadTooLarge);
                }

                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var output = new MemoryStream();
                var buffer = new byte[32768];
                int count;
                while ((count = await stream.ReadAsync(buffer, timeout.Token)) > 0)
                {
                    if (output.Length + count > request.Limit)
                    {
                        throw new VaultException("The GitHub file exceeds its supported size.", StatusCodes.Status413PayloadTooLarge);
                    }

                    output.Write(buffer, 0, count);
                }

                return new CommunityDownloadResult((int)response.StatusCode, output.ToArray());
            }

            throw new VaultException("GitHub returned too many download redirects.", StatusCodes.Status502BadGateway);
        }
        catch (HttpRequestException exception)
        {
            throw new VaultException("The native GitHub download failed: " + exception.Message, StatusCodes.Status502BadGateway);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new VaultException("The GitHub download timed out.", StatusCodes.Status504GatewayTimeout);
        }
    }

    private static Uri InitialUri(string? value)
    {
        var catalog = value == "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
        const string repository = @"[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*";
        var raw = value is not null && Regex.IsMatch(value, @"\Ahttps://raw\.githubusercontent\.com/" + repository + @"/(?:HEAD|\d+\.\d+\.\d+)/(?:manifest|versions)\.json\z", RegexOptions.NonBacktracking);
        var asset = value is not null && Regex.IsMatch(value, @"\Ahttps://github\.com/" + repository + @"/releases/download/\d+\.\d+\.\d+/(?:manifest\.json|main\.js|styles\.css)\z", RegexOptions.NonBacktracking);
        if ((!catalog && !raw && !asset) || !Uri.TryCreate(value, UriKind.Absolute, out var uri))
        {
            throw new VaultException("Only public GitHub community catalog, manifest, version and release-asset downloads are supported.");
        }

        return uri;
    }

    private static void ValidateRedirect(Uri uri)
    {
        if (uri.Scheme != "https" || !uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) || uri.Host is not ("github.com" or "raw.githubusercontent.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
        {
            throw new VaultException("GitHub redirected the download outside its allowed public asset hosts.", StatusCodes.Status502BadGateway);
        }
    }
}
