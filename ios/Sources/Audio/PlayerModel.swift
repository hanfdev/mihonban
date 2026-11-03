import AVFAudio
import MediaPlayer
import Network
import Observation
@preconcurrency import SFBAudioEngine

final class PreparedAudio: @unchecked Sendable {
    let decoder: AudioDecoder
    let source: MBHTTPInputSource?
    init(decoder: AudioDecoder, source: MBHTTPInputSource?) { self.decoder = decoder; self.source = source }
}

@MainActor @Observable
final class PlayerModel: NSObject {
    private(set) var queue = PlaybackQueue()
    private(set) var current: Track?
    private(set) var wantsPlayback = false
    private(set) var isLoading = false
    private(set) var isSeeking = false
    private(set) var elapsed: Double = 0
    private(set) var duration: Double = 0
    private(set) var buffered: Double = 0
    var error: String?
    var isExpanded = false

    @ObservationIgnored private let engine = AudioPlayer()
    @ObservationIgnored private var client: APIClient?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var entries: [ObjectIdentifier: Entry] = [:]
    @ObservationIgnored private var pending: [UUID: MBHTTPInputSource] = [:]
    @ObservationIgnored private var tickTask: Task<Void, Never>?
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var prefetchAllowed = false
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?
    @ObservationIgnored private var demoURL: URL?
    @ObservationIgnored private var foreground = true
    @ObservationIgnored private var nextIsPreparing = false

    private struct Entry {
        let audio: PreparedAudio
        let queue: PlaybackQueue
        let generation: UUID
    }

