from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db.models import Count, Q
from django.shortcuts import redirect
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html, format_html_join

from .models import (Ad, ApiToken, ChatMessage, ChatProfile, ChatReport, CryptoOrder, CryptoTransfer, CryptoWallet, CryptoWalletChange, CustomerProfile, Device, DeviceClaim, EaConnection, LoginEvent, Payment, PaymentMethod,
                     AIPrefs, AlertDelivery, AlertPrefs, Donation, Idea, IdeaComment, Plan, SiteSettings, SocialAccount, Subscription, TrialGrant)
from . import services
from .services import active_subscriptions

User = get_user_model()

# Dashboard with KPI cards on top of Jazzmin's app list (templates/admin/dashboard.html)
admin.site.index_template = "admin/dashboard.html"

# Inline colours: the theme's .badge classes don't render inside Jazzmin's change lists
STATE_COLOURS = {"Active": "#28a745", "Expired": "#dc3545", "Suspended": "#e0a800",
                 "Cancelled": "#6c757d", "Scheduled": "#17a2b8"}
BADGE = ('<span style="background:{};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;'
         'font-weight:600;white-space:nowrap;margin-right:4px;">{}</span>')


def state_badge(sub):
    label = sub.state_label
    return format_html(BADGE, STATE_COLOURS.get(label, "#6c757d"), label)


# ── Registration settings (single row) ──────────────────────────────────────
@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name in ("whatsapp_token", "ai_api_key", "telegram_bot_token"):
            from django import forms
            kwargs["widget"] = forms.PasswordInput(render_value=True)
        return super().formfield_for_dbfield(db_field, request, **kwargs)
    fieldsets = (
        ("Login methods", {"fields": ("allow_google_login", "allow_facebook_login", "allow_email_login", "allow_signup"),
                           "description": "Turn email + password off to make everyone use Google / Facebook "
                                          "(customers with the same email keep their account and plan). "
                                          "Google / Facebook also need their ids in the VPS .env."}),
        ("Login as guest (web terminal)", {"fields": ("guest_login_enabled", "guest_plan"),
                                           "description": "Guests use the terminal without an account. They get the "
                                                          "features of the plan chosen here (the hidden plan \"Guest\" "
                                                          "has everything on): open Plans > Guest to switch features "
                                                          "on or off. Guest accounts are listed under Users "
                                                          "(username guest-...)."}),
        ("Free trial / plans for new accounts (automatic)", {"fields": ("trial_enabled", "signups_per_ip_hour"),
                                    "description": "Which plan a new account gets is switched ON / OFF per sign-up "
                                                   "method in the Plans list (columns Email / Google / Facebook sign-up). "
                                                   "Given once per account and once per phone / PC. To give a free "
                                                   "trial by hand: Free trials given > 'Give a free trial to users', or "
                                                   "Users > select > Action 'Give a free trial'."}),
        ("Support contact", {"fields": ("support_email", "support_whatsapp"),
                             "description": "Shown to customers in the app, web terminal, website and login pages."}),
        ("Broker partner button", {"fields": ("broker_name", "partner_link", "partner_button_text")}),
        ("Auto-trading (ICT Bridge EA)", {"fields": ("copy_trading_enabled", "auto_trade_models", "copy_magic_numbers", "copy_lot_per_1000")}),
        ("App updates", {"fields": ("min_app_version",),
                         "description": "Put the newest app version here (e.g. 2.13.1) after you publish it to "
                                        "force every phone with an older version to update."}),
        ("Device protection", {"fields": ("device_idle_hours",),
                               "description": "Device limits per type are set on each Plan (and can be changed "
                                              "for one customer on their Subscription)."}),
        ("Crypto payments", {"fields": (("crypto_diff_usd", "crypto_diff_percent"),),
                             "description": "Exchanges take their withdrawal fee out of the amount sent. A payment "
                                           "within this difference of the order still starts the plan by itself "
                                           "(the larger of USD / % counts: 3 USD or 2% → 27 accepted for 30, 244 "
                                           "for 249). Bigger differences go to Crypto payments → Needs review."}),
        ("Community", {"fields": ("community_enabled", "community_wait_minutes", "community_rules",
                                  "community_blocked_words"),
                       "description": "Members only see each other's nickname. Messages with abusive words, links, "
                                      "phone numbers or emails are blocked by themselves; 3 blocked messages mute "
                                      "the account for 30 minutes; 3 reports hide a message. Moderate under "
                                      "Community messages / members."}),
        ("Donations", {
            "fields": ("donations_enabled", "donation_title", "donation_text", ("donation_amounts", "donation_currency")),
            "description": "Separate from plans. Crypto donations are automatic: they use the same crypto wallets as "
                           "plan payments (Crypto wallets), are found on the blockchain and marked received by themselves "
                           "(Crypto payments, type Donation). Bank / wallet methods: tick 'Show for donations' under Payment "
                           "methods; those donations are reported by the donor and checked by you. All are listed under "
                           "Donations. The website page is /donate.html."}),
        ("AI chart assistant", {
            "fields": (("ai_provider", "ai_model"), "ai_api_key"),
            "description": "Optional. The assistant always answers from the engine's data; with a provider and key the "
                           "answer is reworded by that model. Users may also add their own key in the terminal (AI tab)."}),
        ("WhatsApp signal alerts", {
            "fields": ("whatsapp_alerts_enabled", "whatsapp_phone_number_id", "whatsapp_token",
                       ("whatsapp_template", "whatsapp_template_lang")),
            "description": "Users turn on Auto notify in the terminal (Signals tab) and get every new matching signal "
                           "on WhatsApp. Meta WhatsApp Cloud API: create an approved template named as above with 8 body "
                           "variables: {{1}} symbol, {{2}} model, {{3}} BUY/SELL, {{4}} grade, {{5}} entry, {{6}} stop, "
                           "{{7}} targets, {{8}} time. Example body: \"ICT Terminal signal: {{1}} {{2}} {{3}} (grade {{4}}). "
                           "Entry {{5}}, SL {{6}}, TP {{7}}. {{8}}. Not financial advice.\""}),
        ("Chart alerts from the server (terminal closed too)", {
            "fields": ("chart_alerts_enabled", "whatsapp_alert_template", ("telegram_bot_token", "telegram_bot_username"),
                       "email_alerts_enabled"),
            "description": "Users' price / trend line / zone / session / ICT event alerts are checked on the server every "
                           "15-60 s and sent to the channels each user turns on in the terminal (Alerts tab, Delivery). "
                           "WhatsApp: create a second approved template named as above with 1 body variable, e.g. "
                           "\"ICT Terminal alert: {{1}}\". Telegram: create a bot with @BotFather, paste its token and "
                           "username; users press Connect Telegram. Signals also go to Telegram when a user connected it."}),
        ("Ads", {"fields": (("ads_enabled", "ads_for_free"),),
                 "description": "Ads themselves are under Ads. Plans with “Show ads” ticked (free / trial) and "
                                "users without a plan see them; paying VIP plans never do."}),
        ("Backtests & broker", {
            "fields": (("backtest_enabled", "backtest_free"), "mt5_time_offset_hours", "broker_symbol_map"),
            "description": "Users WITH a plan follow “Backtests and model statistics” on their plan; users without "
                           "a plan follow “Backtests for users without a plan” here."}),
        (None, {"fields": ("updated_at",)}),
    )
    readonly_fields = ("updated_at",)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        # Straight to the one settings row instead of a list with a single entry
        obj = SiteSettings.load()
        return redirect(reverse("admin:accounts_sitesettings_change", args=[obj.pk]))



