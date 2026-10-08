import hashlib
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

# No 0/O/1/I so keys could be read out over WhatsApp without mistakes
_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_license_key():
    """License keys are no longer used (accounts only), but migration 0001 still
    references this function, so it has to stay importable."""
    groups = ["".join(secrets.choice(_KEY_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "IQT-" + "-".join(groups)


AI_PROVIDERS = [("none", "Off (template answers only)"), ("anthropic", "Anthropic Claude"), ("openai", "OpenAI"),
                ("gemini", "Google Gemini"), ("openrouter", "OpenRouter"), ("groq", "Groq")]

class Plan(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=80, unique=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="USD")
    duration_days = models.PositiveIntegerField(default=30, help_text="0 = lifetime")
    is_vip = models.BooleanField(default=True, help_text="Paid access. Untick for free / trial plans.")
    # ICT Terminal features
    can_view_signals = models.BooleanField("Live model signals", default=True,
                                           help_text="Signals panel and ICT model indicators on charts")
    signal_delay_minutes = models.PositiveIntegerField(
        default=0, help_text="Show signals this many minutes late (e.g. 30 on a free plan). 0 = real time")
    allowed_models = models.CharField(
        max_length=200, default="all",
        help_text='"all", or model ids separated by commas, e.g. M1,M2,M4')
    ict_indicators = models.BooleanField("ICT indicators", default=True,
                                         help_text="FVG, order blocks, liquidity and market structure on charts")
    max_charts = models.PositiveSmallIntegerField("Charts per layout", default=4, choices=[(n, str(n)) for n in range(1, 9)])
    can_view_trades = models.BooleanField("MT5 accounts", default=True,
                                          help_text="Connected MT5 accounts, positions and P/L in the terminal")
    can_auto_trade = models.BooleanField("Auto-trading (ICT Bridge EA)", default=False)
    max_mt_accounts = models.PositiveIntegerField("MT accounts", default=1,
                                                  help_text="MT4 / MT5 accounts the EA may trade. 0 = unlimited")
    ai_messages_per_day = models.PositiveIntegerField("AI agent messages per day", default=0,
                                                      help_text="0 = AI agent off")
    alerts_limit = models.PositiveIntegerField("Alerts", default=10, help_text="Active alerts per user. 0 = unlimited")
    can_use_backtest = models.BooleanField("Backtests and model statistics", default=True)
    show_ads = models.BooleanField("Show ads", default=False,
                                   help_text="Tick for the free / trial plans. Paying VIP plans: leave it off.")
    max_devices = models.PositiveIntegerField(default=2, editable=False,
                                              help_text="Old single device limit, replaced by the three limits below")
    max_mobile = models.PositiveIntegerField("Mobile app devices", default=1,
                                             help_text="Phones with the ICT Terminal app. 0 = unlimited")
    max_desktop = models.PositiveIntegerField("Windows app devices", default=1,
                                              help_text="PCs with the ICT Terminal Windows app. 0 = unlimited")
    max_web = models.PositiveIntegerField("Web terminal browsers", default=1,
                                          help_text="Browsers using the web terminal. 0 = unlimited")
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(default=True, help_text="Listed in the app's upgrade screen")
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "price"]

    def __str__(self):
        return self.name

    @property
    def duration_label(self):
        return "Lifetime" if self.duration_days == 0 else f"{self.duration_days} days"

    @property
    def device_limits(self):
        return {"mobile": self.max_mobile, "desktop": self.max_desktop, "web": self.max_web}

    @property
    def model_ids(self):
        """None = every model; otherwise the ids this plan allows."""
        raw = self.allowed_models.strip()
        if not raw or raw.lower() == "all":
            return None
        return [m.strip().upper() for m in raw.split(",") if m.strip()]


class SiteSettings(models.Model):
    """Single-row settings edited in the admin (Registration settings)."""

    allow_signup = models.BooleanField("Email + password sign-up", default=True,
                                       help_text="Show \"Create account\" with email + password. Off = new accounts "
                                                 "only through Google / Facebook")
    signup_plans = models.ManyToManyField(
        Plan, blank=True, related_name="+",
        verbose_name="Free trial plans",
        help_text="Plans given as the automatic free trial (e.g. VIP Trial). Empty = no free trial.")

    # Broker partnership: shown as a button in the app and desktop dashboard
    broker_name = models.CharField(max_length=60, default="Axi")
    partner_link = models.URLField(max_length=300, blank=True,
                                   default="https://www.axi.com/int/live-account?promocode=4735876",
                                   help_text="Your partner / referral sign-up link. Empty hides the button.")
    partner_button_text = models.CharField(max_length=60, default="Open Axi Account")

    # Auto-trading (ICT Bridge EA)
    copy_trading_enabled = models.BooleanField(
        "Auto-trading on", default=True, help_text="Master switch. Off = no ICT Bridge EA opens trades.")
    auto_trade_models = models.CharField(
        "Models approved for auto-trading", max_length=200, blank=True,
        help_text="Model ids, comma separated (e.g. M9). Only models proven in backtests belong here. "
                  "Empty = the EA connects and reports but opens no trades.")
    copy_magic_numbers = models.CharField(
        max_length=200, blank=True,
        help_text="Magic numbers of the master EA(s) whose trades VIPs see and copy, comma separated "
                  "(e.g. 20250101). Empty = every trade on the master MT5.")
    copy_lot_per_1000 = models.DecimalField(
        max_digits=6, decimal_places=2, default=0.01,
        help_text="Copier lot size for every 1,000 USD of the follower's balance (before their multiplier).")
    # Login methods (enforced by the server, the apps only show the matching buttons)
    allow_email_login = models.BooleanField(
        "Email + password login", default=True,
        help_text="Off = nobody can log in with email + password (apps, Windows, web); only Google / Facebook.")
    allow_google_login = models.BooleanField("Google login", default=True)
    allow_facebook_login = models.BooleanField("Facebook login", default=True)
    guest_login_enabled = models.BooleanField(
        "Login as guest", default=True,
        help_text="Shows \"Continue as guest\" on the web terminal's login screen. Each browser gets its own "
                  "guest account (no email or password). Off = the button disappears and guests are locked.")
    guest_plan = models.ForeignKey(
        Plan, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        verbose_name="Guest features",
        help_text="Guests get the features of this plan. Edit that plan (Plans > Guest) to switch features on or off. "
                  "Empty = guests are locked like users without a plan.")

    # Free trial (automatic, only for Google / Facebook accounts in the mobile or Windows app)
    trial_enabled = models.BooleanField(
        "Automatic free trial", default=True,
        help_text="New Google / Facebook accounts get the plans ticked under Registration (e.g. VIP Trial) "
                  "once, if this phone / PC never had a trial and the account never had one.")
    signups_per_ip_hour = models.PositiveIntegerField(
        "New accounts per IP per hour", default=3, help_text="Stops bots creating many accounts. 0 = no limit.")

    # Forced app update
    min_app_version = models.CharField(
        "Minimum app version", max_length=20, blank=True,
        help_text='e.g. 2.13.1. Phones with an older Android app see a full-screen "Update required" and must '
                  "download the new version to continue. Empty = no forced update (only the daily reminder).")

    # Device protection
    device_idle_hours = models.PositiveIntegerField(
        default=2, help_text="A device that has not been used for this many hours loses its slot when the "
                             "customer signs in on a new device of the same type (the old one is logged out). "
                             "0 = never: the customer must log out on the old device first.")

    # Crypto payments: exchanges often take their withdrawal fee out of the amount sent
    crypto_diff_usd = models.DecimalField(
        "Allowed difference (USD)", max_digits=8, decimal_places=2, default=Decimal("3"),
        help_text="A crypto payment this much below (or above) the order amount still activates the plan by itself, "
                  "e.g. 3 = 27 USDT is accepted for a 30 USDT order.")
    crypto_diff_percent = models.DecimalField(
        "Allowed difference (%)", max_digits=5, decimal_places=2, default=Decimal("2"),
        help_text="The same as a percentage of the order; the larger of the two counts, e.g. 2% = 244 USDT is "
                  "accepted for a 249 USDT order. Bigger differences go to Needs review.")

    # Backtests / model statistics (who may use them is also set per plan)
    backtest_enabled = models.BooleanField("Backtests on", default=True,
                                           help_text="Off = backtests and model statistics disappear in all apps.")
    backtest_free = models.BooleanField("Backtests for users without a plan", default=False)
    mt5_time_offset_hours = models.IntegerField(
        "MT5 server time (UTC +hours)", default=3,
        help_text="MT5 shows broker server time. Axi is UTC+3 in summer, UTC+2 in winter.")
    broker_symbol_map = models.TextField(
        "Broker symbols", blank=True,
        help_text="One per line, BROKER=MARKET, e.g. XAUUSD=GC_GOLD or NAS100=NASDAQ (matched by the start of the "
                  "name, so XAUUSD.pro works). Empty = the built-in list.")
    # Ads (Ad manager)
    ads_enabled = models.BooleanField("Ads on", default=True, help_text="Off = no ad anywhere.")
    ads_for_free = models.BooleanField("Ads for users without a plan", default=True,
                                       help_text="Guests and accounts with no active plan.")
    # Community chat
    community_enabled = models.BooleanField("Community on", default=True,
                                            help_text="Off = the Community button disappears in all apps.")
    community_wait_minutes = models.PositiveIntegerField(
        "New account wait (minutes)", default=10,
        help_text="A new account can read at once but write only after this many minutes (stops bots).")
    community_rules = models.TextField("Community rules", default='1. Be respectful. No insults, harassment, hate speech or threats.\n2. No abusive, vulgar or sexual language, in any language.\n3. No spam, advertising, links, referral codes or self-promotion.\n4. Never share personal information (phone, email, address, IDs) - yours or anyone else\'s.\n5. No scams: no selling signals or accounts, no "account management" offers, never ask for money or crypto.\n6. Keep it about trading and ICT Terminal.\n7. Nothing here is financial advice. Trade at your own risk.\n8. Admins can delete messages and mute or ban accounts that break these rules.',
                                       help_text="Every user must accept these before the first message.")
    community_blocked_words = models.TextField(
        "Extra blocked words", blank=True,
        help_text="One per line, added to the built-in list of abusive words (English, Urdu, Hindi).")
    # WhatsApp signal alerts (Meta WhatsApp Cloud API)
    whatsapp_alerts_enabled = models.BooleanField("WhatsApp signal alerts on", default=False,
                                                  help_text="Off = no WhatsApp message is sent to anyone.")
    whatsapp_phone_number_id = models.CharField("Phone number ID", max_length=40, blank=True,
                                                help_text="Meta for Developers → your app → WhatsApp → API setup → Phone number ID.")
    whatsapp_token = models.CharField("Access token", max_length=600, blank=True,
                                      help_text="A permanent System User token with whatsapp_business_messaging permission.")
    whatsapp_template = models.CharField("Message template name", max_length=60, default="ict_signal",
                                         help_text="An approved template with 8 variables, see the help text below.")
    whatsapp_template_lang = models.CharField("Template language", max_length=10, default="en")
    whatsapp_alert_template = models.CharField(
        "Chart alert template name", max_length=60, default="ict_alert",
        help_text="An approved template with 1 variable: {{1}} the alert text (chart alerts: price, line, zone, session, ICT events).")
    chart_alerts_enabled = models.BooleanField(
        "Chart alerts from the server on", default=True,
        help_text="The server checks every user's chart alerts even when the terminal is closed and sends them to the "
                  "channels the user turned on (WhatsApp, Telegram, email, webhook).")
    telegram_bot_token = models.CharField("Telegram bot token", max_length=100, blank=True,
                                          help_text="From @BotFather (/newbot). Empty = no Telegram alerts.")
    telegram_bot_username = models.CharField("Telegram bot username", max_length=60, blank=True,
                                             help_text="Without @, e.g. ICTTerminalAlertsBot. Users open t.me/<this> to connect.")
    email_alerts_enabled = models.BooleanField("Alerts by email on", default=True,
                                               help_text="Needs EMAIL_HOST in admin_panel/.env (otherwise emails are only printed).")
    ai_provider = models.CharField("AI provider", max_length=20, default="none", choices=AI_PROVIDERS,
                                   help_text="The model that words the chart assistant's answers (it only rewrites the engine's facts).")
    ai_model = models.CharField("AI model", max_length=80, blank=True,
                                help_text="Empty = the provider's default (e.g. claude-haiku-4-5, gpt-4o-mini, gemini-2.0-flash).")
    ai_api_key = models.CharField("AI API key", max_length=300, blank=True)
    donations_enabled = models.BooleanField("Donations on", default=False,
                                            help_text="Shows a Donate button in the terminal and a Support section on the website.")
    donation_title = models.CharField(max_length=80, default="Support ICT Terminal")
    donation_text = models.TextField(blank=True, default="ICT Terminal is built by a small team. If it helps your trading, "
                                     "you can support its development with a donation of any size. Thank you!")
    donation_amounts = models.CharField("Suggested amounts", max_length=80, default="5, 10, 25, 50",
                                        help_text="Comma separated, in the donation currency")
    donation_currency = models.CharField(max_length=3, default="USD")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Settings"
        verbose_name_plural = "Settings"

    def __str__(self):
        return "Settings"

    @property
    def approved_models(self):
        return [m.strip().upper() for m in self.auto_trade_models.split(",") if m.strip()]

    @property
    def magic_list(self):
        return [int(m) for m in self.copy_magic_numbers.replace(" ", "").split(",") if m.strip().lstrip("-").isdigit()]

    def save(self, *args, **kwargs):
        self.pk = 1  # there is only ever one row
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class CustomerProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    phone = models.CharField("Phone / WhatsApp", max_length=30, blank=True)
    is_guest = models.BooleanField("Guest", default=False,
                                   help_text="Created by \"Continue as guest\" in the web terminal (no email or password).")
    country = models.CharField(max_length=60, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Profile of {self.user}"


class Subscription(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_SUSPENDED = "suspended"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_SUSPENDED, "Suspended"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    starts_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True,
                                      help_text="Empty = never expires. Filled from the plan when left empty on create.")
    max_devices = models.PositiveIntegerField(null=True, blank=True, editable=False,
                                              help_text="Old single device limit override (no longer used)")
    max_mobile = models.PositiveIntegerField("Mobile app devices", null=True, blank=True,
                                             help_text="Only for this customer. Empty = the plan's limit, 0 = unlimited")
    max_desktop = models.PositiveIntegerField("Windows app devices", null=True, blank=True,
                                              help_text="Only for this customer. Empty = the plan's limit, 0 = unlimited")
    max_web = models.PositiveIntegerField("Web terminal browsers", null=True, blank=True,
                                          help_text="Only for this customer. Empty = the plan's limit, 0 = unlimited")
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+", editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.display_name} · {self.plan}"

    def save(self, *args, **kwargs):
        if self._state.adding and self.expires_at is None and self.plan_id and self.plan.duration_days:
            self.expires_at = (self.starts_at or timezone.now()) + timedelta(days=self.plan.duration_days)
        super().save(*args, **kwargs)

    @property
    def display_name(self):
        return self.user.get_full_name() or self.user.email or self.user.username

    @property
    def is_expired(self):
        return self.expires_at is not None and self.expires_at <= timezone.now()

    @property
    def is_valid(self):
        now = timezone.now()
        return (self.status == self.STATUS_ACTIVE and self.starts_at <= now and not self.is_expired
                and self.plan.is_active)

    @property
    def state_label(self):
        if self.status != self.STATUS_ACTIVE:
            return self.get_status_display()
        if self.starts_at > timezone.now():
            return "Scheduled"
        return "Expired" if self.is_expired else "Active"

    @property
    def days_left(self):
        if self.expires_at is None:
            return None
        return max(0, (self.expires_at - timezone.now()).days)

    @property
    def device_limits(self):
        """{"mobile": n, "desktop": n, "web": n}: this subscription's override, else the plan's. 0 = unlimited."""
        plan = self.plan.device_limits
        own = {"mobile": self.max_mobile, "desktop": self.max_desktop, "web": self.max_web}
        return {kind: plan[kind] if own[kind] is None else own[kind] for kind in plan}

    def extend(self, days):
        """Add days from the later of now and the current expiry (renewals never lose paid time)."""
        base = max(self.expires_at or timezone.now(), timezone.now())
        self.expires_at = base + timedelta(days=days)
        if self.status != self.STATUS_ACTIVE:
            self.status = self.STATUS_ACTIVE


DEVICE_KINDS = [("mobile", "Mobile app"), ("desktop", "Windows app"), ("web", "Web terminal")]
# Which slot a client uses. "desktop" is what the web terminal sent before it had its own
# per-browser id, so it counts as web; the Windows app now sends "windows".
KIND_FOR_PLATFORM = {"android": "mobile", "ios": "mobile", "windows": "desktop", "macos": "desktop",
                     "linux": "desktop", "web": "web", "desktop": "web"}


def device_kind(platform):
    return KIND_FOR_PLATFORM.get((platform or "").lower(), "mobile")


class Device(models.Model):
    PLATFORM_CHOICES = [
        ("android", "Android"), ("ios", "iOS"), ("windows", "Windows"), ("macos", "macOS"),
        ("linux", "Linux"), ("web", "Web"), ("desktop", "Desktop dashboard"), ("other", "Other"),
    ]
    KIND_CHOICES = DEVICE_KINDS

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=128)
    name = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=12, choices=PLATFORM_CHOICES, default="other")
    kind = models.CharField("Type", max_length=8, choices=KIND_CHOICES, default="mobile")
    is_blocked = models.BooleanField(default=False)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(default=timezone.now)
    last_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        unique_together = [("user", "device_id")]
        ordering = ["-last_seen"]

    def __str__(self):
        return self.name or self.device_id


class SocialAccount(models.Model):
    """A Google or Facebook identity linked to an account."""
    PROVIDERS = [("google", "Google"), ("facebook", "Facebook")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="social_accounts")
    provider = models.CharField(max_length=10, choices=PROVIDERS)
    uid = models.CharField("Provider user id", max_length=128)
    email = models.EmailField(blank=True)
    name = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("provider", "uid")]
        verbose_name = "Google / Facebook login"

    def __str__(self):
        return f"{self.get_provider_display()} · {self.email or self.uid}"


