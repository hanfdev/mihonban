import MediaPlayer
import UIKit

// A fresh media timeline lets the system extrapolate progress without a
// background polling timer or repeated artwork publications.
struct NowPlayingTimeline: Equatable {
    let elapsed: Double
    let duration: Double
    let rate: Double

    static func capture(elapsed: Double, duration: Double, engineTime: Double?, engineDuration: Double?,
                        playing: Bool, wantsPlayback: Bool, loading: Bool, seeking: Bool, ended: Bool) -> Self {
        let total = !loading && !ended && engineDuration?.isFinite == true && engineDuration! > 0
            ? engineDuration! : max(0, duration.isFinite ? duration : 0)
        let position = !loading && !seeking && !ended && engineTime?.isFinite == true && engineTime! >= 0
            ? engineTime! : elapsed
        let bounded = max(0, position.isFinite ? position : 0)
        return Self(elapsed: total > 0 ? min(total, bounded) : bounded, duration: total,
                    rate: playing && wantsPlayback && !loading && !ended ? 1 : 0)
    }
}

// MediaPlayer invokes these callbacks on its own queues (artwork is rendered on
// the now-playing access queue). A closure formed inside a MainActor method
// inherits that isolation, and Swift 6 traps when it runs elsewhere, so every
// callback handed to MediaPlayer is built here, outside any actor.
enum NowPlayingBridge {
    nonisolated static func artwork(_ image: UIImage) -> MPMediaItemArtwork {
        let box = ImageBox(image)
        return MPMediaItemArtwork(boundsSize: image.size) { _ in box.image }
    }

    nonisolated static func addTarget(_ command: MPRemoteCommand,
        _ handler: @escaping @Sendable (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) -> Any {
        command.addTarget { event in handler(event) }
    }
}

// UIImage is immutable once rendered; the box lets it cross into the callback.
private final class ImageBox: @unchecked Sendable {
    let image: UIImage
    init(_ image: UIImage) { self.image = image }
}
