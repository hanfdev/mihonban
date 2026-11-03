import XCTest
import MediaPlayer
import UIKit
@testable import Mihonban

// The system can ask for lock-screen artwork on a non-main queue. The box
// transfers the immutable artwork without claiming that the player is Sendable.
private final class ArtworkBox: @unchecked Sendable {
    let value: MPMediaItemArtwork
    init(_ value: MPMediaItemArtwork) { self.value = value }
}

@MainActor
final class NowPlayingTests: XCTestCase {
    func testArtworkCanBeRequestedOffMainThread() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        let artwork = ArtworkBox(NowPlayingBridge.artwork(image))
        let requested = expectation(description: "Artwork requested from a system callback queue")
        DispatchQueue.global(qos: .userInitiated).async {
            let result = artwork.value.image(at: CGSize(width: 32, height: 32))
            XCTAssertNotNil(result)
            requested.fulfill()
        }
        await fulfillment(of: [requested], timeout: 10)
    }
}
