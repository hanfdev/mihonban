import Foundation
import OSLog
import UIKit

// Identifies one transfer across process launches. The background session
// reports only the task description, so it carries everything needed to file
// a finished download even before any store has been attached.
nonisolated struct DownloadKey: Hashable, Sendable {
    let service: String
    let file: String
    let attempt: String
    let track: String

    var text: String { ["v1", service, file, attempt, track].joined(separator: "|") }

    init(service: String, file: String, attempt: String, track: String) {
        self.service = service; self.file = file; self.attempt = attempt; self.track = track
    }

    // The values came back from the system, so they are checked before any
    // of them is used to build a file path.
    init?(_ text: String?) {
        let parts = (text ?? "").split(separator: "|", maxSplits: 4, omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 5, parts[0] == "v1",
              parts[1].range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              parts[2].range(of: "^[0-9a-f]{64}\\.[a-z0-9]{1,5}$", options: .regularExpression) != nil,
              parts[3].range(of: "^[0-9a-f]{8}$", options: .regularExpression) != nil,
              !parts[4].isEmpty else { return nil }
        self.init(service: parts[1], file: parts[2], attempt: parts[3], track: parts[4])
    }

    static func newAttempt() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8)).lowercased() }
}

nonisolated enum DownloadEvent: Sendable {
    case progress(DownloadKey, written: Int64, expected: Int64)
    case finished(DownloadKey, bytes: Int64)
    case failed(DownloadKey, status: Int)
    case cancelled(DownloadKey)

    var key: DownloadKey {
        switch self {
        case .progress(let key, _, _), .finished(let key, _), .failed(let key, _), .cancelled(let key): key
        }
    }
}

// Observation points let native tests hold real filesystem operations at the
// cancellation boundary without replacing the URLSession delegate path.
nonisolated enum DownloadFileStage: Sendable { case validated, committing, removing }

