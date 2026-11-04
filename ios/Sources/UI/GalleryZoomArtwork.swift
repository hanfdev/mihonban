import SwiftUI
import UIKit

// These values are in points, independent of the decoded image's pixel scale.
enum GalleryZoomGeometry {
    static func fittedSize(image: CGSize, viewport: CGSize) -> CGSize {
        guard image.width > 0, image.height > 0, viewport.width > 0, viewport.height > 0 else { return .zero }
        let scale = min(viewport.width / image.width, viewport.height / image.height)
        return CGSize(width: image.width * scale, height: image.height * scale)
    }

    static func centeringInsets(content: CGSize, viewport: CGSize) -> UIEdgeInsets {
        let horizontal = max(0, (viewport.width - content.width) / 2)
        let vertical = max(0, (viewport.height - content.height) / 2)
        return UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    static func boundedOffset(_ offset: CGPoint, content: CGSize, viewport: CGSize, insets: UIEdgeInsets) -> CGPoint {
        CGPoint(x: min(max(offset.x, -insets.left), max(-insets.left, content.width - viewport.width + insets.right)),
                y: min(max(offset.y, -insets.top), max(-insets.top, content.height - viewport.height + insets.bottom)))
    }

    static func zoomRect(around point: CGPoint, scale: CGFloat, viewport: CGSize) -> CGRect {
        let size = CGSize(width: viewport.width / scale, height: viewport.height / scale)
        return CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height)
    }
}

struct GalleryZoomArtwork: UIViewRepresentable {
    let image: UIImage?
    let isActive: Bool
    let pageNumber: Int
    let pageCount: Int
    let onPagingLockChange: (Bool) -> Void

    func makeUIView(context: Context) -> GalleryZoomScrollView { GalleryZoomScrollView(frame: .zero) }

    func updateUIView(_ view: GalleryZoomScrollView, context: Context) {
        view.onPagingLockChange = onPagingLockChange
        view.setPage(number: pageNumber, count: pageCount)
        view.setActive(isActive)
        view.setImage(image)
    }

    static func dismantleUIView(_ view: GalleryZoomScrollView, coordinator: ()) {
        view.onPagingLockChange = nil
    }
}

final class GalleryZoomScrollView: UIScrollView, UIScrollViewDelegate {
    let artworkView = UIImageView()
    var onPagingLockChange: ((Bool) -> Void)?
    private(set) var locksPaging = false
    private var active = true
    private var handlingZoomGesture = false
    private var resetting = false
    private var viewportSize = CGSize.zero
    private var notificationPending = false
    private var pageNumber = 1
    private var pageCount = 1

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        bounces = false
        bouncesZoom = false
        alwaysBounceHorizontal = false
        alwaysBounceVertical = false
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        backgroundColor = .clear
        clipsToBounds = true
        accessibilityIdentifier = "gallery-viewport"
        artworkView.contentMode = .scaleAspectFit
        artworkView.isAccessibilityElement = false
        artworkView.accessibilityTraits = .image
        artworkView.accessibilityLabel = L10n.text("common.zoom")
        artworkView.accessibilityIdentifier = "gallery-image"
        addSubview(artworkView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
        updateInteraction()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != viewportSize else { return }
        viewportSize = bounds.size
        // Rotation and split-view resizing start from a fresh aspect-fit layout.
        resetZoom()
    }

    func setImage(_ image: UIImage?) {
        guard artworkView.image !== image else { return }
        artworkView.image = image
        artworkView.isAccessibilityElement = image != nil
        resetZoom()
    }

    func setPage(number: Int, count: Int) {
        pageNumber = number
        pageCount = count
        updateAccessibility()
    }

    func setActive(_ value: Bool) {
        guard active != value else { return }
        active = value
        isUserInteractionEnabled = value
        accessibilityElementsHidden = !value
        accessibilityIdentifier = value ? "gallery-viewport" : nil
        if !value { resetZoom() }
    }

    func resetZoom() {
        resetting = true
        handlingZoomGesture = false
        setZoomScale(minimumZoomScale, animated: false)
        let size = GalleryZoomGeometry.fittedSize(image: artworkView.image?.size ?? .zero, viewport: bounds.size)
        artworkView.frame = CGRect(origin: .zero, size: size)
        contentSize = size
        centerArtwork()
        contentOffset = CGPoint(x: -contentInset.left, y: -contentInset.top)
        resetting = false
        updateInteraction()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { artworkView }

    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        guard !resetting else { return }
        handlingZoomGesture = true
        updateInteraction()
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        guard !resetting else { return }
        centerArtwork()
        updateInteraction()
    }

    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
        guard !resetting else { return }
        handlingZoomGesture = false
        if zoomScale <= minimumZoomScale + 0.001 {
            resetZoom()
        } else {
            contentOffset = GalleryZoomGeometry.boundedOffset(contentOffset, content: contentSize,
                                                             viewport: bounds.size, insets: contentInset)
            updateInteraction()
        }
    }

    private func centerArtwork() {
        let insets = GalleryZoomGeometry.centeringInsets(content: contentSize, viewport: bounds.size)
        if contentInset != insets { contentInset = insets }
    }

    private func updateInteraction() {
        let hasImage = artworkView.image != nil
        let locked = active && hasImage && (handlingZoomGesture || zoomScale > minimumZoomScale + 0.001)
        // At 1x a one-finger drag belongs to the pager, but pinch must remain enabled.
        panGestureRecognizer.isEnabled = locked
        pinchGestureRecognizer?.isEnabled = hasImage
        updateAccessibility()
        guard locksPaging != locked else { return }
        locksPaging = locked
        guard !notificationPending else { return }
        notificationPending = true
        // Layout and image replacement can happen inside updateUIView. Coalesce
        // notifications onto the next turn rather than mutate SwiftUI state there.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.notificationPending = false
            self.onPagingLockChange?(self.locksPaging)
        }
    }

    private func updateAccessibility() {
        // Page position and magnification are useful to VoiceOver as well as UI tests.
        artworkView.accessibilityValue = "\(pageNumber)/\(pageCount), " + String(format: "%.2f×", zoomScale)
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard artworkView.image != nil else { return }
        if zoomScale > minimumZoomScale + 0.001 {
            setZoomScale(minimumZoomScale, animated: true)
        } else {
            let point = gesture.location(in: artworkView)
            zoom(to: GalleryZoomGeometry.zoomRect(around: point, scale: 2.5, viewport: bounds.size), animated: true)
        }
    }
}

struct GalleryPageIndicator: UIViewRepresentable {
    let count: Int
    let current: Int

    func makeUIView(context: Context) -> UIPageControl {
        let control = UIPageControl()
        control.currentPageIndicatorTintColor = .white
        control.pageIndicatorTintColor = UIColor.white.withAlphaComponent(0.35)
        control.accessibilityLabel = L10n.text("albumPage.gallery")
        control.accessibilityIdentifier = "gallery-pages"
        return control
    }

    func updateUIView(_ control: UIPageControl, context: Context) {
        control.numberOfPages = count
        control.currentPage = current
    }
}
