import XCTest
@testable import Mihonban

private struct PrefetchDecoderSnapshot: Decodable {
    struct Request: Decodable {
        let start: Int
        let status: Int
    }
    let active: Int
    let metadataSent: Int
    let metadataBytes: Int
    let drops: Int
    let requests: [Request]
}

@MainActor
private final class PrefetchDecoderFixture {
    let token = UUID().uuidString
    let defaultsName = "org.mihonban.prefetch-decoder.\(UUID().uuidString)"
    let api: APIClient
    let player = PlayerModel(monitorNetwork: false)
    let current: Track
    let next: Track

    init() throws {
        api = try APIClient(address: "http://127.0.0.1:8766")
        current = Track(id: "network-flac-rendering-\(token)", title: "Current real audio", duration: 8, format: "flac")
        next = Track(id: "network-flac-prefetch-failure-\(token)", title: "Metadata-only next audio", duration: 8, format: "flac")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        let settings = CacheSettings(defaults: defaults)
        settings.enabled = false
        settings.preloadPolicy = .always
        player.cache = settings
        player.updatePreloadNetwork(PreloadNetwork(connected: true, wifiOrEthernet: true))
        player.connect(api)
    }

    var control: URL { api.url("fixture", "prefetch-decoder", token) }

    func snapshot() async throws -> PrefetchDecoderSnapshot {
        let (data, response) = try await api.session.data(from: control)
        try APIClient.validate(response)
        return try JSONDecoder().decode(PrefetchDecoderSnapshot.self, from: data)
    }

    func release(failing: Bool, recoverCurrent: Bool = false) async throws {
        let action = recoverCurrent ? "fail-recover" : failing ? "fail" : "release"
        var request = URLRequest(url: control.appendingPathComponent(action))
        request.httpMethod = "POST"
        let (_, response) = try await api.session.data(for: request)
        try APIClient.validate(response)
    }

    func start() async throws {
        _ = try await api.login(password: "fixture-password")
        player.play([current, next])
    }

    func cleanup() async {
        player.stop()
        player.setForeground(false)
        try? await release(failing: true)
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            if (try? await snapshot().active) == 0 { break }
            try? await Task.sleep(for: .milliseconds(20))
        }
        UserDefaults(suiteName: defaultsName)?.removePersistentDomain(forName: defaultsName)
    }
}

