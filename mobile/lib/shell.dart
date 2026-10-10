import "dart:async";
import "dart:io";

import "package:file_picker/file_picker.dart";
import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:path_provider/path_provider.dart";
import "package:share_plus/share_plus.dart";
import "package:url_launcher/url_launcher.dart";
import "package:webview_flutter/webview_flutter.dart";
import "package:webview_flutter_android/webview_flutter_android.dart";

import "bridge.dart";
import "lock.dart";
import "theme.dart";

/// The whole web terminal (the same code as the browser version) in a full-screen WebView. The login,
/// charts, signals, alerts, MT5 tab and account all live in the terminal; the app adds the phone parts.
class TerminalShell extends StatefulWidget {
  const TerminalShell({super.key, required this.lock});
  final AppLock lock;

  @override
  State<TerminalShell> createState() => _TerminalShellState();
}

class _TerminalShellState extends State<TerminalShell> with WidgetsBindingObserver {
  late final WebViewController _web;
  String _error = "";
  int _progress = 0;
  DateTime? _backAt;

  @override
  void initState() {
    super.initState();
    _web = WebViewController();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_setUp());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Back from the sign-in tab (or any other app): the terminal checks a waiting Google / Facebook login now.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_web.runJavaScript("window.dispatchEvent(new Event('ict:resume'))").catchError((_) {}));
    }
  }

  Future<void> _setUp() async {
    final web = _web;
    await web.setJavaScriptMode(JavaScriptMode.unrestricted);
    await web.setBackgroundColor(kBg);
    await web.enableZoom(false);                 // pinch zooms the chart, never the whole page
    final ua = await web.getUserAgent() ?? "";
    await web.setUserAgent("$ua $kUaTag".trim());
    await web.addJavaScriptChannel("IctApp", onMessageReceived: (m) => _onMessage(m.message));
    await web.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (req) {
        if (staysInApp(req.url)) return NavigationDecision.navigate;
        unawaited(_openOutside(req.url));
        return NavigationDecision.prevent;
      },
      onProgress: (p) => mounted ? setState(() => _progress = p) : null,
      onPageFinished: (_) => _tellPage(),
      onWebResourceError: (e) {
        if ((e.isForMainFrame ?? true) && mounted) setState(() => _error = e.description);
      },
    ));
    // alert / confirm / prompt of the page (e.g. "Remove all drawings?") as phone dialogs
    await web.setOnJavaScriptAlertDialog((r) => _dialog(r.message, ok: "OK"));
    await web.setOnJavaScriptConfirmDialog((r) async => await _dialog(r.message, ok: "OK", cancel: "Cancel") ?? false);
    await web.setOnJavaScriptTextInputDialog((r) async => await _prompt(r.message, r.defaultText ?? "") ?? "");
    final platform = web.platform;
    if (platform is AndroidWebViewController) {
      await platform.setOnShowFileSelector(_pickFiles);       // watchlist import, pictures in ideas
      await platform.setMediaPlaybackRequiresUserGesture(false);
    }
    await web.loadRequest(Uri.parse(kWebUrl));
  }

  /// Tells the page it runs in the app (version, lock on / off); the terminal reads window.__ictApp.
  Future<void> _tellPage() async {
    final on = widget.lock.enabled;
    try {
      await _web.runJavaScript("window.__ictApp = { version: '$kAppVersion', lock: $on, lockAvailable: ${await widget.lock.available()} };"
          "window.dispatchEvent(new Event('ict:app'));");
    } catch (_) {/* the page is still loading */}
  }

  Future<void> _onMessage(String raw) async {
    final m = BridgeMessage.parse(raw);
    switch (m) {
      case OpenUrl(:final url):
        await _openOutside(url);
      case SaveFile(:final name, :final mime, :final bytes):
        final dir = await getTemporaryDirectory();
        final file = File("${dir.path}/$name");
        await file.writeAsBytes(bytes, flush: true);
        await Share.shareXFiles([XFile(file.path, mimeType: mime, name: name)], subject: name);
      case ShareText(:final text):
        await Share.share(text);
      case SetLock(:final on):
        final ok = await widget.lock.setEnabled(on);
        if (!ok && mounted) _snack(widget.lock.lastError.isNotEmpty ? widget.lock.lastError : "The fingerprint lock is not available on this phone.");
        await _tellPage();
      case null:
        break;
    }
  }

  Future<void> _openOutside(String url) async {
    final u = Uri.tryParse(url);
    if (u == null) return;
    // the Google / Facebook sign-in runs in a Chrome tab on top of the app (Google allows that, not a
    // WebView); when it is done the server sends ictterminal://login, which closes the tab
    if (isSignIn(u)) {
      // Google / Facebook refuse sign-in inside an app's own web view: always the phone's browser
      // (Chrome). The server's last page sends ictterminal://login, which brings this app back.
      var ok = false;
      try {
        ok = await launchUrl(u, mode: LaunchMode.externalApplication);
      } catch (_) {
        ok = false;
      }
      if (!ok && mounted) _snack("Could not open the browser for the sign-in");
      return;
    }
    if (!await launchUrl(u, mode: LaunchMode.externalApplication) && mounted) _snack("Could not open $url");
  }

  Future<List<String>> _pickFiles(FileSelectorParams params) async {
    final types = params.acceptTypes.where((t) => t.isNotEmpty).toList();
    final ext = types.where((t) => t.startsWith(".")).map((t) => t.substring(1)).toList();
    final images = types.isNotEmpty && types.every((t) => t.startsWith("image/"));
    final res = await FilePicker.platform.pickFiles(
      allowMultiple: params.mode == FileSelectorMode.openMultiple,
      type: ext.isNotEmpty ? FileType.custom : images ? FileType.image : FileType.any,
      allowedExtensions: ext.isNotEmpty ? ext : null,
    );
    return [for (final f in res?.files ?? const <PlatformFile>[]) if (f.path != null) Uri.file(f.path!).toString()];
  }

  Future<bool?> _dialog(String text, {required String ok, String? cancel}) => showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(content: Text(text), actions: [
          if (cancel != null) TextButton(onPressed: () => Navigator.pop(c, false), child: Text(cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(ok)),
        ]),
      );

  Future<String?> _prompt(String text, String value) {
    final field = TextEditingController(text: value);
    return showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(text),
          const SizedBox(height: 10),
          TextField(controller: field, autofocus: true),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text("Cancel")),
          FilledButton(onPressed: () => Navigator.pop(c, field.text), child: const Text("OK")),
        ],
      ),
    );
  }

  void _snack(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  /// Back button: closes the terminal's open dialog / menu / panel first, then goes back a page, then
  /// asks for a second press to leave the app.
  Future<void> _back() async {
    try {
      final closed = await _web.runJavaScriptReturningResult("window.__ictBack ? window.__ictBack() : false");
      if (closed == true || closed == "true") return;
    } catch (_) {/* page not ready */}
    if (await _web.canGoBack()) {
      await _web.goBack();
      return;
    }
    final now = DateTime.now();
    if (_backAt != null && now.difference(_backAt!) < const Duration(seconds: 2)) {
      await SystemNavigator.pop();
      return;
    }
    _backAt = now;
    _snack("Press back again to close ICT Terminal");
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_back());
      },
      child: Scaffold(
        body: SafeArea(
          child: _error.isNotEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.wifi_off, color: kMuted, size: 40),
                      const SizedBox(height: 12),
                      Text("ICT Terminal could not load.\n$_error", textAlign: TextAlign.center, style: const TextStyle(color: kMuted)),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: () {
                          setState(() => _error = "");
                          unawaited(_web.reload());
                        },
                        child: const Text("Try again"),
                      ),
                    ]),
                  ),
                )
              : Stack(children: [
                  WebViewWidget(controller: _web),
                  if (_progress < 100) LinearProgressIndicator(value: _progress / 100, minHeight: 2, color: kAccent, backgroundColor: kBg),
                ]),
        ),
      ),
    );
  }
}
