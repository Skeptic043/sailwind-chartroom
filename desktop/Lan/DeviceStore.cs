using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SailwindChartroom.Lan;

/// <summary>A phone or tablet paired with this Chartroom. Only a hash of its token is kept.</summary>
internal sealed record Device(string Id, string Name, string TokenHash, DateTime PairedAt, DateTime LastSeen);

/// <summary>
/// Owns devices.json beside the workspace: whether devices on the player's network may connect, the paired
/// devices, and the one pairing code the player is showing, if any. Thread-safe, since connections arrive on
/// worker threads.
/// </summary>
internal sealed class DeviceStore(string folder)
{
    public const int CodeAttempts = 5;
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(5);
    private const int MaxNameLength = 40;

    private readonly object gate = new();
    private readonly string path = Path.Combine(folder, "devices.json");
    private List<Device> devices = [];
    private bool enabled;
    private (string Code, DateTime Expires, int Attempts)? pairing;

    public bool Enabled { get { lock (gate) return enabled; } }

    public IReadOnlyList<Device> Devices { get { lock (gate) return [.. devices]; } }

    /// <summary>Whether a pairing code is still waiting to be used.</summary>
    public bool Pairing { get { lock (gate) return pairing is not null; } }

    /// <summary>Reads devices.json. A missing or unreadable file means nothing is paired and the service is off.</summary>
    public void Load()
    {
        lock (gate)
        {
            try
            {
                var saved = JsonSerializer.Deserialize<Saved>(File.ReadAllText(path));
                enabled = saved?.Enabled == true;
                devices = [.. (saved?.Devices ?? []).Where(device => device.Id is { Length: > 0 } && device.TokenHash is { Length: 64 })];
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
            {
                enabled = false;
                devices = [];
            }
        }
    }

    public void SetEnabled(bool value)
    {
        lock (gate)
        {
            enabled = value;
            if (!value) pairing = null;
            Save();
        }
    }

    /// <summary>A new six-digit code, replacing any earlier one.</summary>
    public string StartPairing(DateTime now)
    {
        lock (gate)
        {
            string code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            pairing = (code, now + CodeLifetime, 0);
            return code;
        }
    }

    public void StopPairing()
    {
        lock (gate) pairing = null;
    }

    /// <summary>
    /// Pairs a new device when the code matches the one showing. The code works once, for its lifetime, and
    /// stops working after <see cref="CodeAttempts"/> wrong tries. A device pairing again names its old token,
    /// whose entry it replaces. Returns the device and its token, or null.
    /// </summary>
    public (Device Device, string Token)? TryPair(string code, string name, DateTime now, string? previousToken = null)
    {
        lock (gate)
        {
            if (pairing is not { } current || !enabled) return null;
            if (now > current.Expires)
            {
                pairing = null;
                return null;
            }
            if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(current.Code), Encoding.ASCII.GetBytes(code ?? "")))
            {
                pairing = current.Attempts + 1 >= CodeAttempts ? null : current with { Attempts = current.Attempts + 1 };
                return null;
            }
            pairing = null;
            if (!string.IsNullOrEmpty(previousToken)) devices.RemoveAll(device => device.TokenHash == Hash(previousToken));
            string token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var device = new Device($"device-{Guid.NewGuid():N}", CleanName(name), Hash(token), now, now);
            devices.Add(device);
            Save();
            return (device, token);
        }
    }

    /// <summary>The paired device holding this token, or null.</summary>
    public Device? Authenticate(string token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        string hash = Hash(token);
        lock (gate)
        {
            if (!enabled) return null;
            return devices.FirstOrDefault(device => CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(device.TokenHash), Encoding.ASCII.GetBytes(hash)));
        }
    }

    public void Rename(string id, string name) => Update(id, device => device with { Name = CleanName(name) });

    public void Touch(string id, DateTime now) => Update(id, device => device with { LastSeen = now });

    public bool Remove(string id)
    {
        lock (gate)
        {
            if (devices.RemoveAll(device => device.Id == id) == 0) return false;
            Save();
            return true;
        }
    }

    private void Update(string id, Func<Device, Device> change)
    {
        lock (gate)
        {
            int index = devices.FindIndex(device => device.Id == id);
            if (index < 0) return;
            devices[index] = change(devices[index]);
            Save();
        }
    }

    // Called under the lock. Written through a temporary file, like the workspace.
    private void Save()
    {
        Directory.CreateDirectory(folder);
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(new Saved(enabled, devices)));
        File.Move(temporary, path, overwrite: true);
    }

    private static string CleanName(string? name)
    {
        string clean = new string((name ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        return clean.Length == 0 ? "Device" : clean.Length > MaxNameLength ? clean[..MaxNameLength] : clean;
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private sealed record Saved(bool Enabled, List<Device>? Devices);
}
