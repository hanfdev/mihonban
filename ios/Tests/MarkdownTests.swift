import Foundation
import XCTest
@testable import Mihonban

@MainActor
final class MarkdownTests: XCTestCase {
    private func allBlocks(_ document: MarkdownDocument) -> [MarkdownDocument.Block] {
        func descend(_ block: MarkdownDocument.Block) -> [MarkdownDocument.Block] {
            [block] + block.children.flatMap(descend)
        }
        return document.blocks.flatMap(descend)
    }

    private func text(_ block: MarkdownDocument.Block) -> String { String(block.text.characters) }

    func testHeadingsParagraphsAndThematicBreak() {
        let document = MarkdownDocument.parse("# Album\n\nFirst paragraph.\nAnother line.\n\n## Credits ##\n\n---\n\nLast.")
        XCTAssertEqual(document.blocks.map(\.kind), [.heading(1), .paragraph, .heading(2), .thematicBreak, .paragraph])
        XCTAssertEqual(text(document.blocks[0]), "Album")
        XCTAssertEqual(text(document.blocks[1]), "First paragraph.\nAnother line.")
        XCTAssertEqual(text(document.blocks[2]), "Credits")
    }

    func testSetextHeadingsAndNonHeadingHash() {
        let document = MarkdownDocument.parse("Title\n=====\n\nSubtitle\n---\n\n#not-a-heading")
        XCTAssertEqual(document.blocks.map(\.kind), [.heading(1), .heading(2), .paragraph])
        XCTAssertEqual(text(document.blocks[2]), "#not-a-heading")
    }

