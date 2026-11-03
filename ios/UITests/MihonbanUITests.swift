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
