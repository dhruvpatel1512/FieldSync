using System.Net.Http.Headers;
using FieldSync.Api.Data;
using FieldSync.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FieldSync.Tests;

/// <summary>Runs the real API in memory, swapping SQL Server for an in-memory SQLite database.</summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureServices(services =>
        {
            var existing = services.Single(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>));
            services.Remove(existing);
            _connection.Open();
            services.AddDbContext<AppDbContext>(o => o.UseSqlite(_connection));
        });
    }

    public HttpClient ClientAs(string role, string name = "Test User")
    {
        var client = CreateClient();
        var (token, _) = Services.GetRequiredService<TokenService>().Create(name.Replace(" ", "").ToLower(), name, role);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _connection.Dispose();
    }
}
