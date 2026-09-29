using System.Text.Json;
using FieldSync.Api.Data;
using FieldSync.Api.Dtos;
using FieldSync.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FieldSync.Api.Services;

public class SyncService(AppDbContext db, QualityChecker quality)
{
    public const int PullPageSize = 500;

    // One push at a time on this server, so version numbers are committed in order
    // and a device pulling "since X" can never skip a record. (Single-instance demo.)
    private static readonly SemaphoreSlim PushGate = new(1, 1);

    public async Task<PushResponse> PushAsync(PushRequest req, string userName)
    {
        await PushGate.WaitAsync();
        try
        {
            var response = new PushResponse();
            var expeditionIds = await db.Expeditions.Select(e => e.Id).ToListAsync();
            var log = new SyncLog { DeviceId = req.DeviceId, UserName = userName, ReceivedAt = DateTimeOffset.UtcNow, Received = req.Findings.Count };

            foreach (var dto in req.Findings)
            {
                var errors = Validate(dto, expeditionIds);
                if (errors.Count > 0)
                {
                    response.Results.Add(new PushResult { Id = dto.Id, Status = "rejected", Errors = errors });
                    log.Rejected++;
                    continue;
                }

                var existing = await db.Findings.FindAsync(dto.Id);

                if (existing is null)
                {
                    // 1) Brand-new record
                    var f = new Finding { Id = dto.Id };
                    Apply(dto, f, req.DeviceId, userName);
                    db.Findings.Add(f);
                    await StampAsync(f);
                    response.Results.Add(Accepted(f));
                    log.Accepted++;
                }
                else if (existing.DeviceId == req.DeviceId && existing.ClientUpdatedAt == dto.ClientUpdatedAt)
                {
                    // 2) Same edit sent again (connection dropped before the device got our reply). Idempotent: no change.
                    response.Results.Add(new PushResult { Id = dto.Id, Status = "duplicate", ServerVersion = existing.ServerVersion, QualityFlags = Flags(existing) });
                    log.Duplicates++;
                }
                else if (dto.BaseServerVersion == existing.ServerVersion)
                {
                    // 3) Edit based on the latest server version: safe to apply
                    Apply(dto, existing, req.DeviceId, userName);
                    await StampAsync(existing);
                    response.Results.Add(Accepted(existing));
                    log.Accepted++;
                }
                else
                {
                    // 4) Someone else changed it first. Keep the server copy, store this edit for human review.
                    db.SyncConflicts.Add(new SyncConflict
                    {
                        FindingId = dto.Id, DeviceId = req.DeviceId, SubmittedBy = userName,
                        ClientPayloadJson = JsonSerializer.Serialize(dto), DetectedAt = DateTimeOffset.UtcNow,
                    });
                    existing.HasConflict = true;
                    response.Results.Add(new PushResult { Id = dto.Id, Status = "conflict", ServerVersion = existing.ServerVersion });
                    log.Conflicts++;
                }
            }

            db.SyncLogs.Add(log);
            await db.SaveChangesAsync();
            return response;
        }
        finally
        {
            PushGate.Release();
        }
    }

    public async Task<PullResponse> PullAsync(long since)
    {
        var page = await db.Findings
            .Where(f => f.ServerVersion > since)
            .OrderBy(f => f.ServerVersion)
            .Take(PullPageSize + 1)
            .ToListAsync();

        var hasMore = page.Count > PullPageSize;
        if (hasMore) page.RemoveAt(page.Count - 1);

        return new PullResponse
        {
            Findings = page.Select(FindingDto.From).ToList(),
            MaxVersion = page.Count > 0 ? page[^1].ServerVersion : since,
            HasMore = hasMore,
        };
    }

    /// <summary>Reviewer decision: keep the server copy, or apply the device's edit.</summary>
    public async Task<bool> ResolveConflictAsync(int conflictId, bool keepClient, string reviewer)
    {
        var c = await db.SyncConflicts.FindAsync(conflictId);
        if (c is null || c.Resolved) return false;
        var f = await db.Findings.FindAsync(c.FindingId);
        if (f is null) return false;

        await PushGate.WaitAsync();
        try
        {
            if (keepClient)
            {
                var dto = JsonSerializer.Deserialize<FindingDto>(c.ClientPayloadJson)!;
                Apply(dto, f, c.DeviceId, c.SubmittedBy);
            }
            c.Resolved = true;
            c.ResolvedBy = reviewer;
            c.Resolution = keepClient ? "client" : "server";
            f.HasConflict = await db.SyncConflicts.AnyAsync(x => x.FindingId == f.Id && !x.Resolved && x.Id != c.Id);
            await StampAsync(f);   // new version, so every device pulls the final answer
            await db.SaveChangesAsync();
            return true;
        }
        finally
        {
            PushGate.Release();
        }
    }

    public static List<string> Validate(FindingDto d, ICollection<int> expeditionIds)
    {
        var e = new List<string>();
        if (d.Id == Guid.Empty) e.Add("Id is required");
        if (!expeditionIds.Contains(d.ExpeditionId)) e.Add("Unknown expedition");
        if (d.Latitude is < -90 or > 90) e.Add("Latitude must be between -90 and 90");
        if (d.Longitude is < -180 or > 180) e.Add("Longitude must be between -180 and 180");
        if (d.DepthM is < 0 or > 10_000) e.Add("Depth must be between 0 and 10,000 m");
        if (d.GpsAccuracyM is < 0) e.Add("GPS accuracy cannot be negative");
        if (!MaterialTypes.All.Contains(d.MaterialType)) e.Add("Unknown material type");
        if (!Enum.IsDefined(d.HydrocarbonIndicator)) e.Add("Unknown hydrocarbon indicator");
        if ((d.Notes?.Length ?? 0) > 2000) e.Add("Notes are limited to 2,000 characters");
        if (d.CapturedAt > DateTimeOffset.UtcNow.AddDays(1)) e.Add("Capture time is in the future (check the device clock)");
        return e;
    }

    private static void Apply(FindingDto d, Finding f, string deviceId, string userName)
    {
        f.ExpeditionId = d.ExpeditionId;
        f.Latitude = d.Latitude;
        f.Longitude = d.Longitude;
        f.GpsAccuracyM = d.GpsAccuracyM;
        f.MaterialType = d.MaterialType;
        f.HydrocarbonIndicator = d.HydrocarbonIndicator;
        f.DepthM = d.DepthM;
        f.Notes = d.Notes?.Trim() ?? "";
        if (f.EngineerName == "") f.EngineerName = userName;   // capturer, from the token; later edits (e.g. by an analyst) keep it
        f.DeviceId = deviceId;
        f.CapturedAt = d.CapturedAt;
        f.ClientUpdatedAt = d.ClientUpdatedAt;
        f.IsDeleted = d.IsDeleted;
    }

    private async Task StampAsync(Finding f)
    {
        f.ServerVersion = VersionClock.Next();
        f.ServerUpdatedAt = DateTimeOffset.UtcNow;
        f.QualityFlags = string.Join(';', await quality.CheckAsync(f));
    }

    private static PushResult Accepted(Finding f) =>
        new() { Id = f.Id, Status = "accepted", ServerVersion = f.ServerVersion, QualityFlags = Flags(f) };

    private static string[] Flags(Finding f) => f.QualityFlags.Split(';', StringSplitOptions.RemoveEmptyEntries);
}
