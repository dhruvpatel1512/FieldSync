using FieldSync.Api.Models;

namespace FieldSync.Api.Dtos;

/// <summary>What the device sends and receives. Deliberately separate from the EF entity.</summary>
public class FindingDto
{
    public Guid Id { get; set; }
    public int ExpeditionId { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public double? GpsAccuracyM { get; set; }
    public string MaterialType { get; set; } = "";
    public HydrocarbonIndicator HydrocarbonIndicator { get; set; }
    public double DepthM { get; set; }
    public string Notes { get; set; } = "";
    public string EngineerName { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public DateTimeOffset CapturedAt { get; set; }
    public DateTimeOffset ClientUpdatedAt { get; set; }
    public long? BaseServerVersion { get; set; }   // null = brand-new record
    public long? ServerVersion { get; set; }
    public bool IsDeleted { get; set; }
    public string[] QualityFlags { get; set; } = [];

    public static FindingDto From(Finding f) => new()
    {
        Id = f.Id, ExpeditionId = f.ExpeditionId, Latitude = f.Latitude, Longitude = f.Longitude,
        GpsAccuracyM = f.GpsAccuracyM, MaterialType = f.MaterialType, HydrocarbonIndicator = f.HydrocarbonIndicator,
        DepthM = f.DepthM, Notes = f.Notes, EngineerName = f.EngineerName, DeviceId = f.DeviceId,
        CapturedAt = f.CapturedAt, ClientUpdatedAt = f.ClientUpdatedAt,
        BaseServerVersion = f.ServerVersion, ServerVersion = f.ServerVersion, IsDeleted = f.IsDeleted,
        QualityFlags = f.QualityFlags.Split(';', StringSplitOptions.RemoveEmptyEntries),
    };
}

public class PushRequest
{
    public string DeviceId { get; set; } = "";
    public List<FindingDto> Findings { get; set; } = [];
}

public class PushResult
{
    public Guid Id { get; set; }
    public string Status { get; set; } = "";        // accepted | duplicate | conflict | rejected
    public long? ServerVersion { get; set; }
    public List<string> Errors { get; set; } = [];
    public string[] QualityFlags { get; set; } = [];
}

public class PushResponse { public List<PushResult> Results { get; set; } = []; }

public class PullResponse
{
    public List<FindingDto> Findings { get; set; } = [];
    public long MaxVersion { get; set; }
    public bool HasMore { get; set; }
}

public class LoginRequest { public string Username { get; set; } = ""; public string Password { get; set; } = ""; }
public class LoginResponse
{
    public string Token { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}
