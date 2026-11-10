# Building Sailwind Chartroom

## Requirements

- Windows with PowerShell 7 and the .NET 10 SDK.
- Node.js 22 or later.
- Microsoft Edge, for the browser tests.

## Layout

- `index.html`, `styles.css` and `src/` are the chart page. `src/app.mjs` is its entry point and `src/model.mjs` holds the chart data rules.
- `desktop/` is the Windows host. It embeds the page in the exe, serves it to WebView2 and owns the saved workspace file.
- `src/island-catalog.generated.mjs` holds the island outlines. See Island catalog below.

The project version is `<Version>` in `desktop/SailwindChartroom.csproj`. The app reads it from there at run time.

## Build

From the repository folder:

```powershell
npm ci
dotnet build desktop -c Release
```

## Test

```powershell
npm test
dotnet test tests/desktop
```

`npm test` runs the chart model tests and the browser tests, which drive the page in Edge against a stand-in for the desktop host. `dotnet test` covers the host's workspace file handling and message parsing. Any failure makes the command fail.

## Package

```powershell
pwsh -File ./scripts/package.ps1
```

This runs the tests, publishes a self-contained single-file `win-x64` build and writes `artifacts/SailwindChartroom-<version>.zip` with `Sailwind Chartroom.exe`, `README.md`, `LICENSE` and `THIRD-PARTY-NOTICES.md`. Every ZIP entry is checked against its source file.

## Releases and updates

The app updates itself from this repository's GitHub releases. A release is offered when its tag is a version newer than the running app (for example `v0.5.2`), it is not a draft or prerelease, and it has exactly one asset named `SailwindChartroom-<version>.zip` from `scripts/package.ps1`. The app checks the asset's size and the SHA-256 digest GitHub publishes for it, and that the exe inside reports the release version, before swapping it in. The release body is shown as the release notes.

## Chart files

Exports are JSON objects of the form `{ "format": "sailwind-chartroom", "version": 1, "exportedAt": "...", "charts": [...] }`. Increase `SCHEMA_VERSION` in `src/model.mjs` when the saved shape of a chart changes in a way older versions can't read, upgrade older files in `importChartData`, and add a fixture to `tests/fixtures/` written by the previous version. Files from before the format label, and Sailwind Interactive Map exports, still import.

## Sailwind theme images

`assets/sailwind` is committed. To remake it, download the original CC0 images listed in `THIRD-PARTY-NOTICES.md` into a folder and run:

```powershell
pwsh -File ./scripts/prepare-sailwind-art.ps1 -Source <download folder> -Out assets/sailwind
```

## Island catalog

`src/island-catalog.generated.mjs` is committed. It was generated from `sailwind_empty_sea_map.html`, an unofficial "empty sea" version of the Sailwind Web Map whose `const CAT=[...]` line embeds the island polygons. To regenerate it from that page:

```powershell
node scripts/generate-island-catalog.mjs sailwind_empty_sea_map.html src/island-catalog.generated.mjs
```

Record the Sailwind Map commit the polygons come from in `THIRD-PARTY-NOTICES.md`.
