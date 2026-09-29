using FieldSync.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FieldSync.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Expedition> Expeditions => Set<Expedition>();
    public DbSet<Finding> Findings => Set<Finding>();
    public DbSet<SyncConflict> SyncConflicts => Set<SyncConflict>();
    public DbSet<SyncLog> SyncLogs => Set<SyncLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Finding>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();              // the device owns the id
            e.Property(x => x.HydrocarbonIndicator).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => x.ServerVersion);                          // fast "pull since version"
            e.HasIndex(x => new { x.ExpeditionId, x.Latitude, x.Longitude });
        });
        b.Entity<SyncConflict>().HasIndex(x => new { x.FindingId, x.Resolved });

        // Synthetic demo data: two made-up exploration blocks
        b.Entity<Expedition>().HasData(
            new Expedition { Id = 1, Name = "Block A Onshore Survey", Region = "Cambay Basin, Gujarat", MinLat = 22.0, MaxLat = 23.5, MinLon = 72.0, MaxLon = 73.0 },
            new Expedition { Id = 2, Name = "Block B Shelf Survey", Region = "Upper Assam Shelf", MinLat = 26.5, MaxLat = 27.5, MinLon = 94.0, MaxLon = 95.5 });
    }
}
