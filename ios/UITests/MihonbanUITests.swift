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

        // The cache section must be reachable and its actions must work.
        app.buttons["settings.open"].tap()
        XCTAssertTrue(app.staticTexts["Local cache"].waitForExistence(timeout: 10))
        app.swipeUp()
        let clear = app.buttons["cache.clear"]
        XCTAssertTrue(clear.waitForExistence(timeout: 10))
        clear.tap()
        XCTAssertTrue(app.staticTexts["Cache cleared"].waitForExistence(timeout: 5))
        screenshot("05-settings-cache")
        app.buttons["Done"].tap()
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
        screenshot("04-queue")
    }

    func testRealConnectionAndNetworkPlayback() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        let address = app.textFields["connection.address"]
        if !address.waitForExistence(timeout: 5) {
            app.buttons["settings.open"].tap()
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
    }

    func testConnectionScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)"]
        app.launch()
        XCTAssertTrue(app.textFields["connection.address"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["connection.connect"].isEnabled)
        screenshot("00-connect-zh")
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}