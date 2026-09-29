namespace FieldSync.Api.Services;

/// <summary>
/// Hands out strictly increasing version numbers (Unix milliseconds x 1000 + counter).
/// Kept below 2^53 so JavaScript clients can hold them as plain numbers without losing precision.
/// Single-server demo. With several API instances you would use a SQL Server SEQUENCE or rowversion instead.
/// </summary>
public static class VersionClock
{
    private static long _last;
    private static readonly object Lock = new();

    public static long Next()
    {
        lock (Lock)
        {
            var candidate = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() * 1000;
            _last = Math.Max(candidate, _last + 1);
            return _last;
        }
    }
}
