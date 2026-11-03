import MediaPlayer
import UIKit

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
