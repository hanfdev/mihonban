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
    @ObservationIgnored private var preloadNetwork = PreloadNetwork()
    @ObservationIgnored private var nextRequestID: UUID?
    @ObservationIgnored private var nextTrackID: String?
    private(set) var playbackIntent = UUID()
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var remoteTargets: [(MPRemoteCommand, Any)] = []
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var artwork: MPMediaItemArtwork?
    @ObservationIgnored private var demoURL: URL?
    @ObservationIgnored private var foreground = true
    @ObservationIgnored private var nextIsPreparing = false
    @ObservationIgnored private var waitingForNext = false
    @ObservationIgnored private var activeID: ObjectIdentifier?
    @ObservationIgnored private var interrupted = false
    @ObservationIgnored private var initialPosition: Double = 0
    @ObservationIgnored var cache: CacheSettings?
    @ObservationIgnored var media: MediaCache?
    @ObservationIgnored var downloads: DownloadStore?
    // Tracks whose streamed file finished, so the cache is pruned once per write.
    @ObservationIgnored private var completedWrites: Set<String> = []
    // Predecoded next tracks removed after a queue edit. If the engine had
    // already started one, it is replaced as soon as it begins rendering. The
    // audio is retained so its identifier cannot be reused by a new decoder.
    @ObservationIgnored private var discarded: [ObjectIdentifier: PreparedAudio] = [:]

    private struct Entry {
        let audio: PreparedAudio
        var queue: PlaybackQueue
        let generation: UUID
        // True while the entry holds the predecoded next track, not the current one.
        var isNext: Bool
    }

    override convenience init() { self.init(monitorNetwork: true) }

    init(monitorNetwork: Bool) {
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
            let network = PreloadNetwork(connected: path.status == .satisfied,
                wifiOrEthernet: path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet),
                expensive: path.isExpensive, constrained: path.isConstrained)
            Task { @MainActor in self?.updatePreloadNetwork(network) }
        }
        if monitorNetwork { monitor.start(queue: DispatchQueue(label: "org.mihonban.network")) }
        setForeground(true)
    }

    func connect(_ client: APIClient, demoURL: URL? = nil) {
        stop()
        self.client = client
        self.demoURL = demoURL
    }

    // Without an index, Play all starts at the first track, or at a random one
    // while shuffle is on. A nil shuffle keeps the mode the user chose.
    func play(_ tracks: [Track], index: Int? = nil, shuffle: Bool? = nil) {
        playbackIntent = UUID()
        guard !tracks.isEmpty, client != nil else { return }
        let start = index ?? ((shuffle ?? queue.shuffled) ? Int.random(in: tracks.indices) : 0)
        guard tracks.indices.contains(start) else { return }
        queue.replace(tracks, startingAt: start, shuffle: shuffle)
        wantsPlayback = true
        beginCurrent()
    }

    private func beginCurrent(at position: Double = 0) {
        waitingForNext = false
        generation = UUID()
        cancelTransfers()
        engine.stop()
        entries.removeAll()
        discarded.removeAll()
        activeID = nil
        initialPosition = position
        current = queue.current
        error = nil
        elapsed = position
        duration = current?.duration ?? 0
        buffered = 0
        isSeeking = false
        isLoading = current != nil
        artwork = nil
        updateNowPlaying()
        loadArtwork()
        guard current != nil else { return }
        prepare(queue, immediate: true)
        media?.prune(protecting: protectedFiles)
    }

    // The current and next track are never evicted while they are in use.
    var protectedFiles: Set<String> {
        Set([queue.current, queue.nextSnapshot()?.current].compactMap { $0 }.map(MediaPaths.audioName))
    }

    private func prepare(_ snapshot: PlaybackQueue, immediate: Bool) {
        guard let client, let track = snapshot.current else { return }
        let token = generation
        let requestID = UUID()
        let local = demoURL
        let position = immediate ? initialPosition : 0
        let source: MBHTTPInputSource?
        if local != nil { source = nil }
        else if let downloaded = downloads?.localFile(track) {
            // A complete local file is opened directly; the remote URL is only
            // used if the file disappeared between this check and the open.
            source = MBHTTPInputSource(remoteURL: client.url("api", "stream", track.id), cacheURL: downloaded, persistent: true)
            pending[requestID] = source
        } else {
            let directory = media?.audioDirectory ?? client.cacheDirectory.appendingPathComponent("audio", isDirectory: true)
            let cacheFile = directory.appendingPathComponent(MediaPaths.audioName(track))
            media?.touch(cacheFile)
            source = MBHTTPInputSource(remoteURL: client.url("api", "stream", track.id), cacheURL: cacheFile,
                                       persistent: cache?.enabled ?? true)
            pending[requestID] = source
        }
        if !immediate {
            nextIsPreparing = true
            nextRequestID = requestID
            nextTrackID = track.id
            source?.unmeteredOnly = (cache?.preloadPolicy ?? .automatic) == .automatic
        }
        // Decoder open may probe a distant file offset. Never let it block UI.
        let sourceBox = SourceBox(source)
        Task.detached(priority: immediate ? .userInitiated : .utility) { [weak self] in
            let result: Result<PreparedAudio, Error>
            do {
                let decoder: AudioDecoder
                if let local { decoder = try AudioDecoder(url: local) }
                else if let source = sourceBox.value {
                    decoder = try AudioDecoder(inputSource: source, decoderName: MBDecoderNameForExtension(track.fileExtension))
                } else { throw ClientError.connection }
                try decoder.open()
                if position > 0 && decoder.supportsSeeking {
                    let frame = AVAudioFramePosition(position * decoder.processingFormat.sampleRate)
                    try decoder.seek(to: min(frame, max(0, decoder.length - 1)))
                }
                result = .success(PreparedAudio(decoder: decoder, source: sourceBox.value))
            } catch { result = .failure(error) }
            await self?.prepared(result, snapshot: snapshot, requestID: requestID, token: token, immediate: immediate)
        }
    }

    private func prepared(_ result: Result<PreparedAudio, Error>, snapshot: PlaybackQueue,
                          requestID: UUID, token: UUID, immediate: Bool) {
        let source = pending.removeValue(forKey: requestID)
        guard token == generation, immediate || nextRequestID == requestID else {
            source?.cancel()
            if case .success(let audio) = result { audio.source?.cancel() }
            return
        }
        if !immediate { nextIsPreparing = false; nextRequestID = nil; nextTrackID = nil }
        switch result {
        case .success(let audio):
            // The queue may have been edited while decoding. The current entry
            // always follows the live queue; a stale prefetch is discarded.
            var latest = snapshot
            if immediate { latest = queue }
            else if let next = queue.nextSnapshot(), next.current?.id == snapshot.current?.id { latest = next }
            else {
                audio.source?.cancel()
                prepareNext()
                return
            }
            let id = ObjectIdentifier(audio.decoder)
            entries[id] = Entry(audio: audio, queue: latest, generation: token, isNext: !immediate)
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
                if immediate { fail() }
                else if waitingForNext { ended() }
            }
        case .failure:
            source?.cancel()
            if immediate { fail() }
            else if waitingForNext { ended() }
            // A failed prefetch is retried only when that track becomes current.
        }
    }

    private func prepareNext() {
        guard (cache?.preloadPolicy ?? .automatic).allows(preloadNetwork), wantsPlayback, !isLoading, !nextIsPreparing,
              entries.count == 1, pending.isEmpty,
              let next = queue.nextSnapshot(), next.current?.id != current?.id else { return }
        prepare(next, immediate: false)
    }

    func updatePreloadNetwork(_ network: PreloadNetwork) {
        guard network != preloadNetwork else { return }
        preloadNetwork = network
        preloadSettingsChanged()
    }

    func preloadSettingsChanged() {
        cancelNextPreparation()
        for (id, entry) in entries where entry.isNext { discardNext(id) }
        // Cancellation cannot strand playback at an end-of-track boundary.
        if waitingForNext { ended() } else { prepareNext() }
    }

    private func cancelNextPreparation() {
        if let id = nextRequestID { pending.removeValue(forKey: id)?.cancel() }
        nextRequestID = nil
        nextTrackID = nil
        nextIsPreparing = false
    }

    func reservePlaybackIntent() -> UUID {
        playbackIntent = UUID()
        error = nil
        return playbackIntent
    }

    func enqueue(_ tracks: [Track], next: Bool) {
        playbackIntent = UUID()
        guard !tracks.isEmpty, client != nil else { return }
        let wasEmpty = current == nil
        queue.enqueue(tracks, next: next)
        if wasEmpty { wantsPlayback = true; beginCurrent() } else { queueEdited() }
    }

    func removeUpcoming(at offsets: IndexSet) {
        queue.removeUpcoming(at: offsets)
        queueEdited()
    }

    func moveUpcoming(from source: IndexSet, to destination: Int) {
        queue.moveUpcoming(from: source, to: destination)
        queueEdited()
    }

    func moveUpcoming(entries: [PlaybackQueue.Entry.ID], before anchor: PlaybackQueue.Entry.ID?) {
        queue.moveUpcoming(entries: entries, before: anchor)
        queueEdited()
    }

    func removeUpcoming(entries: [PlaybackQueue.Entry.ID]) {
        queue.removeUpcoming(entries: entries)
        queueEdited()
    }

    func jumpToUpcoming(_ id: PlaybackQueue.Entry.ID) {
        guard let offset = queue.upcomingOffset(for: id) else { return }
        jumpToUpcoming(offset)
    }

    func jumpToUpcoming(_ offset: Int) {
        playbackIntent = UUID()
        guard queue.jumpToUpcoming(offset) else { return }
        wantsPlayback = true
        beginCurrent()
    }

    // Keep decoded entries consistent with an edited queue without touching the
    // track that is playing. A predecoded next track that no longer follows is
    // removed from the engine queue and the correct one is prefetched instead.
    private func queueEdited() {
        playbackIntent = UUID()
        let next = queue.nextSnapshot()
        if nextTrackID != nil && nextTrackID != next?.current?.id { cancelNextPreparation() }
        for (id, entry) in entries where entry.generation == generation {
            if entry.isNext {
                if let next, next.current?.id == entry.queue.current?.id { entries[id]?.queue = next }
                else { discardNext(id) }
            } else { entries[id]?.queue = queue }
        }
        // A prefetch still decoding is checked against the live queue when it
        // finishes, and replaced there if the next track changed.
        prepareNext()
    }

    private func discardNext(_ id: ObjectIdentifier) {
        // clearQueue removes decoders the engine has not started yet. The next
        // track is only started once the current one has finished decoding.
        engine.clearQueue()
        if let entry = entries.removeValue(forKey: id) {
            entry.audio.source?.cancel()
            discarded[id] = entry.audio
        }
    }

    // The track identifier of the prefetched next entry, if one is ready.
    var preparedNextID: String? {
        entries.values.first { $0.isNext && $0.generation == generation }?.queue.current?.id
    }

    func toggle() { wantsPlayback ? pause() : resume() }

    func pause() {
        playbackIntent = UUID()
        wantsPlayback = false
        engine.pause()
        updateNowPlaying()
    }

    func resume() {
        playbackIntent = UUID()
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
        playbackIntent = UUID()
        if queue.advance() { wantsPlayback = true; beginCurrent() }
        else { pause() }
    }

    func previous() {
        playbackIntent = UUID()
        if elapsed > 3 { seek(to: 0) }
        else if queue.previous() { wantsPlayback = true; beginCurrent() }
        else { seek(to: 0) }
    }

    func seek(to value: Double) {
        playbackIntent = UUID()
        guard !isLoading, engine.supportsSeeking, value.isFinite else { return }
        isSeeking = true
        if engine.seek(time: min(max(0, value), max(0, duration - 0.05))) {
            elapsed = value
            updateNowPlaying()
        } else { isSeeking = false; error = L10n.text("mobile.seekFailed") }
    }

    // Changing the order or repeat mode never interrupts the current track.
    func toggleShuffle() {
        playbackIntent = UUID()
        queue.setShuffle(!queue.shuffled)
        queueEdited()
    }

    func cycleRepeat() {
        playbackIntent = UUID()
        queue.repeatMode = PlaybackQueue.RepeatMode(rawValue: (queue.repeatMode.rawValue + 1) % 3) ?? .off
        queueEdited()
    }

    func stop() {
        waitingForNext = false
        playbackIntent = UUID()
        generation = UUID()
        cancelTransfers()
        engine.stop()
        entries.removeAll()
        discarded.removeAll()
        current = nil
        queue = PlaybackQueue()
        wantsPlayback = false
        isLoading = false
        isSeeking = false
        activeID = nil
        initialPosition = 0
        interrupted = false
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
        nextRequestID = nil
        nextTrackID = nil
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
            if buffered >= 1, entry.audio.source != nil, let id = entry.queue.current?.id,
               completedWrites.insert(id).inserted {
                media?.prune(protecting: protectedFiles)
            }
        }
    }

    private func rendered(_ id: ObjectIdentifier) {
        if discarded.removeValue(forKey: id) != nil {
            // The engine started a next track that a queue edit had removed.
            if queue.advance(automatic: true) { beginCurrent() } else { pause() }
            return
        }
        guard let entry = entries[id], entry.generation == generation else { return }
        waitingForNext = false
        // Any other track starting means the removed decoders never will.
        if id != activeID { discarded.removeAll() }
        let changed = current?.id != entry.queue.current?.id
        entry.audio.source?.unmeteredOnly = false
        entries[id]?.isNext = false
        queue = entry.queue
        current = queue.current
        isLoading = false
        if changed {
            elapsed = 0
            duration = current?.duration ?? 0
            artwork = nil
            loadArtwork()
        }
        if let previous = activeID, previous != id {
            entries.removeValue(forKey: previous)?.audio.source?.cancel()
        }
        activeID = id
        updateNowPlaying()
        prepareNext()
    }

    private func ended() {
        guard !isLoading, current != nil else { return }
        if nextIsPreparing { waitingForNext = true; return }
        waitingForNext = false
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
            MPNowPlayingInfoPropertyPlaybackRate: wantsPlayback && !isLoading && !interrupted ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork() {
        artworkTask?.cancel()
        guard let client, let track = current, let album = track.albumId, demoURL == nil else { return }
        artworkTask = Task { [weak self] in
            let pinned = MediaPaths.pinnedCover(baseURL: client.baseURL, album: album)
            guard let image = await ArtworkStore.shared.image(url: client.artworkURL(album, size: 480),
                session: client.session, pixels: 640, pinned: pinned), !Task.isCancelled, self?.current?.id == track.id else { return }
            self?.artwork = NowPlayingBridge.artwork(image)
            self?.updateNowPlaying()
        }
    }

    private enum RemoteAction: Sendable { case play, pause, toggle, next, previous }

    private func perform(_ action: RemoteAction) {
        switch action {
        case .play: resume()
        case .pause: pause()
        case .toggle: toggle()
        case .next: next()
        case .previous: previous()
        }
    }

    private func installRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        let actions: [(MPRemoteCommand, RemoteAction)] = [
            (commands.playCommand, .play), (commands.pauseCommand, .pause),
            (commands.togglePlayPauseCommand, .toggle),
            (commands.nextTrackCommand, .next), (commands.previousTrackCommand, .previous)]
        for (command, action) in actions {
            command.isEnabled = true
            // Handlers are nonisolated and hop to the main actor explicitly.
            let token = NowPlayingBridge.addTarget(command) { [weak self] _ in
                guard let player = self else { return .commandFailed }
                Task { @MainActor in player.perform(action) }
                return .success
            }
            remoteTargets.append((command, token))
        }
        commands.changePlaybackPositionCommand.isEnabled = true
        let token = NowPlayingBridge.addTarget(commands.changePlaybackPositionCommand) { [weak self] event in
            guard let player = self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let time = event.positionTime
            Task { @MainActor in player.seek(to: time) }
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
            self.interrupted = type == AVAudioSession.InterruptionType.began.rawValue
            if !self.interrupted && options & AVAudioSession.InterruptionOptions.shouldResume.rawValue == 0 {
                self.wantsPlayback = false
            }
            self.updateNowPlaying()
        }
    }
}
