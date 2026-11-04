import UIKit
import XCTest
@testable import Mihonban

@MainActor
final class GalleryZoomTests: XCTestCase {
    private let viewport = CGSize(width: 320, height: 640)

    private func image(_ size: CGSize = CGSize(width: 800, height: 800)) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    private func scroller() -> GalleryZoomScrollView {
        let view = GalleryZoomScrollView(frame: CGRect(origin: .zero, size: viewport))
        view.setImage(image())
        view.layoutIfNeeded()
        return view
    }

    func testAspectFitHandlesSquareWideAndTallImages() {
        XCTAssertEqual(GalleryZoomGeometry.fittedSize(image: CGSize(width: 800, height: 800), viewport: viewport),
                       CGSize(width: 320, height: 320))
        XCTAssertEqual(GalleryZoomGeometry.fittedSize(image: CGSize(width: 1600, height: 800), viewport: viewport),
                       CGSize(width: 320, height: 160))
        XCTAssertEqual(GalleryZoomGeometry.fittedSize(image: CGSize(width: 400, height: 1600), viewport: viewport),
                       CGSize(width: 160, height: 640))
        XCTAssertEqual(GalleryZoomGeometry.fittedSize(image: .zero, viewport: viewport), .zero)
        XCTAssertEqual(GalleryZoomGeometry.fittedSize(image: viewport, viewport: .zero), .zero)
    }

    func testShortAxisStaysCenteredAndCannotBePannedOutOfBounds() {
        let content = CGSize(width: 800, height: 400)
        let insets = GalleryZoomGeometry.centeringInsets(content: content, viewport: viewport)
        XCTAssertEqual(insets, UIEdgeInsets(top: 120, left: 0, bottom: 120, right: 0))
        XCTAssertEqual(GalleryZoomGeometry.boundedOffset(CGPoint(x: -900, y: -900), content: content,
                                                         viewport: viewport, insets: insets), CGPoint(x: 0, y: -120))
        XCTAssertEqual(GalleryZoomGeometry.boundedOffset(CGPoint(x: 900, y: 900), content: content,
                                                         viewport: viewport, insets: insets), CGPoint(x: 480, y: -120))
    }

    func testBothAxesPanOnlyWithinEnlargedImage() {
        let content = CGSize(width: 960, height: 960)
        let insets = GalleryZoomGeometry.centeringInsets(content: content, viewport: viewport)
        XCTAssertEqual(insets, .zero)
        XCTAssertEqual(GalleryZoomGeometry.boundedOffset(CGPoint(x: -5, y: 999), content: content,
                                                         viewport: viewport, insets: insets), CGPoint(x: 0, y: 320))
        XCTAssertEqual(GalleryZoomGeometry.boundedOffset(CGPoint(x: 300, y: 140), content: content,
                                                         viewport: viewport, insets: insets), CGPoint(x: 300, y: 140))
    }

    func testDoubleTapZoomRectIsCenteredOnTapNotImageCenter() {
        let tap = CGPoint(x: 205, y: 145)
        let rect = GalleryZoomGeometry.zoomRect(around: tap, scale: 2.5, viewport: viewport)
        XCTAssertEqual(rect.midX, tap.x, accuracy: 0.001)
        XCTAssertEqual(rect.midY, tap.y, accuracy: 0.001)
        XCTAssertEqual(rect.width, 128, accuracy: 0.001)
        XCTAssertEqual(rect.height, 256, accuracy: 0.001)
    }

