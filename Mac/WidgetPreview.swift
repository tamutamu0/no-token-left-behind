import SwiftUI
import WebKit

enum PreviewSize: String, CaseIterable, Identifiable {
    case small, medium, large
    var id: String { rawValue }
    var title: String { switch self { case .small: return String(localized: "Small"); case .medium: return String(localized: "Medium"); case .large: return String(localized: "Large") } }
    var width: CGFloat { self == .small ? 155 : 329 }
    var height: CGFloat { switch self { case .small: return 155; case .medium: return 169; case .large: return 345 } }
}

enum PreviewAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { switch self { case .system: return String(localized: "Auto"); case .light: return String(localized: "Light"); case .dark: return String(localized: "Dark") } }
    func resolved(_ scheme: ColorScheme) -> String {
        self == .system ? (scheme == .dark ? "dark" : "light") : rawValue
    }
}

struct WidgetPreviewPanel: View {
    let snapshot: UsageSnapshot
    let now: Date
    @Environment(\.colorScheme) private var colorScheme
    @State private var size = PreviewSize.medium
    @State private var appearance = PreviewAppearance.system
    @State private var sample = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Widget").font(.headline)
                Spacer()
                Toggle("Sample data", isOn: $sample).toggleStyle(.switch).controlSize(.small)
                    .fixedSize()
            }
            HStack(spacing: 16) {
                Picker("Size", selection: $size) {
                    ForEach(PreviewSize.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).frame(width: 180)
                Spacer(minLength: 0)
                Picker("Appearance", selection: $appearance) {
                    ForEach(PreviewAppearance.allCases) { Text($0.title).tag($0) }
                }.pickerStyle(.segmented).frame(width: 220)
            }
            ZStack {
                RoundedRectangle(cornerRadius: 18).fill(Color.primary.opacity(0.035))
                WidgetPreviewWebView(snapshot: sample ? .demo(at: now) : snapshot, now: now,
                    size: size, appearance: appearance.resolved(colorScheme))
                    .frame(width: size.width, height: size.height)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .shadow(color: .black.opacity(0.08), radius: 10, y: 3)
                    .padding(24)
            }.frame(maxWidth: .infinity).frame(height: size.height + 48)
            Text("Text width and spacing vary slightly with the iPhone model.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(18)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 22))
    }
}

struct WidgetPreviewWebView: NSViewRepresentable {
    let snapshot: UsageSnapshot
    let now: Date
    let size: PreviewSize
    let appearance: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.underPageBackgroundColor = .clear
        guard let templateURL = Bundle.main.url(forResource: "WidgetPreview", withExtension: "html"),
              let sourceURL = Bundle.main.url(forResource: "AI Usage", withExtension: "js"),
              let template = try? String(contentsOf: templateURL, encoding: .utf8),
              let source = try? String(contentsOf: sourceURL, encoding: .utf8) else {
            view.loadHTMLString("<p>" + String(localized: "Couldn’t load the preview.") + "</p>", baseURL: nil)
            return view
        }
        // Use the shipped Scriptable functions; never run its iCloud/app entry point.
        let functions = source.components(separatedBy: "// Scriptable entry point")[0]
            .replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive)
        view.loadHTMLString(template.replacingOccurrences(of: "/*WIDGET_SCRIPT*/", with: functions), baseURL: nil)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard let bytes = try? snapshot.encoded(), let json = String(data: bytes, encoding: .utf8) else { return }
        // The snapshot encoder only allows numerical quota metadata, never account secrets.
        // The preview speaks the app's language, like the widget follows the iPhone's.
        let language = (Bundle.main.preferredLocalizations.first ?? "en").filter { $0.isLetter || $0 == "-" }
        let call = "window.renderUsagePreview(\(json), '\(size.rawValue)', '\(appearance)', \(now.timeIntervalSince1970), '\(language)');"
        context.coordinator.update(view, call: call)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var ready = false
        private var latest = ""
        private var rendered = ""

        func update(_ view: WKWebView, call: String) {
            latest = call
            guard ready, rendered != latest else { return }
            rendered = latest
            view.evaluateJavaScript(latest, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            update(webView, call: latest)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // This is an offline renderer. No links, account pages or external navigation.
            let initial = navigationAction.navigationType == .other && navigationAction.request.url?.absoluteString == "about:blank"
            decisionHandler(initial ? .allow : .cancel)
        }
    }
}
