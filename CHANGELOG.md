# Changelog

## 0.9.18

### Added
- 42 island outlines from Fluffy's [Terra Incognita](https://github.com/FluffyJesus/Terra_Incognita) mod join the mod islands pool for use with locations. Thank you to FluffyJesus for providing the island icons, and M.I.D.N for the suggestion

## 0.9.17

### Fixed
- `Game clock %` distances now match the game's with the TimeScale mod

## 0.9.14

### Added
- `Game clock %` in `Chart details`, the route panel and the dead reckoning panel (for users of the [TimeScale](https://github.com/NANDbrew/TimeScale/releases/latest) mod)

### Changed
- The save status at the top right is just a colored dot, with its status in the tooltip, so the buttons beside it no longer shift while saving
- Naming a location after a search area or rough area removes that area
- Placing a location selects it's name to allow typing a name without clicking the text box first

## 0.9.12

### Fixed
- On Mac, Escape closes menus, notes and the publish or save route panel after clicking something in them

## 0.9.11

### Added
- `View` > `Recorded track` can hide the lines connecting recorded positions
- `View` > `Recorded track` can hide Voyage Recorder locations recorded automatically or manually, including their wind and everything else recorded with them

### Changed
- Recorded track, route file and Chartroom Voyages commands moved from `File` to the new `Voyage` menu
- Renamed `Wind along the track` to `Wind direction`
- Removed `Save chart` (charts autosave)
- Movable panels don't get hidden behind sidebars when they are opened, closed or resized
- Menus and panel buttons now fit in narrow windows

## 0.9.8

### Added
- The `Add note` tool (`N`) places a note on the chart
- Notes written with Voyage Recorder appear on the chart when following or importing a recording
- The `Add encounter` tool (`E`) marks Random Encounters sightings: flotsam, whales, dense fog, fishing bonanza, intense storm, and fog or flotsam with whales
- Locations, encounters and note icons can be tiny, small, normal or large size, with a default icon size in `Settings`
- `Equipment` in the chart tools can limit recorded positions to what your instruments could reveal, with positions being only hidden until the feature is disabled again
- `Hotkeys` beside `Tools` and `Items` on the top of the application shows a small movable panel with Voyage Recorder's keys
- `Route` beside `Tools` and `Items` on the top of the application shows or hides the route panel
- `Key` beside `Tools` and `Items` on the top of the application, or `View` > `Track key`, shows a movable panel explaining each line, dot, arrow and flag on your track
- The `File` menu's `Share and race` section holds everything that works with Chartroom Voyages
- `File` > `Manage charts` shows your charts and folders as a tree, to rename, reorder, delete and move charts between folders
- `Save route to file` saves part of your Voyage Recorder track as a file
- Select the beginning and end of a track together (hold shift to select multiple) to `Connect` them together manually into one track
- Race starts, checkpoints and finishes marked with Voyage Recorder show as colored flags on your track
- `Compare a route` draws other players' routes beside yours with their wind, port visits and notes, `Go to` brings one into view, and `Show location by time elapsed` shows the route at a normal or sped up pace
- `Publish world/route` sends a route to [Chartroom Voyages](https://skeptic043.github.io/sailwind-chartroom-voyages/), publishing its world too if the site doesn't have it yet, and `Enter a race` checks a run against its race before sending it
- `Publish as race` under a planned route, or `Publish route as race` in the `File` menu, turns the route into a race anyone can enter, publishing its world too if the site doesn't have it yet
- `Browse worlds and routes` adds other players' routes as comparisons and can show a world's heatmap on the chart

### Changed
- Search areas now snap to an 8, 16 or 32-point compass instead of 16, 32, or 64
- Text is no longer able to be highlighted
- Very fast sailing, such as with the [propeller mod](https://github.com/DogEggz01/Propeller), no longer breaks your track into pieces
- Wind on your track is drawn in the same way as the wind markers for consistency
- The route panel can now be moved

## 0.8.11

### Changed
- Following or importing a Voyage Recorder recording only adds the latest game in that save slot, leaving out the track, ports and search areas of earlier games (needs Voyage Recorder 0.1.9)

## 0.8.9

### Added
- Follows recordings from Voyage Recorder, a new companion mod. `Follow live (Voyage Recorder)` automatically finds and lists your recordings
- Following a recording picks up where the chart left off and offers to add positions recorded while Chartroom wasn't following
- Separate `View` options to show or hide Coordinate Viewer and Voyage Recorder positions
- Search areas can switch between snapping to a 16, 32 or 64-point compass
- While using Voyage Recorder:
  - With `Port visits` on in Voyage Recorder, ports you stop at become locations in Chartroom
  - Reaching a port clears its search areas and rough areas. Turn this off with `Clear search areas and rough areas for ports you reach` in `Settings`
  - With `Missions` on in Voyage Recorder, `Search area` markers are added automatically as you scroll through the missions in your mission book or on a port's mission board
  - Recorded positions can show the current boat, its course and speed, wind direction and strength, and hull damage, as chosen in Voyage Recorder's config

### Changed
- `Coordinate Viewer` in the `File` and `View` menus is now `Recorded track`, since it covers both Coordinate Viewer and Voyage Recorder
- The last position of a recorded track sits above islands and locations
- Recorded wind is drawn as a larger feathered arrow on recorded tracks

### Fixed
- Bottleneck Isle ends up in the right place when importing a Scrambled Seas save map

## 0.8.0

### Added
- `Dead reckoning` tool (D)
- Select at least two Coordinate Viewer positions to see their distance and average speed. You can also save them as a route
- Use the `Tools` and `Items` buttons in the top bar to show or hide the side panels without opening the `View` menu
- Recorded wind appears along the Coordinate Viewer track and has its own toggle in `View`
- The `View` menu can show or hide DR positions

### Changed
- Coordinate Viewer positions keep their exact game time instead of rounding to the nearest minute
- The track leaves a gap after a jump, such as reloading a save or starting a new game in the same slot, instead of drawing across the chart
- Long Coordinate Viewer tracks draw faster, and undo no longer copies the whole track for every edit
- `Imported track` in the `View` menu is now `Coordinate Viewer track`. The final position is labelled `Last position`
- Wind indicators are centered on the point you place them instead of rotating around the placed location
- The route bar no longer shows the bearing of the first leg
- Paired fields stack in narrow side panels instead of squeezing together

### Fixed
- Corrected Coordinate Viewer wind directions. Coordinate Viewer records wind as an angle from east, but Chartroom treated it as a compass bearing. Charts from earlier versions are corrected when loaded
- A track crossing the chart’s east and west edges no longer draws a line across the whole chart

## 0.7.1

### Added
- `Circumnavigation` toggle in the route panel: routes take the short way around the world, wrapping across the chart's east and west edges
- Lock button for placed chart items
- `Lock selected` and `Unlock selected` in the `Edit` menu
- Several boats can be marked at one location

### Changed
- Zoom in much further

Thanks to cap'n beaver and herpderp for suggesting deeper zoom, cap'n beaver for several boats per island, and daniel prates for locking locations

## 0.6.13

### Added
- `Follow live` under `Coordinate Viewer` in the `File` menu adds your position to the chart each time Coordinate Viewer records it
- `Copy for SailMaster` in the route panel copies a route to paste into SailMaster's route box
- Coordinate Viewer positions can be selected, edited and deleted
- Islands on an imported Scrambled Seas map can be selected to add notes or remove them
- `Imported map` toggle in the `View` menu for charts imported from Scrambled Seas

### Changed
- Coordinate Viewer options have their own section in the `File` menu
- `Vanilla map` always shows the game's own map, separately from an imported one

### Fixed
- Coordinate Viewer positions show above route lines instead of behind them

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
