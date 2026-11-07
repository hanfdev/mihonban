import Foundation

enum PreloadPolicy: String, CaseIterable, Sendable {
    case off, automatic, always
    var label: String { "mobile.preload" + rawValue.capitalized }
    func allows(_ network: PreloadNetwork) -> Bool {
        guard network.connected else { return false }
        switch self {
        case .off: return false
        case .always: return true
        case .automatic: return network.wifiOrEthernet && !network.expensive && !network.constrained
        }
    }
}

struct PreloadNetwork: Equatable, Sendable {
    var connected = false
    var wifiOrEthernet = false
    var expensive = false
    var constrained = false
}