# ── Plans ────────────────────────────────────────────────────────────────────
@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "price_label", "duration_label", "is_vip", "devices_label", "active_subscribers",
                    "auto_email", "auto_google", "auto_facebook", "is_active", "is_public", "sort_order")
    list_editable = ("auto_email", "auto_google", "auto_facebook", "is_active", "is_public", "sort_order")
    list_filter = ("is_active", "is_public", "is_vip", "auto_email", "auto_google", "auto_facebook")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    actions = ["give_to_everyone"]

    @admin.action(description="Give this plan to EVERY user…")
    def give_to_everyone(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(request, "Select exactly one plan.", messages.WARNING)
            return None
        return grant_plan_view(self, request, User.objects.all(), plan=queryset.first())
    fieldsets = (
        (None, {"fields": ("name", "slug", "description", ("price", "currency"), "duration_days")}),
        ("Signals & charts", {"fields": ("is_vip", ("can_view_signals", "signal_delay_minutes"), "allowed_models",
                                         ("ict_indicators", "max_charts"), "can_use_backtest", "show_ads")}),
        ("Trading & AI", {"fields": ("can_view_trades", ("can_auto_trade", "max_mt_accounts"),
                                     "ai_messages_per_day", "alerts_limit"),
                          "description": "Auto-trading sends engine signals to the customer's MT4 / MT5 through "
                                         "the ICT Bridge EA. Only enable it on plans for models proven in backtests."}),
        ("Devices per account", {"fields": (("max_mobile", "max_desktop", "max_web"),),
                                 "description": "How many of each a customer on this plan may use at the same "
                                                "time. 0 = unlimited."}),
        ("Given automatically to new accounts", {"fields": (("auto_email", "auto_google", "auto_facebook"),),
                    "description": "ON = a new account made this way gets this plan at once (for the plan's duration). "
                                   "Settings > Free trial must be on. Use it for a free plan or a trial (e.g. 'VIP Trial', "
                                   "7 days); paid plans normally stay OFF."}),
        ("Visibility", {"fields": ("is_active", "is_public", "sort_order")}),
    )

    def get_queryset(self, request):
        now = timezone.now()
        return super().get_queryset(request).annotate(active_count=Count(
            "subscriptions",
            filter=Q(subscriptions__status=Subscription.STATUS_ACTIVE)
            & (Q(subscriptions__expires_at__isnull=True) | Q(subscriptions__expires_at__gt=now)),
        ))

    @admin.display(description="Price", ordering="price")
    def price_label(self, obj):
        return f"{obj.price} {obj.currency}"

    @admin.display(description="Devices (app / Windows / web)")
    def devices_label(self, obj):
        return " / ".join("∞" if n == 0 else str(n) for n in obj.device_limits.values())

    @admin.display(description="Active subscribers", ordering="active_count")
    def active_subscribers(self, obj):
        return obj.active_count


# ── Subscriptions ────────────────────────────────────────────────────────────
class ExpiryFilter(admin.SimpleListFilter):
    title = "expiry"
    parameter_name = "expiry"

    def lookups(self, request, model_admin):
        return [("active", "Active"), ("7d", "Expiring in 7 days"), ("30d", "Expiring in 30 days"),
                ("expired", "Expired"), ("lifetime", "Lifetime")]

    def queryset(self, request, qs):
        now = timezone.now()
        value = self.value()
        if value == "active":
            return qs.filter(status=Subscription.STATUS_ACTIVE).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        if value in ("7d", "30d"):
            days = 7 if value == "7d" else 30
            return qs.filter(status=Subscription.STATUS_ACTIVE, expires_at__gt=now,
                             expires_at__lte=now + timedelta(days=days))
        if value == "expired":
            return qs.filter(expires_at__lte=now)
        if value == "lifetime":
            return qs.filter(expires_at__isnull=True)
        return qs


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    fields = ("amount", "currency", "method", "reference", "status", "paid_at")
    fk_name = "subscription"


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("customer", "account_email", "plan", "state", "expires_at", "days_left_col", "created_at")
    list_filter = (ExpiryFilter, "status", "plan")
    search_fields = ("user__email", "user__first_name", "user__last_name", "notes")
    autocomplete_fields = ("user",)
    list_select_related = ("plan", "user")
    readonly_fields = ("created_by", "created_at", "updated_at", "state")
    inlines = [PaymentInline]
    actions = ["extend_30", "extend_plan", "suspend", "reactivate"]
    fieldsets = (
        ("Customer", {"fields": ("user",)}),
        ("Plan", {"fields": ("plan", "status", "state", ("starts_at", "expires_at"))}),
        ("Devices for this customer only", {
            "fields": (("max_mobile", "max_desktop", "max_web"),),
            "description": "Leave empty to use the plan's limits. 0 = unlimited."}),
        ("Notes", {"fields": ("notes", "created_by", "created_at", "updated_at")}),
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.display(description="Customer", ordering="user__first_name")
    def customer(self, obj):
        return obj.display_name

    @admin.display(description="Account", ordering="user__email")
    def account_email(self, obj):
        return obj.user.email

    @admin.display(description="State")
    def state(self, obj):
        return state_badge(obj)

    @admin.display(description="Days left", ordering="expires_at")
    def days_left_col(self, obj):
        return "∞" if obj.expires_at is None else obj.days_left

    @admin.action(description="Extend by 30 days")
    def extend_30(self, request, queryset):
        for sub in queryset:
            sub.extend(30)
            sub.save()
        self.message_user(request, f"Extended {queryset.count()} subscription(s) by 30 days.", messages.SUCCESS)

    @admin.action(description="Extend by the plan's duration")
    def extend_plan(self, request, queryset):
        done = 0
        for sub in queryset.select_related("plan"):
            if sub.plan.duration_days:
                sub.extend(sub.plan.duration_days)
                sub.save()
                done += 1
        self.message_user(request, f"Extended {done} subscription(s). Lifetime plans were skipped.", messages.SUCCESS)

    @admin.action(description="Suspend (block access)")
    def suspend(self, request, queryset):
        n = queryset.update(status=Subscription.STATUS_SUSPENDED)
        self.message_user(request, f"Suspended {n} subscription(s).", messages.WARNING)

    @admin.action(description="Reactivate")
    def reactivate(self, request, queryset):
        n = queryset.update(status=Subscription.STATUS_ACTIVE)
        self.message_user(request, f"Reactivated {n} subscription(s). Expired ones still need extending.", messages.SUCCESS)


# ── Payments ─────────────────────────────────────────────────────────────────
@admin.register(PaymentMethod)
class PaymentMethodAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "account_title", "account_number", "currency", "is_active", "for_plans", "for_donations", "sort_order")
    list_editable = ("is_active", "for_plans", "for_donations", "sort_order")
    list_filter = ("kind", "is_active")
    search_fields = ("name", "account_title", "account_number")
    fieldsets = (
        (None, {"fields": ("name", "kind", "is_active", ("for_plans", "for_donations"), "sort_order")}),
        ("Account shown to customers", {"fields": ("account_title", "account_number", "details", "currency", "instructions")}),
    )


PAYMENT_BADGES = {"pending": ("#f0ad4e", "Waiting for approval"), "paid": ("#28a745", "Paid"),
                  "refunded": ("#6c757d", "Refunded"), "failed": ("#dc3545", "Rejected / failed")}


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("created_at", "customer", "plan", "amount_label", "paid_to", "reference", "status_badge",
                    "source", "applied")
    list_filter = ("status", "source", "payment_method", "plan", "applied")
    search_fields = ("reference", "user__email", "subscription__user__email", "notes")
    autocomplete_fields = ("user", "subscription")
    list_select_related = ("user", "plan", "payment_method", "subscription__user")
    date_hierarchy = "created_at"
    readonly_fields = ("applied", "recorded_by", "created_at")
    actions = ["approve", "reject"]
    fieldsets = (
        ("Customer and plan", {"fields": ("user", "plan", "subscription")}),
        ("Payment", {"fields": (("amount", "currency"), "local_amount", ("payment_method", "method"), "reference", "source")}),
        ("Status", {"fields": ("status", "paid_at", "applied"),
                    "description": "Set the status to Paid and save (or use the Approve action) "
                                   "to activate / extend the customer's plan."}),
        ("Notes", {"fields": ("notes", "recorded_by", "created_at")}),
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.recorded_by = request.user
        if obj.subscription_id and not obj.user_id:
            obj.user = obj.subscription.user
        if obj.status == "paid" and not obj.paid_at:
            obj.paid_at = timezone.now()
        super().save_model(request, obj, form, change)
        if obj.status == "paid" and not obj.applied:
            sub = services.apply_payment(obj)
            if sub is not None:
                self.message_user(request, f"Plan active for {sub.display_name} until "
                                           f"{sub.expires_at:%Y-%m-%d}" if sub.expires_at else
                                  f"Plan active for {sub.display_name} (lifetime).", messages.SUCCESS)

    @admin.display(description="Customer")
    def customer(self, obj):
        if obj.subscription_id:
            return obj.subscription.display_name
        return obj.user.email if obj.user_id else "-"

    @admin.display(description="Amount", ordering="amount")
    def amount_label(self, obj):
        return f"{obj.amount} {obj.currency}" + (f" ({obj.local_amount})" if obj.local_amount else "")

    @admin.display(description="Paid to")
    def paid_to(self, obj):
        return obj.payment_method.name if obj.payment_method_id else obj.get_method_display()

    @admin.display(description="Status", ordering="status")
    def status_badge(self, obj):
        color, label = PAYMENT_BADGES.get(obj.status, ("#6c757d", obj.get_status_display()))
        return format_html('<span style="background:{};color:#fff;padding:2px 8px;border-radius:10px;'
                           'font-size:12px;white-space:nowrap">{}</span>', color, label)

    @admin.action(description="Approve: mark paid and activate / extend the plan")
    def approve(self, request, queryset):
        done = 0
        for payment in queryset.select_related("subscription__plan", "plan"):
            if services.apply_payment(payment) is not None:
                done += 1
        self.message_user(request, f"Approved {queryset.count()} payment(s); {done} plan(s) activated or extended.",
                          messages.SUCCESS)

    @admin.action(description="Reject (payment not received)")
    def reject(self, request, queryset):
        n = queryset.filter(applied=False).update(status="failed")
        self.message_user(request, f"Rejected {n} payment(s). Already applied payments were left unchanged.",
                          messages.WARNING)



# ── Copy trading: customers' copier EAs ─────────────────────────────────────
@admin.register(EaConnection)
class EaConnectionAdmin(admin.ModelAdmin):
    list_display = ("user", "copy_enabled", "multiplier", "status", "mt5_login", "mt5_server", "balance_label",
                    "open_copies", "last_seen", "blocked")
    list_filter = ("copy_enabled", "blocked")
    list_editable = ("blocked",)
    search_fields = ("user__email", "mt5_login")
    readonly_fields = ("token_prefix", "token_created_at", "last_seen", "mt5_login", "mt5_server", "balance",
                       "currency", "ea_version", "open_copies", "updated_at")
    autocomplete_fields = ("user",)
    actions = ["revoke_token"]

    @admin.display(description="EA")
    def status(self, obj):
        if not obj.token_hash:
            return format_html('<span class="text-muted">no token</span>')
        return format_html(BADGE, "#28a745" if obj.online else "#6c757d", "online" if obj.online else "offline")

    @admin.display(description="Balance", ordering="balance")
    def balance_label(self, obj):
        return f"{obj.balance:,.2f} {obj.currency}" if obj.balance is not None else "-"

    @admin.action(description="Revoke EA token (EA stops copying until a new token is made)")
    def revoke_token(self, request, queryset):
        n = queryset.update(token_hash="", token_prefix="")
        self.message_user(request, f"Revoked {n} EA token(s).", messages.WARNING)


# ── Devices, login sessions, login history ──────────────────────────────────
@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "platform", "user", "is_blocked", "last_seen", "last_ip", "first_seen")
    list_filter = ("kind", "platform", "is_blocked")
    search_fields = ("name", "device_id", "user__email", "last_ip")
    readonly_fields = ("device_id", "kind", "first_seen", "last_seen", "last_ip")
    actions = ["log_out", "block", "unblock"]

    @admin.action(description="Log out and free the slot (customer can sign in on another device)")
    def log_out(self, request, queryset):
        n = 0
        for device in queryset.filter(is_blocked=False).select_related("user"):
            services.release_device(device, f"logged out by admin {request.user}")
            n += 1
        self.message_user(request, f"Logged out {n} device(s).", messages.SUCCESS)

    @admin.action(description="Block selected devices (also logs them out)")
    def block(self, request, queryset):
        for device in queryset:
            ApiToken.objects.filter(user=device.user, device_id=device.device_id).update(revoked=True)
        self.message_user(request, f"Blocked {queryset.update(is_blocked=True)} device(s).", messages.WARNING)

    @admin.action(description="Unblock selected devices")
    def unblock(self, request, queryset):
        self.message_user(request, f"Unblocked {queryset.update(is_blocked=False)} device(s).", messages.SUCCESS)


@admin.register(ApiToken)
class ApiTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "prefix", "device_name", "platform", "created_at", "last_used_at", "expires_at", "revoked")
    list_filter = ("revoked", "platform")
    search_fields = ("user__email", "prefix", "device_name")
    readonly_fields = ("user", "prefix", "device_id", "device_name", "platform", "created_at", "last_used_at",
                       "expires_at")
    actions = ["revoke"]

    def has_add_permission(self, request):
        return False  # tokens are only issued by logging in

    @admin.action(description="Revoke (log out) selected sessions")
    def revoke(self, request, queryset):
        self.message_user(request, f"Revoked {queryset.update(revoked=True)} session(s).", messages.WARNING)


