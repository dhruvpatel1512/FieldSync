using FieldSync.Api.Dtos;
using FieldSync.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FieldSync.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IConfiguration config, TokenService tokens) : ControllerBase
{
    private record DemoUser(string Username, string Password, string DisplayName, string Role);

    /// <summary>Demo login against the users in appsettings.json.</summary>
    // ponytail: plain-text demo passwords in config; switch to ASP.NET Identity (hashed) or Microsoft Entra ID before real users.
    [HttpPost("login")]
    [EnableRateLimiting("login")]   // slows down password guessing
    public ActionResult<LoginResponse> Login(LoginRequest req)
    {
        var users = config.GetSection("DemoUsers").Get<List<DemoUser>>() ?? [];
        var user = users.FirstOrDefault(u =>
            string.Equals(u.Username, req.Username, StringComparison.OrdinalIgnoreCase) && u.Password == req.Password);
        if (user is null) return Unauthorized();

        var (token, expiresAt) = tokens.Create(user.Username, user.DisplayName, user.Role);
        return new LoginResponse { Token = token, DisplayName = user.DisplayName, Role = user.Role, ExpiresAt = expiresAt };
    }
}
