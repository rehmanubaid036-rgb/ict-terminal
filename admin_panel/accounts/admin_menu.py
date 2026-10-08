"""The admin's left menu in sections (Users, Plans, Payments, Crypto, Community ...) instead of one long list.

Django lists every model of the "accounts" app together; here the menu (and the dashboard) are regrouped by
topic. Each model's own page and URL stay the same. A model not named below lands in "Other", so nothing
ever disappears from the menu.
"""
# (section key, title, icon, models as "app_label.modelname") in menu order
SECTIONS = [
    ("users", "Users & logins", "fas fa-users", [
        "auth.user", "accounts.customerprofile", "accounts.socialaccount", "accounts.device", "accounts.deviceclaim",
        "accounts.apitoken", "accounts.loginevent", "auth.group"]),
    ("plans", "Plans & subscriptions", "fas fa-layer-group", [
        "accounts.plan", "accounts.subscription", "accounts.trialgrant"]),
    ("payments", "Payments (bank / wallet)", "fas fa-money-bill-wave", [
        "accounts.payment", "accounts.paymentmethod"]),
    ("crypto", "Crypto payments", "fab fa-bitcoin", [
        "accounts.cryptoorder", "accounts.cryptowallet", "accounts.cryptotransfer", "accounts.cryptowalletchange",
        "accounts.cryptoscanstate"]),
    ("donations", "Donations", "fas fa-heart", ["accounts.donation"]),
    ("community", "Community", "fas fa-comments", [
        "accounts.chatmessage", "accounts.chatprofile", "accounts.chatreport", "accounts.idea", "accounts.ideacomment",
        "accounts.idealike", "accounts.ideareport"]),
    ("alerts", "Alerts (WhatsApp / Telegram)", "fas fa-bell", ["accounts.alertprefs", "accounts.alertdelivery"]),
    ("trading", "Auto-trading (EA)", "fas fa-robot", ["accounts.eaconnection"]),
    ("ai", "AI assistant", "fas fa-brain", ["accounts.aiprefs"]),
    ("ads", "Ads", "fas fa-bullhorn", ["accounts.ad"]),
    ("settings", "Settings", "fas fa-cogs", ["accounts.sitesettings"]),
]
ICONS = {
    "auth.user": "fas fa-user", "auth.group": "fas fa-users-cog", "accounts.customerprofile": "fas fa-address-card",
    "accounts.socialaccount": "fab fa-google", "accounts.device": "fas fa-mobile-alt", "accounts.deviceclaim": "fas fa-lock",
    "accounts.apitoken": "fas fa-key", "accounts.loginevent": "fas fa-history",
    "accounts.plan": "fas fa-layer-group", "accounts.subscription": "fas fa-id-card", "accounts.trialgrant": "fas fa-gift",
    "accounts.payment": "fas fa-receipt", "accounts.paymentmethod": "fas fa-university",
    "accounts.cryptoorder": "fas fa-shopping-cart", "accounts.cryptowallet": "fas fa-wallet",
    "accounts.cryptotransfer": "fas fa-exchange-alt", "accounts.cryptowalletchange": "fas fa-history",
    "accounts.cryptoscanstate": "fas fa-search-dollar", "accounts.donation": "fas fa-hand-holding-heart",
    "accounts.chatmessage": "fas fa-comment", "accounts.chatprofile": "fas fa-user-tag", "accounts.chatreport": "fas fa-flag",
    "accounts.idea": "fas fa-lightbulb", "accounts.ideacomment": "fas fa-comment-dots", "accounts.idealike": "fas fa-thumbs-up",
    "accounts.ideareport": "fas fa-flag", "accounts.alertprefs": "fas fa-sliders-h", "accounts.alertdelivery": "fas fa-paper-plane",
    "accounts.eaconnection": "fas fa-plug", "accounts.aiprefs": "fas fa-key", "accounts.ad": "fas fa-ad",
    "accounts.sitesettings": "fas fa-cogs",
}


def jazzmin_icons() -> dict:
    """Icons for settings.JAZZMIN_SETTINGS: the sections and every model in them (keys as the menu builds them)."""
    out = {key: icon for key, _, icon, _ in SECTIONS}
    out["other"] = "fas fa-folder"
    for key, _, _, models in SECTIONS:
        for m in models:
            out[f"{key}.{m.split('.')[1]}"] = ICONS.get(m, "fas fa-circle")
    return out


SECTION_ORDER = [key for key, *_ in SECTIONS] + ["other"]


def install(site) -> None:
    """Regroups ``site``'s menu (called from accounts/admin.py once every model is registered)."""
    original = site.get_app_list

    def grouped_app_list(request, app_label=None):
        apps = original(request, app_label)
        if app_label:                                   # an app's own index page: as Django makes it
            return apps
        by_model = {}
        for app in apps:
            for m in app["models"]:
                by_model[f"{app['app_label']}.{m['object_name']}".lower()] = m
        out, used = [], set()
        for key, title, _, models in SECTIONS:
            items = [by_model[m] for m in models if m in by_model]
            used.update(m for m in models if m in by_model)
            if items:
                out.append({"name": title, "app_label": key, "app_url": items[0]["admin_url"], "has_module_perms": True,
                            "models": items})
        rest = [m for k, m in by_model.items() if k not in used]
        if rest:
            out.append({"name": "Other", "app_label": "other", "app_url": rest[0]["admin_url"], "has_module_perms": True,
                        "models": rest})
        return out

    site.get_app_list = grouped_app_list