@admin.register(LoginEvent)
class LoginEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "identifier", "method", "success", "reason", "ip", "platform")
    # "Device limit / change" shows blocked extra devices, replaced idle devices and login
    # tokens used on another device: repeated entries for one account suggest shared passwords.
    list_filter = ("success", "method", "platform")
    search_fields = ("identifier", "ip", "user__email")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# ── Users: profile, subscriptions and devices on the user page ──────────────
class ProfileInline(admin.StackedInline):
    model = CustomerProfile
    can_delete = False
    extra = 0


class UserSubscriptionInline(admin.TabularInline):
    model = Subscription
    fk_name = "user"
    extra = 0
    fields = ("plan", "status", "starts_at", "expires_at", "max_mobile", "max_desktop", "max_web")
    show_change_link = True


class UserSocialInline(admin.TabularInline):
    model = SocialAccount
    extra = 0
    fields = ("provider", "email", "name", "last_login")
    readonly_fields = fields


class UserDeviceInline(admin.TabularInline):
    model = Device
    extra = 0
    fields = ("name", "kind", "platform", "device_id", "is_blocked", "last_seen", "last_ip")
    readonly_fields = ("device_id", "kind", "last_seen", "last_ip")


admin.site.unregister(User)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    inlines = [ProfileInline, UserSubscriptionInline, UserSocialInline, UserDeviceInline]
    list_display = ("email", "full_name", "current_plans", "is_active", "is_staff", "date_joined", "last_login")
    search_fields = ("email", "username", "first_name", "last_name", "profile__phone")
    actions = ["give_free_trial", "reset_devices", "give_plan"]

    @admin.action(description="Give a plan… (to the selected users)")
    def give_plan(self, request, queryset):
        return grant_plan_view(self, request, queryset)

    @admin.display(description="Name")
    def full_name(self, obj):
        return obj.get_full_name() or "-"

    @admin.display(description="Active plans")
    def current_plans(self, obj):
        subs = active_subscriptions(obj)
        if not subs:
            return format_html('<span class="text-muted">none</span>')
        return format_html_join("", "{}", ((f"{s.plan.name} ",) for s in subs))

    @admin.action(description="Reset devices (log out everywhere, free all device slots)")
    def reset_devices(self, request, queryset):
        n = 0
        for device in Device.objects.filter(user__in=queryset, is_blocked=False).select_related("user"):
            services.release_device(device, f"reset by admin {request.user}")
            n += 1
        ApiToken.objects.filter(user__in=queryset, revoked=False).update(revoked=True)
        self.message_user(request, f"Removed {n} device(s) and logged the account(s) out.", messages.SUCCESS)


