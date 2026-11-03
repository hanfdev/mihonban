import XCTest

@MainActor
final class MihonbanUITests: XCTestCase {
    func testBrowsePlayPauseAndQueue() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        let album = app.buttons["album.demo-1"]
        XCTAssertTrue(album.waitForExistence(timeout: 15))
        screenshot("01-library")

        // Artists are derived from album credits, so the tab works offline too.
        openTab(app, "Artists")
        XCTAssertTrue(element(app, "artist.Studio Ensemble").waitForExistence(timeout: 10))
        openTab(app, "Albums")
        XCTAssertTrue(album.waitForExistence(timeout: 10))

        // The cache section must be reachable and its actions must work.
        app.buttons["settings.open"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Local cache"].waitForExistence(timeout: 10))
        app.swipeUp()
        let clear = app.buttons["cache.clear"]
        XCTAssertTrue(clear.waitForExistence(timeout: 10))
        clear.tap()
        XCTAssertTrue(app.staticTexts["Cache cleared"].waitForExistence(timeout: 5))
        screenshot("05-settings-cache")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(album.waitForExistence(timeout: 10))

        album.tap()
        let play = app.buttons["album.play"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        screenshot("02-album")
        play.tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        expand.tap()
        XCTAssertTrue(app.staticTexts["player.title"].waitForExistence(timeout: 10))
        screenshot("03-now-playing")
        let toggle = app.buttons["player.toggle"].firstMatch
        toggle.tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        app.buttons["Queue"].tap()
        XCTAssertTrue(app.staticTexts["Up next"].waitForExistence(timeout: 5))
        // Jumping to an upcoming entry plays it and removes it from Up next.
        let upcoming = element(app, "queue.0")
        XCTAssertTrue(upcoming.waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "queue.1").exists)
        screenshot("04-queue")
        upcoming.tap()
        let skipped = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element(app, "queue.1"))
        wait(for: [skipped], timeout: 10)
    }

    func testRealConnectionAndNetworkPlayback() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        let address = app.textFields["connection.address"]
        if !address.waitForExistence(timeout: 5) {
            app.buttons["settings.open"].firstMatch.tap()
            app.buttons["Sign out"].tap()
            app.buttons["Sign out"].firstMatch.tap()
        }
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        address.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) {
            app.menuItems["Select All"].tap()
        }
        address.typeText("http://127.0.0.1:8766")
        let password = app.secureTextFields["connection.password"]
        password.tap()
        password.typeText("fixture-password")
        app.buttons["connection.connect"].tap()
        let album = app.buttons["album.network-mp3"]
        XCTAssertTrue(album.waitForExistence(timeout: 20))
        album.tap()
        app.buttons["album.play"].tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 20))
        expand.tap()
        XCTAssertTrue(app.staticTexts["player.title"].waitForExistence(timeout: 10))
        // Elapsed time is polled twice a second, so accept any label past two seconds.
        let elapsed = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "0:0[2-9]")).firstMatch
        XCTAssertTrue(elapsed.waitForExistence(timeout: 20))
        XCTAssertEqual(app.state, .runningForeground)
        screenshot("06-network-playback")
        app.buttons["player.collapse"].firstMatch.tap()

        // Every tab must decode the worker-shaped fixture responses.
        openTab(app, "Artists")
        let ensemble = element(app, "artist.Test Ensemble")
        XCTAssertTrue(ensemble.waitForExistence(timeout: 15))
        XCTAssertTrue(element(app, "artist.Session Player").exists, "featured-only artists are listed")
        ensemble.tap()
        XCTAssertTrue(app.buttons["artist.play"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["artist.bio"].waitForExistence(timeout: 10))
        screenshot("07-artist")

        openTab(app, "Tracks")
        XCTAssertTrue(element(app, "track.network-ogg").waitForExistence(timeout: 15))
        screenshot("08-tracks")

        openTab(app, "Picks")
        XCTAssertTrue(element(app, "favorite.network-mp3").waitForExistence(timeout: 15))
        screenshot("09-picks")

        // A focused search field collapses the iOS 26 tab bar, so search runs last.
        openTab(app, "Search")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("guest")
        XCTAssertTrue(element(app, "search.artist.Guest Singer").waitForExistence(timeout: 10))
        screenshot("10-search")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testConnectionScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)"]
        app.launch()
        XCTAssertTrue(app.textFields["connection.address"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["connection.connect"].isEnabled)
        screenshot("00-connect-zh")
    }

    private func openTab(_ app: XCUIApplication, _ label: String) {
        let tab = app.tabBars.buttons[label]
        if tab.waitForExistence(timeout: 3) { tab.tap() } else { app.buttons[label].firstMatch.tap() }
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}