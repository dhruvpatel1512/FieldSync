using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using FieldSync.Api.Dtos;
using FieldSync.Api.Models;

namespace FieldSync.Tests;

public class SyncTests : IClassFixture<ApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly ApiFactory _factory;
    private readonly HttpClient _engineer;

    public SyncTests(ApiFactory factory)
    {
        _factory = factory;
        _engineer = factory.ClientAs("Engineer", "Field Engineer 1");
    }

    // A valid finding inside Block A (Cambay Basin). Each test uses its own coordinates to avoid duplicate flags.
    private static FindingDto NewFinding(double lat, double lon, string material = "Shale") => new()
    {
        Id = Guid.NewGuid(), ExpeditionId = 1, Latitude = lat, Longitude = lon, GpsAccuracyM = 8,
        MaterialType = material, HydrocarbonIndicator = HydrocarbonIndicator.GasShow, DepthM = 42.5,
        Notes = "Grey shale, faint gas odour", CapturedAt = DateTimeOffset.UtcNow, ClientUpdatedAt = DateTimeOffset.UtcNow,
    };

    private async Task<PushResponse> Push(HttpClient client, string deviceId, params FindingDto[] findings)
    {
        var res = await client.PostAsJsonAsync("/api/sync/push", new PushRequest { DeviceId = deviceId, Findings = findings.ToList() }, Json);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PushResponse>(Json))!;
    }

    private async Task<PullResponse> Pull(long since)
    {
        return (await _engineer.GetFromJsonAsync<PullResponse>($"/api/sync/pull?since={since}", Json))!;
    }

    [Fact]
    public async Task New_finding_is_accepted_and_can_be_pulled()
    {
        var f = NewFinding(22.5001, 72.5001);
        var res = await Push(_engineer, "device-A", f);

        Assert.Equal("accepted", res.Results.Single().Status);
        Assert.NotNull(res.Results.Single().ServerVersion);

        var pulled = await Pull(0);
        var saved = Assert.Single(pulled.Findings, x => x.Id == f.Id);
        Assert.Equal("Field Engineer 1", saved.EngineerName);   // taken from the token, not the device
    }

    [Fact]
    public async Task Sending_the_same_batch_twice_does_not_create_duplicates()
    {
        // Simulates: device pushed, network dropped before the reply arrived, device retries.
        var f = NewFinding(22.5002, 72.5002);
        var first = await Push(_engineer, "device-A", f);
        var second = await Push(_engineer, "device-A", f);

        Assert.Equal("accepted", first.Results.Single().Status);
        Assert.Equal("duplicate", second.Results.Single().Status);
        Assert.Equal(first.Results.Single().ServerVersion, second.Results.Single().ServerVersion);

        var pulled = await Pull(0);
        Assert.Single(pulled.Findings, x => x.Id == f.Id);
    }

    [Fact]
    public async Task Stale_edit_from_another_device_becomes_a_conflict_not_an_overwrite()
    {
        var f = NewFinding(22.5003, 72.5003);
        var v1 = (await Push(_engineer, "device-A", f)).Results.Single().ServerVersion;

        // Device B edits based on v1: accepted
        var editB = Clone(f); editB.DepthM = 50; editB.BaseServerVersion = v1; editB.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(1);
        Assert.Equal("accepted", (await Push(_engineer, "device-B", editB)).Results.Single().Status);

        // Device A (offline all this time) also edits based on v1: conflict
        var editA = Clone(f); editA.DepthM = 60; editA.BaseServerVersion = v1; editA.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(2);
        Assert.Equal("conflict", (await Push(_engineer, "device-A", editA)).Results.Single().Status);

        // Server kept device B's value; device A's edit is waiting for review
        var saved = (await Pull(0)).Findings.Single(x => x.Id == f.Id);
        Assert.Equal(50, saved.DepthM);

        var analyst = _factory.ClientAs("Analyst", "Office Analyst");
        var conflicts = await analyst.GetFromJsonAsync<List<SyncConflict>>("/api/conflicts", Json);
        Assert.Contains(conflicts!, c => c.FindingId == f.Id);
    }

    [Fact]
    public async Task Analyst_can_resolve_a_conflict_by_keeping_the_device_edit()
    {
        var f = NewFinding(22.5004, 72.5004);
        var v1 = (await Push(_engineer, "device-A", f)).Results.Single().ServerVersion;
        var editB = Clone(f); editB.DepthM = 70; editB.BaseServerVersion = v1; editB.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(1);
        await Push(_engineer, "device-B", editB);
        var editA = Clone(f); editA.DepthM = 80; editA.BaseServerVersion = v1; editA.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(2);
        await Push(_engineer, "device-A", editA);

        var analyst = _factory.ClientAs("Analyst", "Office Analyst");
        var conflict = (await analyst.GetFromJsonAsync<List<SyncConflict>>("/api/conflicts", Json))!.Single(c => c.FindingId == f.Id);
        var res = await analyst.PostAsync($"/api/conflicts/{conflict.Id}/resolve?keep=client", null);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        var saved = (await Pull(0)).Findings.Single(x => x.Id == f.Id);
        Assert.Equal(80, saved.DepthM);
    }

    [Fact]
    public async Task Invalid_data_is_rejected_with_reasons()
    {
        var bad = NewFinding(123, 72.5);          // latitude out of range
        bad.MaterialType = "Kryptonite";
        var r = (await Push(_engineer, "device-A", bad)).Results.Single();

        Assert.Equal("rejected", r.Status);
        Assert.Contains(r.Errors, e => e.Contains("Latitude"));
        Assert.Contains(r.Errors, e => e.Contains("material"));
    }

    [Fact]
    public async Task Quality_checks_flag_out_of_area_and_duplicate_locations()
    {
        var outside = NewFinding(25.0, 80.0);     // outside Block A's box
        var r1 = (await Push(_engineer, "device-A", outside)).Results.Single();
        Assert.Contains(r1.QualityFlags, q => q.Contains("outside"));

        var first = NewFinding(22.6000, 72.6000);
        var twoMetresAway = NewFinding(22.60001, 72.60001);
        await Push(_engineer, "device-A", first);
        var r2 = (await Push(_engineer, "device-B", twoMetresAway)).Results.Single();
        Assert.Contains(r2.QualityFlags, q => q.Contains("duplicate"));
    }

    [Fact]
    public async Task Pull_returns_only_changes_after_the_given_version()
    {
        var a = (await Push(_engineer, "device-A", NewFinding(22.7001, 72.7001))).Results.Single().ServerVersion!.Value;
        var b = NewFinding(22.7002, 72.7002);
        await Push(_engineer, "device-A", b);

        var pulled = await Pull(a);
        Assert.Contains(pulled.Findings, x => x.Id == b.Id);
        Assert.All(pulled.Findings, x => Assert.True(x.ServerVersion > a));
    }

    [Fact]
    public async Task Requests_without_a_token_are_refused()
    {
        var anonymous = _factory.CreateClient();
        var res = await anonymous.GetAsync("/api/sync/pull");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Admin_can_edit_and_delete_a_finding_and_the_capturer_is_kept()
    {
        var f = NewFinding(22.8001, 72.8001);
        var v1 = (await Push(_engineer, "device-A", f)).Results.Single().ServerVersion;

        var admin = _factory.ClientAs("Admin", "Office Admin");
        var edit = Clone(f); edit.DepthM = 99; edit.BaseServerVersion = v1; edit.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(1);
        var v2 = (await Push(admin, "office-pc", edit)).Results.Single();
        Assert.Equal("accepted", v2.Status);

        var del = Clone(edit); del.IsDeleted = true; del.BaseServerVersion = v2.ServerVersion; del.ClientUpdatedAt = DateTimeOffset.UtcNow.AddSeconds(2);
        Assert.Equal("accepted", (await Push(admin, "office-pc", del)).Results.Single().Status);

        var saved = (await Pull(0)).Findings.Single(x => x.Id == f.Id);   // deletions sync too, as a tombstone
        Assert.True(saved.IsDeleted);
        Assert.Equal(99, saved.DepthM);
        Assert.Equal("Field Engineer 1", saved.EngineerName);             // not overwritten by the admin
    }

    [Theory]
    [InlineData("""{ "deviceId": "device-A", "findings": [null] }""")]
    [InlineData("""{ "deviceId": "device-A", "findings": null }""")]
    public async Task Malformed_batch_is_a_400_not_a_crash(string body)
    {
        var res = await _engineer.PostAsync("/api/sync/push", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Theory]
    [InlineData("Engineer", "GET", "/api/conflicts", HttpStatusCode.Forbidden)]   // engineers don't review
    [InlineData("Analyst", "POST", "/api/sync/push", HttpStatusCode.Forbidden)]   // analysts review but can't change data
    [InlineData("Admin", "GET", "/api/conflicts", HttpStatusCode.OK)]             // admins can do both
    public async Task Each_role_only_reaches_its_own_endpoints(string role, string method, string url, HttpStatusCode expected)
    {
        var client = _factory.ClientAs(role);
        var res = method == "GET"
            ? await client.GetAsync(url)
            : await client.PostAsJsonAsync(url, new PushRequest { DeviceId = "x", Findings = [NewFinding(22.81, 72.81)] }, Json);
        Assert.Equal(expected, res.StatusCode);
    }

    private static FindingDto Clone(FindingDto f) =>
        JsonSerializer.Deserialize<FindingDto>(JsonSerializer.Serialize(f, Json), Json)!;
}
