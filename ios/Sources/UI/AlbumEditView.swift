import SwiftUI

// Native counterpart of the web EditDialog. The sheet closes only after the
// service accepts the write; a refusal keeps the form and its input.
struct AlbumEditView: View {
    let model: AppModel
    let album: Album
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var draft: AlbumDraft
    @State private var saving = false
    @State private var problem: String?

    init(model: AppModel, album: Album, onSaved: @escaping () -> Void = {}) {
        self.model = model
        self.album = album
        self.onSaved = onSaved
        _draft = State(initialValue: AlbumDraft(album))
    }

    private var changed: Bool { draft != AlbumDraft(album) }

    var body: some View {
        NavigationStack {
            Form {
                if let problem {
                    Section {
                        Label(problem, systemImage: "exclamationmark.circle").foregroundStyle(Theme.accent)
                            .accessibilityIdentifier("edit.problem")
                    }.listRowBackground(Theme.surface)
                }
                Section(L10n.text("albumPage.title")) {
                    TextField(L10n.text("albumPage.title"), text: $draft.title, axis: .vertical)
                        .accessibilityIdentifier("edit.title")
                    LabeledContent(L10n.text("albumPage.year")) {
                        TextField("YYYY", text: $draft.year).keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing).monospacedDigit()
                            .accessibilityIdentifier("edit.year")
                    }
                }.listRowBackground(Theme.surface)
                artists
                Section {
                    field("albumPage.primaryGenres", text: $draft.genres, prompt: "albumPage.genresPh", id: "edit.genres")
                    field("albumPage.secondaryGenres", text: $draft.secondaryGenres, prompt: "albumPage.secGenresPh", id: "edit.secondaryGenres")
                    field("albumPage.descriptors", text: $draft.descriptors, prompt: "albumPage.descPh", id: "edit.descriptors")
                } header: { Text(L10n.text("common.genres")) } footer: {
                    Text(L10n.text("mobile.listSeparatorHint"))
                }.listRowBackground(Theme.surface)
                Section(L10n.text("albumPage.note")) {
                    TextField(L10n.text("albumPage.notePh"), text: $draft.note, axis: .vertical)
                        .lineLimit(5...14).accessibilityIdentifier("edit.note")
                }.listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden).background(Theme.background)
            .scrollDismissesKeyboard(.interactively)
            .disabled(saving)
            .navigationTitle(L10n.text("albumPage.edit")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("common.cancel")) { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() }
                    else {
                        Button(L10n.text("common.save")) { Task { await save() } }
                            .disabled(!changed).accessibilityIdentifier("edit.save")
                    }
                }
            }
            .interactiveDismissDisabled(changed || saving)
        }.tint(Theme.accent)
    }

    private var artists: some View {
        Section {
            ForEach($draft.credits) { $credit in
                VStack(alignment: .leading, spacing: 6) {
                    TextField(L10n.text("albumPage.artistNamePh"), text: $credit.name)
                        .textInputAutocapitalization(.words)
                    TextField(L10n.text("albumPage.artistSortPh"), text: $credit.sort)
                        .font(.subheadline).foregroundStyle(.secondary).autocorrectionDisabled()
                }.padding(.vertical, 2)
            }
            .onDelete { draft.credits.remove(atOffsets: $0) }
            .onMove { draft.credits.move(fromOffsets: $0, toOffset: $1) }
            Button(L10n.text("albumPage.addArtist"), systemImage: "plus") {
                draft.credits.append(.init(name: "", sort: ""))
            }.disabled(draft.credits.count >= 24)
        } header: {
            HStack {
                Text(L10n.text("albumPage.artists"))
                Spacer()
                if draft.credits.count > 1 { EditButton().font(.footnote).textCase(nil) }
            }
        } footer: { Text(L10n.text("albumPage.artistCasingHint")) }
            .listRowBackground(Theme.surface)
    }

    private func field(_ label: String, text: Binding<String>, prompt: String, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L10n.text(label)).font(.footnote).foregroundStyle(.secondary)
            TextField(L10n.text(prompt), text: text, axis: .vertical).accessibilityIdentifier(id)
        }.padding(.vertical, 2)
    }

    private func save() async {
        guard !saving else { return }
        switch draft.payload() {
        case .failure(let failure):
            problem = L10n.text("albumPage.saveFail", L10n.text(failure.key))
        case .success(let edit):
            saving = true
            problem = nil
            defer { saving = false }
            do {
                try await model.catalog.save(album.id, edit: edit)
                onSaved()
                dismiss()
            } catch is CancellationError {
                return
            } catch {
                problem = L10n.text("albumPage.saveFail", error.localizedDescription)
            }
        }
    }
}
