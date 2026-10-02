# ICT Terminal: VPS setup (Roman Urdu)

ICT Terminal VPS par ICC Terminal ke sath alag chalta hai. **ICC ko koi haath nahi lagta:**

| | ICT Terminal | ICC Terminal (nahi chheda jata) |
|---|---|---|
| Folder | `C:\ICT engine` | `C:\ICC` |
| Python | apna `.venv` | system Python |
| Ports | 3100, 8100, 8101 | 8000, 8001, 8501 |
| Cloudflare tunnel | apni: service "ICT Tunnel" | "ICC Tunnel" |
| Auto-start task | "ICT Terminal" | "ICC Terminal" |
| MT5 (data) | apna alag Axi demo | ICC ke apne terminals |

Addresses:
- Website (plans, downloads, guide): https://ict.iccterminal.trade
- Web terminal: https://ict.iccterminal.trade/terminal/
- APK download: https://ict.iccterminal.trade/downloads/ICT_Terminal.apk
- Windows app download: https://ict.iccterminal.trade/downloads/ICT_Terminal_Windows.exe
- API (app aur EA): https://ictapi.iccterminal.trade
- Admin panel: https://ictadmin.iccterminal.trade/admin/

Website par plans ki prices khud admin panel se aati hain. Admin panel me price set karein, website par foran nazar aa jayegi.
APK aur Windows app har update zip ke `downloads` folder me hoti hain, is leye website ke download buttons khud update ho jaate hain.

## Pehli dafa install

ICC ko pehle ya baad me kuch nahi karna. Wo jaise chal raha hai chalta rahe.

1. **ICT ka apna MT5:** Axi MT5 ka installer chalaein aur install folder `C:\ICT engine\mt5` chunein. Is ke baad:
   - Usay khol kar Axi **demo** account me login karein aur "Save password" on rakhein.
   - Tools > Options > Charts > "Max bars in chart" ko **Unlimited** kar dein.

   ICC ke MT5 terminals istemal nahi honge. Setup unhein khud mana kar deta hai.
2. `ICT_Terminal_VPS_v….zip` ko `C:\ICT engine` me extract karein.
3. `C:\ICT engine\oneclickict.bat` par right-click karein aur **Run as administrator** chunein. Ye script ye sab karti hai:
   - Python packages ICT ke `.venv` me install karti hai.
   - Settings, database, plans aur superadmin banati hai.
   - ICT ki apni Cloudflare tunnel aur auto-start set karti hai.
   - Sab services chala kar aakhir me check chalati hai.

   Agar Cloudflare login maange to browser me login karein aur `iccterminal.trade` chunein. Ye sirf aik dafa hota hai.
4. Phir `vpscheckict.bat` chalaein. Jo report aaye (ya `deploy\vpscheck_ict_report.txt`) wo copy kar ke Claude ko bhej dein.

Superadmin ka email aur password `admin_panel\.env` me hain (`DJANGO_SUPERUSER_EMAIL` aur `DJANGO_SUPERUSER_PASSWORD`). Admin panel me plans ki prices set karein.

## Update (nayi zip)

1. Nayi zip ko `C:\ICT engine` me extract karein aur overwrite karein.

   Ye cheezen zip me nahi hotin, es leye mehfooz rehti hain:
   - `.env` files
   - database
   - users aur signals
   - tunnel ki key
2. `oneclickict.bat` ko dobara Run as administrator se chalaein. Ye ICT ko band karti hai, update karti hai, aur dobara chala kar check karti hai.

## Zaroori: ICC ka one-click

ICC ka apna `ICC_ONE_CLICK.bat` chalte waqt VPS ke **saare** Python programs band kar deta hai, ICT ke bhi. ICT is se kharab nahi hota, sirf ruk jata hai. Jab bhi ICC ka one-click chalaein, us ke baad `oneclickict.bat` dobara chala dein, ya VPS ko log off / log on kar dein.

## ICT ko band karna aur chalana

- **Band karne ke leye:** `C:\ICT engine\ictoneclickclose.bat` par right-click karein aur Run as administrator chunein. Ye sirf ICT ke programs band karti hai, phir saaf batati hai:
  - ICT ka koi program baqi hai ya nahi (hona chahiye: "none");
  - ICT ke ports khaali hue ya nahi;
  - jo Python programs ab bhi chal rahe hain, wo ICT ke nahi (ICC Terminal ke) hain, aur un ki list.
- **Dobara chalane ke leye:** `oneclickict.bat`, ya `deploy\startict.bat`. Login par ICT khud bhi chalta hai.

## MT5 EA (auto-trading)

1. `ea\mt5\ICT_Bridge.mq5` aur `ICT_Json.mqh` ko MT5 ke `MQL5\Experts\ICT` folder me copy karein, phir MetaEditor me Compile karein.
2. MT5 me Tools > Options > Expert Advisors me "Allow WebRequest" on karein aur ye URL add karein: `https://ictapi.iccterminal.trade`
3. EA chart par lagaein aur user ka token dein. Pehle sirf **demo** account par chalaein.
4. Auto-trade sirf un models par hoga jo admin panel ki Site settings > "Auto-trade models" me approve kiye gaye hon. Abhi koi model approve nahi hai.

## Masla ho to

- Har ICT service ki apni minimized window hoti hai ("ICT API Server", "ICT Engine Runner" waghera). Error usi window me nazar aata hai.
- `vpscheckict.bat` ki report Claude ko bhejein.
