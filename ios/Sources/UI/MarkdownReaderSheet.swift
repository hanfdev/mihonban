import SwiftUI

// Long-form text lives in its own scroll view, so closing never requires
// reaching the last paragraph or changing the album's scroll position.
struct MarkdownReaderSheet: View {
    let title: String
    let text: String
    @Environment(\.dismiss) private var dismiss
    @State private var document: MarkdownDocument?

    var body: some View {
        NavigationStack {
            ScrollView {
                Group {
                    if let document, document.source == text {
                        MarkdownContent(document: document)
                    } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40) }
                }.padding(20).frame(maxWidth: 680, alignment: .leading)
                    .frame(maxWidth: .infinity).accessibilityIdentifier("reader.content")
            }.background(Theme.background).accessibilityIdentifier("reader.scroll")
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L10n.text("common.done")) { dismiss() }.accessibilityIdentifier("reader.done")
                    }
                }
        }.presentationDragIndicator(.visible).tint(Theme.accent)
            .task(id: text) {
                let result = await MarkdownDocument.prepare(text)
                if !Task.isCancelled { document = result }
            }
    }
}