# ── Google / Facebook logins, device locks, free trials ─────────────────────

    @admin.action(description="Give a free trial…")
    def give_free_trial(self, request, queryset):
        return free_trial_view(self, request, queryset.filter(is_active=True))

@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ("provider", "email", "name", "user", "created_at", "last_login")
    list_filter = ("provider",)
    search_fields = ("email", "name", "uid", "user__email")
    readonly_fields = ("provider", "uid", "email", "name", "created_at", "last_login")
    autocomplete_fields = ("user",)


@admin.register(DeviceClaim)
class DeviceClaimAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "user", "trial_used", "blocked_attempts", "ip", "created_at")
    list_filter = ("kind", "trial_used")
    search_fields = ("name", "device_id", "user__email", "ip")
    readonly_fields = ("device_id", "kind", "created_at", "ip", "blocked_attempts")
    autocomplete_fields = ("user",)
    actions = ["unlock", "reset_trial"]

    @admin.action(description="Full reset: new account AND a new free trial allowed on this phone / PC")
    def reset_trial(self, request, queryset):
        n = queryset.update(user=None, trial_used=False, blocked_attempts=0)
        self.message_user(request, f"Reset {n} device(s): they can create an account and get a trial again.",
                          messages.SUCCESS)

    @admin.action(description="Unlock: let this phone / PC create a new account (keeps trial-used)")
    def unlock(self, request, queryset):
        n = queryset.update(user=None)
        self.message_user(request, f"Unlocked {n} device(s).", messages.SUCCESS)