// Both native suites select PlaybackCompletionTests. The server sends valid
// FLAC metadata, then holds every PCM frame until the test releases its gate.
extension PlaybackCompletionTests {
    private func prefetchedDecoderAtRealEOF() async throws -> PrefetchDecoderFixture {
        let fixture = try PrefetchDecoderFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.start()
        try await waitForPrefetchedDecoder {
            fixture.player.elapsed > 0.1 && !fixture.player.isLoading && fixture.player.preparedNextID == fixture.next.id
        }
        let held = try await fixture.snapshot()
        XCTAssertGreaterThan(held.metadataSent, 0)
        XCTAssertGreaterThan(held.metadataBytes, 42, "Send complete STREAMINFO and all remaining FLAC metadata")
        XCTAssertEqual(held.drops, 0)
        XCTAssertGreaterThan(held.active, 0)
        XCTAssertNil(fixture.player.error)
        try await waitForPrefetchedDecoder { fixture.player.lastDecodingTrackIDForTesting == fixture.next.id }
        try await waitForPrefetchedDecoder { fixture.player.lastCompletedTrackIDForTesting == fixture.current.id }
        XCTAssertEqual(fixture.player.current?.id, fixture.current.id)
        XCTAssertEqual(fixture.player.preparedNextID, fixture.next.id, "The next decoder must already be enqueued before the read fails")
        XCTAssertEqual(fixture.player.lastDecodingTrackIDForTesting, fixture.next.id, "The failure must occur during actual PCM decoding, after decoder.open")
        XCTAssertTrue(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        XCTAssertNil(fixture.player.error)
        return fixture
    }

    private func earlyFailedPrefetchWithPausedCurrent() async throws -> PrefetchDecoderFixture {
        let fixture = try PrefetchDecoderFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.start()
        try await waitForPrefetchedDecoder {
            fixture.player.lastDecodingTrackIDForTesting == fixture.next.id &&
                fixture.player.preparedNextID == fixture.next.id
        }
        // B starts decoding while A's final chunks remain in the shared ring
        // buffer. Pause immediately so the real network retry cannot outlast
        // that tail and accidentally turn this into an after-EOF regression.
        fixture.player.pause()
        let pausedPosition = fixture.player.elapsed
        guard fixture.player.current?.id == fixture.current.id,
              fixture.player.lastCompletedTrackIDForTesting != fixture.current.id,
              fixture.player.duration - pausedPosition > 0.05 else {
            XCTFail("Pause must retain unrendered A audio before releasing B's first PCM read")
            throw NSError(domain: "PrefetchedDecoderFailureTests", code: 2)
        }
        XCTAssertGreaterThan(pausedPosition, 0.1)
        let held = try await fixture.snapshot()
        XCTAssertGreaterThan(held.metadataBytes, 42)
        XCTAssertGreaterThan(held.active, 0)
        XCTAssertEqual(held.drops, 0)
        XCTAssertNil(fixture.player.error)

        try await fixture.release(failing: true, recoverCurrent: true)
        try await waitForPrefetchedDecoder { fixture.player.preparedNextID == nil }
        let failure = try await fixture.snapshot()
        XCTAssertEqual(failure.requests.map(\.status), [206, 404],
                       "B must fail its first PCM read and ranged retry before A resumes")
        XCTAssertEqual(failure.drops, 1)
        XCTAssertEqual(failure.active, 0)
        XCTAssertEqual(fixture.player.current?.id, fixture.current.id)
        XCTAssertNotEqual(fixture.player.lastCompletedTrackIDForTesting, fixture.current.id)
        XCTAssertEqual(fixture.player.elapsed, pausedPosition, accuracy: 0.05)
        XCTAssertFalse(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        XCTAssertFalse(fixture.player.isLoading)
        XCTAssertNil(fixture.player.error)
        return fixture
    }

    func testEarlyPrefetchedDecoderFailurePreservesPausedCurrentAudioUntilRealEOF() async throws {
        let fixture = try await earlyFailedPrefetchWithPausedCurrent()
        fixture.player.resume()
        XCTAssertEqual(fixture.player.current?.id, fixture.current.id,
                       "Resuming must first play A's remaining audio")
        try await waitForPrefetchedDecoder {
            fixture.player.current?.id == fixture.next.id && fixture.player.elapsed > 0.3 && !fixture.player.isLoading
        }
        XCTAssertTrue(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        XCTAssertNil(fixture.player.error)
        let recovered = try await fixture.snapshot()
        XCTAssertEqual(recovered.requests.map(\.status), [206, 404, 206],
                       "B is retried once as current after A finishes its retained audio")
        XCTAssertEqual(recovered.requests.last?.start, 0)
    }

    func testRemovingEarlyFailedPrefetchAllowsPausedCurrentAudioToFinish() async throws {
        let fixture = try await earlyFailedPrefetchWithPausedCurrent()
        fixture.player.removeUpcoming(at: IndexSet(integer: 0))
        XCTAssertFalse(fixture.player.hasEnded, "Removing B must preserve A's unrendered tail")
        XCTAssertFalse(fixture.player.wantsPlayback)
        fixture.player.resume()
        try await waitForPrefetchedDecoder { fixture.player.hasEnded }

        XCTAssertEqual(fixture.player.current?.id, fixture.current.id)
        XCTAssertEqual(fixture.player.lastCompletedTrackIDForTesting, fixture.current.id,
                       "A must reach a real renderingComplete after the early B failure")
        XCTAssertEqual(fixture.player.elapsed, fixture.player.duration, accuracy: 0.05)
        XCTAssertFalse(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.isLoading)
        XCTAssertNil(fixture.player.error)
        let finished = try await fixture.snapshot()
        XCTAssertEqual(finished.requests.map(\.status), [206, 404], "Removed B must not be retried")
    }

    func testPrefetchedDecoderFailureAfterActualEOFAdvancesToARetriableCurrentError() async throws {
        let fixture = try await prefetchedDecoderAtRealEOF()
        try await fixture.release(failing: true)
        try await waitForPrefetchedDecoder {
            fixture.player.current?.id == fixture.next.id && fixture.player.error != nil && !fixture.player.isLoading
        }
        let failure = try await fixture.snapshot()
        XCTAssertGreaterThanOrEqual(failure.drops, 1)
        XCTAssertGreaterThanOrEqual(failure.requests.filter { $0.status == 404 }.count, 2,
                                   "The prepared decoder's ranged retry and the current-track retry must both fail genuinely")
        XCTAssertFalse(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        XCTAssertNil(fixture.player.preparedNextID)
        let before = failure.requests.count
        fixture.player.resume()
        try await waitForPrefetchedDecoder {
            let log = try await fixture.snapshot()
            return log.requests.count > before && fixture.player.error != nil && !fixture.player.isLoading
        }
        XCTAssertEqual(fixture.player.current?.id, fixture.next.id, "Play retries the failed track without returning to exhausted A")
    }

    func testPausingAfterActualEOFPreservesPauseWhenThePrefetchedDecoderFails() async throws {
        let fixture = try await prefetchedDecoderAtRealEOF()
        fixture.player.pause()
        XCTAssertFalse(fixture.player.wantsPlayback)
        try await fixture.release(failing: true, recoverCurrent: true)
        try await waitForPrefetchedDecoder {
            fixture.player.current?.id == fixture.next.id && fixture.player.error == nil && !fixture.player.isLoading
        }
        XCTAssertFalse(fixture.player.wantsPlayback, "Resolving the exhausted queue must preserve an explicit pause")
        XCTAssertNil(fixture.player.preparedNextID)
        let failure = try await fixture.snapshot()
        XCTAssertEqual(failure.requests.filter { $0.status == 404 }.count, 1,
                       "Only the aborted prefetched source fails; B succeeds when reopened as current")
        XCTAssertEqual(failure.requests.last?.status, 206)
        XCTAssertEqual(failure.requests.last?.start, 0)
        let position = fixture.player.elapsed
        try await Task.sleep(for: .milliseconds(600))
        XCTAssertNil(fixture.player.error)
        XCTAssertFalse(fixture.player.wantsPlayback, "Successful preparation must not resume a paused player")
        XCTAssertEqual(fixture.player.elapsed, position, accuracy: 0.05)
        fixture.player.resume()
        try await waitForPrefetchedDecoder { fixture.player.elapsed > position + 0.3 && !fixture.player.isLoading }
        XCTAssertEqual(fixture.player.current?.id, fixture.next.id)
        XCTAssertTrue(fixture.player.wantsPlayback)
        XCTAssertNil(fixture.player.error)
    }

    func testRepeatedPlayDuringPrefetchedDecoderFailureRecoversTheSameNextTrack() async throws {
        let fixture = try await prefetchedDecoderAtRealEOF()
        try await fixture.release(failing: true, recoverCurrent: true)
        var playRequests = 0
        var reachedNext = false
        try await waitForPrefetchedDecoder {
            // Repeated taps race the actual transport retry, decoding-aborted
            // callback and engine stop, without synthesizing those callbacks.
            XCTAssertNil(fixture.player.error, "A successful current retry must not expose a transient playback failure")
            fixture.player.resume()
            playRequests += 1
            if fixture.player.current?.id == fixture.next.id { reachedNext = true }
            if reachedNext {
                XCTAssertEqual(fixture.player.current?.id, fixture.next.id,
                               "Once B becomes current, a late failure or play command must not return to A")
            } else {
                XCTAssertEqual(fixture.player.current?.id, fixture.current.id)
            }
            XCTAssertNil(fixture.player.error, "The recovered current request succeeds throughout repeated Play commands")
            return reachedNext && fixture.player.elapsed > 0.3 && !fixture.player.isLoading
        }
        XCTAssertGreaterThan(playRequests, 2, "Exercise repeated commands while the real failure crosses its callback boundary")
        XCTAssertTrue(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        let position = fixture.player.elapsed
        try await waitForPrefetchedDecoder { fixture.player.elapsed > position + 0.4 }
        XCTAssertEqual(fixture.player.current?.id, fixture.next.id)
        XCTAssertNil(fixture.player.error)
        XCTAssertTrue(fixture.player.wantsPlayback)
        let recovered = try await fixture.snapshot()
        XCTAssertEqual(recovered.requests.map(\.status), [206, 404, 206],
                       "Repeated Play must not loop through source failures or reopen the next track repeatedly")
        XCTAssertEqual(recovered.requests.last?.start, 0)
    }

    func testStoppingAfterActualEOFRetiresTheHeldPrefetchedDecoder() async throws {
        let fixture = try await prefetchedDecoderAtRealEOF()
        fixture.player.stop()
        let before = try await fixture.snapshot()
        try await fixture.release(failing: true)
        try await waitForPrefetchedDecoder { try await fixture.snapshot().active == 0 }
        // The source's first retry delay is 0.5 seconds. Observe beyond it to
        // verify cancellation cannot recreate either a transfer or the queue.
        try await Task.sleep(for: .milliseconds(900))
        let after = try await fixture.snapshot()
        XCTAssertEqual(after.requests.count, before.requests.count)
        XCTAssertNil(fixture.player.current)
        XCTAssertTrue(fixture.player.queue.tracks.isEmpty)
        XCTAssertNil(fixture.player.error)
        XCTAssertFalse(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.isLoading)
    }

    func testHeldPrefetchedDecoderStartsNormallyAfterActualEOFWhenBytesArrive() async throws {
        let fixture = try await prefetchedDecoderAtRealEOF()
        try await fixture.release(failing: false)
        try await waitForPrefetchedDecoder {
            fixture.player.current?.id == fixture.next.id && fixture.player.elapsed > 0.3 && !fixture.player.isLoading
        }
        XCTAssertTrue(fixture.player.wantsPlayback)
        XCTAssertFalse(fixture.player.hasEnded)
        XCTAssertNil(fixture.player.error)
        let success = try await fixture.snapshot()
        XCTAssertEqual(success.drops, 0)
        XCTAssertTrue(success.requests.allSatisfy { $0.status == 206 })
    }

    private func waitForPrefetchedDecoder(_ condition: () async throws -> Bool,
                                         file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(18))
        while ContinuousClock.now < deadline {
            if try await condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The real decoder did not reach its gated prefetch boundary", file: file, line: line)
        throw NSError(domain: "PrefetchedDecoderFailureTests", code: 1)
    }
}
