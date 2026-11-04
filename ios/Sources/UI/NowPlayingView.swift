import AVKit
import SwiftUI

struct MiniPlayer: View {
    let model: AppModel
    var body: some View {
        if let track = model.player.current {
            HStack(spacing: 12) {
                Button { model.player.isExpanded = true } label: {
                    HStack(spacing: 12) {
                        Cover(albumID: track.albumId ?? "", size: 160, client: model.imageClient)
                            .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 7))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(track.title).font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text(model.player.isLoading ? L10n.text("mobile.preparing") : PlaybackCredits(track: track).compactText)
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
    @State private var creditsSheet: CreditsSelection?
    @State private var pendingArtist: (trackID: String, name: String)?
    @State private var scrubbing = false
    @State private var scrubTime: Double = 0
    @State private var controlsHeight: CGFloat = 330

    private var player: PlayerModel { model.player }
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView {
                    let side = NowPlayingLayout.coverSide(in: geometry.size, controlsHeight: controlsHeight)
                    let width = NowPlayingLayout.controlsWidth(in: geometry.size, coverSide: side)
                    Group {
                        if NowPlayingLayout.usesColumns(geometry.size) {
                            HStack(alignment: .top, spacing: NowPlayingLayout.columnSpacing) {
                                cover.frame(width: side, height: side)
                                controls.frame(width: width)
                            }
                        } else {
                            VStack(spacing: NowPlayingLayout.coverSpacing) {
                                cover.frame(width: side, height: side)
                                controls.frame(width: width)
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { controlsHeight = $0 }
                            }
                        }
                    }.padding(.horizontal, NowPlayingLayout.horizontalInset)
                        .padding(.top, NowPlayingLayout.topInset).padding(.bottom, NowPlayingLayout.bottomInset)
                        .frame(maxWidth: .infinity)
                }.scrollBounceBehavior(.basedOnSize).background(Theme.background)
                    .accessibilityIdentifier("player.scroll")
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    IconButton(symbol: "chevron.down", label: L10n.text("mobile.collapse")) { dismiss() }
                        .accessibilityIdentifier("player.collapse")
                }
                ToolbarItem(placement: .principal) {
                    Text(L10n.text("mobile.nowPlaying")).font(Theme.body(13)).foregroundStyle(Theme.dim)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let track = player.current {
                        Menu { TrackActions(track: track, model: model) } label: { Image(systemName: "ellipsis") }
                            .accessibilityLabel(L10n.text("mobile.moreActions")).accessibilityIdentifier("player.more")
                    }
                }
            }
            .sheet(isPresented: $queueVisible) { QueueView(player: player) }
            .sheet(item: $creditsSheet, onDismiss: finishArtistSelection) { selection in
                PlaybackCreditsSheet(credits: selection.credits) { name in
                    guard selection.id == player.current?.id else { return }
                    pendingArtist = (selection.id, name)
                    creditsSheet = nil
                }
            }
            .onChange(of: player.current?.id) { _, _ in
                pendingArtist = nil
                creditsSheet = nil
            }
        }.presentationDragIndicator(.visible).tint(Theme.accent)
    }

    private struct CreditsSelection: Identifiable {
        let id: String
        let credits: PlaybackCredits
    }

    private func openArtists() {
        guard let track = player.current else { return }
        let credits = PlaybackCredits(track: track)
        if let name = credits.singleArtist { model.pendingRoute = .artist(name) }
        else if !credits.isEmpty { creditsSheet = CreditsSelection(id: track.id, credits: credits) }
    }

    private func finishArtistSelection() {
        // Dismiss the nested sheet before the shell closes Now Playing and routes.
        let selection = pendingArtist
        pendingArtist = nil
        if let selection, selection.trackID == player.current?.id {
            model.pendingRoute = .artist(selection.name)
        }
    }

    private var cover: some View {
        Cover(albumID: player.current?.albumId ?? "", size: 800, client: model.imageClient)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(player.current?.albumTitle ?? "")
            .accessibilityAddTraits(.isImage).accessibilityIdentifier("player.cover")
    }

    private var favoriteButton: PlayerFavoriteButton? {
        guard model.sessionStore.isAdmin, let track = player.current else { return nil }
        return PlayerFavoriteButton(trackID: track.id, favorites: model.favorites, session: model.sessionStore)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: NowPlayingLayout.controlSpacing) {
            NowPlayingHeading(track: player.current, openAlbum: {
                if let album = player.current?.albumId { model.pendingRoute = .album(album) }
            }, openArtists: openArtists, favorite: favoriteButton)
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
                ShuffleToggle(player: player, identifier: "player.shuffle")
                Spacer(minLength: 4)
                IconButton(symbol: "backward.end.fill", label: L10n.text("player.prev")) { player.previous() }
                Spacer(minLength: 8)
                PlayButton(player: player, diameter: 70)
                Spacer(minLength: 8)
                IconButton(symbol: "forward.end.fill", label: L10n.text("player.next")) { player.next() }
                    .accessibilityIdentifier("player.next")
                Spacer(minLength: 4)
                IconButton(symbol: player.queue.repeatMode == .one ? "repeat.1" : "repeat",
                           label: L10n.text(["player.repeatOff", "player.repeatAll", "player.repeatOne"][player.queue.repeatMode.rawValue]),
                           selected: player.queue.repeatMode != .off) { player.cycleRepeat() }
            }.padding(.vertical, 4)
            // Icons only, under shuffle and repeat, as in the system music app.
            HStack {
                RoutePicker().frame(width: 44, height: 44).accessibilityLabel(L10n.text("mobile.audioOutput"))
                    .accessibilityIdentifier("player.route")
                Spacer()
                IconButton(symbol: "list.bullet", label: L10n.text("mobile.queue")) { queueVisible = true }
                    .accessibilityIdentifier("player.queue")
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
                    Section { row(current).foregroundStyle(Theme.accent).listRowBackground(Theme.surface) } header: { header(L10n.text("mobile.nowPlaying")) }
                }
                Section {
                    // Offsets identify entries because one track may be queued twice.
                    ForEach(Array(player.queue.upcoming.enumerated()), id: \.offset) { offset, track in
                        Button { player.jumpToUpcoming(offset) } label: { row(track) }
                            .buttonStyle(.plain).listRowBackground(Theme.surface).accessibilityIdentifier("queue.\(offset)")
                    }
                    .onMove { player.moveUpcoming(from: $0, to: $1) }
                    .onDelete { player.removeUpcoming(at: $0) }
                } header: { header(L10n.text("mobile.upNext")) }
            }.scrollContentBackground(.hidden).background(Theme.background)
                .accessibilityIdentifier("queue.list")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { EditButton() }
                    ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } }
                }
        }.tint(Theme.accent)
    }
    private func header(_ text: String) -> some View {
        Text(text).font(Theme.body(12)).foregroundStyle(Theme.faint).textCase(nil)
    }
    private func row(_ track: Track) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(track.title).font(Theme.body(15))
            Text(track.artist ?? "").font(Theme.body(12)).foregroundStyle(Theme.dim)
        }.padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
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
