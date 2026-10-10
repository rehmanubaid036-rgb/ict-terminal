import "dart:convert";

import "package:flutter_test/flutter_test.dart";
import "package:ict_terminal/bridge.dart";

void main() {
  const web = "https://ict.iccterminal.trade/terminal/";

  test("the terminal stays in the app, everything else opens outside", () {
    expect(staysInApp("https://ict.iccterminal.trade/terminal/", web: web), isTrue);
    expect(staysInApp("https://ict.iccterminal.trade/terminal/?symbol=AXI:XAUUSD&tf=1m", web: web), isTrue);
    expect(staysInApp("https://ict.iccterminal.trade/terminal", web: web), isTrue);
    expect(staysInApp("about:blank", web: web), isTrue);
    expect(staysInApp("https://ict.iccterminal.trade/auto-trading.html", web: web), isFalse);   // the website: browser
    expect(staysInApp("https://ict.iccterminal.trade/api/v1/oauth/google/start?session=x", web: web), isFalse);
    expect(staysInApp("https://accounts.google.com/o/oauth2/v2/auth", web: web), isFalse);
    expect(staysInApp("https://wa.me/923001234567", web: web), isFalse);
    expect(staysInApp("mailto:someone@example.com", web: web), isFalse);
    expect(staysInApp("https://evil.example/terminal/", web: web), isFalse);
    expect(staysInApp("https://ict.iccterminal.trade.evil.example/terminal/", web: web), isFalse);
  });

  test("bridge messages", () {
    expect(BridgeMessage.parse(jsonEncode({"type": "open", "url": "https://t.me/x"})), isA<OpenUrl>());
    final save = BridgeMessage.parse(jsonEncode({"type": "save", "name": "../../gold 1m.png", "mime": "image/png", "base64": base64Encode([1, 2, 3])}));
    expect(save, isA<SaveFile>());
    expect((save as SaveFile).name, "gold 1m.png");
    expect(save.bytes, [1, 2, 3]);
    expect((BridgeMessage.parse(jsonEncode({"type": "lock", "on": true})) as SetLock).on, isTrue);
    expect(BridgeMessage.parse(jsonEncode({"type": "share", "text": "https://ict.iccterminal.trade/s/abc"})), isA<ShareText>());
    expect(BridgeMessage.parse("not json"), isNull);
    expect(BridgeMessage.parse(jsonEncode({"type": "unknown"})), isNull);
    expect(BridgeMessage.parse(jsonEncode({"type": "save", "name": "x"})), isNull);
  });

  test("file names are safe", () {
    expect(safeFileName("AXI_XAUUSD_1m.png"), "AXI_XAUUSD_1m.png");
    expect(safeFileName(r"..\..\a:b*c.txt"), "a_b_c.txt");
    expect(safeFileName("../../etc/passwd"), "passwd");
    expect(safeFileName(".hidden"), "ict_file.hidden");
    expect(safeFileName(""), "ict_file");
  });

  test("the lock asks again only after two minutes away", () {
    final now = DateTime(2026, 10, 10, 12);
    expect(needsUnlock(enabled: false, pausedAt: null, now: now), isFalse);
    expect(needsUnlock(enabled: true, pausedAt: null, now: now), isTrue);
    expect(needsUnlock(enabled: true, pausedAt: now.subtract(const Duration(seconds: 30)), now: now), isFalse);
    expect(needsUnlock(enabled: true, pausedAt: now.subtract(const Duration(minutes: 3)), now: now), isTrue);
  });

  test("only the Google / Facebook start page opens in the sign-in tab", () {
    expect(isSignIn(Uri.parse("https://ict.iccterminal.trade/api/v1/oauth/google/start?session=x")), isTrue);
    expect(isSignIn(Uri.parse("https://ict.iccterminal.trade/api/v1/oauth/facebook/start")), isTrue);
    expect(isSignIn(Uri.parse("https://ict.iccterminal.trade/guide/")), isFalse);
    expect(isSignIn(Uri.parse("https://wa.me/123")), isFalse);
  });
}
