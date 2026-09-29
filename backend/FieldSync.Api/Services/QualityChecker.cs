using FieldSync.Api.Data;
using FieldSync.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FieldSync.Api.Services;

/// <summary>
/// Rule-based data-quality checks run on every accepted finding. They warn but never block:
/// the engineer in the field knows best, and a reviewer at head office sees the flags.
/// </summary>
public class QualityChecker(AppDbContext db)
{
    public const double DuplicateRadiusM = 5;
    public const double PoorGpsAccuracyM = 50;

    public async Task<List<string>> CheckAsync(Finding f)
    {
        var flags = new List<string>();

        var exp = await db.Expeditions.FindAsync(f.ExpeditionId);
        if (exp is not null &&
            (f.Latitude < exp.MinLat || f.Latitude > exp.MaxLat || f.Longitude < exp.MinLon || f.Longitude > exp.MaxLon))
            flags.Add("Location is outside the expedition's survey block");

        if (f.GpsAccuracyM is > PoorGpsAccuracyM)
            flags.Add($"Weak GPS fix (±{f.GpsAccuracyM:0} m)");

        if (f.HydrocarbonIndicator != HydrocarbonIndicator.None && f.MaterialType is "Basalt" or "Salt")
            flags.Add($"Hydrocarbon show in {f.MaterialType} is unusual, please verify");

        // Possible duplicate: another finding in the same expedition within 5 m
        const double deg = 0.0001; // ~11 m pre-filter so the database does the heavy lifting
        var nearby = await db.Findings
            .Where(x => x.ExpeditionId == f.ExpeditionId && x.Id != f.Id && !x.IsDeleted &&
                        x.Latitude > f.Latitude - deg && x.Latitude < f.Latitude + deg &&
                        x.Longitude > f.Longitude - deg && x.Longitude < f.Longitude + deg)
            .Select(x => new { x.Latitude, x.Longitude })
            .ToListAsync();
        if (nearby.Any(n => HaversineM(f.Latitude, f.Longitude, n.Latitude, n.Longitude) <= DuplicateRadiusM))
            flags.Add("Another finding exists within 5 m (possible duplicate)");

        return flags;
    }

    public static double HaversineM(double lat1, double lon1, double lat2, double lon2)
    {
        const double r = 6_371_000;
        double ToRad(double d) => d * Math.PI / 180;
        var dLat = ToRad(lat2 - lat1);
        var dLon = ToRad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * r * Math.Asin(Math.Sqrt(a));
    }
}
