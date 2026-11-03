#if DEBUG
import Foundation
import AVFAudio

enum DemoLibrary {
    static let albums: [Album] = [
        album("demo-1", "夜の余白", "見本盤スタジオ", 1984),
        album("demo-2", "A quiet room", "Studio Ensemble", 1978),
        album("demo-3", "海辺の手紙", "見本盤スタジオ", 1982),
        album("demo-4", "Evening studies", "Studio Ensemble", 1991)
    ]

    private static func album(_ id: String, _ title: String, _ artist: String, _ year: Int) -> Album {
        let tracks = ["First light", "Interlude", "After the rain"].enumerated().map { index, name in
            Track(id: "\(id)-\(index)", title: name, duration: 30, format: "wav", disc: 1,
                  track: index + 1, albumId: id, albumTitle: title, artist: artist)
        }
        return Album(id: id, title: title, artist: artist, year: year, trackCount: tracks.count, duration: 90, tracks: tracks)
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
