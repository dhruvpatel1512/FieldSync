using System.Security.Claims;
using FieldSync.Api.Dtos;
using FieldSync.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FieldSync.Api.Controllers;

[ApiController]
[Route("api/sync")]
[Authorize]
public class SyncController(SyncService sync) : ControllerBase
{
    public const int MaxBatch = 200;

    /// <summary>Device sends its pending records. Safe to call repeatedly with the same data.
    /// Analysts push too: that's how dashboard edits and deletions reach every device.</summary>
    [HttpPost("push")]
    [Authorize(Roles = "Engineer,Analyst")]
    public async Task<ActionResult<PushResponse>> Push(PushRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId) || req.DeviceId.Length > 64)
            return BadRequest("DeviceId is required (max 64 characters)");
        if (req.Findings.Count > MaxBatch)
            return BadRequest($"Send at most {MaxBatch} findings per batch");
        if (req.Findings.Contains(null!))
            return BadRequest("Findings must not contain null entries");

        var user = User.FindFirstValue(ClaimTypes.Name) ?? "unknown";
        return await sync.PushAsync(req, user);
    }

    /// <summary>Device asks for everything changed since the last version it has seen.</summary>
    [HttpGet("pull")]
    public async Task<ActionResult<PullResponse>> Pull([FromQuery] long since = 0) =>
        await sync.PullAsync(Math.Max(0, since));
}
