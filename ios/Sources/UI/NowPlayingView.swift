import AVKit
import SwiftUI

struct MiniPlayer: View {
    let model: AppModel
    var body: some View {
        if let track = model.player.current {
            HStack(spacing: 12) {
                Button { model.player.isExpanded = true } label: {
                    HStack(spacing: 12) {
                        Cover(albumID: track.albumId ?? "", size: 160, client: model.demo ? nil : model.client)
                            .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 7))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(track.title).font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text(model.player.isLoading ? L10n.text("mobile.preparing") : track.artist ?? "")
                                .font(Theme.body(12)).foregroundStyle(Theme.dim).lineLimit(1)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("player.expand")
                PlayButton(player: model.player, diameter: 36)
                IconButton(symbol: "forward.end.fill", label: L10n.text("player.next")) { model.player.next() }
            }.padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.surface)
                .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 0.5) }
        }
    }
}

struct NowPlayingView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var queueVisible = false
    @State private var scrubbing = false
    @State private var scrubTime: Double = 0

    private var player: PlayerModel { model.player }
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    let landscape = geometry.size.width > 700 && geometry.size.width > geometry.size.height
                    Group {
                        if landscape {
                            HStack(spacing: 40) {
                                cover.frame(maxWidth: 440)
                                controls.frame(maxWidth: 480)
                            }
                        } else {
                            VStack(spacing: 32) { cover.frame(maxWidth: 500); controls.frame(maxWidth: 500) }
                        }
                    }.padding(.horizontal, 28).padding(.top, 14).padding(.bottom, 36)
                        .frame(maxWidth: .infinity)
                }.background(Theme.background)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    IconButton(symbol: "chevron.down", label: L10n.text("mobile.collapse")) { dismiss() }
                }
                ToolbarItem(placement: .principal) {
                    Text(L10n.text("mobile.nowPlaying")).font(Theme.body(13)).foregroundStyle(Theme.dim)
                }
            }
            .sheet(isPresented: $queueVisible) { QueueView(player: player) }
        }.presentationDragIndicator(.visible).tint(Theme.accent)
    }

    private var cover: some View {
        Cover(albumID: player.current?.albumId ?? "", size: 800, client: model.demo ? nil : model.client)
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text(player.current?.title ?? "").font(Theme.title(27)).lineLimit(3)
                    .accessibilityIdentifier("player.title")
                Text(player.current?.artist ?? "").font(Theme.body(16)).foregroundStyle(Theme.dim)
                Text(player.current?.albumTitle ?? "").font(Theme.body(13)).foregroundStyle(Theme.faint).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 0) {
                Slider(value: Binding(get: { scrubbing ? scrubTime : min(player.elapsed, max(player.duration, 1)) },
                                      set: { scrubTime = $0 }),
                       in: 0...max(player.duration, 1), onEditingChanged: { editing in
                    if editing { scrubTime = player.elapsed; scrubbing = true }
                    else { scrubbing = false; player.seek(to: scrubTime) }
                }).disabled(player.isLoading).accessibilityLabel(L10n.text("player.seek"))
                HStack {
                    Text(timestamp(scrubbing ? scrubTime : player.elapsed))
                    Spacer()
                    if player.isLoading || player.isSeeking { Text(L10n.text("mobile.preparing")) }
                    Spacer()
                    Text("−" + timestamp(max(0, player.duration - (scrubbing ? scrubTime : player.elapsed))))
                }.font(Theme.body(11)).monospacedDigit().foregroundStyle(Theme.faint)
            }
            HStack {
                IconButton(symbol: "shuffle", label: L10n.text("common.shuffle"), selected: player.queue.shuffled) { player.toggleShuffle() }
                Spacer(minLength: 4)
                IconButton(symbol: "backward.end.fill", label: L10n.text("player.prev")) { player.previous() }
                Spacer(minLength: 8)
                PlayButton(player: player, diameter: 70)
                Spacer(minLength: 8)
                IconButton(symbol: "forward.end.fill", label: L10n.text("player.next")) { player.next() }
                Spacer(minLength: 4)
                IconButton(symbol: player.queue.repeatMode == .one ? "repeat.1" : "repeat",
                           label: L10n.text(["player.repeatOff", "player.repeatAll", "player.repeatOne"][player.queue.repeatMode.rawValue]),
                           selected: player.queue.repeatMode != .off) { player.cycleRepeat() }
            }.padding(.vertical, 4)
            HStack {
                RoutePicker().frame(width: 44, height: 44).accessibilityLabel(L10n.text("mobile.audioOutput"))
                Text(L10n.text("mobile.audioOutput")).font(Theme.body(13)).foregroundStyle(Theme.dim)
                Spacer()
                IconButton(symbol: "list.bullet", label: L10n.text("mobile.queue")) { queueVisible = true }
            }
            if let error = player.error {
                VStack(alignment: .leading, spacing: 10) {
                    Text(error).font(Theme.body(14)).foregroundStyle(Theme.dim)
                    Button(L10n.text("common.retry")) { player.resume() }
                }
            }
        }
    }
}

struct QueueView: View {
    let player: PlayerModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(L10n.text("mobile.queue")).font(Theme.title(30)).foregroundStyle(Theme.ink)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                }
                if let current = player.current {
                    Section { row(current).foregroundStyle(Theme.accent) } header: { header(L10n.text("mobile.nowPlaying")) }
                }
                Section { ForEach(player.queue.upcoming) { row($0) } } header: { header(L10n.text("mobile.upNext")) }
            }.scrollContentBackground(.hidden).background(Theme.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
        }.tint(Theme.accent)
    }
    private func header(_ text: String) -> some View {
        Text(text).font(Theme.body(12)).foregroundStyle(Theme.faint).textCase(nil)
    }
    private func row(_ track: Track) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(track.title).font(Theme.body(15))
            Text(track.artist ?? "").font(Theme.body(12)).foregroundStyle(Theme.dim)
        }.padding(.vertical, 6).listRowBackground(Theme.surface)
    }
}

struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = UIColor(Theme.dim)
        view.activeTintColor = UIColor(Theme.accent)
        view.prioritizesVideoDevices = false
        return view
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
