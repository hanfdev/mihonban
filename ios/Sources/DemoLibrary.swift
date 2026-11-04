#if DEBUG
import Foundation
import AVFAudio

enum DemoLibrary {
    static var albums: [Album] {
        var result = [
            album("demo-1", "夜の余白", "見本盤スタジオ", 1984, rating: 3.86, genre: "Shibuya-kei"),
            album("demo-2", "A quiet room for evening studies", "Studio Ensemble", 1978, genre: "Shibuya-Kei"),
            album("demo-3", "海辺の手紙", "見本盤スタジオ", 1982, genre: "Shibuya-kei"),
            album("demo-4", "Evening studies", "Studio Ensemble", 1991, rating: 3.41)
        ]
        // Opt-in stress fixtures leave the existing browse and queue tests intact.
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--demo-credits") {
            var tracks = result[0].normalizedTracks
            tracks[0].title = "A very long song title for an evening with the studio ensemble"
            tracks[0].artists = creditNames.map { ArtistCredit(name: $0) }
            tracks[0].artist = creditNames.joined(separator: ", ")
            tracks[1].artist = rawCredits
            tracks[2].artists = [ArtistCredit(name: "Studio Ensemble")]
            tracks[2].artist = "Studio Ensemble"
            result[0].tracks = tracks
        }
        if arguments.contains("--demo-queue-layout") {
            var tracks = result[0].normalizedTracks
            for index in 1..<tracks.count {
                tracks[index].title = "Queue \(index): " + String(repeating: "A long song title ", count: 6)
                tracks[index].artist = rawCredits
                tracks[index].artists = nil
            }
            result[0].tracks = tracks
        }
        if arguments.contains("--demo-small-credits") {
            var tracks = result[0].normalizedTracks
            tracks[0].artists = ["First Artist", "Second Artist", "Third Artist"].map { ArtistCredit(name: $0) }
            tracks[0].artist = "First Artist, Second Artist, Third Artist"
            tracks[1].artists = ["First Artist", "Second Artist"].map { ArtistCredit(name: $0) }
            tracks[1].artist = "First Artist, Second Artist"
            result[0].tracks = tracks
        }
        if arguments.contains("--demo-markdown") {
            result[0].note = markdownSample
        }
        if arguments.contains("--demo-reading") {
            result[0].note = (1...40).map { "Paragraph \($0). A quiet evening in the recording studio, with notes about the musicians and this edition." }.joined(separator: "\n\n")
            result[0].rym?.rank = "#185 for 1984, #10,999 Overall"
        }
        if arguments.contains("--demo-captions") {
            result[0].title = "Songs in the Key of Life"
            result[0].rym = RymRating(rating: 4.4, votes: 120)
            result[1].title = "Lucky"
            result[1].rym = RymRating(rating: 4.3, votes: 120)
        }
        if arguments.contains("--demo-descriptors") {
            result[0].rym?.descriptors = descriptorWords
            result[2].rym = RymRating(descriptors: ["calm"])
        }
        return result
    }

    static var artists: [Artist] {
        guard ProcessInfo.processInfo.arguments.contains("--demo-markdown") else { return [] }
        return [Artist(name: "見本盤スタジオ", note: markdownSample)]
    }

    static let markdownSample = """
    # Session notes

    A **careful** recording with *quiet* passages and ~~discarded~~ ideas.
    Listen to `take_02` before the final mix.

    ## Recording details

    - First session
    - Second session
      - Guest strings

    1. Record the ensemble
    2. Listen together

    > Keep the room sound.

    ```text
    take_01  00:42
      preserve this indentation
    ```

    | Track | Duration |
    | --- | ---: |
    | First light | 3:42 |
    | Interlude | 1:20 |

    ---

    [Session archive](https://example.invalid/archive)
    [Unsafe link](javascript:alert(1))
    ![Studio photograph](https://example.invalid/studio.jpg)

    Final listening note.
    """

    static let creditNames = ["Studio Ensemble with a deliberately long display name", "Guest Singer",
                              "弦楽アンサンブル", "Session Player", "María Silva", "김민수", "Brass Ensemble", "Final Artist"]
    static let rawCredits = "Earth, Wind & Fire, Guest Singer / Studio Ensemble with a long original credit, Final Contributor"
    static let descriptorWords = ["love", "romantic", "lonely", "mellow", "melancholic", "soft", "male vocalist",
                                  "bittersweet", "longing", "breakup", "acoustic", "melodic", "introspective", "soothing",
                                  "calm", "nocturnal", "sentimental", "warm", "cozy", "crooning", "peaceful", "sensual", "nostalgia"]

    // Ratings and title lengths are mixed so screenshots show tile alignment.
    private static func album(_ id: String, _ title: String, _ artist: String, _ year: Int,
                              rating: Double? = nil, genre: String = "Ambient") -> Album {
        let tracks = ["First light", "Interlude", "After the rain"].enumerated().map { index, name in
            Track(id: "\(id)-\(index)", title: name, duration: 30, format: "wav", disc: 1,
                  track: index + 1, albumId: id, albumTitle: title, artist: artist)
        }
        var album = Album(id: id, title: title, artist: artist, year: year, trackCount: tracks.count, duration: 90,
                          genres: [genre], tracks: tracks)
        if let rating { album.rym = RymRating(rating: rating, votes: 120) }
        return album
    }

    static func tone() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mihonban-demo.wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100)!
        buffer.frameLength = 44100
        for channel in 0..<2 {
            for frame in 0..<44100 {
                buffer.floatChannelData![channel][frame] = Float(sin(Double(frame) / 44100 * 440 * 2 * .pi)) * 0.03
            }
        }
        for _ in 0..<30 { try file.write(from: buffer) }
        return url
    }
}
#endif
