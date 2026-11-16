using System.Text.Json;
using RonSijm.Slopsidian.Services;
using Xunit;

namespace RonSijm.Slopsidian.Linux.Tests;

public sealed class VaultJsonTests
{
    [Theory]
    [InlineData("9007199254740992")]
    [InlineData("1e999")]
    [InlineData("1e-9999")]
    [InlineData("0.10000000000000000000001")]
    public void UnsafeNumericValuesAreRefusedWithoutChangingTheOriginalJson(string number)
    {
        var source = "{\"unknown\":" + number + "}";
        using var document = JsonDocument.Parse(source);
        var error = Assert.Throws<VaultException>(() => VaultJson.ValidateRoundTrip(document.RootElement));
        Assert.Equal(422, error.StatusCode);
        Assert.Equal(source, document.RootElement.GetRawText());
    }

    [Theory]
    [InlineData("-0")]
    [InlineData("0e999999999999999999999")]
    [InlineData("1.25e2")]
    [InlineData("9007199254740991")]
    public void ExactlyRoundTrippableNumbersRemainAccepted(string number)
    {
        using var document = JsonDocument.Parse("{\"unknown\":" + number + "}");
        VaultJson.ValidateRoundTrip(document.RootElement);
    }

    [Fact]
    public void CanvasCanRejectDuplicateFieldsWithoutChangingLegacyConfigurationBehavior()
    {
        using var document = JsonDocument.Parse("{\"unknown\":1,\"unknown\":2}");
        VaultJson.ValidateRoundTrip(document.RootElement);
        var error = Assert.Throws<VaultException>(() => VaultJson.ValidateRoundTrip(document.RootElement, "Canvas", rejectDuplicateKeys: true));
        Assert.Contains("duplicate JSON fields", error.Message);
    }
}
