import SwiftUI

@main
struct MihonbanApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .foregroundStyle(Theme.ink)
                .font(Theme.body())
                .task { await model.bootstrap() }
                .onChange(of: phase) { _, value in
                    model.player.setForeground(value == .active)
                    if value == .active { Task { await model.refresh() } }
                }
        }
    }
}

struct RootView: View {
    @Bindable var model: AppModel
    @State private var settings = false

    var body: some View {
        Group {
            if model.session?.ok == true {
                NavigationStack {
                    LibraryView(model: model)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button { settings = true } label: {
                                    Image(systemName: "slider.horizontal.3").font(.system(size: 20, weight: .medium))
                                        .foregroundStyle(Theme.ink)
                                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                                    .accessibilityLabel(L10n.text("mobile.settings"))
                                    .accessibilityIdentifier("settings.open")
                            }
                        }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if model.player.current != nil { MiniPlayer(model: model) }
                }
                .sheet(isPresented: $settings) { SettingsView(model: model) }
            } else { ConnectionView(model: model) }
        }
        .background(Theme.background)
        .sheet(isPresented: Binding(get: { model.player.isExpanded }, set: { model.player.isExpanded = $0 })) {
            NowPlayingView(model: model)
        }
    }
}

struct ConnectionView: View {
    @Bindable var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 12) {
                    Image("Logo").resizable().scaledToFit().frame(width: 92, height: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 22)).accessibilityHidden(true)
                    Text("見本盤").font(Theme.title(44))
                    Text(L10n.text("mobile.connectHint")).foregroundStyle(Theme.dim)
                }.padding(.bottom, 12)
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L10n.text("mobile.address")).foregroundStyle(Theme.dim)
                        TextField(L10n.text("mobile.address"), text: $model.address,
                                  prompt: Text(verbatim: "https://music.example.com").foregroundStyle(Theme.faint))
                            .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never)
                            .autocorrectionDisabled().accessibilityIdentifier("connection.address")
                            .padding(14).background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L10n.text("login.password")).foregroundStyle(Theme.dim)
                        SecureField(L10n.text("login.password"), text: $model.password,
                                    prompt: Text(L10n.text("mobile.optionalPassword")).foregroundStyle(Theme.faint))
                            .textContentType(.password).accessibilityIdentifier("connection.password")
                            .padding(14).background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
                    }
                    Toggle(L10n.text("mobile.remember"), isOn: $model.rememberPassword)
                        .font(Theme.body(13)).tint(Theme.accent)
                    if model.address.lowercased().hasPrefix("http://") {
                        Label(L10n.text("mobile.insecureHTTP"), systemImage: "lock.open")
                            .font(Theme.body(13)).foregroundStyle(Theme.dim)
                    }
                }
                if let error = model.error { Text(error).foregroundStyle(Theme.accent).font(Theme.body(14)) }
                Button { Task { await model.connect() } } label: {
                    HStack {
                        if model.connecting { ProgressView().tint(Theme.ink) }
                        Text(L10n.text(model.connecting ? "mobile.connecting" : "mobile.connect"))
                    }.font(Theme.body(16, weight: .semibold)).frame(maxWidth: .infinity).frame(minHeight: 52)
                }
                .buttonStyle(.plain).background(Theme.accent, in: RoundedRectangle(cornerRadius: 10))
                .disabled(model.connecting || model.address.isEmpty).accessibilityIdentifier("connection.connect")
                .opacity(model.connecting || model.address.isEmpty ? 0.55 : 1)
                Text(L10n.text("mobile.m0Notice")).font(Theme.body(12)).foregroundStyle(Theme.faint)
            }.padding(28).frame(maxWidth: 500).frame(maxWidth: .infinity).padding(.top, 42)
        }.background(Theme.background).scrollDismissesKeyboard(.interactively)
    }
}

struct SettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDisconnect = false
    @State private var cacheUsed = 0
    @State private var cleared = false
    var body: some View {
        NavigationStack {
            List {
                Section(L10n.text("mobile.connection")) {
                    Text(model.demo ? "Demo" : model.address).font(Theme.body(14)).textSelection(.enabled)
                    Button(L10n.text("login.signOut"), role: .destructive) { confirmDisconnect = true }
                }.listRowBackground(Theme.surface)
                Section {
                    Toggle(L10n.text("mobile.cacheEnable"), isOn: $model.cache.enabled)
                    Picker(L10n.text("mobile.cacheLimit"), selection: $model.cache.limitBytes) {
                        ForEach(CacheSettings.limits, id: \.self) { Text(CacheSettings.label($0)).tag($0) }
                    }.disabled(!model.cache.enabled)
                    LabeledContent(L10n.text("mobile.cacheUsed"), value: CacheSettings.size(cacheUsed))
                        .accessibilityIdentifier("cache.used")
                    if cleared {
                        Text(L10n.text("mobile.cacheCleared")).font(Theme.body(13)).foregroundStyle(Theme.dim)
                    }
                    Toggle(L10n.text("mobile.preloadNext"), isOn: $model.cache.preloadNext)
                        .disabled(!model.cache.enabled)
                    Button(L10n.text("mobile.clearCache"), role: .destructive) {
                        model.clearCache()
                        cacheUsed = 0
                        cleared = true
                    }.accessibilityIdentifier("cache.clear")
                } header: { Text(L10n.text("mobile.cache")) } footer: {
                    Text(L10n.text(model.cache.enabled ? "mobile.cacheHint" : "mobile.cacheOffNotice"))
                }.listRowBackground(Theme.surface)
                Section {
                    Text(L10n.text("mobile.m0Notice"))
                    Text(L10n.text("mobile.prefetchNotice"))
                    Text("Mihonban 0.1.0 · M0").foregroundStyle(Theme.faint)
                }.font(Theme.body(14)).listRowBackground(Theme.surface)
                Section {
                    NavigationLink(L10n.text("mobile.licenses")) { LicenseView() }
                }.listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden).background(Theme.background)
            .navigationTitle(L10n.text("mobile.settings")).navigationBarTitleDisplayMode(.inline)
            .task { cacheUsed = model.cacheUsage }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
            .confirmationDialog(L10n.text("mobile.disconnectConfirm"), isPresented: $confirmDisconnect, titleVisibility: .visible) {
                Button(L10n.text("login.signOut"), role: .destructive) { dismiss(); model.disconnect() }
            }
        }.tint(Theme.accent)
    }
}

struct LicenseView: View {
    private var licenses: String {
        guard let url = Bundle.main.url(forResource: "Acknowledgements", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "SFBAudioEngine · sbooth/SFBAudioEngine\nShippori Mincho · SIL Open Font License\nInter · SIL Open Font License" }
        return text
    }
    var body: some View {
        ScrollView { Text(licenses).font(.system(size: 12, design: .monospaced)).textSelection(.enabled).padding(20) }
            .background(Theme.background).navigationTitle(L10n.text("mobile.licenses"))
    }
}
