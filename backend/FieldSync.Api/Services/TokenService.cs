using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace FieldSync.Api.Services;

public class TokenService(IConfiguration config)
{
    public (string Token, DateTimeOffset ExpiresAt) Create(string username, string displayName, string role)
    {
        var jwt = config.GetSection("Jwt");
        // Long-lived on purpose: engineers may be off-network for days.
        // ponytail: no refresh or revocation, a stolen token works until expiry; add refresh tokens + a revocation list before production.
        var expires = DateTimeOffset.UtcNow.AddDays(jwt.GetValue("DaysValid", 7));
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt["Key"]!));
        var token = new JwtSecurityToken(
            issuer: jwt["Issuer"],
            audience: jwt["Audience"],
            claims:
            [
                new Claim(ClaimTypes.NameIdentifier, username),
                new Claim(ClaimTypes.Name, displayName),
                new Claim(ClaimTypes.Role, role),
            ],
            expires: expires.UtcDateTime,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}
