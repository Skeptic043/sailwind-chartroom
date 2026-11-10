# Tests, publishes and packages Sailwind Chartroom as artifacts/SailwindChartroom-<version>.zip.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # Always install exactly what package-lock.json names, so the tests run against the locked dependencies.
    npm ci
    if ($LASTEXITCODE) { throw 'npm ci failed.' }
    npm test
    if ($LASTEXITCODE) { throw 'Chart page tests failed.' }
    dotnet test tests/desktop
    if ($LASTEXITCODE) { throw 'Desktop host tests failed.' }

    $version = ([xml](Get-Content -LiteralPath 'desktop/SailwindChartroom.csproj' -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid project version: $version" }

    # Publish into a fresh folder of our own so nothing stale can reach the package.
    $staging = Join-Path ([IO.Path]::GetTempPath()) "chartroom-publish-$([Guid]::NewGuid().ToString('N'))"
    try {
        dotnet publish desktop -c Release -o $staging
        if ($LASTEXITCODE) { throw 'dotnet publish failed.' }

        # Explicit list, so build leftovers and local files can never be redistributed.
        $releaseFiles = [ordered]@{
            'Sailwind Chartroom.exe' = Join-Path $staging 'Sailwind Chartroom.exe'
            'README.md'              = Join-Path $root 'README.md'
            'LICENSE'                = Join-Path $root 'LICENSE'
            'THIRD-PARTY-NOTICES.md' = Join-Path $root 'THIRD-PARTY-NOTICES.md'
        }
        $unexpected = Get-ChildItem -LiteralPath $staging -File | Where-Object Name -ne 'Sailwind Chartroom.exe'
        if ($unexpected) { throw "Publish produced files the package would leave out: $($unexpected.Name -join ', ')" }

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $outputDir = Join-Path $root 'artifacts'
        New-Item -ItemType Directory -Force $outputDir | Out-Null
        $destination = Join-Path $outputDir "SailwindChartroom-$version.zip"
        $temporary = "$destination.$([Guid]::NewGuid().ToString('N')).tmp"
        try {
            $archive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
            try {
                foreach ($entry in $releaseFiles.GetEnumerator()) {
                    $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.Value, $entry.Key, [IO.Compression.CompressionLevel]::Optimal)
                }
            } finally { $archive.Dispose() }
            $archive = [IO.Compression.ZipFile]::OpenRead($temporary)
            try {
                if ($archive.Entries.Count -ne $releaseFiles.Count) { throw 'ZIP entry count differs.' }
                foreach ($entry in $releaseFiles.GetEnumerator()) {
                    $packed = $archive.GetEntry($entry.Key)
                    if ($null -eq $packed) { throw "Missing ZIP entry: $($entry.Key)" }
                    $stream = $packed.Open()
                    $sha = [Security.Cryptography.SHA256]::Create()
                    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
                    finally { $stream.Dispose(); $sha.Dispose() }
                    if ($hash -ne (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash) { throw "ZIP hash mismatch: $($entry.Key)" }
                }
            } finally { $archive.Dispose() }
            Move-Item -LiteralPath $temporary -Destination $destination -Force
            Write-Host "Verified $($releaseFiles.Count) files: $destination"
        } finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        }
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
} finally {
    Pop-Location
}
