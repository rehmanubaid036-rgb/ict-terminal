import "package:flutter/material.dart";
import "package:local_auth/local_auth.dart";
import "package:shared_preferences/shared_preferences.dart";

import "bridge.dart";
import "theme.dart";

/// Optional fingerprint / face / PIN lock (switched on in the terminal: Account > Fingerprint lock).
class AppLock {
  AppLock({LocalAuthentication? auth}) : _auth = auth ?? LocalAuthentication();
  final LocalAuthentication _auth;
  static const _key = "ict.lock";
  bool enabled = false;

  Future<void> load() async => enabled = (await SharedPreferences.getInstance()).getBool(_key) ?? false;

  Future<bool> available() async {
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  /// Switching on asks for the fingerprint once, so nobody locks themselves out by mistake.
  Future<bool> setEnabled(bool on) async {
    if (on && !(await available() && await unlock("Confirm to switch on the lock"))) return false;
    enabled = on;
    await (await SharedPreferences.getInstance()).setBool(_key, on);
    return true;
  }

  Future<bool> unlock([String reason = "Unlock ICT Terminal"]) async {
    try {
      return await _auth.authenticate(localizedReason: reason, options: const AuthenticationOptions(stickyAuth: true));
    } catch (_) {
      return false;
    }
  }
}

/// Shows the terminal; covers it while the lock asks (at start and when the app comes back after
/// [kRelockAfter] in the background).
class LockGate extends StatefulWidget {
  const LockGate({super.key, required this.lock, required this.child});
  final AppLock lock;
  final Widget child;

  @override
  State<LockGate> createState() => _LockGateState();
}

class _LockGateState extends State<LockGate> with WidgetsBindingObserver {
  bool _locked = false;
  bool _asking = false;
  DateTime? _pausedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _locked = widget.lock.enabled;
    if (_locked) WidgetsBinding.instance.addPostFrameCallback((_) => _ask());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_asking) return;                                   // the fingerprint sheet itself pauses the app
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) _pausedAt ??= DateTime.now();
    if (state == AppLifecycleState.resumed) {
      if (needsUnlock(enabled: widget.lock.enabled, pausedAt: _pausedAt, now: DateTime.now())) {
        setState(() => _locked = true);
        _ask();
      }
      _pausedAt = null;
    }
  }

  Future<void> _ask() async {
    if (_asking) return;
    _asking = true;
    final ok = await widget.lock.unlock();
    _asking = false;
    if (mounted && ok) setState(() => _locked = false);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      widget.child,
      if (_locked)
        Positioned.fill(
          child: ColoredBox(
            color: kBg,
            child: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.fingerprint, size: 64, color: kAccent),
                const SizedBox(height: 12),
                const Text("ICT Terminal is locked", style: TextStyle(color: kText, fontSize: 16)),
                const SizedBox(height: 16),
                FilledButton(onPressed: _ask, child: const Text("Unlock")),
              ]),
            ),
          ),
        ),
    ]);
  }
}
