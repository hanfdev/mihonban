import SwiftUI

struct ShareSelection: Identifiable {
    let id = UUID()
    let text: String
    let url: URL

    static func albumURL(base: URL, id: String) -> URL? {
        guard !id.isEmpty, var parts = URLComponents(url: base, resolvingAgainstBaseURL: false),
              ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
              parts.host?.isEmpty == false, parts.user == nil, parts.password == nil else { return nil }
        parts.query = nil
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        // A trailing slash preserves a reverse proxy's service path prefix.
        if !parts.path.hasSuffix("/") { parts.path += "/" }
        parts.percentEncodedFragment = "/album/" + encoded
        return parts.url
    }

    static func album(_ album: Album, client: APIClient?) -> ShareSelection? {
        guard let client, let url = albumURL(base: client.baseURL, id: album.id) else { return nil }
        return ShareSelection(text: album.title + "\n" + album.artist, url: url)
    }

    static func track(_ track: Track, client: APIClient?) -> ShareSelection? {
        guard let client, let id = track.albumId, let url = albumURL(base: client.baseURL, id: id) else { return nil }
        let text = [track.title, PlaybackCredits(track: track).fullText, track.albumTitle ?? ""]
            .filter { !$0.isEmpty }.joined(separator: "\n")
        return ShareSelection(text: text, url: url)
    }
}

// The sheet owns an immutable selection even if playback advances underneath.
struct ActivitySheet: UIViewControllerRepresentable {
    let selection: ShareSelection
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [selection.text, selection.url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