    override init() {
        super.init()
        engine.delegate = self
        installRemoteCommands()
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification,
            object: nil, queue: .main) { [weak self] notification in
                let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
                if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    Task { @MainActor in self?.pause() }
                }
            })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification,
            object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.stop()
                    self?.error = L10n.text("mobile.audioReset")
                }
            })
        monitor.pathUpdateHandler = { [weak self] path in
            let allowed = path.status == .satisfied && !path.isExpensive && !path.isConstrained
            Task { @MainActor in
                self?.prefetchAllowed = allowed
                if allowed { self?.prepareNext() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "org.mihonban.network"))
        setForeground(true)
    }

    func connect(_ client: APIClient, demoURL: URL? = nil) {
        stop()
        self.client = client
        self.demoURL = demoURL
    }

    func play(_ tracks: [Track], index: Int = 0, shuffle: Bool = false) {
        guard tracks.indices.contains(index), client != nil else { return }
        queue.replace(tracks, startingAt: index, shuffle: shuffle)
        wantsPlayback = true
        beginCurrent()
    }

    private func beginCurrent() {
        generation = UUID()
        cancelTransfers()
        engine.stop()
        entries.removeAll()
        current = queue.current
        error = nil
        elapsed = 0
        duration = current?.duration ?? 0
        buffered = 0
        isSeeking = false
        isLoading = current != nil
        artwork = nil
        updateNowPlaying()
        loadArtwork()
        guard current != nil else { return }
        prepare(queue, immediate: true)
    }

    private func prepare(_ snapshot: PlaybackQueue, immediate: Bool) {
        guard let client, let track = snapshot.current else { return }
        let token = generation
        let requestID = UUID()
        let local = demoURL
        let source: MBHTTPInputSource?
        if local != nil { source = nil }
        else {
            let cache = client.cacheDirectory.appendingPathComponent("audio", isDirectory: true)
                .appendingPathComponent(digest(track.id)).appendingPathExtension(track.fileExtension)
            source = MBHTTPInputSource(remoteURL: client.url("api", "stream", track.id), cacheURL: cache)
            pending[requestID] = source
        }
        if !immediate { nextIsPreparing = true }
        // Decoder open may probe a distant file offset. Never let it block UI.
        let sourceBox = SourceBox(source)
        Task.detached(priority: immediate ? .userInitiated : .utility) { [weak self] in
            let result: Result<PreparedAudio, Error>
            do {
                let decoder: AudioDecoder
                if let local { decoder = try AudioDecoder(url: local) }
                else if let source = sourceBox.value {
                    let suffix: String
                    switch track.fileExtension {
                    case "flac": suffix = "FLAC"
                    case "ogg", "oga": suffix = "OggVorbis"
                    case "opus": suffix = "OggOpus"
                    default: suffix = "CoreAudio"
                    }
                    decoder = try AudioDecoder(inputSource: source,
                        decoderName: AudioDecoder.Name(rawValue: "org.sbooth.AudioEngine.Decoder." + suffix))
                } else { throw ClientError.connection }
                try decoder.open()
                result = .success(PreparedAudio(decoder: decoder, source: sourceBox.value))
            } catch { result = .failure(error) }
            await self?.prepared(result, snapshot: snapshot, requestID: requestID, token: token, immediate: immediate)
        }
    }

    private func prepared(_ result: Result<PreparedAudio, Error>, snapshot: PlaybackQueue,
                          requestID: UUID, token: UUID, immediate: Bool) {
        let source = pending.removeValue(forKey: requestID)
        guard token == generation else {
            source?.cancel()
            if case .success(let audio) = result { audio.source?.cancel() }
            return
        }
        if !immediate { nextIsPreparing = false }
        switch result {
        case .success(let audio):
            let id = ObjectIdentifier(audio.decoder)
            entries[id] = Entry(audio: audio, queue: snapshot, generation: token)
            do {
                try engine.enqueue(audio.decoder, immediate: immediate)
                if immediate {
                    isLoading = false
                    if wantsPlayback { try activateAndPlay() }
                    updateNowPlaying()
                    prepareNext()
                }
            } catch {
                entries.removeValue(forKey: id)
                audio.source?.cancel()
                fail()
            }
        case .failure:
            source?.cancel()
            if immediate { fail() }
            // A failed prefetch is retried only when that track becomes current.
        }
    }

    private func prepareNext() {
        guard prefetchAllowed, wantsPlayback, !isLoading, !nextIsPreparing,
              entries.count == 1, pending.isEmpty,
              let next = queue.nextSnapshot(), next.current?.id != current?.id else { return }
        prepare(next, immediate: false)
    }

    func toggle() { wantsPlayback ? pause() : resume() }

    func pause() {
        wantsPlayback = false
        engine.pause()
        updateNowPlaying()
    }

    func resume() {
        guard current != nil else { return }
        wantsPlayback = true
        error = nil
        if !isLoading {
            if entries.isEmpty { beginCurrent() }
            else { do { try activateAndPlay() } catch { fail() } }
        }
        updateNowPlaying()
        prepareNext()
    }

    private func activateAndPlay() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try session.setActive(true)
        try engine.play()
    }

    func next() {
        if queue.advance() { wantsPlayback = true; beginCurrent() }
        else { pause() }
    }

    func previous() {
        if elapsed > 3 { seek(to: 0) }
        else if queue.previous() { wantsPlayback = true; beginCurrent() }
        else { seek(to: 0) }
    }

    func seek(to value: Double) {
        guard !isLoading, engine.supportsSeeking, value.isFinite else { return }
        isSeeking = true
        if engine.seek(time: min(max(0, value), max(0, duration - 0.05))) {
            elapsed = value
            updateNowPlaying()
        } else { isSeeking = false; error = L10n.text("player.seekFailed") }
    }

    func toggleShuffle() {
        let position = elapsed
        let playing = wantsPlayback
        queue.setShuffle(!queue.shuffled)
        // Predecoded audio cannot be removed by clearQueue. Rebuild at the same
        // position so changing the order never plays an obsolete next decoder.
        restart(at: position, playing: playing)
    }

    func cycleRepeat() {
        let position = elapsed
        let playing = wantsPlayback
        queue.repeatMode = PlaybackQueue.RepeatMode(rawValue: (queue.repeatMode.rawValue + 1) % 3) ?? .off
        restart(at: position, playing: playing)
    }

    @ObservationIgnored private var restorePosition: Double?
    private func restart(at position: Double, playing: Bool) {
        guard current != nil else { return }
        wantsPlayback = playing
        beginCurrent()
        restorePosition = position > 0 ? position : nil
    }

    func stop() {
        generation = UUID()
        cancelTransfers()
        engine.stop()
        entries.removeAll()
        current = nil
        queue = PlaybackQueue()
        wantsPlayback = false
        isLoading = false
        isSeeking = false
        restorePosition = nil
        artworkTask?.cancel()
        artwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func cancelTransfers() {
        pending.values.forEach { $0.cancel() }
        pending.removeAll()
        entries.values.forEach { $0.audio.source?.cancel() }
        nextIsPreparing = false
    }

    private func fail() {
        wantsPlayback = false
        isLoading = false
        isSeeking = false
        error = L10n.text("mobile.playbackFailed")
        cancelTransfers()
        engine.stop()
        entries.removeAll()
        updateNowPlaying()
    }

    func setForeground(_ active: Bool) {
        foreground = active
        tickTask?.cancel()
        tickTask = nil
        if active {
            tickTask = Task { [weak self] in
                while !Task.isCancelled {
                    self?.tick()
                    try? await Task.sleep(for: .milliseconds(500))
                }
            }
        }
    }

    private func tick() {
        if let time = engine.currentTime, time.isFinite, !isSeeking { elapsed = max(0, time) }
        if let total = engine.totalTime, total.isFinite, total > 0 { duration = total }
        if let decoder = engine.nowPlaying, let entry = entries[ObjectIdentifier(decoder as AnyObject)] {
            buffered = entry.audio.source?.downloadedFraction ?? 1
        }
    }

    private func rendered(_ id: ObjectIdentifier) {
        guard let entry = entries[id], entry.generation == generation else { return }
        let changed = current?.id != entry.queue.current?.id
        queue = entry.queue
        current = queue.current
        isLoading = false
        if changed {
            elapsed = 0
            duration = current?.duration ?? 0
            artwork = nil
            loadArtwork()
        }
        if let position = restorePosition {
            restorePosition = nil
            seek(to: position)
        }
        // The previous decoder may still be reporting completion on its queue.
        for (key, old) in entries where key != id && old.queue.cursor < queue.cursor {
            old.audio.source?.cancel()
            entries.removeValue(forKey: key)
        }
        updateNowPlaying()
        prepareNext()
    }

    private func ended() {
        guard !isLoading, current != nil else { return }
        if nextIsPreparing { return }
        if queue.advance(automatic: true) { beginCurrent() }
        else { pause(); elapsed = duration; updateNowPlaying() }
    }

    private func updateNowPlaying() {
        guard let track = current else { return }
        var info: [String: Any] = [MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist ?? "",
            MPMediaItemPropertyAlbumTitle: track.albumTitle ?? "",
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: wantsPlayback && !isLoading ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork() {
        artworkTask?.cancel()
        guard let client, let track = current, let album = track.albumId, demoURL == nil else { return }
        artworkTask = Task { [weak self] in
            guard let image = await ArtworkStore.shared.image(url: client.artworkURL(album, size: 480),
                session: client.session, pixels: 640), !Task.isCancelled, self?.current?.id == track.id else { return }
            self?.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self?.updateNowPlaying()
        }
    }

    private func installRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        let actions: [(MPRemoteCommand, @MainActor (PlayerModel) -> Void)] = [
            (commands.playCommand, { $0.resume() }), (commands.pauseCommand, { $0.pause() }),
            (commands.togglePlayPauseCommand, { $0.toggle() }),
            (commands.nextTrackCommand, { $0.next() }), (commands.previousTrackCommand, { $0.previous() })]
        for (command, action) in actions {
            command.isEnabled = true
            let token = command.addTarget { [weak self] _ in
                Task { @MainActor in if let self { action(self) } }
                return .success
            }
            remoteTargets.append((command, token))
        }
        commands.changePlaybackPositionCommand.isEnabled = true
        let token = commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let time = event.positionTime
            Task { @MainActor in self?.seek(to: time) }
            return .success
        }
        remoteTargets.append((commands.changePlaybackPositionCommand, token))
    }
}