    func testFitAllowsPagingButKeepsPinchAvailable() {
        let view = scroller()
        XCTAssertEqual(view.minimumZoomScale, 1)
        XCTAssertEqual(view.maximumZoomScale, 5)
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertEqual(view.artworkView.frame.size, CGSize(width: 320, height: 320))
        XCTAssertEqual(view.contentInset.top, 160)
        XCTAssertEqual(view.contentOffset, CGPoint(x: 0, y: -160))
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.panGestureRecognizer.isEnabled)
        XCTAssertEqual(view.pinchGestureRecognizer?.isEnabled, true)
        XCTAssertFalse(view.bounces)
        XCTAssertFalse(view.bouncesZoom)
        XCTAssertTrue(view.viewForZooming(in: view) === view.artworkView)
    }

    func testPinchLocksPagingEvenBeforeScaleChangesAndReleasesAtOne() {
        let view = scroller()
        view.scrollViewWillBeginZooming(view, with: view.artworkView)
        XCTAssertTrue(view.locksPaging)
        XCTAssertTrue(view.panGestureRecognizer.isEnabled)
        view.scrollViewDidEndZooming(view, with: view.artworkView, atScale: 1)
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.panGestureRecognizer.isEnabled)
    }

    func testZoomEnablesPanAndResetRestoresFitAndPaging() {
        let view = scroller()
        view.setZoomScale(3, animated: false)
        XCTAssertTrue(view.locksPaging)
        XCTAssertTrue(view.panGestureRecognizer.isEnabled)
        XCTAssertEqual(view.contentSize.width, 960, accuracy: 0.01)
        XCTAssertEqual(view.contentInset, .zero)
        view.contentOffset = CGPoint(x: 200, y: 100)
        view.resetZoom()
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertEqual(view.contentOffset, CGPoint(x: 0, y: -160))
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.panGestureRecognizer.isEnabled)
    }

    func testNativeZoomLimitsClampScaleAndRestorePaging() {
        let view = scroller()
        view.setZoomScale(10, animated: false)
        XCTAssertEqual(view.zoomScale, 5)
        XCTAssertTrue(view.locksPaging)
        view.setZoomScale(0.5, animated: false)
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.panGestureRecognizer.isEnabled)
    }

    func testRepeatedImageUpdatePreservesZoomButNewImageResets() {
        let view = scroller()
        view.setZoomScale(2.5, animated: false)
        view.setImage(view.artworkView.image)
        XCTAssertEqual(view.zoomScale, 2.5)
        XCTAssertTrue(view.locksPaging)
        view.setImage(image(CGSize(width: 1600, height: 800)))
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertEqual(view.artworkView.frame.size, CGSize(width: 320, height: 160))
        XCTAssertEqual(view.contentOffset, CGPoint(x: 0, y: -240))
        XCTAssertFalse(view.locksPaging)
    }

    func testLeavingPageResetsZoomAndReturningAllowsPaging() {
        let view = scroller()
        view.setZoomScale(3, animated: false)
        view.setActive(false)
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.isUserInteractionEnabled)
        view.setActive(true)
        XCTAssertTrue(view.isUserInteractionEnabled)
        XCTAssertFalse(view.locksPaging)
        XCTAssertEqual(view.pinchGestureRecognizer?.isEnabled, true)
    }

    func testViewportResizeResetsZoomAndRecomputesCentering() {
        let view = scroller()
        view.setZoomScale(3, animated: false)
        view.frame = CGRect(x: 0, y: 0, width: 640, height: 320)
        view.setNeedsLayout()
        view.layoutIfNeeded()
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertEqual(view.artworkView.frame.size, CGSize(width: 320, height: 320))
        XCTAssertEqual(view.contentOffset, CGPoint(x: -160, y: 0))
        XCTAssertFalse(view.locksPaging)
    }

    func testAccessibilityIdentifiesPageAndReportsCurrentZoom() {
        let view = scroller()
        view.setPage(number: 2, count: 4)
        XCTAssertEqual(view.artworkView.accessibilityIdentifier, "gallery-image")
        XCTAssertEqual(view.artworkView.accessibilityValue, "2/4, 1.00×")
        view.setZoomScale(2.5, animated: false)
        XCTAssertEqual(view.artworkView.accessibilityValue, "2/4, 2.50×")
        view.setActive(false)
        XCTAssertTrue(view.accessibilityElementsHidden)
        XCTAssertEqual(view.artworkView.accessibilityValue, "2/4, 1.00×")
        view.setActive(true)
        XCTAssertFalse(view.accessibilityElementsHidden)
    }

    func testClearingImageReleasesPagingAndDisablesImageGestures() {
        let view = scroller()
        view.setZoomScale(3, animated: false)
        view.setImage(nil)
        XCTAssertEqual(view.zoomScale, 1)
        XCTAssertFalse(view.locksPaging)
        XCTAssertFalse(view.panGestureRecognizer.isEnabled)
        XCTAssertEqual(view.pinchGestureRecognizer?.isEnabled, false)
        XCTAssertFalse(view.artworkView.isAccessibilityElement)
        XCTAssertNil(view.artworkView.image)
    }
}