class DeviceClaim(models.Model):
    """A phone / PC (mobile or Windows app id) is locked to the first account created on it,
    and gives at most one free trial. Delete the row to let the device create a new account."""

    device_id = models.CharField(max_length=128, unique=True)
    kind = models.CharField("Type", max_length=8, choices=DEVICE_KINDS, default="mobile")
    name = models.CharField(max_length=120, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="device_claims", help_text="Account this device is locked to")
    trial_used = models.BooleanField(default=False)
    blocked_attempts = models.PositiveIntegerField(default=0, help_text="Tries to create another account here")
    created_at = models.DateTimeField(auto_now_add=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        verbose_name = "Device lock"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name or self.device_id


class TrialGrant(models.Model):
    """One automatic free trial per account (and per device, see DeviceClaim)."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trial_grant")
    device_id = models.CharField(max_length=128, blank=True)
    provider = models.CharField(max_length=10, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Free trial given"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Trial · {self.user}"


CRYPTO_NETWORKS = [("trc20_usdt", "USDT · TRON (TRC20)"), ("bep20_usdt", "USDT · BNB Smart Chain (BEP20)"),
                   ("base_usdc", "USDC · Base")]


class CryptoWallet(models.Model):
    """Where customers pay in crypto. Only the public address is stored: the server can see
    payments arrive but can never move money (no private keys)."""

    network = models.CharField(max_length=12, choices=CRYPTO_NETWORKS, unique=True)
    address = models.CharField(max_length=64, help_text="Your receiving address. Copy it from your own wallet "
                                                        "(self-custody wallet recommended, e.g. Trust Wallet).")
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Crypto wallet"
        ordering = ["network"]

    def __str__(self):
        return f"{self.get_network_display()} · {self.fingerprint}"

    @property
    def fingerprint(self):
        a = self.address or ""
        return f"{a[:6]}…{a[-6:]}" if len(a) > 14 else a


class CryptoWalletChange(models.Model):
    """Every change of a receiving address (a changed address would redirect payments)."""

    network = models.CharField(max_length=12, choices=CRYPTO_NETWORKS)
    old_address = models.CharField(max_length=64, blank=True)
    new_address = models.CharField(max_length=64, blank=True)
    changed_by = models.CharField(max_length=150, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]
        verbose_name = "Crypto wallet change (audit log)"


class CryptoOrder(models.Model):
    """A customer's crypto checkout: pay this exact amount to this address within the time
    limit; the watcher confirms it on the blockchain and activates the plan by itself."""

    STATUS = [("waiting", "Waiting for payment"), ("confirming", "Confirming on the blockchain"),
              ("paid", "Paid - plan active"), ("expired", "Expired (no payment)"),
              ("cancelled", "Cancelled by the customer"), ("review", "Needs review"), ("rejected", "Rejected")]

    KINDS = [("plan", "Plan"), ("donation", "Donation")]

    kind = models.CharField(max_length=10, choices=KINDS, default="plan", db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="crypto_orders",
                             null=True, blank=True, help_text="Empty for a donation from a visitor without an account")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="+", null=True, blank=True)
    donation = models.OneToOneField("Donation", on_delete=models.SET_NULL, null=True, blank=True, related_name="crypto_order")
    key = models.CharField(max_length=32, blank=True, help_text="Lets a donor without an account follow the order")
    network = models.CharField(max_length=12, choices=CRYPTO_NETWORKS)
    address = models.CharField(max_length=64, help_text="Receiving address at the time of the order")
    amount = models.DecimalField(max_digits=18, decimal_places=4, help_text="Exact amount to pay (unique)")
    price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Plan price (or the donation) in USD")
    status = models.CharField(max_length=10, choices=STATUS, default="waiting", db_index=True)
    txid = models.CharField("Transaction ID", max_length=80, null=True, blank=True, unique=True)
    paid_amount = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)
    from_address = models.CharField(max_length=64, blank=True)
    confirmations = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=250, blank=True)
    payment = models.ForeignKey("Payment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    source = models.CharField(max_length=10, default="app")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    checked_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Crypto payment"

    def __str__(self):
        return f"#{self.pk} {self.amount} · {self.get_network_display()} · {self.get_status_display()}"

    @property
    def who(self):
        if self.user:
            return self.user.email
        if self.donation:
            return self.donation.email or self.donation.name or "visitor"
        return "visitor"

    @property
    def open(self):
        return self.status in ("waiting", "confirming")


class CryptoTransfer(models.Model):
    """Every official-token payment seen arriving at our addresses while orders were open,
    matched to an order or not: nothing that reaches the wallet is lost from view."""

    STATUS = [("new", "New"), ("matched", "Matched to an order"), ("unmatched", "Not matched - check it")]

    network = models.CharField(max_length=12, choices=CRYPTO_NETWORKS)
    address = models.CharField(max_length=64)
    txid = models.CharField("Transaction ID", max_length=80)
    value = models.DecimalField(max_digits=40, decimal_places=0, help_text="Smallest token units")
    amount = models.DecimalField(max_digits=24, decimal_places=6)
    from_address = models.CharField(max_length=64, blank=True)
    block_time = models.DateTimeField(null=True, blank=True)
    confirmations = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS, default="new", db_index=True)
    order = models.ForeignKey(CryptoOrder, on_delete=models.SET_NULL, null=True, blank=True, related_name="transfers",
                              help_text="To give a customer their plan for an unmatched payment: pick their order "
                                        "here, save, then use the action “Pay the linked order”.")
    note = models.CharField(max_length=250, blank=True)
    seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-seen_at"]
        verbose_name = "Incoming crypto transfer"
        constraints = [models.UniqueConstraint(fields=["network", "txid"], name="crypto_transfer_once")]

    def __str__(self):
        return f"{self.amount} · {self.get_network_display()} · {self.txid[:12]}…"


class CryptoScanState(models.Model):
    """Per network: when the chain was last read, and a short lease so only one process
    (watcher or a customer's status check) reads it at a time."""

    network = models.CharField(max_length=12, choices=CRYPTO_NETWORKS, unique=True)
    cursor = models.FloatField(null=True, blank=True, help_text="Unix time already read up to")
    scanned_at = models.DateTimeField(null=True, blank=True)
    lease_until = models.DateTimeField(null=True, blank=True)


class OAuthLogin(models.Model):
    """One Google / Facebook sign-in in progress (10 minutes). The app / terminal that
    started it polls with its secret session id; the browser shows the provider pages."""

    session_hash = models.CharField(max_length=64, unique=True)
    state = models.CharField(max_length=64, unique=True)
    provider = models.CharField(max_length=10)
    device_id = models.CharField(max_length=128, blank=True)
    device_name = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=12, blank=True)
    legacy_id = models.CharField(max_length=128, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    uid = models.CharField(max_length=128, blank=True)
    email = models.EmailField(blank=True)
    name = models.CharField(max_length=150, blank=True)
    confirm_key = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=10, default="pending")   # pending / verified / done / error
    result = models.TextField(blank=True, help_text="JSON handed to the app once, then cleared")
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def expired(self):
        return (timezone.now() - self.created_at).total_seconds() > 600


class EaConnection(models.Model):
    """A customer's MT5 copier: the token their EA sends, their copy settings and the
    EA's last check-in. The raw token is only shown when it is generated."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ea_connection")
    copy_enabled = models.BooleanField(default=False, help_text="The customer's Copy ON / OFF switch")
    multiplier = models.DecimalField(max_digits=4, decimal_places=2, default=1,
                                     help_text="Scales the lot size (0.1 – 10). 1 = 0.01 lot per 1,000 USD.")
    token_hash = models.CharField(max_length=64, blank=True, db_index=True, editable=False)
    token_prefix = models.CharField(max_length=8, blank=True, editable=False)
    token_created_at = models.DateTimeField(null=True, blank=True, editable=False)
    blocked = models.BooleanField(default=False, help_text="Stop this customer's EA from receiving trades")

    # Reported by the EA on each check-in
    last_seen = models.DateTimeField(null=True, blank=True)
    mt5_login = models.CharField(max_length=40, blank=True)
    mt5_server = models.CharField(max_length=80, blank=True)
    balance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=8, blank=True)
    ea_version = models.CharField(max_length=20, blank=True)
    open_copies = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "EA connection"

    def __str__(self):
        return f"EA · {self.user}"

    def new_token(self):
        raw = "ea_" + secrets.token_urlsafe(24)
        self.token_hash = ApiToken.hash(raw)
        self.token_prefix = raw[:8]
        self.token_created_at = timezone.now()
        return raw

    @property
    def online(self):
        return bool(self.last_seen and (timezone.now() - self.last_seen).total_seconds() < 120)


class ApiToken(models.Model):
    """Login session for the app / dashboard. Only a SHA-256 hash is stored."""

    TOKEN_LIFETIME_DAYS = 60

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens")
    key_hash = models.CharField(max_length=64, unique=True, editable=False)
    prefix = models.CharField(max_length=8, editable=False, help_text="First characters, to recognise a token")
    device_id = models.CharField(max_length=128, blank=True)
    device_name = models.CharField(max_length=120, blank=True)
    platform = models.CharField(max_length=12, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Login token"

    def __str__(self):
        return f"{self.user} · {self.prefix}…"

    @staticmethod
    def hash(raw):
        return hashlib.sha256(raw.encode()).hexdigest()

    @classmethod
    def issue(cls, user, device_id="", device_name="", platform=""):
        raw = secrets.token_urlsafe(32)
        token = cls.objects.create(
            user=user, key_hash=cls.hash(raw), prefix=raw[:8],
            device_id=device_id[:128], device_name=device_name[:120], platform=platform[:12],
            expires_at=timezone.now() + timedelta(days=cls.TOKEN_LIFETIME_DAYS),
        )
        return token, raw

    @property
    def is_valid(self):
        return not self.revoked and self.expires_at > timezone.now() and self.user.is_active


class PaymentMethod(models.Model):
    """Where customers send money (shown in the app, desktop and website)."""
    KIND_CHOICES = [
        ("bank", "Bank account"), ("jazzcash", "JazzCash"), ("easypaisa", "Easypaisa"),
        ("crypto", "Crypto wallet"), ("other", "Other"),
    ]
    # Payment.method value recorded for each kind
    PAYMENT_METHOD_FOR_KIND = {"bank": "bank_transfer", "jazzcash": "jazzcash", "easypaisa": "easypaisa",
                               "crypto": "crypto", "other": "other"}

    name = models.CharField(max_length=60, help_text='Shown to customers, e.g. "Meezan Bank", "JazzCash", "USDT (TRC20)"')
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default="bank")
    account_title = models.CharField(max_length=100, blank=True, help_text="Name on the account")
    account_number = models.CharField(max_length=160,
                                      help_text="IBAN / account number, mobile wallet number or crypto address")
    details = models.CharField(max_length=200, blank=True,
                               help_text="Extra line, e.g. bank branch or crypto network (TRC20)")
    currency = models.CharField(max_length=3, blank=True,
                                help_text="Currency this account receives, e.g. PKR for JazzCash / Easypaisa, USD for USDT. "
                                          "Customers see the plan price converted to it. Empty = the customer's own currency.")
    instructions = models.TextField(blank=True, help_text="Shown under the account, e.g. exchange rate or notes")
    is_active = models.BooleanField(default=True)
    for_plans = models.BooleanField("Show for plan payments", default=True)
    for_donations = models.BooleanField("Show for donations", default=False,
                                        help_text="Listed in the Donate window (terminal and website) when donations are on")
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name

    def as_dict(self):
        return {"id": self.pk, "name": self.name, "kind": self.kind, "kind_label": self.get_kind_display(),
                "account_title": self.account_title, "account_number": self.account_number,
                "details": self.details, "instructions": self.instructions, "currency": self.currency.upper()}


class Payment(models.Model):
    SOURCE_CHOICES = [("admin", "Admin panel"), ("app", "Mobile app"), ("desktop", "Desktop / web terminal")]
    METHOD_CHOICES = [
        ("bank_transfer", "Bank transfer"), ("jazzcash", "JazzCash"), ("easypaisa", "Easypaisa"),
        ("card", "Card"), ("crypto", "Crypto"), ("cash", "Cash"), ("other", "Other"),
    ]
    STATUS_CHOICES = [("pending", "Pending"), ("paid", "Paid"), ("refunded", "Refunded"), ("failed", "Failed")]

    subscription = models.ForeignKey(Subscription, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="payments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="payments")
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments",
                             help_text="Plan paid for. Approving the payment activates or extends it.")
    payment_method = models.ForeignKey(PaymentMethod, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name="payments", verbose_name="Paid to")
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default="admin")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    method = models.CharField(max_length=16, choices=METHOD_CHOICES, default="bank_transfer")
    local_amount = models.CharField(max_length=40, blank=True,
                                    help_text="What the customer saw in their own currency, e.g. ≈ 37.50 SAR")
    reference = models.CharField(max_length=120, blank=True, help_text="Transaction ID / receipt number")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    paid_at = models.DateTimeField(null=True, blank=True)
    applied = models.BooleanField(default=False, editable=False,
                                  help_text="Already used to extend the subscription")
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+", editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.amount} {self.currency} · {self.get_status_display()}"


class LoginEvent(models.Model):
    METHOD_CHOICES = [("password", "Email + password"), ("register", "Registration"),
                      ("device", "Device limit / change"), ("google", "Google"), ("facebook", "Facebook"),
                      ("trial", "Free trial"), ("signup", "Account creation blocked"), ("guest", "Continue as guest")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="login_events")
    identifier = models.CharField(max_length=160, blank=True, help_text="Email used")
    method = models.CharField(max_length=10, choices=METHOD_CHOICES)
    success = models.BooleanField(default=False)
    reason = models.CharField(max_length=200, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    device_id = models.CharField(max_length=128, blank=True)
    platform = models.CharField(max_length=12, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.identifier} · {'ok' if self.success else 'failed'}"


def _ad_image_path(instance, filename):
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "png").lower()[:5]
    return f"ads/{secrets.token_hex(8)}.{ext}"


class Ad(models.Model):
    """A paid ad (broker / offer) shown to users on the free plan / trial, never to paying VIP.
    Which plans see ads is the "Show ads" tick on each Plan; users without a plan always see them
    while ads are switched on in Settings."""

    name = models.CharField(max_length=80, help_text="For you, e.g. \"Axi October offer\" (not shown)")
    headline = models.CharField(max_length=80, help_text="Short title the users see")
    text = models.CharField(max_length=200, blank=True, help_text="One or two lines under the title")
    image = models.FileField(upload_to=_ad_image_path, blank=True,
                             help_text="PNG / JPG / WEBP / GIF, up to 2 MB. Banner: wide (e.g. 1200×300). "
                                       "Popup: square or tall (e.g. 1080×1080).")
    link = models.URLField(max_length=500, help_text="Where a click goes (the advertiser's page)")
    button_text = models.CharField(max_length=30, default="Learn more")
    show_app_banner = models.BooleanField("Mobile app banner", default=True)
    show_web_banner = models.BooleanField("Web terminal / Windows app banner", default=True)
    show_app_popup = models.BooleanField("Mobile app popup (once a day)", default=False)
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField(null=True, blank=True, help_text="Empty = until you switch it off")
    is_active = models.BooleanField(default=True)
    priority = models.IntegerField(default=0, help_text="Higher first when several ads run")
    impressions = models.PositiveIntegerField(default=0, editable=False)
    clicks = models.PositiveIntegerField(default=0, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-priority", "-created_at"]

    def __str__(self):
        return self.name

    @property
    def running(self):
        now = timezone.now()
        return self.is_active and self.starts_at <= now and (self.ends_at is None or self.ends_at > now)



class ChatProfile(models.Model):
    """A user's community identity: only the nickname is ever shown, never the name or email."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_profile")
    nickname = models.CharField(max_length=20, unique=True)
    rules_accepted_at = models.DateTimeField(null=True, blank=True)
    muted_until = models.DateTimeField(null=True, blank=True)
    banned = models.BooleanField(default=False)
    ban_reason = models.CharField(max_length=200, blank=True)
    strikes = models.PositiveIntegerField(default=0, help_text="Messages blocked by the filters")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Community member"

    def __str__(self):
        return self.nickname

    @property
    def muted(self):
        return bool(self.muted_until and self.muted_until > timezone.now())


class ChatMessage(models.Model):
    ROOMS = [("general", "General"), ("ict", "ICT concepts & models"), ("gold", "Gold & metals"), ("forex", "Forex"), ("indices", "Indices"),
             ("crypto", "Crypto"), ("ea", "EAs & copy trading")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_messages")
    room = models.CharField(max_length=10, choices=ROOMS, default="general", db_index=True)
    text = models.CharField(max_length=500)
    hidden = models.BooleanField(default=False, help_text="Deleted by an admin or hidden by reports")
    hidden_reason = models.CharField(max_length=120, blank=True)
    reports = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Community message"

    def __str__(self):
        return f"{self.room}: {self.text[:40]}"


class ChatReport(models.Model):
    message = models.ForeignKey(ChatMessage, on_delete=models.CASCADE, related_name="report_set")
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    reason = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "reporter"], name="chat_report_once")]
        verbose_name = "Community report"


