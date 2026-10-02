"""Django settings for the ICT Terminal admin panel.

Values come from admin_panel/.env (see .env.example). Run setup_admin_panel.bat
once to create it with a random SECRET_KEY and INTERNAL_API_SECRET.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY is missing. Run setup_admin_panel.bat (or copy .env.example to .env).")

DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

# Shared secret that api_server.py sends in X-Service-Key when it asks this
# panel to verify a login token. (Open/close signup and the plans new accounts
# get are set in the admin under Registration settings.)
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

# Support contact shown to customers
SUPPORT_WHATSAPP = os.getenv("SUPPORT_WHATSAPP", "923304040740")
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "") or "rehmanubaid036@gmail.com"

# Google / Facebook login. The sign-in pages send customers back to
# PUBLIC_API_URL/api/v1/oauth/<google|facebook>/callback (register exactly that address
# in Google Cloud Console and Meta for Developers). Empty ids = that button is hidden.
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://ictapi.iccterminal.trade").rstrip("/")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID", "")
FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")

INSTALLED_APPS = [
    "jazzmin",  # AdminLTE 3 theme for the Django admin; must come before django.contrib.admin
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "accounts",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # serves the admin's CSS/JS under waitress
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# SQLite for now; ADMIN_PANEL_DB can point elsewhere (e.g. a throwaway copy for testing)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.getenv("ADMIN_PANEL_DB") or (BASE_DIR / "data" / "admin_panel.sqlite3"),
        # The crypto watcher writes from its own process: wait for a busy database, don't fail
        "OPTIONS": {"timeout": 20},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Login rate limiting uses the cache; the local-memory cache is fine for one process
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "Asia/Karachi")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# Uploads (ad images). admin_panel/data/ is kept by the VPS update, like the database.
MEDIA_ROOT = os.getenv("ADMIN_PANEL_MEDIA") or (BASE_DIR / "data" / "media")
MEDIA_URL = "/media/"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Password-reset emails. Without SMTP settings they are printed to the console.
if os.getenv("EMAIL_HOST"):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = os.getenv("EMAIL_HOST")
    EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
    EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", SUPPORT_EMAIL or "no-reply@localhost")

if not DEBUG:
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = True
    X_FRAME_OPTIONS = "DENY"
    SECURE_CONTENT_TYPE_NOSNIFF = True
    if env_bool("DJANGO_HTTPS", False):
        SESSION_COOKIE_SECURE = True
        CSRF_COOKIE_SECURE = True
        SECURE_SSL_REDIRECT = True
        # The ICT API calls this panel over plain http on 127.0.0.1 (service key protected):
        # only browser pages are sent to https, the internal /api/ calls are answered directly.
        SECURE_REDIRECT_EXEMPT = [r"^api/"]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"accounts": {"handlers": ["console"], "level": "INFO"}},
}

# ── Jazzmin (AdminLTE 3) ─────────────────────────────────────────────────────
JAZZMIN_SETTINGS = {
    "site_title": "ICT Terminal Admin",
    "site_header": "ICT Terminal",
    "site_brand": "ICT Terminal",
    "welcome_sign": "ICT Terminal: Admin Panel",
    "copyright": "ICT Terminal",
    "search_model": ["auth.User", "accounts.Subscription"],
    "topmenu_links": [
        {"name": "Dashboard", "url": "admin:index", "permissions": ["auth.view_user"]},
        {"model": "accounts.Subscription"},
        {"model": "accounts.Payment"},
    ],
    "order_with_respect_to": ["accounts", "accounts.subscription", "accounts.plan", "accounts.eaconnection", "accounts.sitesettings",
                              "accounts.payment", "accounts.paymentmethod", "accounts.device", "accounts.apitoken", "accounts.loginevent",
                              "auth"],
    "icons": {
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.Group": "fas fa-users",
        "accounts.Plan": "fas fa-layer-group",
        "accounts.Subscription": "fas fa-id-card",
        "accounts.Payment": "fas fa-money-bill-wave",
        "accounts.PaymentMethod": "fas fa-university",
        "accounts.Device": "fas fa-mobile-alt",
        "accounts.ApiToken": "fas fa-key",
        "accounts.LoginEvent": "fas fa-history",
        "accounts.CustomerProfile": "fas fa-address-card",
        "accounts.SiteSettings": "fas fa-cogs",
        "accounts.EaConnection": "fas fa-copy",
    },
    "show_ui_builder": False,
    "changeform_format": "horizontal_tabs",
    "related_modal_active": True,
}

JAZZMIN_UI_TWEAKS = {
    # AdminLTE's own theme, light or dark following the computer's setting
    "theme": "default",
    "default_theme_mode": "auto",
    "navbar": "navbar-dark",
    "sidebar": "sidebar-dark-warning",
    "accent": "accent-warning",
    "brand_colour": "navbar-dark",
    "navbar_small_text": False,
    "sidebar_nav_child_indent": True,
}