    func testInlineEmphasisStrikeCodeAndSafeLinks() {
        let document = MarkdownDocument.parse("**bold** *italic* ~~removed~~ `literal_*` [site](https://example.com/music) [mail](mailto:music@example.com)")
        let runs = Array(document.blocks[0].text.runs)
        XCTAssertTrue(runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
        XCTAssertTrue(runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
        XCTAssertTrue(runs.contains { $0.inlinePresentationIntent?.contains(.strikethrough) == true })
        XCTAssertTrue(runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
        XCTAssertEqual(runs.compactMap(\.link).map(\.scheme), ["https", "mailto"])
        XCTAssertEqual(document.plainPreview, "bold italic removed literal_* site mail")
    }

    func testOrderedAndNestedListsPreserveNumbersAndParagraphs() {
        let document = MarkdownDocument.parse("3. First\n   - Child\n     7. Grandchild\n4. Second\n\n   Another paragraph.\n\nOutside.")
        XCTAssertEqual(document.blocks.count, 2)
        let list = document.blocks[0]
        XCTAssertEqual(list.kind, .list(ordered: true))
        XCTAssertEqual(list.children.map(\.kind), [.listItem("3."), .listItem("4.")])
        let nested = list.children[0].children[1]
        XCTAssertEqual(nested.kind, .list(ordered: false))
        XCTAssertEqual(nested.children[0].children[1].kind, .list(ordered: true))
        XCTAssertEqual(nested.children[0].children[1].children[0].kind, .listItem("7."))
        XCTAssertEqual(list.children[1].children.map(text), ["Second", "Another paragraph."])
        XCTAssertEqual(text(document.blocks[1]), "Outside.")
    }

    func testQuotesContainListsAndNestedQuotes() {
        let document = MarkdownDocument.parse("> Opening\n>\n> - One\n> - Two\n>\n> > Nested\n\nOutside")
        XCTAssertEqual(document.blocks.map(\.kind), [.quote, .paragraph])
        XCTAssertEqual(document.blocks[0].children.map(\.kind), [.paragraph, .list(ordered: false), .quote])
        XCTAssertTrue(document.plainPreview.contains("Opening One Two Nested Outside"))
    }

    func testCodePreservesWhitespaceSyntaxAndLineEndings() {
        let source = "```swift\r\n  let x = \"**not bold**\"\r\n\tprint(x)\r\n\r\n```\r\n"
        let document = MarkdownDocument.parse(source)
        XCTAssertEqual(document.source, source)
        XCTAssertEqual(document.blocks.count, 1)
        XCTAssertEqual(document.blocks[0].kind, .code(language: "swift"))
        XCTAssertEqual(text(document.blocks[0]), "  let x = \"**not bold**\"\r\n\tprint(x)\r\n\r\n")
        XCTAssertTrue(document.blocks[0].text.runs.allSatisfy { $0.link == nil && $0.inlinePresentationIntent == nil })
    }

    func testTildeUnclosedAndIndentedCode() {
        let unclosed = MarkdownDocument.parse("~~~text\n[not a link](javascript:bad)\nlast line")
        XCTAssertEqual(unclosed.blocks[0].kind, .code(language: "text"))
        XCTAssertEqual(text(unclosed.blocks[0]), "[not a link](javascript:bad)\nlast line")
        let indented = MarkdownDocument.parse("    alpha\n      beta\n\nAfter")
        XCTAssertEqual(indented.blocks.map(\.kind), [.code(language: nil), .paragraph])
        XCTAssertEqual(text(indented.blocks[0]), "alpha\n  beta\n\n")
        XCTAssertEqual(MarkdownDocument.parse("```\n```").blocks[0].kind, .code(language: nil))
    }

    func testFencesNestedInAListRetainCode() {
        let document = MarkdownDocument.parse("- Example\n\n  ```text\n  one\n    two\n  ```")
        let code = allBlocks(document).first { $0.kind == .code(language: "text") }
        XCTAssertNotNil(code)
        XCTAssertEqual(code.map(text), "one\n  two\n")
    }

    func testTableAlignmentsEscapesAndInlineFormatting() {
        let document = MarkdownDocument.parse("| Name | Value | Note |\n| :--- | ---: | :---: |\n| **Record** | 42 | `a|b` |\n| A\\|B | 5 | plain |")
        XCTAssertEqual(document.blocks.count, 1)
        let table = document.blocks[0]
        XCTAssertEqual(table.kind, .table([.leading, .trailing, .center]))
        XCTAssertEqual(table.children.count, 3)
        XCTAssertEqual(table.children[0].kind, .tableRow(header: true))
        XCTAssertEqual(table.children[1].children.map(text), ["Record", "42", "a|b"])
        XCTAssertEqual(table.children[2].children.map(text), ["A|B", "5", "plain"])
    }

    func testUnsafeLinksAreInertEvenWithinStyledText() {
        let source = "**[bad](javascript:alert%281%29)** [file](file:///private/test) [data](data:text/html,bad) [app](mihonban://delete) [relative](/admin) [safe](https://example.com)"
        let document = MarkdownDocument.parse(source)
        let links = allBlocks(document).flatMap { $0.text.runs.compactMap(\.link) }
        XCTAssertEqual(links, [URL(string: "https://example.com")!])
        XCTAssertTrue(document.plainPreview.contains("bad file data app relative safe"))
        for value in ["javascript:alert(1)", "file:///private", "data:text/html,hi", "//example.com", "/relative",
                      "https://name:password@example.com", "mailto:test@example.com?subject=%0AInjected"] {
            XCTAssertFalse(MarkdownDocument.isSafeURL(URL(string: value)!), value)
        }
        for value in ["http://example.com/path", "https://example.com", "mailto:test@example.com"] {
            XCTAssertTrue(MarkdownDocument.isSafeURL(URL(string: value)!), value)
        }
    }

    func testImageSyntaxBecomesExplicitLinkWithoutImageAttributes() {
        let document = MarkdownDocument.parse("![Cover art](https://example.com/cover.jpg) ![Unsafe](file:///private/photo) ![](https://example.com/empty.jpg)")
        let runs = allBlocks(document).flatMap { Array($0.text.runs) }
        XCTAssertTrue(runs.allSatisfy { $0.imageURL == nil })
        XCTAssertEqual(runs.compactMap(\.link).map(\.absoluteString),
                       ["https://example.com/cover.jpg", "https://example.com/empty.jpg"])
        XCTAssertEqual(document.plainPreview, "Cover art Unsafe ↗")
    }

    func testImageAndHTMLSyntaxInsideCodeRemainLiteral() {
        let document = MarkdownDocument.parse("`![alt](https://example.com/a.png) <script>`")
        XCTAssertEqual(document.plainPreview, "![alt](https://example.com/a.png) <script>")
        XCTAssertTrue(document.blocks[0].text.runs.allSatisfy { $0.link == nil && $0.imageURL == nil })
    }

    func testRawHTMLIsVisibleInertText() {
        let document = MarkdownDocument.parse("<script>alert('x')</script>\n<a href=\"javascript:bad\">click</a>")
        XCTAssertTrue(document.plainPreview.contains("<script>"))
        XCTAssertTrue(document.plainPreview.contains("<a href="))
        XCTAssertTrue(allBlocks(document).allSatisfy { $0.text.runs.allSatisfy { $0.link == nil && $0.imageURL == nil } })
    }

    func testEmptyMalformedAndUnicodeInput() {
        XCTAssertTrue(MarkdownDocument.parse("").blocks.isEmpty)
        XCTAssertTrue(MarkdownDocument.parse(" \n\t\r\n").plainPreview.isEmpty)
        let malformed = "**Unclosed [label](\n\n日本語 · 한국어 · Français"
        let document = MarkdownDocument.parse(malformed)
        XCTAssertEqual(document.source, malformed)
        XCTAssertTrue(document.plainPreview.contains("Unclosed"))
        XCTAssertTrue(document.plainPreview.contains("日本語 · 한국어 · Français"))
    }

    func testPlainPreviewHasNoBlockMarkersOrDestinations() {
        let document = MarkdownDocument.parse("# **Album**\n\n- *One*\n- [Two](https://example.com)\n\n> Quote\n\n---\n\n```\ncode\nline\n```")
        XCTAssertEqual(document.plainPreview, "Album One Two Quote code line")
        XCTAssertFalse(document.plainPreview.contains("https://"))
        XCTAssertLessThanOrEqual(MarkdownDocument.parse(String(repeating: "word ", count: 1_000)).plainPreview.count, 1_200)
    }

    func testIDsAreStableAndUniqueAcrossNestedBlocks() {
        let source = "# Heading\n\n- One\n  - Two\n\n> Quote\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"
        let first = allBlocks(MarkdownDocument.parse(source)).map(\.id)
        let second = allBlocks(MarkdownDocument.parse(source)).map(\.id)
        XCTAssertEqual(first, second)
        XCTAssertEqual(Set(first).count, first.count)
        XCTAssertEqual(MarkdownDocument.parse("# Heading").blocks[0].accessibilityIdentifier, "markdown-heading-0")
        XCTAssertTrue(allBlocks(MarkdownDocument.parse(source)).contains { $0.accessibilityIdentifier.hasPrefix("markdown-list-") })
    }

    func testLargeInputIsRetainedAndBoundedWithoutLosingLiteralText() {
        let source = String(repeating: "x", count: 200_000)
        let document = MarkdownDocument.parse(source)
        XCTAssertEqual(document.source, source)
        XCTAssertTrue(document.usedLiteralFallback)
        XCTAssertFalse(document.isTruncated)
        XCTAssertEqual(document.blocks.map(text).joined(), source)
        XCTAssertTrue(document.blocks.allSatisfy { $0.text.characters.count <= MarkdownDocument.maximumInlineCharacters })
        let manyBlocks = MarkdownDocument.parse(String(repeating: "paragraph\n\n", count: 4_000))
        XCTAssertTrue(manyBlocks.usedLiteralFallback)
        XCTAssertLessThan(manyBlocks.blocks.count, MarkdownDocument.maximumBlocks + 30)
    }

    func testDepthLimitFallsBackWithoutDroppingContent() {
        let source = String(repeating: "> ", count: 40) + "deep text"
        let document = MarkdownDocument.parse(source)
        XCTAssertTrue(document.usedLiteralFallback)
        XCTAssertTrue(document.plainPreview.contains("deep text"))
        XCTAssertLessThanOrEqual(allBlocks(document).count, MarkdownDocument.maximumDepth + 1)
    }

    func testPrepareRunsAsAnAsyncPreparedDocumentAPI() async {
        let document = await MarkdownDocument.prepare("# Prepared\n\n**Once**")
        XCTAssertEqual(document.plainPreview, "Prepared Once")
        XCTAssertEqual(document.blocks.map(\.kind), [.heading(1), .paragraph])
    }
}
