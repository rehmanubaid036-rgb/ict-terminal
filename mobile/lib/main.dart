import "package:flutter/material.dart";

import "lock.dart";
import "shell.dart";
import "theme.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final lock = AppLock();
  await lock.load();
  runApp(IctApp(lock: lock));
}

class IctApp extends StatelessWidget {
  const IctApp({super.key, required this.lock});
  final AppLock lock;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "ICT Terminal",
      debugShowCheckedModeBanner: false,
      theme: ictTheme(),
      home: LockGate(lock: lock, child: TerminalShell(lock: lock)),
    );
  }
}
