using FieldSync.Api.Data;
using FieldSync.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FieldSync.Api.Controllers;

[ApiController]
[Route("api/expeditions")]
[Authorize]
public class ExpeditionsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<List<Expedition>> Get() => await db.Expeditions.AsNoTracking().OrderBy(e => e.Id).ToListAsync();
}