@admin.register(TrialGrant)
class TrialGrantAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "device_id", "ip", "created_at")
    list_filter = ("provider",)
    search_fields = ("user__email", "device_id", "ip")
    readonly_fields = ("user", "provider", "device_id", "ip", "created_at")
    change_list_template = "admin/trialgrant_changelist.html"

    def has_add_permission(self, request):
        return False

    def get_urls(self):
        from django.urls import path
        return [path("give/", self.admin_site.admin_view(self.give_view), name="accounts_trialgrant_give")] + super().get_urls()

    def give_view(self, request):
        """Choose users (all, or the ones without a trial yet) and the trial plan, then give it."""
        users = User.objects.filter(is_active=True).exclude(username__startswith="guest-").order_by("-date_joined")
        return free_trial_view(self, request, users, pick=True)


# ── Crypto payments (automatic, verified on the blockchain) ─────────────────
from django import forms  # noqa: E402

from . import crypto, crypto_chain  # noqa: E402


class CryptoWalletForm(forms.ModelForm):
    class Meta:
        model = CryptoWallet
        fields = ("network", "address", "is_active")

    def clean(self):
        data = super().clean()
        network, address = data.get("network"), (data.get("address") or "").strip()
        if network and address:
            problem = crypto_chain.valid_address(network, address)
            if problem:
                raise forms.ValidationError({"address": problem})
        data["address"] = address
        return data


@admin.register(CryptoWallet)
class CryptoWalletAdmin(admin.ModelAdmin):
    form = CryptoWalletForm
    list_display = ("network", "fingerprint_col", "is_active", "updated_at")
    list_editable = ("is_active",)
    fieldsets = ((None, {"fields": ("network", "address", "is_active"),
                         "description": "Only your PUBLIC receiving address. Never enter a private key or seed "
                                        "phrase anywhere. Every change is written to the audit log."}),)

    @admin.display(description="Address (first / last 6)")
    def fingerprint_col(self, obj):
        return format_html('<code style="font-size:13px">{}</code>', obj.fingerprint)

    def save_model(self, request, obj, form, change):
        old = CryptoWallet.objects.filter(pk=obj.pk).values_list("address", flat=True).first() if obj.pk else ""
        super().save_model(request, obj, form, change)
        if (old or "") != obj.address:
            CryptoWalletChange.objects.create(network=obj.network, old_address=old or "", new_address=obj.address,
                                              changed_by=str(request.user), ip=request.META.get("REMOTE_ADDR"))
            self.message_user(request, f"⚠️ {obj.get_network_display()} address changed to {obj.fingerprint}. "
                                       "Check that it is your own wallet.", messages.WARNING)


@admin.register(CryptoWalletChange)
class CryptoWalletChangeAdmin(admin.ModelAdmin):
    list_display = ("changed_at", "network", "old_address", "new_address", "changed_by", "ip")
    list_filter = ("network",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


CRYPTO_BADGES = {"waiting": "#6c757d", "confirming": "#17a2b8", "paid": "#28a745", "expired": "#adb5bd",
                 "cancelled": "#adb5bd", "review": "#f0ad4e", "rejected": "#dc3545",
                 "new": "#17a2b8", "matched": "#28a745", "unmatched": "#f0ad4e"}


@admin.register(CryptoOrder)
class CryptoOrderAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "who_col", "plan", "amount_col", "network", "status_col", "tx_link", "confirmations")
    list_filter = ("kind", "status", "network", "plan")
    search_fields = ("user__email", "txid", "from_address")
    date_hierarchy = "created_at"
    readonly_fields = [f.name for f in CryptoOrder._meta.fields]
    actions = ["check_now", "approve", "reject"]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Customer / donor")
    def who_col(self, obj):
        return obj.who

    @admin.display(description="Amount")
    def amount_col(self, obj):
        paid = f" (paid {obj.paid_amount})" if obj.paid_amount is not None and obj.paid_amount != obj.amount else ""
        return f"{obj.amount} {crypto_chain.NETWORKS[obj.network]['token']}{paid}"

    @admin.display(description="Status", ordering="status")
    def status_col(self, obj):
        return format_html(BADGE, CRYPTO_BADGES.get(obj.status, "#6c757d"), obj.get_status_display())

    @admin.display(description="Transaction")
    def tx_link(self, obj):
        if not obj.txid:
            return "-"
        return format_html('<a href="{}{}" target="_blank" rel="noopener">{}…</a>',
                           crypto_chain.NETWORKS[obj.network]["explorer"], obj.txid, obj.txid[:10])

    @admin.action(description="Check on the blockchain now")
    def check_now(self, request, queryset):
        for order in queryset.select_related("plan", "user"):
            crypto.check_order(order, force=True)
        self.message_user(request, "Checked.", messages.SUCCESS)

    @admin.action(description="Approve (activate the plan) - only after checking the transaction")
    def approve(self, request, queryset):
        n = 0
        for order in queryset.filter(status__in=("review", "confirming", "expired", "cancelled")).exclude(txid=None):
            crypto.approve(order, by=str(request.user))
            n += 1
        self.message_user(request, f"Approved {n} payment(s). Orders without a transaction were skipped "
                                   "(for those, use Incoming crypto transfers).", messages.SUCCESS)

    @admin.action(description="Reject")
    def reject(self, request, queryset):
        n = queryset.exclude(status="paid").update(status="rejected")
        self.message_user(request, f"Rejected {n} order(s).", messages.WARNING)


