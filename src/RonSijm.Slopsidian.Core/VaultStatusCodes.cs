namespace RonSijm.Slopsidian.Services;

internal static class VaultStatusCodes
{
    public const int Status400BadRequest = 400;
    public const int Status403Forbidden = 403;
    public const int Status404NotFound = 404;
    public const int Status409Conflict = 409;
    public const int Status413PayloadTooLarge = 413;
    public const int Status415UnsupportedMediaType = 415;
    public const int Status422UnprocessableEntity = 422;
    public const int Status428PreconditionRequired = 428;
    public const int Status429TooManyRequests = 429;
    public const int Status500InternalServerError = 500;
    public const int Status501NotImplemented = 501;
    public const int Status502BadGateway = 502;
    public const int Status503ServiceUnavailable = 503;
    public const int Status504GatewayTimeout = 504;
}
