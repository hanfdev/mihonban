import SwiftUI

struct AlbumDescriptors: View {
    let descriptors: [String]
    @Binding var isExpanded: Bool

    private var words: [String] { descriptors.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }

    var body: some View {
        if !words.isEmpty {
            DisclosureGroup(isExpanded: $isExpanded) {
                Text(words.joined(separator: " · ")).font(Theme.body(13)).foregroundStyle(Theme.dim)
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("album.descriptors.content")
            } label: {
                HStack {
                    Text(L10n.text("common.descriptors")).font(Theme.body(15)).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(String(words.count)).font(Theme.body(12).monospacedDigit()).fixedSize()
                }.foregroundStyle(Theme.dim)
            }.disclosureGroupStyle(DescriptorDisclosureStyle())
        }
    }
}

// Keep DisclosureGroup's binding and content, with a full-width touch target
// outside a Form. These are read-only metadata, not a second row of genre links.
private struct DescriptorDisclosureStyle: DisclosureGroupStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { configuration.isExpanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    configuration.label
                    Image(systemName: configuration.isExpanded ? "chevron.down" : "chevron.right")
                        .font(Theme.body(12, weight: .semibold)).foregroundStyle(Theme.dim).accessibilityHidden(true)
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("album.descriptors")
                .accessibilityValue(L10n.text(configuration.isExpanded ? "mobile.expanded" : "mobile.collapsed"))
                .accessibilityHint(L10n.text(configuration.isExpanded ? "md.collapse" : "md.expand"))
            if configuration.isExpanded { configuration.content }
        }
    }
}
