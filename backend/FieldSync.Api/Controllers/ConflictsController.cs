using System.Security.Claims;
using FieldSync.Api.Data;
using FieldSync.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FieldSync.Api.Controllers;

[ApiController]
[Route("api/conflicts")]
[Authorize(Roles = "Analyst")]
public class ConflictsController(AppDbContext db, SyncService sync) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Open() =>
        Ok(await db.SyncConflicts.AsNoTracking().Where(c => !c.Resolved).OrderBy(c => c.Id).ToListAsync());

    /// <summary>keep = "server" (discard the device edit) or "client" (apply the device edit).</summary>
    [HttpPost("{id:int}/resolve")]
    public async Task<IActionResult> Resolve(int id, [FromQuery] string keep)
    {
        if (keep is not ("server" or "client")) return BadRequest("keep must be 'server' or 'client'");
        var reviewer = User.FindFirstValue(ClaimTypes.Name) ?? "unknown";
        return await sync.ResolveConflictAsync(id, keep == "client", reviewer) ? NoContent() : NotFound();
    }
}