// Owns the background URLSession. Transfers continue while the app is
// suspended; the system relaunches the app to deliver results. A user force
// quit cancels them, which the store reports as interrupted on next launch.
nonisolated final class DownloadEngine: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let identifier = "org.mihonban.ios.downloads"
    static let log = Logger(subsystem: "org.mihonban.ios", category: "downloads")
    static let shared = DownloadEngine(configuration: DownloadEngine.background(), root: MediaPaths.supportRoot)

    let root: URL
    private var session: URLSession!
    private let lock = NSLock()
    private var handler: (@Sendable (DownloadEvent) -> Void)?
    private var buffered: [DownloadEvent] = []
    private var running: [DownloadKey: URLSessionTask] = [:]
    private var failures: [Int: Int] = [:]
    private var lastProgress: [Int: Date] = [:]
    private var finishEvents: (@Sendable () -> Void)?
    private let files = DispatchQueue(label: "org.mihonban.download-files", qos: .utility)
    // Only the file queue accesses ownership. One latest claim per destination
    // rejects retired callbacks without retaining every previous attempt.
    private var fileOwners: [URL: (key: DownloadKey, retired: Bool)] = [:]
    private var coverOwners: [URL: UUID] = [:]
    private let observeCoverStage: @Sendable (URL, DownloadFileStage) -> Void
    private let observeFileStage: @Sendable (DownloadKey, DownloadFileStage) -> Void

    init(configuration: URLSessionConfiguration, root: URL,
         observeCoverStage: @escaping @Sendable (URL, DownloadFileStage) -> Void = { _, _ in },
         observeFileStage: @escaping @Sendable (DownloadKey, DownloadFileStage) -> Void = { _, _ in }) {
        self.root = root
        self.observeCoverStage = observeCoverStage
        self.observeFileStage = observeFileStage
        super.init()
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }

    static func background() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.httpMaximumConnectionsPerHost = 3
        // Cookies are attached per request, only for the service origin.
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.timeoutIntervalForResource = 6 * 60 * 60
        return configuration
    }

    func destination(_ key: DownloadKey) -> URL {
        MediaPaths.downloads(root: root, service: key.service).appendingPathComponent("audio", isDirectory: true)
            .appendingPathComponent(key.file)
    }

    // Events that arrive with no store attached (for example while the system
    // relaunches the app) are kept until one attaches. Progress is not kept.
    func attach(_ handler: (@Sendable (DownloadEvent) -> Void)?) {
        lock.lock()
        self.handler = handler
        let pending = handler == nil ? [] : buffered
        if handler != nil { buffered.removeAll() }
        lock.unlock()
        pending.forEach { handler?($0) }
    }

    private func emit(_ event: DownloadEvent) {
        lock.lock()
        let target = handler
        var transient = false
        if case .progress = event { transient = true }
        if target == nil && !transient { buffered.append(event) }
        lock.unlock()
        target?(event)
    }

    func prepare(_ key: DownloadKey) {
        // Claim queued attempts too: resolving their stream address can fail or
        // be cancelled before start, but removal must still clear older bytes.
        files.async { self.fileOwners[self.destination(key)] = (key, false) }
    }

    func start(_ request: URLRequest, key: DownloadKey) {
        // Enqueue synchronously before resuming; an earlier removal must finish
        // before this attempt can own or replace the destination.
        prepare(key)
        let task = session.downloadTask(with: request)
        task.taskDescription = key.text
        lock.lock(); running[key] = task; lock.unlock()
        task.resume()
    }

    func cancel(_ key: DownloadKey) {
        // URLSession cancellation cannot interrupt a completion delegate that
        // already passed validation. Order its file retirement with that commit
        // without making the caller wait for disk work.
        files.async {
            let target = self.destination(key)
            if let owner = self.fileOwners[target], owner.key != key { return }
            self.fileOwners[target] = (key, true)
            self.observeFileStage(key, .removing)
            try? FileManager.default.removeItem(at: target)
        }
        lock.lock()
        let task = running.removeValue(forKey: key)
        lock.unlock()
        if let task { task.cancel(); return }
        session.getAllTasks { tasks in
            tasks.filter { $0.taskDescription == key.text }.forEach { $0.cancel() }
        }
    }

    func waitForFileOperations() async {
        await withCheckedContinuation { continuation in
            files.async { continuation.resume() }
        }
    }

    // Covers share the audio file queue so removal, a replacement request and
    // its eventual write keep the order in which the store requested them.
    func prepareCover(_ target: URL, attempt: UUID) {
        files.async { self.coverOwners[target] = attempt }
    }

    func needsCover(_ target: URL, attempt: UUID) async -> Bool {
        await withCheckedContinuation { continuation in
            files.async {
                continuation.resume(returning: self.coverOwners[target] == attempt
                    && !FileManager.default.fileExists(atPath: target.path))
            }
        }
    }

    func saveCover(_ data: Data, to target: URL, attempt: UUID) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            files.async {
                defer { continuation.resume() }
                guard self.coverOwners[target] == attempt else { return }
                self.observeCoverStage(target, .committing)
                try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                         attributes: MediaPaths.protection)
                try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
    }

    func retireCover(_ target: URL, attempt: UUID) {
        files.async {
            if self.coverOwners[target] == attempt { self.coverOwners.removeValue(forKey: target) }
        }
    }

    func removeCover(_ target: URL) {
        files.async {
            self.coverOwners.removeValue(forKey: target)
            self.observeCoverStage(target, .removing)
            try? FileManager.default.removeItem(at: target)
        }
    }

    // Transfers the system still holds, used to tell a suspended app apart
    // from one whose transfers were cancelled by a force quit.
    func liveKeys() async -> Set<DownloadKey> {
        let tasks = await session.allTasks
        return lock.withLock {
            var keys = Set<DownloadKey>()
            for task in tasks where task.state == .running || task.state == .suspended {
                guard let key = DownloadKey(task.taskDescription) else { continue }
                keys.insert(key)
                running[key] = task
            }
            return keys
        }
    }

    func setFinishEvents(_ handler: @escaping @Sendable () -> Void) {
        lock.lock(); finishEvents = handler; lock.unlock()
    }

    // MARK: Resolving the stream address

    // The stream endpoint usually redirects to storage. The probe stops at the
    // first redirect, so the session cookie is sent only to the service origin
    // and never to a storage host.
    static func resolve(_ url: URL, client: APIClient) async throws -> URLRequest {
        var probe = URLRequest(url: url)
        probe.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let (bytes, response) = try await client.session.bytes(for: probe, delegate: StopRedirects())
        bytes.task.cancel()
        guard let http = response as? HTTPURLResponse else { throw ClientError.connection }
        var target = url
        if (300..<400).contains(http.statusCode) {
            guard let location = http.value(forHTTPHeaderField: "Location"),
                  let next = URL(string: location, relativeTo: url)?.absoluteURL else { throw ClientError.connection }
            if url.scheme == "https" && next.scheme != "https" { throw ClientError.connection }
            target = next
        } else if !(200..<300).contains(http.statusCode) {
            throw ServerError(status: http.statusCode, code: nil)
        }
        var request = URLRequest(url: target)
        let sameOrigin = target.scheme == url.scheme && target.host == url.host && target.port == url.port
        if sameOrigin, let cookies = HTTPCookieStorage.shared.cookies(for: target), !cookies.isEmpty {
            for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) { request.setValue(value, forHTTPHeaderField: name) }
        }
        request.setValue("Mihonban-iOS/0.2", forHTTPHeaderField: "User-Agent")
        return request
    }

    // MARK: URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let key = DownloadKey(downloadTask.taskDescription) else { return }
        lock.lock()
        let now = Date()
        let due = now.timeIntervalSince(lastProgress[downloadTask.taskIdentifier] ?? .distantPast) > 0.25
        if due { lastProgress[downloadTask.taskIdentifier] = now }
        lock.unlock()
        if due { emit(.progress(key, written: totalBytesWritten, expected: totalBytesExpectedToWrite)) }
    }

    // The temporary file is deleted when this returns, so it is moved here.
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let key = DownloadKey(downloadTask.taskDescription) else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let manager = FileManager.default
        let target = destination(key)
        let expected = downloadTask.countOfBytesExpectedToReceive
        let size = Int64((try? location.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
        guard (200..<300).contains(status), size > 0, expected <= 0 || size == expected else {
            lock.lock(); failures[downloadTask.taskIdentifier] = status == 0 || (200..<300).contains(status) ? -1 : status; lock.unlock()
            return
        }
        observeFileStage(key, .validated)
        // The delegate is off MainActor and must keep the temporary file alive
        // until the move finishes. No state lock is held during filesystem I/O.
        let outcome = files.sync { () -> Int in
            if let owner = fileOwners[target], owner.key != key || owner.retired {
                return URLError.cancelled.rawValue
            }
            // A restored background task may complete before a store attaches
            // or liveKeys runs, so an unclaimed destination is still eligible.
            fileOwners[target] = (key, false)
            observeFileStage(key, .committing)
            do {
                try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                            attributes: MediaPaths.protection)
                if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
                try manager.moveItem(at: location, to: target)
                try manager.setAttributes(MediaPaths.protection, ofItemAtPath: target.path)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var file = target
                try? file.setResourceValues(values)
                return 0
            } catch { return -1 }
        }
        lock.lock(); failures[downloadTask.taskIdentifier] = outcome; lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let key = DownloadKey(task.taskDescription) else { return }
        lock.lock()
        let outcome = failures.removeValue(forKey: task.taskIdentifier)
        lastProgress.removeValue(forKey: task.taskIdentifier)
        if running[key] === task { running.removeValue(forKey: key) }
        lock.unlock()
        if (error as? URLError)?.code == .cancelled || outcome == URLError.cancelled.rawValue {
            emit(.cancelled(key)); return
        }
        if error == nil, outcome == 0 { emit(.finished(key, bytes: task.countOfBytesReceived)) }
        else {
            // HTTP statuses are positive; transport failures keep their negative
            // URLError code so the row can say why. Addresses are never logged.
            let code = outcome ?? (error as NSError?)?.code ?? -1
            if let error = error as NSError? {
                Self.log.error("transfer failed: \(error.domain, privacy: .public) \(error.code, privacy: .public)")
            }
            emit(.failed(key, status: code))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        guard let origin = task.originalRequest?.url, let target = request.url else { completionHandler(nil); return }
        if origin.scheme == "https" && target.scheme != "https" { completionHandler(nil); return }
        var safe = request
        if origin.host != target.host || origin.port != target.port || origin.scheme != target.scheme {
            safe.setValue(nil, forHTTPHeaderField: "Cookie")
            safe.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(safe)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let finish = finishEvents
        finishEvents = nil
        lock.unlock()
        // Complete already-enqueued retirements before the system can suspend
        // us again. The main queue receives only the final notification.
        if let finish { files.async { DispatchQueue.main.async { finish() } } }
    }
}

private nonisolated final class StopRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

// Receives the relaunch callback for background transfers.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Reconnects to transfers the system kept while the app was not running.
        _ = DownloadEngine.shared
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == DownloadEngine.identifier else { completionHandler(); return }
        let box = CompletionBox(completionHandler)
        DownloadEngine.shared.setFinishEvents { box.run() }
    }
}

private nonisolated final class CompletionBox: @unchecked Sendable {
    private let handler: () -> Void
    init(_ handler: @escaping () -> Void) { self.handler = handler }
    func run() { handler() }
}
