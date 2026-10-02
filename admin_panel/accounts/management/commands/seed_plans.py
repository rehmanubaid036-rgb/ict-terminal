from django.core.management.base import BaseCommand

from accounts.models import Plan

# Prices are placeholders: set real prices in the admin (Plans page). Auto-trading stays off until
# a model is proven in backtests; turn it on per plan in the admin when that happens.
DEFAULT_PLANS = [
    {"name": "Free", "slug": "free", "duration_days": 0, "price": 0, "is_vip": False, "sort_order": 0,
     "signal_delay_minutes": 30, "allowed_models": "M1", "ict_indicators": True, "max_charts": 1,
     "can_view_trades": False, "can_auto_trade": False, "ai_messages_per_day": 0, "alerts_limit": 3,
     "can_use_backtest": False, "show_ads": True, "max_mobile": 1, "max_desktop": 1, "max_web": 1,
     "description": "Charts with ICT indicators, Silver Bullet signals 30 minutes late."},
    {"name": "Pro Monthly", "slug": "pro-monthly", "duration_days": 30, "price": 0, "sort_order": 10,
     "signal_delay_minutes": 0, "allowed_models": "all", "max_charts": 4, "can_view_trades": True,
     "can_auto_trade": False, "ai_messages_per_day": 30, "alerts_limit": 50, "max_mobile": 1, "max_desktop": 1,
     "max_web": 1, "description": "Real-time signals from every model, 4-chart layouts, alerts, AI agent."},
    {"name": "Elite Monthly", "slug": "elite-monthly", "duration_days": 30, "price": 0, "sort_order": 20,
     "signal_delay_minutes": 0, "allowed_models": "all", "max_charts": 4, "can_view_trades": True,
     "can_auto_trade": False, "max_mt_accounts": 3, "ai_messages_per_day": 200, "alerts_limit": 0,
     "max_mobile": 2, "max_desktop": 2, "max_web": 2,
     "description": "Everything in Pro, more devices and AI messages, auto-trading when enabled."},
    {"name": "Elite Annual", "slug": "elite-annual", "duration_days": 365, "price": 0, "sort_order": 30,
     "signal_delay_minutes": 0, "allowed_models": "all", "max_charts": 4, "can_view_trades": True,
     "can_auto_trade": False, "max_mt_accounts": 3, "ai_messages_per_day": 200, "alerts_limit": 0,
     "max_mobile": 2, "max_desktop": 2, "max_web": 2, "description": "Elite for 12 months."},
]


class Command(BaseCommand):
    help = "Create the default ICT Terminal plans (existing plans are left unchanged)."

    def handle(self, *args, **options):
        for data in DEFAULT_PLANS:
            _, created = Plan.objects.get_or_create(slug=data["slug"], defaults=data)
            self.stdout.write(f"{'created' if created else 'exists '}  {data['name']}")
