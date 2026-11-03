import SwiftUI

struct DownloadsView: View {
    let model: AppModel
    let downloads: DownloadStore
    @State private var confirmRemoveAll = false

    var body: some View {
        List {
            if downloads.problemCount > 0 {
                Section {
                    Button(L10n.text("mobile.retryAll"), systemImage: "arrow.clockwise") { downloads.retryAll() }
                        .accessibilityIdentifier("downloads.retryAll")
                } footer: { Text(L10n.text("mobile.downloadInterruptedHint")) }
            }
            ForEach(downloads.groups) { group in
                Section {
                    ForEach(group.records) { record in
                        DownloadRow(record: record) { play(group, from: record) }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { downloads.remove(record.id) } label: {
                                    Label(L10n.text("common.delete"), systemImage: "trash")
                                }
                                if record.state == .failed || record.state == .interrupted {
                                    Button { downloads.retry(record.id) } label: {
                                        Label(L10n.text("common.retry"), systemImage: "arrow.clockwise")
                                    }.tint(Theme.accent)
                                }
                            }
                    }
                } header: { header(group) }
            }
        }
        .overlay {
            if downloads.records.isEmpty {
                ContentUnavailableView(L10n.text("mobile.downloadsEmpty"), systemImage: "arrow.down.circle",
                                       description: Text(L10n.text("mobile.downloadsEmptyHint")))
            }
        }
        .scrollContentBackground(.hidden).background(Theme.background)
        .navigationTitle(L10n.text("mobile.downloads"))
        .toolbar {
            if !downloads.records.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(L10n.text("mobile.removeAllDownloads"), systemImage: "trash", role: .destructive) {
                            confirmRemoveAll = true
                        }
                    } label: { Image(systemName: "ellipsis") }.accessibilityLabel(L10n.text("mobile.moreActions"))
                }
            }
        }
        .confirmationDialog(L10n.text("mobile.removeAllConfirm"), isPresented: $confirmRemoveAll, titleVisibility: .visible) {
            Button(L10n.text("mobile.removeAllDownloads"), role: .destructive) { downloads.removeAll() }
        }
    }

    private func header(_ group: DownloadStore.AlbumGroup) -> some View {
        HStack(spacing: 12) {
            Cover(albumID: group.id, size: 160, client: model.imageClient)
                .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(group.album?.title ?? group.records.first?.track.albumTitle ?? "").font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink).lineLimit(1)
                Text(group.album?.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Menu {
                Button(L10n.text("common.playAll"), systemImage: "play") { play(group, from: nil) }
                Button(L10n.text("mobile.removeDownload"), systemImage: "trash", role: .destructive) {
                    downloads.remove(album: group.id)
                }
            } label: { Image(systemName: "ellipsis.circle").font(.title3) }
                .accessibilityLabel(L10n.text("mobile.moreActions"))
        }.textCase(nil).padding(.vertical, 4)
    }

    private func play(_ group: DownloadStore.AlbumGroup, from record: DownloadRecord?) {
        let ready = group.records.filter { $0.state == .done }.map(\.track)
        guard !ready.isEmpty else { return }
        let index = record.flatMap { target in ready.firstIndex { $0.id == target.id } } ?? 0
        model.player.play(ready, index: index)
    }
}

private struct DownloadRow: View {
    let record: DownloadRecord
    let play: () -> Void

    var body: some View {
        Button(action: play) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(record.track.title).font(.body).foregroundStyle(Theme.ink).lineLimit(2)
                    status
                }.frame(maxWidth: .infinity, alignment: .leading)
                indicator
            }.padding(.vertical, 2).contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(record.state != .done)
            .accessibilityIdentifier("download.\(record.state.rawValue).\(record.id)")
    }

    @ViewBuilder private var status: some View {
        switch record.state {
        case .done:
            Text(CacheSettings.size(Int(record.written))).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        case .downloading:
            ProgressView(value: record.fraction).tint(Theme.accent)
        case .queued:
            Text(L10n.text("mobile.downloadQueued")).font(.caption).foregroundStyle(.secondary)
        case .failed:
            Text(L10n.text("mobile.downloadFailed") + code).font(.caption).foregroundStyle(Theme.accent)
        case .interrupted:
            Text(L10n.text("mobile.downloadInterrupted")).font(.caption).foregroundStyle(Theme.accent)
        }
    }

    // HTTP statuses read as "HTTP 404"; transport failures show their code.
    private var code: String {
        guard let status = record.status, status != 0 else { return "" }
        return status > 0 ? " · HTTP \(status)" : " · \(status)"
    }

    @ViewBuilder private var indicator: some View {
        switch record.state {
        case .done: Image(systemName: "arrow.down.circle.fill").foregroundStyle(.secondary)
        case .failed, .interrupted: Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.accent)
        case .queued, .downloading: EmptyView()
        }
    }
}

// The album page control: download, progress (tap to stop), downloaded
// (tap to remove after confirmation) or retry.
struct AlbumDownloadButton: View {
    let album: Album
    let downloads: DownloadStore
    @State private var confirmRemove = false

    var body: some View {
        let state = downloads.state(album: album)
        Button {
            switch state {
            case .none, .partial, .failed: Task { await downloads.download(album: album) }
            case .downloading: downloads.cancel(album: album.id)
            case .complete: confirmRemove = true
            }
        } label: { icon(state).frame(width: 44, height: 44) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("album.download")
            .accessibilityLabel(L10n.text(label(state)))
            .confirmationDialog(L10n.text("mobile.removeDownloadConfirm"), isPresented: $confirmRemove, titleVisibility: .visible) {
                Button(L10n.text("mobile.removeDownload"), role: .destructive) { downloads.remove(album: album.id) }
            }
    }

    @ViewBuilder private func icon(_ state: AlbumDownloadState) -> some View {
        switch state {
        case .none, .partial:
            Image(systemName: "arrow.down.circle").font(.title3).foregroundStyle(Theme.dim)
        case .downloading(let fraction):
            ZStack {
                Circle().stroke(Theme.line, lineWidth: 2.5)
                Circle().trim(from: 0, to: max(0.03, fraction)).stroke(Theme.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: "stop.fill").font(.system(size: 8)).foregroundStyle(Theme.accent)
            }.frame(width: 24, height: 24).animation(.linear(duration: 0.25), value: fraction)
        case .complete:
            Image(systemName: "arrow.down.circle.fill").font(.title3).foregroundStyle(Theme.accent)
        case .failed:
            Image(systemName: "exclamationmark.arrow.circlepath").font(.title3).foregroundStyle(Theme.accent)
        }
    }

    private func label(_ state: AlbumDownloadState) -> String {
        switch state {
        case .none, .partial: "mobile.download"
        case .downloading: "common.cancel"
        case .complete: "mobile.removeDownload"
        case .failed: "common.retry"
        }
    }
}
