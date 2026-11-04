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
    func testAdminEditsAnAlbum() async throws {
        try await Self.resetFixture()
        addTeardownBlock { try await Self.resetFixture() }
        editAlbumInApp()
    }

    private func editAlbumInApp() {
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
        let downloads = app.buttons["downloads.open"]
        // Lazy list rows can exist while their tap centre is below the safe area.
        for _ in 0..<3 {
            if downloads.exists && downloads.isHittable && downloads.frame.maxY < app.frame.maxY - 34 { break }
            app.swipeUp()
        }
        XCTAssertTrue(downloads.waitForExistence(timeout: 10))
        XCTAssertTrue(downloads.isHittable)
        XCTAssertLessThan(downloads.frame.maxY, app.frame.maxY - 34)
        downloads.tap()
        XCTAssertTrue(app.navigationBars["Downloads"].waitForExistence(timeout: 10))
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

    func testPlayerCreditsStayCompactAndOpenEveryArtist() {
        let app = launchCreditsPlayer()
        let artist = app.buttons["player.artist"]
        XCTAssertEqual(artist.value as? String, "+7 more")
        XCTAssertLessThanOrEqual(artist.frame.height, 45)
        XCTAssertLessThanOrEqual(artist.frame.maxX, app.frame.maxX)
        XCTAssertFalse(app.staticTexts["Audio output"].exists)
        let queue = app.buttons["player.queue"]
        XCTAssertTrue(queue.isHittable)
        XCTAssertLessThan(queue.frame.maxY, app.frame.maxY - 24)
        screenshot("19-many-artists")

        artist.tap()
        XCTAssertTrue(app.buttons["player.credit.0"].waitForExistence(timeout: 5))
        for index in 0..<8 {
            let row = app.buttons["player.credit.\(index)"]
            reveal(row, in: app)
            XCTAssertTrue(row.isHittable, "every credited artist can be reached")
        }
        screenshot("20-full-credits")
        app.buttons["player.credit.7"].tap()
        let title = app.staticTexts["artist.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Final Artist")
        XCTAssertFalse(app.buttons["player.collapse"].exists)
        app.buttons["player.expand"].tap()
        XCTAssertTrue(app.buttons["player.artist"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play", "reading credits must not resume playback")

        // The next fixture carries a raw credit, not a structured artist array.
        app.buttons["player.next"].tap()
        waitForLabel(app.buttons["player.title"], "Interlude")
        app.buttons["player.toggle"].firstMatch.tap()
        artist.tap()
        let raw = app.staticTexts["player.credits.raw"]
        XCTAssertTrue(raw.waitForExistence(timeout: 5))
        XCTAssertTrue(raw.label.hasPrefix("Earth, Wind & Fire,"))
        XCTAssertTrue(raw.label.hasSuffix("Final Contributor"))
        XCTAssertFalse(app.buttons["player.credit.0"].exists)
        screenshot("21-original-credit")
        app.buttons["player.credits.done"].tap()
        XCTAssertTrue(artist.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")

        app.buttons["player.next"].tap()
        waitForLabel(app.buttons["player.title"], "After the rain")
        artist.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Studio Ensemble", "a single structured artist still opens directly")
        XCTAssertFalse(app.buttons["player.credits.done"].exists)
    }

    func testPlayerCreditsWithLargeTextAndLandscape() {
        let app = launchCreditsPlayer(largeText: true)
        let artist = app.buttons["player.artist"]
        XCTAssertEqual(artist.value as? String, "+7 more")
        XCTAssertLessThanOrEqual(artist.frame.maxX, app.frame.maxX)
        reveal(app.buttons["player.queue"], in: app)
        XCTAssertTrue(app.buttons["player.queue"].isHittable)
        screenshot("22-large-text-player")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let landscape = expectation(for: NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            return frame.width > frame.height
        }, evaluatedWith: app)
        wait(for: [landscape], timeout: 10)
        let queue = app.buttons["player.queue"]
        reveal(queue, in: app, scrolling: app.scrollViews["player.scroll"])
        XCTAssertTrue(queue.isHittable)
        XCTAssertLessThanOrEqual(queue.frame.maxX, app.windows.firstMatch.frame.maxX)
        screenshot("23-landscape-player")
        queue.tap()
        let list = app.collectionViews["queue.list"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        // Large text makes the current-track section taller than the viewport.
        let next = app.staticTexts["Up next"]
        reveal(next, in: app, scrolling: list)
        XCTAssertTrue(next.isHittable)
        screenshot("23-landscape-queue")
    }

    func testDescriptorsCollapseWithoutChangingPlayback() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-descriptors", "-AppleLanguages", "(en)"]
        app.launch()
        let album = app.buttons["album.demo-1"]
        XCTAssertTrue(album.waitForExistence(timeout: 15))
        album.tap()
        XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
        app.buttons["album.play"].tap()
        XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 10))
        app.buttons["Pause"].firstMatch.tap()
        let mini = app.buttons["player.expand"]
        let playing = mini.label
        let descriptors = app.buttons["album.descriptors"]
        reveal(descriptors, in: app)
        XCTAssertTrue(descriptors.isHittable)
        XCTAssertEqual(descriptors.value as? String, "Collapsed")
        XCTAssertTrue(descriptors.label.contains("23"))
        XCTAssertFalse(app.staticTexts["album.descriptors.content"].exists)
        screenshot("24-descriptors-collapsed")
        descriptors.tap()
        let text = app.staticTexts["album.descriptors.content"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertTrue(text.label.hasPrefix("love · romantic"))
        XCTAssertTrue(text.label.hasSuffix("nostalgia"))
        XCTAssertEqual(descriptors.value as? String, "Expanded")
        screenshot("25-descriptors-expanded")
        descriptors.tap()
        XCTAssertFalse(text.exists)
        XCTAssertEqual(mini.label, playing)
        XCTAssertTrue(app.buttons["Play"].firstMatch.exists, "disclosure does not resume a paused track")

        // Genre navigation remains separate and the next album starts collapsed.
        app.buttons["Shibuya-kei"].firstMatch.tap()
        let other = app.buttons["album.demo-3"]
        reveal(other, in: app)
        XCTAssertTrue(other.isHittable)
        other.tap()
        reveal(descriptors, in: app)
        XCTAssertEqual(descriptors.value as? String, "Collapsed")
        XCTAssertTrue(descriptors.label.contains("1"))
    }

    private func launchCreditsPlayer(largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-credits", "-AppleLanguages", "(en)"]
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        let album = app.buttons["album.demo-1"]
        XCTAssertTrue(album.waitForExistence(timeout: 15))
        album.tap()
        let play = app.buttons["album.play"]
        reveal(play, in: app)
        play.tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        expand.tap()
        XCTAssertTrue(app.buttons["player.artist"].waitForExistence(timeout: 10))
        let pause = app.buttons["player.toggle"].firstMatch
        reveal(pause, in: app)
        pause.tap()
        waitForLabel(pause, "Play")
        return app
    }

    private func waitForLabel(_ element: XCUIElement, _ label: String) {
        let changed = expectation(for: NSPredicate(format: "label == %@", label), evaluatedWith: element)
        wait(for: [changed], timeout: 10)
    }

    private func reveal(_ target: XCUIElement, in app: XCUIApplication, scrolling container: XCUIElement? = nil) {
        let surface = container ?? app
        for _ in 0..<8 {
            let bounds = app.windows.firstMatch.frame
            if target.exists && target.isHittable && target.frame.maxY <= bounds.maxY - 34 { return }
            let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            if target.exists && target.frame.minY < bounds.minY + 100 { end.press(forDuration: 0.05, thenDragTo: start) }
            else { start.press(forDuration: 0.05, thenDragTo: end) }
        }
    }

    func testTileTitleAndArtistStayTogetherWhileRatingsAlign() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-captions", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        let shortTitle = app.staticTexts["tile.title.demo-2"]
        let shortArtist = app.staticTexts["tile.artist.demo-2"]
        let longTitle = app.staticTexts["tile.title.demo-1"]
        let longArtist = app.staticTexts["tile.artist.demo-1"]
        XCTAssertTrue(shortArtist.waitForExistence(timeout: 5))
        XCTAssertTrue(longArtist.exists)
        XCTAssertGreaterThan(longTitle.frame.height, shortTitle.frame.height + 5)
        XCTAssertEqual(shortArtist.frame.minY - shortTitle.frame.maxY, 4, accuracy: 1)
        XCTAssertEqual(longArtist.frame.minY - longTitle.frame.maxY, 4, accuracy: 1)
        XCTAssertLessThan(shortArtist.frame.minY, longArtist.frame.minY)
        XCTAssertEqual(element(app, "tile.footer.demo-1").frame.minY,
                       element(app, "tile.footer.demo-2").frame.minY, accuracy: 1)
        screenshot("26-caption-grouping")
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

    private nonisolated static func resetFixture() async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8766/fixture/reset")!)
        request.httpMethod = "POST"
        // A fresh simulator can stall the runner's first network request. Await
        // the actual response rather than outliving a short expectation timer.
        request.timeoutInterval = 60
        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
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