class Idea(models.Model):
    """A trade idea shared in the community: a chart picture with the author's view (nickname only)."""
    LONG, SHORT, NEUTRAL = "long", "short", "neutral"
    DIRECTIONS = [(LONG, "Long"), (SHORT, "Short"), (NEUTRAL, "Neutral / education")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ideas")
    title = models.CharField(max_length=100)
    body = models.TextField(max_length=2000, blank=True)
    symbol = models.CharField(max_length=30, db_index=True)
    timeframe = models.CharField(max_length=8, blank=True)
    direction = models.CharField(max_length=8, choices=DIRECTIONS, default=NEUTRAL)
    image = models.TextField(blank=True, help_text="Chart picture (JPEG data URL)")
    thumb = models.TextField(blank=True, help_text="Small picture for the list (JPEG data URL)")
    chart = models.TextField(blank=True, help_text="Chart setup (JSON) so readers can open it in their terminal")
    likes = models.PositiveIntegerField(default=0)
    views = models.PositiveIntegerField(default=0)
    comments_count = models.PositiveIntegerField(default=0)
    reports = models.PositiveIntegerField(default=0)
    hidden = models.BooleanField(default=False, help_text="Deleted by the author or an admin, or hidden by reports")
    hidden_reason = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Community idea"

    def __str__(self):
        return f"{self.symbol} {self.title[:40]}"


class IdeaLike(models.Model):
    idea = models.ForeignKey(Idea, on_delete=models.CASCADE, related_name="like_set")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["idea", "user"], name="idea_like_once")]