private final class SourceBox: @unchecked Sendable {
    let value: MBHTTPInputSource?
    init(_ value: MBHTTPInputSource?) { self.value = value }
}

extension PlayerModel: AudioPlayer.Delegate {
    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, renderingStarted decoder: any PCMDecoding) {
        let id = ObjectIdentifier(decoder as AnyObject)
        Task { @MainActor [weak self] in self?.rendered(id) }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, decodingStarted decoder: any PCMDecoding) {
        let id = ObjectIdentifier(decoder as AnyObject)
        Task { @MainActor [weak self] in
            guard let self, self.entries[id]?.queue.current?.id == self.current?.id else { return }
            if let position = self.restorePosition {
                self.restorePosition = nil
                self.seek(to: position)
            }
        }
    }

    nonisolated func audioPlayerEndOfAudio(_ audioPlayer: AudioPlayer) {
        Task { @MainActor [weak self] in self?.ended() }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, didSeek decoder: any PCMDecoding, toFrame frame: AVAudioFramePosition) {
        let id = ObjectIdentifier(decoder as AnyObject)
        Task { @MainActor [weak self] in
            guard let self, self.entries[id]?.queue.current?.id == self.current?.id else { return }
            self.isSeeking = false
            self.tick()
            self.updateNowPlaying()
        }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, decodingAborted decoder: any PCMDecoding,
                                 error: Error, framesRendered: AVAudioFramePosition) {
        let id = ObjectIdentifier(decoder as AnyObject)
        Task { @MainActor [weak self] in
            guard let self, let entry = self.entries[id] else { return }
            entry.audio.source?.cancel()
            self.entries.removeValue(forKey: id)
            if entry.queue.current?.id == self.current?.id { self.fail() }
        }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, encounteredError error: Error) {
        Task { @MainActor [weak self] in self?.fail() }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, playbackStateChanged playbackState: AudioPlayer.PlaybackState) {
        let paused = playbackState == .paused
        Task { @MainActor [weak self] in
            guard let self, paused else { return }
            self.updateNowPlaying()
        }
    }

    nonisolated func audioPlayer(_ audioPlayer: AudioPlayer, audioSessionInterruption userInfo: [AnyHashable: Any]?) {
        let type = (userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) ?? 0
        let options = (userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
        if type == AVAudioSession.InterruptionType.ended.rawValue &&
            options & AVAudioSession.InterruptionOptions.shouldResume.rawValue != 0 {
            do { try AVAudioSession.sharedInstance().setActive(true) }
            catch { audioPlayer.pause() }
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue {
                self.updateNowPlaying()
            } else if !self.engine.isPlaying {
                self.wantsPlayback = false
                self.updateNowPlaying()
            }
        }
    }
}
