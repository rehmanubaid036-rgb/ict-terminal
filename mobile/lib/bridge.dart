import "dart:convert";

/// The web terminal the app shows (set at build time for test builds):
///   flutter build apk --dart-define=ICT_WEB=http://10.0.2.2:5173/terminal/
const String kWebUrl = String.fromEnvironment("ICT_WEB", defaultValue: "https://ict.iccterminal.trade/terminal/");
const String kAppVersion = "0.4.2";
/// Added to the WebView's user agent, so the terminal knows it runs inside the app.
const String kUaTag = "ICTTerminalApp/$kAppVersion (Android)";

/// Pages that stay inside the app: the web terminal itself (and its API calls on the same address).
/// Everything else (the website, guides, WhatsApp, Telegram, Google / Facebook sign-in, the broker,
/// e-mail) opens outside, in the phone's browser or app.
bool staysInApp(String url, {String web = kWebUrl}) {
  final u = Uri.tryParse(url), home = Uri.parse(web);
  if (u == null) return false;
  if (u.scheme == "about" || u.scheme == "data" || u.scheme == "blob" || u.scheme == "javascript") return true;
  if (u.scheme != "http" && u.scheme != "https") return false;
  if (u.host != home.host || u.port != home.port) return false;
  final base = home.path.endsWith("/") ? home.path : "${home.path}/";
  return u.path == home.path || u.path == base.substring(0, base.length - 1) || u.path.startsWith(base);
}

/// The Google / Facebook sign-in start page of the server.
bool isSignIn(Uri u) => RegExp(r"^/api/v1/oauth/(google|facebook)/start$").hasMatch(u.path);

/// A message the terminal sends through `IctApp.postMessage(...)`.
sealed class BridgeMessage {
  const BridgeMessage();

  /// Null for anything the app does not know (old or broken messages are ignored).
  static BridgeMessage? parse(String raw) {
    try {
      final m = jsonDecode(raw);
      if (m is! Map) return null;
      switch (m["type"]) {
        case "open":
          final url = m["url"];
          return url is String && url.isNotEmpty ? OpenUrl(url) : null;
        case "save":
          final name = m["name"], data = m["base64"];
          if (name is! String || data is! String) return null;
          return SaveFile(safeFileName(name), (m["mime"] as String?) ?? "application/octet-stream", base64Decode(data));
        case "share":
          final text = m["text"];
          return text is String && text.isNotEmpty ? ShareText(text) : null;
        case "lock":
          return SetLock(m["on"] == true);
      }
    } catch (_) {
      return null;
    }
    return null;
  }
}

class OpenUrl extends BridgeMessage {
  const OpenUrl(this.url);
  final String url;
}

class SaveFile extends BridgeMessage {
  const SaveFile(this.name, this.mime, this.bytes);
  final String name;
  final String mime;
  final List<int> bytes;
}

class ShareText extends BridgeMessage {
  const ShareText(this.text);
  final String text;
}

class SetLock extends BridgeMessage {
  const SetLock(this.on);
  final bool on;
}

/// A file name that is safe on the phone: no folders, no odd characters, at most 80 characters.
String safeFileName(String name) {
  final clean = name.split(RegExp(r"[\\/]")).last.replaceAll(RegExp(r"[^A-Za-z0-9._ -]"), "_").trim();
  final cut = clean.length > 80 ? clean.substring(clean.length - 80) : clean;
  return cut.isEmpty || cut.startsWith(".") ? "ict_file$cut" : cut;
}

/// The fingerprint lock asks again when the app comes back after this long in the background.
const Duration kRelockAfter = Duration(minutes: 2);
bool needsUnlock({required bool enabled, required DateTime? pausedAt, required DateTime now}) =>
    enabled && (pausedAt == null || now.difference(pausedAt) >= kRelockAfter);