class IdeaComment(models.Model):
    idea = models.ForeignKey(Idea, on_delete=models.CASCADE, related_name="comment_set")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="idea_comments")
    text = models.CharField(max_length=500)
    hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Idea comment"


class IdeaReport(models.Model):
    idea = models.ForeignKey(Idea, on_delete=models.CASCADE, related_name="report_set")
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["idea", "reporter"], name="idea_report_once")]


class AlertPrefs(models.Model):
    """A user's signal alert settings (WhatsApp)."""
    GRADES = [("all", "All grades"), ("A", "A and A+"), ("A+", "A+ only")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alert_prefs")
    whatsapp_number = models.CharField(max_length=20, blank=True, help_text="International format, digits only (923001234567)")
    auto_notify = models.BooleanField(default=False, help_text="Send every new matching signal to WhatsApp")
    min_grade = models.CharField(max_length=4, choices=GRADES, default="A")
    models_csv = models.CharField("Models", max_length=200, blank=True, help_text="Empty = every model of the plan")
    symbols_csv = models.CharField("Symbols", max_length=200, blank=True, help_text="Empty = every symbol")
    bias_only = models.BooleanField(default=True, help_text="Only setups with the daily bias")
    chart_alerts = models.BooleanField(default=True, help_text="Send my chart alerts (price, line, zone, session, ICT events) "
                                                               "to my channels, even when the terminal is closed")
    whatsapp_chart = models.BooleanField("Chart alerts on WhatsApp", default=True)
    telegram_chat_id = models.CharField(max_length=30, blank=True, help_text="Filled in when the user connects the bot")
    telegram_code = models.CharField(max_length=16, blank=True, help_text="One-time code of the Connect Telegram link")
    telegram_signals = models.BooleanField("Signals on Telegram too", default=True)
    email_alerts = models.BooleanField("Chart alerts by email", default=False)
    webhook_url = models.URLField(max_length=300, blank=True, help_text="https:// address that gets every alert as JSON (POST)")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Signal alert settings"

    def __str__(self):
        return f"Alerts of {self.user}"


class AlertDelivery(models.Model):
    """One signal sent (or tried) to one user, so nobody gets the same signal twice."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alert_deliveries")
    signal_key = models.CharField(max_length=160)
    channel = models.CharField(max_length=12, default="whatsapp")
    ok = models.BooleanField(default=False)
    error = models.CharField(max_length=300, blank=True)
    text = models.CharField(max_length=400, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "signal_key", "channel"], name="alert_once")]
        verbose_name = "Signal alert sent"
        verbose_name_plural = "Signal alerts sent"


class AIPrefs(models.Model):
    """A user's own AI key for the chart assistant (instead of the site's)."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_prefs")
    enabled = models.BooleanField(default=False, help_text="Use this key for the user's assistant answers")
    provider = models.CharField(max_length=20, default="anthropic", choices=AI_PROVIDERS)
    model = models.CharField(max_length=80, blank=True)
    api_key = models.CharField(max_length=300, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AI key of a user"
        verbose_name_plural = "AI keys of users"

    def __str__(self):
        return f"{self.user} · {self.provider}"


class Donation(models.Model):
    """A donation someone reported (they send the money, the admin marks it received). Not a plan payment."""
    STATUS = [("pending", "Waiting for check"), ("received", "Received"), ("rejected", "Not received")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="donations")
    name = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="USD")
    method = models.ForeignKey("PaymentMethod", null=True, blank=True, on_delete=models.SET_NULL, related_name="donations")
    reference = models.CharField("Transaction ID", max_length=120, blank=True)
    message = models.CharField(max_length=300, blank=True)
    public = models.BooleanField(default=False, help_text="The donor agreed to show their name as a supporter")
    status = models.CharField(max_length=10, choices=STATUS, default="pending")
    source = models.CharField(max_length=12, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.amount} {self.currency} · {self.name or self.email or self.user or 'anonymous'}"
