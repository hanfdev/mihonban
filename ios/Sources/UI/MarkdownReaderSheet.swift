import SwiftUI

// Long-form text lives in its own scroll view, so closing never requires
// reaching the last paragraph or changing the album's scroll position.
struct MarkdownReaderSheet: View {
    let title: String
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                MarkdownText(source: text).padding(20).frame(maxWidth: 680, alignment: .leading)
                    .frame(maxWidth: .infinity).accessibilityIdentifier("reader.content")
            }.background(Theme.background).accessibilityIdentifier("reader.scroll")
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L10n.text("common.done")) { dismiss() }.accessibilityIdentifier("reader.done")
                    }
                }
        }.presentationDragIndicator(.visible).tint(Theme.accent)
    }
}
