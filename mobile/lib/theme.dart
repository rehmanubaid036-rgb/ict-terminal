import "package:flutter/material.dart";

const kBg = Color(0xFF131722);
const kPanel = Color(0xFF1E222D);
const kBorder = Color(0xFF2A2E39);
const kText = Color(0xFFD1D4DC);
const kMuted = Color(0xFF9598A1);
const kBlue = Color(0xFF2962FF);
const kAccent = Color(0xFF2DD4BF); // ICT teal (ICC Terminal is amber)
const kUp = Color(0xFF26A69A);
const kDown = Color(0xFFEF5350);

ThemeData ictTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: kBg,
    colorScheme: base.colorScheme.copyWith(primary: kBlue, secondary: kAccent, surface: kPanel),
    appBarTheme: const AppBarTheme(backgroundColor: kPanel, foregroundColor: kText, elevation: 0),
    cardTheme: const CardTheme(color: kPanel, margin: EdgeInsets.symmetric(horizontal: 12, vertical: 5)),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: kBg,
      border: OutlineInputBorder(borderSide: BorderSide(color: kBorder)),
      enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: kBorder)),
    ),
    navigationBarTheme: const NavigationBarThemeData(backgroundColor: kPanel, indicatorColor: kBlue),
  );
}
