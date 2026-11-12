# Changelog

## 0.6.10

### Added
- View toggles for chart tools that didn't have one yet, along with various sub-toggles
- Measure lines can now be saved in 3 colors: red, blue and green
- A new `Add waypoints` button that allows you to add waypoints to the end of a saved route
- Day and time entries for waypoints and wind indicators
- Import Scrambled Seas worlds from the scramble XML file
- `Border Expander winds` toggle under `Trade winds`, for its two southern trade winds

### Changed
- The `View` menu follows the order of the chart tools
- Checkboxes in the `View` menu no longer unnecessarily close the `View` menu (how annoying was that?)
- Charts reach 180° east and west for wider Scrambled Seas worlds
- `Trade winds` have their own toggle in the `View` menu instead of being locked under the `Vanilla map` toggle
- `Bigger text`, `Smaller text` and `Match Windows text size` moved to a `Text` submenu in `Help`

### Fixed
- Long messages, such as import errors, stay on screen long enough to read

Thanks to yogos for suggesting the search area toggles, kept lines, adding to saved routes, day and time for waypoints and winds, and the `Measure line` toggle

## 0.6.5

### Added
- A new `Island outlines` toggle in the View menu
- Small icons on each chart tool

### Changed
- The measure line stays on the chart until you delete it or measure a new one
- Drag either end of a selected measure line to adjust it
- The View menu's `Bearing lines and fixes` toggle is now `Measure line` and applies to measure lines

### Removed
- Clear bearing lines from the File menu

### Fixed
- Route speed arrows step in whole and half knots instead of 3.1, 3.6, 4.1

## 0.6.3

### Added
- Bottleneck Isle from Better Ports in the island library

### Changed
- Reworked region filters for island selection to make more sense
- Boats are sorted by region then size, with mod boats being grouped together

### Fixed
- Rock of Despair is no longer marked as a secret island

## 0.6.1

### Added
- Sailwind Chartroom is now available for macOS users
- Vanilla map toggle in the View menu along with optional secret islands and trade winds toggles
- The unnamed Fire Fish Lagoon islands can be placed one at a time
- 32-point compass for directions and snapping, such as NbE and SWbS
- Search areas can show an island chosen from the island library
- Overlapping search areas for the same place share one island where they meet
- Locations can hide their name on the chart

### Fixed
- Sen’na and Fire Fish Town outlines sit on their location instead of off to one side
- Fire Fish Lagoon rocks and small islands were added to the island selection that were previously missing
- Nearby names (such as On’na and Sen’na) both show unless the text would overlap

## 0.5.5

### Initial Release
- Chart locations, rough areas, search areas, routes, winds, boats and Coordinate Viewer tracks
- Island library with native island outlines
- Saved routes stay on the chart and can be edited
- Resolving a search clears every search with the same name
- Automatic saving with a copy from the previous launch
- Import and export of charts, backups and location lists
- Chartroom and Sailwind paper themes, each in light and dark
- Settings window for tool shortcuts, theme, interface size and update checks
- Update checks and one-click updates
