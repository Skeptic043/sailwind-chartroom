import XCTest
@testable import ChartroomCore

final class HostMessageTests: XCTestCase {
    func testRecognisesPageRequests() {
        XCTAssertEqual(HostMessage.parse(#"{"type":"ready"}"#), .ready)
        XCTAssertEqual(HostMessage.parse(#"{"type":"pin"}"#), .pin)
        XCTAssertEqual(HostMessage.parse(#"{"type":"open-folder"}"#), .openFolder)
        XCTAssertEqual(HostMessage.parse(#"{"type":"open-releases"}"#), .openReleases)
        XCTAssertEqual(HostMessage.parse(#"{"type":"check-updates","background":true}"#), .checkUpdates(background: true))
        XCTAssertEqual(HostMessage.parse(#"{"type":"check-updates"}"#), .checkUpdates(background: false))
        XCTAssertEqual(HostMessage.parse(#"{"type":"follow-track","chartId":"chart-1"}"#), .followTrack(chartId: "chart-1"))
        XCTAssertNil(HostMessage.parse(#"{"type":"follow-track"}"#))
        XCTAssertEqual(HostMessage.parse(#"{"type":"stop-track"}"#), .stopTrack)
        XCTAssertEqual(HostMessage.parse(#"{"type":"copy-text","text":"route"}"#), .copyText("route"))
    }

    func testSaveCarriesTheWorkspaceTextUnchanged() {
        let workspace = #"{"charts":[{"name":"Kept","lat":12.3,"z":1,"a":2}],"settings":{}}"#
        XCTAssertEqual(HostMessage.parse(#"{"type":"save","workspace":\#(workspace)}"#), .save(workspace: workspace))
    }

    func testExportCarriesTheFileNameAndContents() {
        XCTAssertEqual(HostMessage.parse(#"{"type":"export-file","name":"chart.json","contents":"{}"}"#), .exportFile(name: "chart.json", contents: "{}"))
    }

    func testAppearanceAndZoomAreChecked() {
        XCTAssertEqual(HostMessage.parse(#"{"type":"set-appearance","dark":false,"followsSystem":true}"#), .setAppearance(dark: false, followsSystem: true))
        XCTAssertEqual(HostMessage.parse(#"{"type":"set-appearance","dark":true}"#), .setAppearance(dark: true, followsSystem: false))
        XCTAssertNil(HostMessage.parse(#"{"type":"set-appearance","dark":"yes"}"#))
        XCTAssertNil(HostMessage.parse(#"{"type":"set-appearance","dark":1}"#))
        XCTAssertEqual(HostMessage.parse(#"{"type":"set-zoom","factor":1.25}"#), .setZoom(1.25))
        XCTAssertNil(HostMessage.parse(#"{"type":"set-zoom","factor":9}"#))
        XCTAssertNil(HostMessage.parse(#"{"type":"set-zoom","factor":true}"#))
    }

    func testSettingsMessagesAreChecked() {
        let message = HostMessage.parse(#"{"type":"open-settings","settings":{"tools":[{"mode":"select","label":"Select","key":"v"}]},"defaults":[{"mode":"select","label":"Select","key":"v"}]}"#)
        guard case .openSettings(let settings, let defaults) = message else { return XCTFail("Expected open-settings") }
        XCTAssertEqual(settings.tools.count, 1)
        XCTAssertEqual(defaults, [ToolShortcut(mode: "select", label: "Select", key: "v")])
        XCTAssertNil(HostMessage.parse(#"{"type":"open-settings","settings":{"tools":[]}}"#))
    }

    func testIgnoresAnythingElse() {
        for json in [
            #"{"type":"save"}"#,
            #"{"type":"save","workspace":"text"}"#,
            #"{"type":"save","workspace":{"charts":{}}}"#,
            #"{"workspace":{"charts":[]},"type":"save"}"#,
            #"{"type":"export-file","name":"chart.json"}"#,
            #"{"type":"export-file","name":"","contents":"{}"}"#,
            #"{"type":42}"#,
            #"{"type":"delete-everything"}"#,
            #"["ready"]"#,
            "not json"
        ] {
            XCTAssertNil(HostMessage.parse(json), json)
        }
    }
}

final class AppSettingsTests: XCTestCase {
    private func tools(location: String = "l", route: String = "r") -> [ToolShortcut] {
        [ToolShortcut(mode: "select", label: "Select & pan", key: "v"), ToolShortcut(mode: "location", label: "Add location", key: location), ToolShortcut(mode: "route", label: "Plot route", key: route)]
    }

    private func parse(_ json: String) -> AppSettings? {
        AppSettings.parse(try? JSONSerialization.jsonObject(with: Data(json.utf8)))
    }

    func testAcceptsSingleUniqueKeys() {
        XCTAssertNil(AppSettings.shortcutProblem(tools(location: "K")))
    }

    func testExplainsWhatToFix() {
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "")), "Choose one letter or number for Add location.")
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "lk")), "Choose one letter or number for Add location.")
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "é")), "Choose one letter or number for Add location.")
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "f")), "F is already used to fit the chart.")
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "i")), "I is already used to open the island library.")
        XCTAssertEqual(AppSettings.shortcutProblem(tools(location: "r")), "Add location and Plot route can't share R.")
    }

    func testReadsTheSettingsThePageSends() {
        let settings = parse(#"{"tools":[{"mode":"select","label":"Select","key":"v"}],"checkForUpdates":false,"interfaceSize":150,"theme":"sailwind","appearance":"light","dark":false,"themes":[{"id":"chartroom","label":"Chartroom"},{"id":"sailwind","label":"Sailwind paper"}],"appearances":[{"id":"system","label":"Match macOS"},{"broken":true}]}"#)
        XCTAssertEqual(settings?.tools.first?.key, "v")
        XCTAssertEqual(settings?.checkForUpdates, false)
        XCTAssertEqual(settings?.interfaceSize, 150)
        XCTAssertEqual(settings?.theme, "sailwind")
        XCTAssertEqual(settings?.appearance, "light")
        XCTAssertEqual(settings?.dark, false)
        XCTAssertEqual(settings?.themes.map(\.id), ["chartroom", "sailwind"])
        XCTAssertEqual(settings?.appearances.map(\.label), ["Match macOS"])
    }

    func testUnknownInterfaceSizesUseTheDefault() {
        let settings = parse(#"{"tools":[{"mode":"select","label":"Select","key":"v"}],"interfaceSize":137}"#)
        XCTAssertEqual(settings?.interfaceSize, 0)
        XCTAssertEqual(settings?.checkForUpdates, true)
    }

    func testIncompleteSettingsAreIgnored() {
        XCTAssertNil(parse(#"{"tools":[]}"#))
        XCTAssertNil(parse(#"{"tools":[{"mode":"select"}]}"#))
        XCTAssertNil(parse(#"{"checkForUpdates":true}"#))
    }

    func testReleaseCandidatesFollowTheCandidateChannel() {
        XCTAssertEqual(UpdateChannels.allowed(forVersion: "0.6.0-rc.2"), ["rc"])
        XCTAssertEqual(UpdateChannels.allowed(forVersion: "0.6.0"), [])
    }
}