@admin.register(CryptoTransfer)
class CryptoTransferAdmin(admin.ModelAdmin):
    """Every payment that reached the wallet while orders were open. "Not matched" ones need a look:
    find the customer, pick their order in the transfer, save, then "Pay the linked order"."""
    list_display = ("seen_at", "network", "amount_col", "status_col", "order_link", "from_address", "tx_link", "note")
    list_filter = ("status", "network")
    search_fields = ("txid", "from_address", "order__user__email")
    date_hierarchy = "seen_at"
    readonly_fields = ("network", "address", "txid", "value", "amount", "from_address", "block_time",
                       "confirmations", "status", "seen_at")
    fields = readonly_fields + ("order", "note")
    raw_id_fields = ("order",)
    actions = ["pay_linked_order"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Amount", ordering="amount")
    def amount_col(self, obj):
        return f"{obj.amount} {crypto_chain.NETWORKS[obj.network]['token']}"

    @admin.display(description="Status", ordering="status")
    def status_col(self, obj):
        return format_html(BADGE, CRYPTO_BADGES.get(obj.status, "#6c757d"), obj.get_status_display())

    @admin.display(description="Order")
    def order_link(self, obj):
        if not obj.order_id:
            return "-"
        return format_html('<a href="../cryptoorder/{}/change/">#{} {}</a>', obj.order_id, obj.order_id,
                           obj.order.who if obj.order else "")

    @admin.display(description="Transaction")
    def tx_link(self, obj):
        return format_html('<a href="{}{}" target="_blank" rel="noopener">{}…</a>',
                           crypto_chain.NETWORKS[obj.network]["explorer"], obj.txid, obj.txid[:10])

    @admin.action(description="Pay the linked order (give the customer their plan)")
    def pay_linked_order(self, request, queryset):
        for t in queryset.select_related("order"):
            order, problem = crypto.pay_linked_order(t, by=str(request.user))
            if problem:
                self.message_user(request, f"{t.txid[:12]}…: {problem}", messages.ERROR)
            else:
                self.message_user(request, f"Order #{order.pk} paid: {'donation received' if order.kind == 'donation' else 'plan active'} for {order.who}.",
                                  messages.SUCCESS)


# ── Ads (Ad manager) ─────────────────────────────────────────────────────────
AD_IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".webp", ".gif")


class AdForm(forms.ModelForm):
    class Meta:
        model = Ad
        fields = "__all__"

    def clean_image(self):
        image = self.cleaned_data.get("image")
        if image and hasattr(image, "size"):
            if not image.name.lower().endswith(AD_IMAGE_TYPES):
                raise forms.ValidationError("Use a PNG, JPG, WEBP or GIF picture.")
            if image.size > 2 * 1024 * 1024:
                raise forms.ValidationError("The picture is bigger than 2 MB. Make it smaller first.")
        return image

    def clean(self):
        data = super().clean()
        if not any(data.get(f) for f in ("show_app_banner", "show_web_banner", "show_app_popup")):
            raise forms.ValidationError("Tick at least one place to show the ad.")
        if data.get("ends_at") and data.get("starts_at") and data["ends_at"] <= data["starts_at"]:
            raise forms.ValidationError({"ends_at": "The end must be after the start."})
        return data


@admin.register(Ad)
class AdAdmin(admin.ModelAdmin):
    form = AdForm
    list_display = ("name", "preview", "places", "state", "starts_at", "ends_at", "impressions", "clicks", "ctr",
                    "priority", "is_active")
    list_editable = ("is_active", "priority")
    search_fields = ("name", "headline")
    readonly_fields = ("preview_large", "impressions", "clicks", "created_at")
    fieldsets = (
        ("Ad", {"fields": ("name", "headline", "text", "image", "preview_large", "link", "button_text")}),
        ("Where", {"fields": ("show_app_banner", "show_web_banner", "show_app_popup"),
                   "description": "Only users on the free plan / trial (plans with “Show ads”) and users "
                                  "without a plan see ads. Paying VIP never do."}),
        ("When", {"fields": (("starts_at", "ends_at"), "is_active", "priority")}),
        ("Results (for the advertiser)", {"fields": (("impressions", "clicks"), "created_at")}),
    )

    @admin.display(description="Picture")
    def preview(self, obj):
        if not obj.image:
            return "-"
        return format_html('<img src="{}" style="max-height:40px;max-width:120px;border-radius:4px">',
                           reverse("ad-image", args=[obj.pk]))

    @admin.display(description="Picture now")
    def preview_large(self, obj):
        if not obj.pk or not obj.image:
            return "-"
        return format_html('<img src="{}" style="max-height:220px;max-width:100%;border-radius:6px">',
                           reverse("ad-image", args=[obj.pk]))

    @admin.display(description="Shown in")
    def places(self, obj):
        return ", ".join(n for f, n in (("show_app_banner", "app banner"), ("show_web_banner", "web banner"),
                                        ("show_app_popup", "app popup")) if getattr(obj, f))

    @admin.display(description="Status")
    def state(self, obj):
        if obj.running:
            return format_html(BADGE, "#28a745", "Running")
        if obj.is_active and obj.starts_at > timezone.now():
            return format_html(BADGE, "#17a2b8", "Scheduled")
        return format_html(BADGE, "#6c757d", "Off / ended")

    @admin.display(description="Click rate")
    def ctr(self, obj):
        return f"{obj.clicks / obj.impressions * 100:.1f}%" if obj.impressions else "-"


# ── Community chat moderation ────────────────────────────────────────────────
def _mute(profiles, hours):
    return profiles.update(muted_until=timezone.now() + timedelta(hours=hours))


