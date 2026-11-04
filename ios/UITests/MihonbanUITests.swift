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
        // The album play control is a circle with no visible text label.
        XCTAssertEqual(play.frame.width, 60, accuracy: 1)
        XCTAssertEqual(play.frame.width, play.frame.height, accuracy: 1)
        XCTAssertEqual(play.label, "Play all")
        XCTAssertFalse(play.staticTexts["Play all"].exists)
        XCTAssertTrue(app.buttons["album.shuffle"].exists)
        let cover = element(app, "album.cover")
        XCTAssertLessThanOrEqual(cover.frame.width, 271)
        XCTAssertGreaterThan(cover.frame.width, 200)
        XCTAssertEqual(cover.frame.width, cover.frame.height, accuracy: 1)
        XCTAssertEqual(cover.frame.midX, play.frame.midX, accuracy: 1)
        screenshot("02-album")
        play.tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        expand.tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        screenshot("03-now-playing")
        let toggle = app.buttons["player.toggle"].firstMatch
        toggle.tap()
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let queue = app.buttons["player.queue"]
        XCTAssertTrue(queue.waitForExistence(timeout: 5))
        // A hittable sliver at the screen edge is not a usable control.
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            queue.isHittable && queue.frame.maxY <= app.frame.maxY - 24
        }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [visible], timeout: 5), .completed)
        XCTAssertFalse(app.staticTexts["Audio output"].exists)
        queue.tap()
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

    // Earlier tests may leave a remembered session, which reopens the library on
    // launch. Signing out returns to the connection screen in any language.
    private func signOutIfNeeded(_ app: XCUIApplication) {
        // Bootstrap hides the connection form until session restoration finishes.
        let restored = expectation(for: NSPredicate(format: "exists == false"),
                                   evaluatedWith: element(app, "connection.restoring"))
        wait(for: [restored], timeout: 30)
        let address = app.textFields["connection.address"]
        guard !address.waitForExistence(timeout: 5) else { return }
        let settings = app.buttons["settings.open"].firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 15))
        settings.tap()
        let signOut = app.buttons["settings.signOut"]
        if !signOut.waitForExistence(timeout: 5) { app.swipeUp() }
        signOut.tap()
        let confirm = app.buttons["settings.signOutConfirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
    }

    // Signs out any remembered session first, so each test chooses its role.
    private func signIn(_ app: XCUIApplication, password secret: String) {
        let address = app.textFields["connection.address"]
        signOutIfNeeded(app)
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        address.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) {
            app.menuItems["Select All"].tap()
        }
        address.typeText("http://127.0.0.1:8766")
        let password = app.secureTextFields["connection.password"]
        focus(password)
        password.typeText(secret)
        app.buttons["connection.connect"].tap()
    }

    // A tap right after the keyboard moves between fields is sometimes dropped,
    // most often on a freshly booted simulator, so tap until the field has focus.
    private func focus(_ field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        for _ in 0..<3 {
            field.tap()
            let wait = XCTNSPredicateExpectation(predicate: focused, object: field)
            if XCTWaiter().wait(for: [wait], timeout: 3) == .completed { return }
        }
        XCTFail("\(field.identifier) never received keyboard focus")
    }

    // Administrators edit album details natively; the fixture applies the
    // worker's validation and is restored afterwards.
    func testAdminEditsAnAlbum() throws {
        resetFixture()
        defer { resetFixture() }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        signIn(app, password: "fixture-admin")
        let album = app.buttons["album.network-ogg"]
        XCTAssertTrue(album.waitForExistence(timeout: 20))
        album.tap()
        let menu = app.buttons["album.menu"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let edit = app.buttons["Edit album"].firstMatch
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Hide"].exists)
        screenshot("13-album-admin-menu")
        edit.tap()

        let title = element(app, "edit.title")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        let save = app.buttons["edit.save"].firstMatch
        XCTAssertFalse(save.isEnabled, "nothing to save before a change")
        screenshot("14-album-edit")
        // Tapping the trailing edge puts the cursor after the existing text.
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.5)).tap()
        let current = (title.value as? String) ?? ""
        title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        title.typeText("Edited in the app")
        XCTAssertTrue(save.isEnabled)
        save.tap()

        // The sheet closes only after the service accepts the edit.
        XCTAssertTrue(app.staticTexts["album.title"].waitForExistence(timeout: 15))
        let saved = expectation(for: NSPredicate(format: "label == %@", "Edited in the app"),
                                evaluatedWith: app.staticTexts["album.title"])
        wait(for: [saved], timeout: 15)
        XCTAssertFalse(title.exists)
        screenshot("15-album-edited")
    }

    func testRealConnectionAndNetworkPlayback() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        signIn(app, password: "fixture-password")
        let album = app.buttons["album.network-mp3"]
        XCTAssertTrue(album.waitForExistence(timeout: 20))
        album.tap()
        let play = app.buttons["album.play"]
        let shuffle = app.buttons["album.shuffle"]
        let downloadControl = app.buttons["album.download"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        XCTAssertTrue(downloadControl.waitForExistence(timeout: 10))
        XCTAssertEqual(play.frame.midX - shuffle.frame.midX,
                       downloadControl.frame.midX - play.frame.midX, accuracy: 1)
        XCTAssertEqual(shuffle.frame.midY, downloadControl.frame.midY, accuracy: 1)
        play.tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 20))
        expand.tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        // Elapsed time is polled twice a second, so accept any label past two seconds.
        let elapsed = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "0:0[2-9]")).firstMatch
        XCTAssertTrue(elapsed.waitForExistence(timeout: 20))
        XCTAssertEqual(app.state, .runningForeground)
        screenshot("06-network-playback")
        // Tapping the track title opens its album and closes the player.
        app.buttons["player.title"].tap()
        let albumTitle = app.staticTexts["album.title"]
        XCTAssertTrue(albumTitle.waitForExistence(timeout: 10))
        XCTAssertEqual(albumTitle.label, "Network MP3")
        XCTAssertFalse(app.buttons["player.collapse"].exists)

        // Downloading the open album finishes and flips the control to "remove".
        let download = app.buttons["album.download"]
        XCTAssertTrue(download.waitForExistence(timeout: 10))
        download.tap()
        expectation(for: NSPredicate(format: "label IN %@", ["Remove download", "Try again"]), evaluatedWith: download)
        waitForExpectations(timeout: 60)
        screenshot("11-album-downloaded")
        let downloaded = download.label == "Remove download"

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

        // The finished download is listed in Settings.
        app.buttons["settings.open"].firstMatch.tap()
        let downloads = element(app, "downloads.open")
        if !downloads.waitForExistence(timeout: 5) { app.swipeUp() }
        XCTAssertTrue(downloads.waitForExistence(timeout: 10))
        downloads.tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "download.")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        screenshot("12-downloads")
        // A failed row carries the HTTP status or transport error code in its label.
        XCTAssertTrue(downloaded, "album download failed: \(row.identifier) \(row.label)")
        XCTAssertEqual(row.identifier, "download.done.network-mp3", row.label)
        app.navigationBars["Downloads"].buttons.firstMatch.tap()
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        done.tap()

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

    func testGenreFilterMergesCaseVariants() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        app.buttons["albums.filters"].tap()
        let genre = app.buttons["filters.genre"]
        XCTAssertTrue(genre.waitForExistence(timeout: 10))
        genre.tap()
        let option = app.buttons["Shibuya-kei"]
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons.matching(identifier: "Shibuya-kei").count, 1)
        XCTAssertFalse(app.buttons["Shibuya-Kei"].exists)
        screenshot("17-genre-options")
        option.tap()
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["album.demo-2"].exists, "the alternate capitalization must match too")
        XCTAssertTrue(app.buttons["album.demo-3"].exists)
        XCTAssertFalse(app.buttons["album.demo-4"].exists, "an unrelated genre must not match")
        screenshot("18-genre-filtered")
    }

    func testShuffleToggleWaitsForPlayAll() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        openTab(app, "Tracks")
        let shuffle = app.buttons["tracks.shuffle"]
        XCTAssertTrue(shuffle.waitForExistence(timeout: 10))
        XCTAssertFalse(shuffle.isSelected)
        shuffle.tap()
        XCTAssertTrue(shuffle.isSelected)
        XCTAssertFalse(app.buttons["player.expand"].exists, "setting shuffle must not start a track")
        screenshot("16-shuffle-enabled")
        app.buttons["tracks.play"].tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        expand.tap()
        let playerShuffle = app.buttons["player.shuffle"]
        XCTAssertTrue(playerShuffle.waitForExistence(timeout: 10))
        XCTAssertTrue(playerShuffle.isSelected, "Play all must keep the selected shuffle mode")
        app.buttons["player.toggle"].firstMatch.tap()
        let title = app.buttons["player.title"].label
        playerShuffle.tap()
        XCTAssertFalse(playerShuffle.isSelected)
        XCTAssertEqual(app.buttons["player.title"].label, title)
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play", "changing mode must not resume playback")
        app.buttons["player.collapse"].tap()
        XCTAssertTrue(shuffle.waitForExistence(timeout: 10))
        XCTAssertFalse(shuffle.isSelected, "the list and player show the same mode")
    }

    func testConnectionScreen() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)"]
        app.launch()
        signOutIfNeeded(app)
        // Signing out keeps the last address, so clear it to check the empty state.
        let address = app.textFields["connection.address"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        let current = address.value as? String ?? ""
        if !current.isEmpty && current != address.placeholderValue {
            focus(address)
            address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        }
        let connect = app.buttons["connection.connect"]
        let disabled = expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: connect)
        wait(for: [disabled], timeout: 5)
        screenshot("00-connect-zh")
    }

    private func resetFixture() {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8766/fixture/reset")!)
        request.httpMethod = "POST"
        let done = expectation(description: "fixture reset")
        URLSession.shared.dataTask(with: request) { _, response, _ in
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
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