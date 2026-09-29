using System.ComponentModel.DataAnnotations;

namespace FieldSync.Api.Models;

public enum HydrocarbonIndicator { None, OilShow, GasShow }

/// <summary>A survey trip into one exploration block. The bounding box is used for data-quality checks.</summary>
public class Expedition
{
    public int Id { get; set; }
    [MaxLength(120)] public string Name { get; set; } = "";
    [MaxLength(120)] public string Region { get; set; } = "";
    public double MinLat { get; set; }
    public double MaxLat { get; set; }
    public double MinLon { get; set; }
    public double MaxLon { get; set; }
}

/// <summary>One field observation: where it was taken and what material was found there.</summary>
public class Finding
{
    public Guid Id { get; set; }                       // generated on the device, so records can be created offline
    public int ExpeditionId { get; set; }
    public Expedition? Expedition { get; set; }

    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public double? GpsAccuracyM { get; set; }

    [MaxLength(40)] public string MaterialType { get; set; } = "";
    public HydrocarbonIndicator HydrocarbonIndicator { get; set; }
    public double DepthM { get; set; }
    [MaxLength(2000)] public string Notes { get; set; } = "";

    [MaxLength(100)] public string EngineerName { get; set; } = "";
    [MaxLength(64)] public string DeviceId { get; set; } = "";
    public DateTimeOffset CapturedAt { get; set; }
    public DateTimeOffset ClientUpdatedAt { get; set; }

    // ---- sync bookkeeping (server-owned) ----
    public long ServerVersion { get; set; }             // increases on every accepted change; devices pull "since" this
    public DateTimeOffset ServerUpdatedAt { get; set; }
    public bool IsDeleted { get; set; }                 // soft delete, so deletions also sync
    public bool HasConflict { get; set; }
    [MaxLength(500)] public string QualityFlags { get; set; } = "";   // ";"-separated warnings
}

/// <summary>An edit that arrived based on an out-of-date version. Kept for a human to review; never silently dropped.</summary>
public class SyncConflict
{
    public int Id { get; set; }
    public Guid FindingId { get; set; }
    [MaxLength(64)] public string DeviceId { get; set; } = "";
    [MaxLength(100)] public string SubmittedBy { get; set; } = "";
    public string ClientPayloadJson { get; set; } = "";
    public DateTimeOffset DetectedAt { get; set; }
    public bool Resolved { get; set; }
    [MaxLength(100)] public string? ResolvedBy { get; set; }
    [MaxLength(10)] public string? Resolution { get; set; }   // "server" or "client"
}

/// <summary>Audit trail: one row per sync batch received.</summary>
public class SyncLog
{
    public int Id { get; set; }
    [MaxLength(64)] public string DeviceId { get; set; } = "";
    [MaxLength(100)] public string UserName { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
    public int Received { get; set; }
    public int Accepted { get; set; }
    public int Duplicates { get; set; }
    public int Conflicts { get; set; }
    public int Rejected { get; set; }
}

public static class MaterialTypes
{
    public static readonly string[] All =
    {
        "Sandstone", "Shale", "Limestone", "Dolomite", "Siltstone",
        "Claystone", "Conglomerate", "Salt", "Coal", "Basalt",
    };
}