@admin.register(ChatProfile)
class ChatProfileAdmin(admin.ModelAdmin):
    list_display = ("nickname", "user", "state", "strikes", "messages", "created_at")
    search_fields = ("nickname", "user__email")
    list_filter = ("banned",)
    readonly_fields = ("user", "rules_accepted_at", "created_at")
    actions = ["mute_24h", "unmute", "ban", "unban"]

    @admin.display(description="State")
    def state(self, obj):
        if obj.banned:
            return format_html(BADGE, "#dc3545", "Banned")
        if obj.muted:
            return format_html(BADGE, "#f0ad4e", f"Muted until {timezone.localtime(obj.muted_until):%d %b %H:%M}")
        return format_html(BADGE, "#28a745", "Active")

    @admin.display(description="Messages")
    def messages(self, obj):
        return obj.user.chat_messages.count()

    @admin.action(description="Mute for 24 hours")
    def mute_24h(self, request, queryset):
        self.message_user(request, f"Muted {_mute(queryset, 24)} member(s) for 24 hours.", messages.WARNING)

    @admin.action(description="Unmute")
    def unmute(self, request, queryset):
        self.message_user(request, f"Unmuted {queryset.update(muted_until=None, strikes=0)} member(s).", messages.SUCCESS)

    @admin.action(description="Ban (can no longer read or write)")
    def ban(self, request, queryset):
        n = queryset.update(banned=True, ban_reason="Banned for breaking the community rules.")
        self.message_user(request, f"Banned {n} member(s).", messages.WARNING)

    @admin.action(description="Unban")
    def unban(self, request, queryset):
        self.message_user(request, f"Unbanned {queryset.update(banned=False, ban_reason='')} member(s).", messages.SUCCESS)


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ("created_at", "room", "nickname", "text", "reports", "hidden", "hidden_reason")
    list_filter = ("room", "hidden")
    search_fields = ("text", "user__chat_profile__nickname", "user__email")
    date_hierarchy = "created_at"
    readonly_fields = ("user", "room", "text", "reports", "created_at")
    actions = ["delete_messages", "restore_messages", "mute_authors", "ban_authors"]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Nickname")
    def nickname(self, obj):
        prof = getattr(obj.user, "chat_profile", None)
        return prof.nickname if prof else "-"

    @admin.action(description="Delete (hide) messages")
    def delete_messages(self, request, queryset):
        n = queryset.update(hidden=True, hidden_reason=f"Deleted by {request.user}")
        self.message_user(request, f"Deleted {n} message(s).", messages.WARNING)

    @admin.action(description="Restore messages")
    def restore_messages(self, request, queryset):
        self.message_user(request, f"Restored {queryset.update(hidden=False, hidden_reason='')} message(s).",
                          messages.SUCCESS)

    @admin.action(description="Mute the authors for 24 hours")
    def mute_authors(self, request, queryset):
        n = _mute(ChatProfile.objects.filter(user__in=queryset.values("user")), 24)
        self.message_user(request, f"Muted {n} member(s) for 24 hours.", messages.WARNING)

    @admin.action(description="Ban the authors")
    def ban_authors(self, request, queryset):
        n = ChatProfile.objects.filter(user__in=queryset.values("user")).update(
            banned=True, ban_reason="Banned for breaking the community rules.")
        self.message_user(request, f"Banned {n} member(s).", messages.WARNING)


@admin.register(ChatReport)
class ChatReportAdmin(admin.ModelAdmin):
    list_display = ("created_at", "message", "reporter", "reason")
    readonly_fields = ("message", "reporter", "reason", "created_at")

    def has_add_permission(self, request):
        return False


@admin.register(Idea)
class IdeaAdmin(admin.ModelAdmin):
    list_display = ("created_at", "symbol", "timeframe", "direction", "title", "nickname", "likes", "comments_count",
                    "views", "reports", "hidden")
    list_filter = ("direction", "hidden", "symbol")
    search_fields = ("title", "body", "symbol", "user__chat_profile__nickname", "user__email")
    date_hierarchy = "created_at"
    readonly_fields = ("user", "likes", "views", "comments_count", "reports", "created_at", "picture")
    exclude = ("image", "thumb", "chart")
    actions = ["hide_ideas", "restore_ideas"]

    def has_add_permission(self, request):
        return False

    @admin.display(description="Nickname")
    def nickname(self, obj):
        prof = getattr(obj.user, "chat_profile", None)
        return prof.nickname if prof else "-"

    @admin.display(description="Chart")
    def picture(self, obj):
        from django.utils.html import format_html
        return format_html('<img src="{}" style="max-width:640px;border-radius:8px">', obj.image) if obj.image else "-"

    @admin.action(description="Delete (hide) ideas")
    def hide_ideas(self, request, queryset):
        n = queryset.update(hidden=True, hidden_reason=f"Deleted by {request.user}")
        self.message_user(request, f"Deleted {n} idea(s).", messages.WARNING)

    @admin.action(description="Restore ideas")
    def restore_ideas(self, request, queryset):
        self.message_user(request, f"Restored {queryset.update(hidden=False, hidden_reason='')} idea(s).", messages.SUCCESS)


@admin.register(IdeaComment)
class IdeaCommentAdmin(admin.ModelAdmin):
    list_display = ("created_at", "idea", "text", "hidden")
    list_filter = ("hidden",)
    search_fields = ("text", "user__chat_profile__nickname")
    readonly_fields = ("idea", "user", "text", "created_at")
    actions = ["hide_comments"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Delete (hide) comments")
    def hide_comments(self, request, queryset):
        self.message_user(request, f"Deleted {queryset.update(hidden=True)} comment(s).", messages.WARNING)


@admin.register(AlertPrefs)
class AlertPrefsAdmin(admin.ModelAdmin):
    list_display = ("user", "whatsapp_number", "auto_notify", "min_grade", "chart_alerts", "telegram_chat_id", "email_alerts", "updated_at")
    list_filter = ("auto_notify", "min_grade", "chart_alerts", "email_alerts")
    search_fields = ("user__email", "whatsapp_number")


@admin.register(AlertDelivery)
class AlertDeliveryAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "channel", "ok", "text", "error")
    list_filter = ("ok", "channel")
    search_fields = ("user__email", "text")
    readonly_fields = ("user", "signal_key", "channel", "ok", "error", "text", "created_at")

    def has_add_permission(self, request):
        return False


