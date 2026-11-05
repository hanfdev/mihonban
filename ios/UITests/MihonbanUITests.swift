import XCTest
import UIKit

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

    func testAdminPicksThePlayingTrack() async throws {
        try await Self.resetFixture()
        addTeardownBlock { try await Self.resetFixture() }
        let app = openAdminPlayer()
        let heart = app.buttons["player.favorite"]
        XCTAssertTrue(heart.waitForExistence(timeout: 10))
        XCTAssertFalse(heart.isSelected)
        XCTAssertEqual(heart.label, "Add to picks")
        XCTAssertEqual(heart.frame.width, 44, accuracy: 0.5)
        XCTAssertEqual(heart.frame.height, 44, accuracy: 0.5)
        XCTAssertGreaterThan(heart.frame.minX, app.buttons["player.title"].frame.maxX)
        assertShortTitleCover(app)
        changePick(app, selected: true)
        let added = try await Self.fixtureTrackPicks()
        XCTAssertTrue(added.contains("network-mp3"), "the heart must persist the current track to the service")
        XCTAssertTrue(added.contains("network-flac"), "another track's pick is unchanged")
        screenshot("27-player-picked")
        changePick(app, selected: false)
        let removed = try await Self.fixtureTrackPicks()
        XCTAssertFalse(removed.contains("network-mp3"))
        XCTAssertTrue(removed.contains("network-flac"))
        screenshot("28-player-unpicked")
        verifyPickFollowsCurrentTrack(app)
    }

    private func verifyPickFollowsCurrentTrack(_ app: XCUIApplication) {
        app.buttons["player.collapse"].tap()
        openTab(app, "Tracks")
        let flac = app.buttons["track.network-flac"]
        XCTAssertTrue(flac.waitForExistence(timeout: 15))
        flac.tap()
        let pause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        pause.tap()
        app.buttons["player.expand"].tap()
        waitForLabel(app.buttons["player.title"], "Test FLAC")
        XCTAssertTrue(app.buttons["player.favorite"].isSelected, "the already-picked track has its own state")
        app.buttons["player.next"].tap()
        waitForLabel(app.buttons["player.title"], "Test MP3")
        app.buttons["player.toggle"].firstMatch.tap()
        XCTAssertFalse(app.buttons["player.favorite"].isSelected, "changing tracks cannot carry the old heart state")
    }

    private func openAdminPlayer() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        signIn(app, password: "fixture-admin")
        let album = app.buttons["album.network-mp3"]
        XCTAssertTrue(album.waitForExistence(timeout: 20))
        album.tap()
        XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
        app.buttons["album.play"].tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        let pause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        pause.tap()
        expand.tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        waitForLabel(app.buttons["player.toggle"].firstMatch, "Play")
        XCTAssertEqual(app.buttons["player.title"].label, "Test MP3")
        return app
    }

    private func changePick(_ app: XCUIApplication, selected: Bool) {
        let heart = app.buttons["player.favorite"]
        heart.tap()
        let saved = expectation(for: NSPredicate { _, _ in heart.isSelected == selected && heart.isEnabled },
                                evaluatedWith: heart)
        wait(for: [saved], timeout: 15)
        XCTAssertEqual(app.buttons["player.title"].label, "Test MP3")
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play", "picking must not resume or replace playback")
        XCTAssertEqual(heart.label, selected ? "Remove from picks" : "Add to picks")
    }

    private nonisolated static func fixtureTrackPicks() async throws -> [String] {
        let configuration = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8766/api/favorites")!)
        request.setValue("mihonban_session=fixture-session", forHTTPHeaderField: "Cookie")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        struct Item: Decodable { let id: String }
        struct Picks: Decodable { let tracks: [Item] }
        return try JSONDecoder().decode(Picks.self, from: data).tracks.map(\.id)
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
        XCTAssertFalse(app.buttons["player.favorite"].exists, "listeners cannot change shared picks")
        screenshot("06-network-playback")
        // Tapping the track title opens its album, not the adjacent artist picker.
        let titleButton = app.buttons["player.title"]
        XCTAssertTrue(titleButton.isHittable)
        titleButton.tap()
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
                                               object: app.buttons["player.collapse"])
        guard XCTWaiter().wait(for: [closed], timeout: 10) == .completed else {
            screenshot("06-title-navigation-failed")
            XCTFail("Tapping the song title must dismiss Now Playing before album actions run")
            return
        }
        XCTAssertFalse(app.buttons["player.credits.done"].exists, "the title must not open artist credits")
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

    func testFilteredTracksShuffleImmediatelyAndPlayAllUsesShownOrder() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        openTab(app, "Tracks")
        app.buttons["tracks.filters"].tap()
        let decade = app.buttons["filters.decade"]
        XCTAssertTrue(decade.waitForExistence(timeout: 10))
        decade.tap()
        app.buttons["1990s"].tap()
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.buttons["track.demo-4-0"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["track.demo-1-0"].exists)
        screenshot("40-filtered-tracks")
        app.buttons["tracks.shuffle"].tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15), "Shuffle starts the filtered queue immediately")
        app.buttons["Pause"].firstMatch.tap()
        expand.tap()
        let playerShuffle = app.buttons["player.shuffle"]
        XCTAssertTrue(playerShuffle.waitForExistence(timeout: 10))
        XCTAssertTrue(playerShuffle.isSelected)
        XCTAssertEqual(app.images["player.cover"].label, "Evening studies")
        app.buttons["player.queue"].tap()
        XCTAssertTrue(app.buttons["queue.1"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["queue.2"].exists, "only the three matching tracks enter the queue")
        app.buttons["queue.close"].tap()
        app.buttons["player.collapse"].tap()
        app.buttons["tracks.play"].tap()
        app.buttons["Pause"].firstMatch.tap()
        expand.tap()
        waitForLabel(app.buttons["player.title"], "After the rain")
        XCTAssertFalse(playerShuffle.isSelected, "Play all uses the displayed title order")
        app.buttons["player.collapse"].tap()
        app.buttons["tracks.filters"].tap()
        app.buttons["filters.decade"].tap()
        app.buttons["1980s"].tap()
        app.buttons["Done"].firstMatch.tap()
        expand.tap()
        XCTAssertEqual(app.images["player.cover"].label, "Evening studies", "changing a filter leaves the existing queue intact")
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
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
        XCTAssertEqual(artist.images.count, 0, "a single artist has no disclosure arrow")
        artist.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertEqual(title.label, "Studio Ensemble", "a single artist opens directly without a picker")
        XCTAssertFalse(app.buttons["player.credit.0"].exists)
        XCTAssertFalse(app.buttons["player.credits.done"].exists)
    }

    func testPlayerCoverIsLargerAndStable() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        let album = app.buttons["album.demo-1"]
        XCTAssertTrue(album.waitForExistence(timeout: 15))
        album.tap()
        XCTAssertTrue(app.buttons["album.play"].waitForExistence(timeout: 10))
        app.buttons["album.play"].tap()
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        let pause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 10))
        pause.tap()
        expand.tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        assertShortTitleCover(app)
        let before = element(app, "player.cover").frame
        app.buttons["player.toggle"].firstMatch.tap()
        waitForLabel(app.buttons["player.toggle"].firstMatch, "Pause")
        let after = element(app, "player.cover").frame
        XCTAssertEqual(before.width, after.width, accuracy: 1)
        XCTAssertEqual(before.minY, after.minY, accuracy: 1, "play/pause must not move the artwork")
        screenshot("29-larger-player-cover")
        app.buttons["player.toggle"].firstMatch.tap()
    }

    private func assertShortTitleCover(_ app: XCUIApplication) {
        let cover = app.images["player.cover"]
        XCTAssertTrue(cover.waitForExistence(timeout: 10))
        let scroll = app.scrollViews["player.scroll"]
        let window = app.windows.firstMatch.frame
        if window.width < 600 {
            // Hosted simulators can spend several seconds on one AX snapshot.
            // Keep the same size requirement, but allow more than one query.
            let enlarged = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                cover.frame.width >= window.width * 0.8
            }, object: nil)
            guard XCTWaiter().wait(for: [enlarged], timeout: 20) == .completed else {
                screenshot("player-cover-size-timeout")
                let diagnostic = XCTAttachment(string: "Window: \(window)\nCover: \(cover.frame)\n" + app.debugDescription)
                diagnostic.name = "Player cover geometry after bounded wait"
                diagnostic.lifetime = .keepAlways
                add(diagnostic)
                XCTFail("The short-title cover must reach at least 80 percent of the phone width")
                return
            }
        }
        let coverFrame = cover.frame
        let scrollFrame = scroll.frame
        if window.width < 600 { XCTAssertGreaterThanOrEqual(coverFrame.width, window.width * 0.8) }
        XCTAssertEqual(coverFrame.width, coverFrame.height, accuracy: 1)
        XCTAssertLessThanOrEqual(coverFrame.width, min(500, scrollFrame.width - 56) + 1)
        XCTAssertEqual(coverFrame.midX, scrollFrame.midX, accuracy: 1)
        let collapse = app.buttons["player.collapse"].frame
        XCTAssertGreaterThanOrEqual(coverFrame.minY, collapse.maxY)
        if window.width < 600 {
            XCTAssertLessThanOrEqual(coverFrame.minY - collapse.maxY, 40, "phone artwork must not inherit a large-title gap")
        } else {
            assertTabletPlayerBalance(app)
        }
        XCTAssertTrue(app.buttons["player.queue"].isHittable)
        XCTAssertLessThanOrEqual(app.buttons["player.queue"].frame.maxY, scroll.frame.maxY - 19)
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.frame.width, 70, accuracy: 1)
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.frame.height, 70, accuracy: 1)
    }

    func testMiniPlayerFitsAccessibilityTextInBothOrientations() {
        let app = launchCreditsPlayer(largeText: true)
        app.buttons["player.collapse"].tap()
        assertMiniPlayerContentVisible(app)
        screenshot("36-accessible-mini-portrait")
        let originalTitle = app.staticTexts["mini.title"].label
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let rotated = expectation(for: NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            return frame.width > frame.height
        }, evaluatedWith: app)
        wait(for: [rotated], timeout: 10)
        assertMiniPlayerContentVisible(app)
        XCTAssertEqual(app.staticTexts["mini.title"].label, originalTitle)
        XCTAssertEqual(app.buttons["mini.toggle"].label, "Play")
        screenshot("37-accessible-mini-landscape")
        app.buttons["mini.next"].tap()
        waitForLabel(app.staticTexts["mini.title"], "Interlude")
        waitForLabel(app.buttons["mini.toggle"], "Pause")
        app.buttons["mini.toggle"].tap()
        waitForLabel(app.buttons["mini.toggle"], "Play")
        app.buttons["player.expand"].tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["player.title"].label, "Interlude")
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
    }

    private func assertMiniPlayerContentVisible(_ app: XCUIApplication) {
        let expand = app.buttons["player.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 10))
        let title = app.staticTexts["mini.title"]
        let artist = app.staticTexts["mini.artists"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue(artist.exists)
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let window = app.windows.firstMatch.frame.insetBy(dx: -1, dy: -1)
            let textArea = expand.frame.insetBy(dx: -1, dy: -1)
            return expand.isHittable && window.contains(expand.frame)
                && textArea.contains(title.frame) && textArea.contains(artist.frame)
        }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [visible], timeout: 5), .completed,
                       "large mini-player text must fit inside its button, not clip above or below the bar")
        XCTAssertGreaterThan(artist.frame.minY, title.frame.minY)
        for control in [app.buttons["mini.toggle"], app.buttons["mini.next"]] {
            XCTAssertTrue(control.isHittable)
            XCTAssertEqual(control.frame.width, 44, accuracy: 0.5)
            XCTAssertEqual(control.frame.height, 44, accuracy: 0.5)
            XCTAssertTrue(app.windows.firstMatch.frame.insetBy(dx: -1, dy: -1).contains(control.frame))
        }
    }

    func testPlayerCreditsWithLargeTextAndLandscape() {
        let app = launchCreditsPlayer(largeText: true)
        let artist = app.buttons["player.artist"]
        XCTAssertEqual(artist.value as? String, "+7 more")
        XCTAssertLessThanOrEqual(artist.frame.maxX, app.frame.maxX)
        let scroll = app.scrollViews["player.scroll"]
        XCTAssertTrue(scroll.waitForExistence(timeout: 10))
        reveal(app.buttons["player.queue"], in: app, scrolling: scroll)
        XCTAssertTrue(app.buttons["player.queue"].isHittable,
                      "queue=\(app.buttons["player.queue"].frame), scroll=\(scroll.frame)")
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
        XCTAssertEqual(artist.value as? String, "+7 more", "layout inspection must stay on the paused fixture")
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

    private func launchCreditsPlayer(largeText: Bool = false, queueStress: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-credits", "--demo-long-playback", "-AppleLanguages", "(en)"]
        if queueStress { app.launchArguments.append("--demo-queue-layout") }
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
        // Pause before opening the player so layout assertions use one track.
        let miniPause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(miniPause.waitForExistence(timeout: 10))
        XCTAssertTrue(miniPause.isHittable)
        miniPause.tap()
        expand.tap()
        XCTAssertTrue(app.buttons["player.artist"].waitForExistence(timeout: 10))
        waitForLabel(app.buttons["player.toggle"].firstMatch, "Play")
        XCTAssertEqual(app.buttons["player.title"].label,
                       "A very long song title for an evening with the studio ensemble")
        return app
    }

    private func waitForLabel(_ element: XCUIElement, _ label: String) {
        let changed = expectation(for: NSPredicate(format: "label == %@", label), evaluatedWith: element)
        wait(for: [changed], timeout: 10)
    }

    private func reveal(_ target: XCUIElement, in app: XCUIApplication, scrolling container: XCUIElement? = nil) {
        let surface = container ?? app
        for _ in 0..<8 {
            let window = app.windows.firstMatch.frame
            // A centred iPad sheet occupies only part of the application window.
            let bounds = container == nil ? window : surface.frame.intersection(window)
            if target.exists && target.isHittable && bounds.contains(target.frame)
                && target.frame.maxY <= bounds.maxY - 34 { return }
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
        XCTAssertEqual(longTitle.frame.height, shortTitle.frame.height, accuracy: 1)
        XCTAssertEqual(shortArtist.frame.minY - shortTitle.frame.maxY, 4, accuracy: 1)
        XCTAssertEqual(longArtist.frame.minY - longTitle.frame.maxY, 4, accuracy: 1)
        XCTAssertEqual(shortArtist.frame.minY, longArtist.frame.minY, accuracy: 1)
        XCTAssertEqual(element(app, "tile.footer.demo-1").frame.minY,
                       element(app, "tile.footer.demo-2").frame.minY, accuracy: 1)
        screenshot("26-caption-grouping")
    }

    func testSimilarAlbumCardsKeepSquareCoversAndSingleLineTitles() {
        for largeText in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = ["--demo", "--demo-similar-layout", "-AppleLanguages", "(en)"]
            if largeText {
                app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
            }
            app.launch()
            defer { app.terminate() }
            let album = app.buttons["album.demo-1"]
            XCTAssertTrue(album.waitForExistence(timeout: 15))
            album.tap()
            let longCard = app.buttons["similar.demo-2"]
            let shortCard = app.buttons["similar.demo-3"]
            reveal(longCard, in: app, scrolling: app.scrollViews["album.scroll"])
            XCTAssertTrue(longCard.isHittable)
            XCTAssertTrue(shortCard.isHittable)
            let longTitle = app.staticTexts["similar.title.demo-2"]
            let shortTitle = app.staticTexts["similar.title.demo-3"]
            XCTAssertTrue(longTitle.exists)
            XCTAssertTrue(shortTitle.exists)
            let fullTitle = longTitle.label
            XCTAssertGreaterThan(fullTitle.count, 60, "the long fixture must actually exceed one visible line")
            XCTAssertEqual(longTitle.frame.height, shortTitle.frame.height, accuracy: 0.5)
            XCTAssertEqual(longCard.frame.height, shortCard.frame.height, accuracy: 0.5)
            for (card, title) in [(longCard, longTitle), (shortCard, shortTitle)] {
                XCTAssertEqual(card.frame.width, 136, accuracy: 0.5)
                // The title follows the full square plus its existing five-point gap.
                XCTAssertEqual(title.frame.minY - card.frame.minY, 141, accuracy: 0.5)
                XCTAssertLessThanOrEqual(title.frame.width, 136.5)
            }
            screenshot(largeText ? "42-similar-accessible-titles" : "41-similar-single-line-titles")
            longCard.tap()
            waitForLabel(app.staticTexts["album.title"], fullTitle)
        }
    }

    func testQueueEditKeepsLongRowsAtTheSameHeightAndPosition() {
        let app = launchCreditsPlayer(queueStress: true)
        app.buttons["player.queue"].tap()
        let first = element(app, "queue.0")
        let second = element(app, "queue.1")
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        XCTAssertTrue(second.exists)
        let frames = [first.frame, second.frame]
        let labels = [first.label, second.label]
        let edit = app.buttons["queue.edit"]
        let close = app.buttons["queue.close"]
        let doneButtons = app.buttons.matching(NSPredicate(format: "label == %@", "Done"))
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertEqual(close.label, "Close")
        XCTAssertEqual(edit.label, "Edit")
        XCTAssertEqual(doneButtons.count, 0, "closing the queue is not a Done action")
        XCTAssertGreaterThanOrEqual(close.frame.width, 43.5)
        XCTAssertGreaterThanOrEqual(close.frame.height, 43.5)
        XCTAssertLessThan(edit.frame.midX, close.frame.midX)
        let handles = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Reorder"))
        for _ in 0..<3 {
            edit.tap()
            XCTAssertTrue(handles.firstMatch.waitForExistence(timeout: 5))
            XCTAssertEqual(handles.count, 2)
            XCTAssertEqual(edit.label, "Done")
            XCTAssertEqual(doneButtons.count, 1, "only ending edit mode may be labelled Done")
            XCTAssertEqual(close.label, "Close")
            XCTAssertTrue(close.isHittable)
            for (index, row) in [first, second].enumerated() {
                XCTAssertEqual(row.frame.height, frames[index].height, accuracy: 1)
                XCTAssertEqual(row.frame.minY, frames[index].minY, accuracy: 1,
                               "editing controls must not make long titles wrap and move the following rows")
                // Native List editing exposes the delete action on the row's
                // accessible button. The complete track credit must still follow it.
                XCTAssertTrue(row.label == labels[index] || row.label == "Remove, " + labels[index],
                              "editing may add the system remove action, but cannot change the track credit")
            }
            edit.tap()
            let finished = expectation(for: NSPredicate(format: "label == %@", "Edit"), evaluatedWith: edit)
            wait(for: [finished], timeout: 5)
            XCTAssertEqual(doneButtons.count, 0)
            XCTAssertTrue(close.isHittable, "ending edit mode leaves the queue open")
            for (index, row) in [first, second].enumerated() {
                XCTAssertEqual(row.frame.height, frames[index].height, accuracy: 1)
                XCTAssertEqual(row.frame.minY, frames[index].minY, accuracy: 1)
                XCTAssertEqual(row.label, labels[index])
            }
        }
        screenshot("40-queue-edit-stable")
        close.tap()
        let title = app.buttons["player.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let currentTitle = title.label
        XCTAssertTrue(currentTitle.hasPrefix("A very long"))
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")

        // Closing while editing must dismiss the sheet without touching playback
        // or applying another queue mutation; edits take effect as they happen.
        app.buttons["player.queue"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        XCTAssertEqual(edit.label, "Edit", "a reopened queue starts outside edit mode")
        XCTAssertEqual(first.label, labels[0])
        XCTAssertEqual(second.label, labels[1])
        edit.tap()
        XCTAssertTrue(handles.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(doneButtons.count, 1)
        XCTAssertEqual(close.label, "Close")
        screenshot("43-queue-edit-single-done")
        close.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.label, currentTitle)
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play", "closing cannot resume a paused track")
    }

    func testQueueDragKeepsRowsAndPlaybackIntact() {
        let app = launchCreditsPlayer()
        app.buttons["player.queue"].tap()
        XCTAssertTrue(app.buttons["queue.0"].waitForExistence(timeout: 10))
        let first = app.buttons["queue.0"].label
        let second = app.buttons["queue.1"].label
        app.buttons["queue.edit"].tap()
        let handles = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Reorder"))
        XCTAssertTrue(handles.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(handles.count, 2)
        // Cross the first row's midpoint and hold before releasing. A center-to-center
        // drag released immediately can snap back before the native drop commits.
        let source = handles.element(boundBy: 1).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let destination = handles.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .withOffset(CGVector(dx: 0, dy: -20))
        source.press(forDuration: 1, thenDragTo: destination, withVelocity: .slow, thenHoldForDuration: 1)
        app.buttons["queue.edit"].tap()
        waitForLabel(app.buttons["queue.0"], second)
        XCTAssertEqual(app.buttons["queue.1"].label, first)
        let gap = app.buttons["queue.1"].frame.minY - app.buttons["queue.0"].frame.maxY
        XCTAssertLessThan(abs(gap), 4, "a completed drag must not leave a row-sized hole")
        screenshot("30-queue-reordered")
        app.buttons["queue.close"].tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
        XCTAssertTrue(app.buttons["player.title"].label.hasPrefix("A very long"))
    }

    func testThreeArtistNamesShowInFullAndUseThePicker() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-small-credits", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        app.buttons["album.demo-1"].tap()
        app.buttons["album.play"].tap()
        XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 10))
        app.buttons["Pause"].firstMatch.tap()
        app.buttons["player.expand"].tap()
        let artist = app.buttons["player.artist"]
        XCTAssertTrue(artist.waitForExistence(timeout: 10))
        XCTAssertEqual(artist.label, "First Artist · Second Artist · Third Artist")
        XCTAssertEqual(artist.images.count, 0, "three artists have no disclosure arrow")
        XCTAssertEqual(artist.value as? String, "")
        XCTAssertFalse(app.staticTexts["player.artists.count"].exists)
        screenshot("31-three-artists")
        artist.tap()
        for index in 0..<3 { XCTAssertTrue(app.buttons["player.credit.\(index)"].waitForExistence(timeout: 5)) }
        XCTAssertFalse(app.buttons["player.credit.3"].exists)
        app.buttons["player.credits.done"].tap()
        app.buttons["player.next"].tap()
        waitForLabel(app.buttons["player.title"], "Interlude")
        app.buttons["player.toggle"].firstMatch.tap()
        XCTAssertEqual(artist.label, "First Artist · Second Artist")
        XCTAssertEqual(artist.images.count, 0, "two artists have no disclosure arrow")
        XCTAssertEqual(artist.value as? String, "")
        artist.tap()
        XCTAssertTrue(app.buttons["player.credit.1"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["player.credit.2"].exists)
        app.buttons["player.credit.1"].tap()
        waitForLabel(app.staticTexts["artist.title"], "Second Artist")
    }

    func testReadingSheetClosesWithoutLosingAlbumPosition() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-reading", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        app.buttons["album.demo-1"].tap()
        let rank = element(app, "album.yearRank")
        XCTAssertTrue(rank.waitForExistence(timeout: 10))
        XCTAssertEqual(rank.label, "#185 for 1984")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Overall")).firstMatch.exists)
        let read = app.buttons["album.note.read"]
        reveal(read, in: app, scrolling: app.scrollViews["album.scroll"])
        XCTAssertTrue(read.isHittable)
        let before = read.frame
        read.tap()
        let done = app.buttons["reader.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        let scroll = app.scrollViews["reader.scroll"]
        let last = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Paragraph 40.")).firstMatch
        for _ in 0..<30 {
            if last.exists && last.isHittable { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(last.exists, "all paragraphs must be retained in the rendered document")
        XCTAssertTrue(last.isHittable)
        XCTAssertTrue(done.isHittable, "closing must not require reaching the end of the note")
        screenshot("32-album-reading")
        done.tap()
        XCTAssertTrue(read.waitForExistence(timeout: 5))
        XCTAssertEqual(read.frame.minY, before.minY, accuracy: 2)
    }

    func testAlbumAndArtistDescriptionsRenderMarkdownNatively() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--demo-markdown", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        app.buttons["album.demo-1"].tap()
        let read = app.buttons["album.note.read"]
        reveal(read, in: app, scrolling: app.scrollViews["album.scroll"])
        read.tap()
        let done = app.buttons["reader.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10))
        assertMarkdownSample(app, scroll: app.scrollViews["reader.scroll"])
        screenshot("41-album-markdown")
        XCTAssertTrue(done.isHittable)
        done.tap()
        XCTAssertTrue(read.waitForExistence(timeout: 5))
        openTab(app, "Artists")
        let artist = element(app, "artist.見本盤スタジオ")
        XCTAssertTrue(artist.waitForExistence(timeout: 10))
        artist.tap()
        assertMarkdownSample(app, scroll: app.scrollViews["artist.scroll"])
        screenshot("42-artist-markdown")
        XCTAssertEqual(app.webViews.count, 0, "descriptions stay native rather than using a web view")
    }

    private func assertMarkdownSample(_ app: XCUIApplication, scroll: XCUIElement) {
        let heading = app.staticTexts["Session notes"]
        reveal(heading, in: app, scrolling: scroll)
        XCTAssertTrue(heading.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["# Session notes"].exists)
        let details = app.staticTexts["Recording details"]
        reveal(details, in: app, scrolling: scroll)
        XCTAssertTrue(details.isHittable)
        let quotation = app.staticTexts["Keep the room sound."]
        reveal(quotation, in: app, scrolling: scroll)
        XCTAssertTrue(quotation.isHittable)
        let code = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "take_01  00:42")).firstMatch
        reveal(code, in: app, scrolling: scroll)
        XCTAssertTrue(code.exists)
        XCTAssertTrue(code.label.contains("  preserve this indentation"))
        let table = app.staticTexts["3:42"]
        reveal(table, in: app, scrolling: scroll)
        XCTAssertTrue(table.isHittable)
        let last = app.staticTexts["Final listening note."]
        reveal(last, in: app, scrolling: scroll)
        XCTAssertTrue(last.isHittable)
        XCTAssertFalse(app.links["Unsafe link"].exists, "executable URL schemes are not interactive")
    }

    func testAirPlayDismissalKeepsTitleAndArtworkGeometry() throws {
        let app = launchCreditsPlayer()
        let title = app.buttons["player.title"]
        let cover = element(app, "player.cover")
        let route = element(app, "player.route")
        XCTAssertTrue(route.waitForExistence(timeout: 5))
        XCTAssertEqual(route.value as? String, "Collapsed")
        let fullTitle = title.label
        let titleFrame = title.frame
        let coverFrame = cover.frame
        for _ in 0..<2 {
            route.buttons.firstMatch.tap()
            let presented = expectation(for: NSPredicate(format: "value == %@", "Expanded"), evaluatedWith: route)
            wait(for: [presented], timeout: 10)
            // AVKit can announce presentation without showing its remote routing
            // UI on a simulator. A delegate flag is not proof that a sheet exists.
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let routingUI = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let headings = [app.staticTexts["AirPlay"], springboard.staticTexts["AirPlay"]]
                return headings.contains { $0.exists && $0.isHittable }
            }, object: nil)
            guard XCTWaiter().wait(for: [routingUI], timeout: 8) == .completed else {
                screenshot("38-airplay-routing-ui-unavailable")
                let hierarchy = XCTAttachment(string: app.debugDescription + "\n" + springboard.debugDescription)
                hierarchy.name = "AirPlay presentation prerequisite"
                hierarchy.lifetime = .keepAlways
                add(hierarchy)
                #if targetEnvironment(simulator)
                throw XCTSkip("The simulator announced AirPlay presentation but exposed no routing panel. System-panel dismissal remains a device-only check; native sheet and delegate clock tests run separately.")
                #else
                XCTFail("AirPlay did not show its routing panel after announcing presentation")
                return
                #endif
            }
            screenshot("38-airplay-title-suspended")
            // Tap above the system route sheet, without selecting or changing an output device.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.16)).tap()
            let dismissed = expectation(for: NSPredicate(format: "value == %@", "Collapsed"), evaluatedWith: route)
            wait(for: [dismissed], timeout: 10)
            XCTAssertTrue(title.isHittable)
            XCTAssertEqual(title.label, fullTitle)
            XCTAssertEqual(title.frame.width, titleFrame.width, accuracy: 0.5)
            XCTAssertEqual(title.frame.height, titleFrame.height, accuracy: 0.5)
            XCTAssertEqual(cover.frame.width, coverFrame.width, accuracy: 0.5)
            XCTAssertEqual(cover.frame.minY, coverFrame.minY, accuracy: 0.5)
            XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play", "closing AirPlay cannot resume a paused song")
        }
        screenshot("39-airplay-title-resumed")
    }

    func testFullTitleIsReadableWithoutWaitingForScrolling() {
        let app = launchCreditsPlayer()
        let title = app.buttons["player.title"]
        let full = title.label
        XCTAssertLessThan(title.frame.height, 60, "long song titles occupy one line")
        XCTAssertGreaterThanOrEqual(title.frame.height, 43.5, "the title has a full-height tap target")
        XCTAssertTrue(title.isHittable)
        XCTAssertEqual(title.staticTexts.count, 0, "moving text copies must not become separate accessibility elements")
        title.press(forDuration: 1.1)
        XCTAssertFalse(app.buttons["player.credits.done"].exists)
        let read = app.buttons["Full track title"]
        XCTAssertTrue(read.waitForExistence(timeout: 5))
        read.tap()
        let text = app.staticTexts["player.fullTitle"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertEqual(text.label, full)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
    }

    func testGalleryZoomKeepsPanningOnTheSelectedImage() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        signIn(app, password: "fixture-password")
        let album = app.buttons["album.network-mp3"]
        XCTAssertTrue(album.waitForExistence(timeout: 20))
        album.tap()
        let thumbnail = app.buttons["gallery.booklet-2"]
        reveal(thumbnail, in: app, scrolling: app.scrollViews["album.scroll"])
        XCTAssertTrue(thumbnail.isHittable)
        thumbnail.tap()
        let image = app.images["gallery-image"]
        let viewport = app.scrollViews["gallery-viewport"]
        XCTAssertTrue(image.waitForExistence(timeout: 15), "the authenticated gallery image must load")
        XCTAssertTrue(viewport.waitForExistence(timeout: 5))
        let selectedPage = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard app.images.matching(identifier: "gallery-image").count == 1,
                  image.exists, viewport.isHittable else { return false }
            return image.isHittable && abs(image.frame.midX - viewport.frame.midX) <= 1
                && app.windows.firstMatch.frame.contains(CGPoint(x: image.frame.midX, y: image.frame.midY))
        }, object: nil)
        guard XCTWaiter().wait(for: [selectedPage], timeout: 10) == .completed else {
            screenshot("33-gallery-selection-failed")
            XCTFail("Opening the second thumbnail must centre its image and expose only that page")
            return
        }
        waitForGallery(image, page: "2/2", zoomed: false)
        screenshot("33-gallery-fitted")

        image.pinch(withScale: 2.2, velocity: 1)
        waitForGallery(image, page: "2/2", zoomed: true)
        let beforePan = image.frame
        let start = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5))
        let end = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        let low = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
        let high = viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        low.press(forDuration: 0.05, thenDragTo: high)
        waitForGallery(image, page: "2/2", zoomed: true)
        XCTAssertGreaterThan(abs(image.frame.minX - beforePan.minX) + abs(image.frame.minY - beforePan.minY), 2,
                             "panning must move the enlarged image, not only suppress paging")
        screenshot("34-gallery-panned")

        viewport.doubleTap()
        waitForGallery(image, page: "2/2", zoomed: false)
        viewport.swipeRight()
        waitForGallery(image, page: "1/2", zoomed: false)
        // A location-aware double tap also targets the touched part of the image.
        viewport.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.35)).doubleTap()
        waitForGallery(image, page: "1/2", zoomed: true)
        viewport.swipeLeft()
        waitForGallery(image, page: "1/2", zoomed: true)
        viewport.doubleTap()
        waitForGallery(image, page: "1/2", zoomed: false)
        screenshot("35-gallery-reset")
    }

    private func waitForGallery(_ image: XCUIElement, page: String, zoomed: Bool) {
        let state = expectation(for: NSPredicate { _, _ in
            guard image.exists, let value = image.value as? String else { return false }
            let parts = value.components(separatedBy: ", ")
            guard parts.count == 2, parts[0] == page,
                  let scale = Double(parts[1].replacingOccurrences(of: "×", with: "")) else { return false }
            return zoomed ? scale > 1.05 : abs(scale - 1) < 0.02
        }, evaluatedWith: image)
        wait(for: [state], timeout: 10)
    }

    func testSingleGlobalSearchHasInsetsAndIncludesSongs() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["album.demo-1"].waitForExistence(timeout: 15))
        app.swipeDown()
        XCTAssertEqual(app.searchFields.count, 0, "the album page has no duplicate global search")
        openTab(app, "Search")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertEqual(app.searchFields.count, 1)
        XCTAssertFalse(app.navigationBars["Search"].buttons["Search"].exists,
                       "the search page must not add a second collapsed search button")
        focus(field)
        field.typeText("quiet room")
        XCTAssertTrue(app.buttons["track.demo-2-2"].waitForExistence(timeout: 10), "album keywords also find their songs")
        let album = element(app, "search.album.demo-2")
        XCTAssertTrue(album.exists)
        XCTAssertGreaterThan(album.frame.minX, app.windows.firstMatch.frame.minX + 8)
        XCTAssertGreaterThanOrEqual(field.frame.minX, app.windows.firstMatch.frame.minX + 8)
        screenshot("41-unified-search")
    }

    func testAppearanceSettingsApplyAndPersist() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-AppleLanguages", "(en)"]
        app.launch()
        XCTAssertTrue(app.buttons["settings.open"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["settings.open"].firstMatch.tap()
        let picker = app.buttons["settings.appearance"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        app.buttons["Light"].tap()
        screenshot("42-light-settings")
        app.buttons["Done"].firstMatch.tap()
        screenshot("42-light-library")
        app.buttons["settings.open"].firstMatch.tap()
        picker.tap()
        app.buttons["Dark"].tap()
        screenshot("43-dark-settings")
        app.buttons["Done"].firstMatch.tap()
        screenshot("43-dark-library")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["settings.open"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["settings.open"].firstMatch.tap()
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        XCTAssertTrue(picker.label.contains("Dark") || (picker.value as? String)?.contains("Dark") == true)
        picker.tap()
        app.buttons["Follow System"].tap()
        screenshot("44-system-appearance")
        app.buttons["Done"].firstMatch.tap()
    }

    func testTabletPlayerUsesWholeWindowAndReturnsFromQueue() {
        let app = launchCreditsPlayer()
        defer { XCUIDevice.shared.orientation = .portrait }
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            let rotated = expectation(for: NSPredicate { _, _ in
                let frame = app.windows.firstMatch.frame
                return orientation == .portrait ? frame.height > frame.width : frame.width > frame.height
            }, evaluatedWith: app)
            wait(for: [rotated], timeout: 10)
            let window = app.windows.firstMatch.frame
            let scroll = app.scrollViews["player.scroll"]
            XCTAssertTrue(scroll.waitForExistence(timeout: 10))
            if min(window.width, window.height) >= 600 {
                XCTAssertEqual(scroll.frame.minX, window.minX, accuracy: 2)
                XCTAssertEqual(scroll.frame.maxX, window.maxX, accuracy: 2)
                XCTAssertGreaterThan(scroll.frame.height, window.height * 0.75)
                XCTAssertLessThan(app.buttons["player.collapse"].frame.maxY, window.minY + 130)
                assertTabletPlayerBalance(app)
                if orientation == .landscapeLeft {
                    let cover = element(app, "player.cover").frame
                    let heading = app.buttons["player.title"].frame
                    let footer = app.buttons["player.queue"].frame
                    XCTAssertEqual(cover.midY, (heading.minY + footer.maxY) / 2, accuracy: 12,
                                   "landscape controls must be centered beside the cover")
                }
            }
            let title = app.buttons["player.title"].label
            app.buttons["player.queue"].tap()
            XCTAssertTrue(app.buttons["queue.close"].waitForExistence(timeout: 10))
            app.buttons["queue.close"].tap()
            XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
            XCTAssertEqual(app.buttons["player.title"].label, title)
            XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
            screenshot(orientation == .portrait ? "45-player-portrait" : "45-player-landscape")
        }
        app.buttons["player.collapse"].tap()
        XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 10))
    }

    private func assertTabletPlayerBalance(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let scroll = app.scrollViews["player.scroll"].frame
        let navigation = app.navigationBars.containing(.button, identifier: "player.collapse").firstMatch.frame
        let cover = element(app, "player.cover").frame
        let heading = app.buttons["player.title"].frame
        let footer = app.buttons["player.queue"].frame
        let composition = cover.union(heading).union(footer)
        // AX reports the ScrollView behind the navigation bar too. Measure below
        // that bar, allowing the bottom gesture inset and control hit-area rounding.
        let visibleTop = max(scroll.minY, navigation.maxY)
        let visibleCenter = (visibleTop + scroll.maxY) / 2
        XCTAssertEqual(composition.midY, visibleCenter, accuracy: 24,
                       "balanced tablet content: content=\(composition), navigation=\(navigation), scroll=\(scroll)",
                       file: file, line: line)
        XCTAssertGreaterThanOrEqual(composition.minY, visibleTop, file: file, line: line)
        XCTAssertLessThanOrEqual(composition.maxY, scroll.maxY, file: file, line: line)
    }

    func testAlbumAndSongSharingUseNativeSheetWithoutChangingPlayback() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)"]
        app.launch()
        signIn(app, password: "fixture-password")
        XCTAssertTrue(app.buttons["album.network-mp3"].waitForExistence(timeout: 20))
        app.buttons["album.network-mp3"].tap()
        app.buttons["album.menu"].tap()
        XCTAssertTrue(app.buttons["album.share"].waitForExistence(timeout: 5))
        app.buttons["album.share"].tap()
        XCTAssertTrue(app.cells.matching(NSPredicate(format: "label == %@", "Copy")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Close"].firstMatch.isHittable)
        screenshot("46-album-share")
        app.buttons["Close"].firstMatch.tap()
        app.buttons["album.play"].tap()
        XCTAssertTrue(app.buttons["player.expand"].waitForExistence(timeout: 15))
        app.buttons["Pause"].firstMatch.tap()
        app.buttons["player.expand"].tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        let title = app.buttons["player.title"].label
        app.buttons["player.more"].tap()
        app.buttons["player.share"].tap()
        XCTAssertTrue(app.cells.matching(NSPredicate(format: "label == %@", "Copy")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Close"].firstMatch.isHittable)
        screenshot("46-song-share")
        app.buttons["Close"].firstMatch.tap()
        XCTAssertTrue(app.buttons["player.title"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["player.title"].label, title)
        XCTAssertEqual(app.buttons["player.toggle"].firstMatch.label, "Play")
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