@admin.register(AIPrefs)
class AIPrefsAdmin(admin.ModelAdmin):
    """Users' own AI keys: the key itself is never shown."""
    list_display = ("user", "provider", "model", "enabled", "has_key", "updated_at")
    list_filter = ("enabled", "provider")
    search_fields = ("user__email",)
    fields = ("user", "enabled", "provider", "model", "has_key", "updated_at")
    readonly_fields = ("user", "provider", "model", "has_key", "updated_at")

    @admin.display(boolean=True, description="Key set")
    def has_key(self, obj):
        return bool(obj.api_key)

    def has_add_permission(self, request):
        return False



# ── Free trial for chosen users ─────────────────────────────────────────────
class FreeTrialForm(forms.Form):
    plan = forms.ModelChoiceField(queryset=Plan.objects.filter(is_active=True).order_by("name"),
                                  help_text="The trial plan (e.g. 'VIP Trial').")
    days = forms.IntegerField(required=False, min_value=1, max_value=3650, help_text="Empty = the plan's own duration.")
    again = forms.BooleanField(required=False, label="Also to users who already had a free trial")


def free_trial_view(model_admin, request, users, pick=False):
    """Give the free trial to many users. ``pick``: the page lists the users with tick boxes (Free trials given);
    otherwise the users are the ones selected in the Users list (action)."""
    from django.template.response import TemplateResponse
    from .models import TrialGrant as TG
    default = Plan.objects.filter(is_active=True).filter(Q(auto_email=True) | Q(auto_google=True) | Q(auto_facebook=True)).first()
    had = set(TG.objects.values_list("user_id", flat=True))
    q = (request.GET.get("q") or request.POST.get("q") or "").strip()
    if pick and q:
        users = users.filter(Q(email__icontains=q) | Q(username__icontains=q) | Q(first_name__icontains=q))
    if "apply" in request.POST:
        form = FreeTrialForm(request.POST)
        chosen = users.filter(pk__in=[int(x) for x in request.POST.getlist("user") if x.isdigit()]) if pick else users
        if form.is_valid() and chosen.exists():
            given, skipped = services.give_free_trial(list(chosen), form.cleaned_data["plan"], form.cleaned_data["days"],
                                                      form.cleaned_data["again"], by=str(request.user))
            model_admin.message_user(request, f"Free trial ({form.cleaned_data['plan'].name}) given to {given} user(s)"
                                              + (f"; {skipped} skipped (they already had a trial)." if skipped else "."), messages.SUCCESS)
            if pick:
                from django.shortcuts import redirect as _redirect
                return _redirect("admin:accounts_trialgrant_changelist")
            return None
        if form.is_valid():
            model_admin.message_user(request, "Tick at least one user.", messages.WARNING)
    else:
        form = FreeTrialForm(initial={"plan": default})
    rows = list(users[:500]) if pick else list(users[:30])
    return TemplateResponse(request, "admin/free_trial.html", {
        **model_admin.admin_site.each_context(request), "title": "Give a free trial", "form": form, "pick": pick, "q": q,
        "rows": [{"u": u, "had": u.pk in had} for u in rows], "count": users.count(),
        "action": request.POST.get("action", ""), "selected": request.POST.getlist("_selected_action"),
        "select_across": request.POST.get("select_across", "0"), "opts": model_admin.model._meta})


# ── Giving a plan to many users at once ─────────────────────────────────────
class GrantPlanForm(forms.Form):
    plan = forms.ModelChoiceField(queryset=Plan.objects.all().order_by("name"))
    days = forms.IntegerField(required=False, min_value=1, max_value=3650,
                              help_text="Empty = the plan's own duration (lifetime plans never expire).")
    note = forms.CharField(required=False, max_length=200, help_text="Saved on each subscription, e.g. 'Ramadan gift'.")


def grant_plan_view(model_admin, request, users, plan=None):
    """The confirmation page of 'Give a plan': choose the plan and the days, then apply to `users`."""
    from django.template.response import TemplateResponse
    users = users.filter(is_active=True)
    if "apply" in request.POST:
        form = GrantPlanForm(request.POST)
        if form.is_valid():
            created, extended = services.grant_plan(list(users), form.cleaned_data["plan"], form.cleaned_data["days"],
                                                    form.cleaned_data["note"])
            model_admin.message_user(request, f"{form.cleaned_data['plan'].name}: {created} new subscription(s), "
                                              f"{extended} extended.", messages.SUCCESS)
            return None
    else:
        form = GrantPlanForm(initial={"plan": plan})
    return TemplateResponse(request, "admin/grant_plan.html", {
        **model_admin.admin_site.each_context(request), "title": "Give a plan", "form": form, "users": users[:30],
        "count": users.count(), "action": request.POST.get("action", ""), "selected": request.POST.getlist("_selected_action"),
        "select_across": request.POST.get("select_across", "0"), "opts": model_admin.model._meta})


@admin.register(Donation)
class DonationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "amount", "currency", "method", "reference", "donor", "status", "public")
    list_filter = ("status", "method", "public")
    search_fields = ("reference", "name", "email", "user__email", "message")
    readonly_fields = ("created_at", "received_at", "user", "source")
    actions = ["mark_received", "mark_rejected"]

    @admin.display(description="Donor")
    def donor(self, obj):
        return obj.name or obj.email or (obj.user.email if obj.user else "anonymous")

    @admin.action(description="Mark as received")
    def mark_received(self, request, queryset):
        n = queryset.exclude(status="received").update(status="received", received_at=timezone.now())
        self.message_user(request, f"{n} donation(s) marked received.", messages.SUCCESS)

    @admin.action(description="Mark as not received")
    def mark_rejected(self, request, queryset):
        n = queryset.update(status="rejected")
        self.message_user(request, f"{n} donation(s) marked not received.", messages.WARNING)

from .admin_menu import install as _menu_sections  # noqa: E402

_menu_sections(admin.site)   # the left menu in sections
