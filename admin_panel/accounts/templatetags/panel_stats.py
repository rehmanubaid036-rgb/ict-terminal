from datetime import timedelta

from django import template
from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from django.utils import timezone

from accounts.models import LoginEvent, Payment, SiteSettings, Subscription

register = template.Library()


@register.simple_tag
def dashboard_stats():
    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    active = (Subscription.objects.filter(status=Subscription.STATUS_ACTIVE, starts_at__lte=now)
              .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)))
    revenue = (Payment.objects.filter(status="paid", paid_at__gte=month_start)
               .values("currency").annotate(total=Sum("amount")).order_by("-total"))
    return {
        "active_subs": active.count(),
        "expiring_7d": active.filter(expires_at__lte=now + timedelta(days=7)).count(),
        "expired": Subscription.objects.filter(expires_at__lte=now).count(),
        "customers": get_user_model().objects.filter(is_staff=False).count(),
        "new_customers_30d": get_user_model().objects.filter(is_staff=False,
                                                             date_joined__gte=now - timedelta(days=30)).count(),
        "revenue_month": ", ".join(f"{r['total']:,.0f} {r['currency']}" for r in revenue) or "0",
        "pending_payments": Payment.objects.filter(status="pending").count(),
        "failed_logins_24h": LoginEvent.objects.filter(success=False, created_at__gte=now - timedelta(days=1)).count(),
        "expiring_soon": active.filter(expires_at__lte=now + timedelta(days=7)).select_related("plan", "user")
                               .order_by("expires_at")[:8],
        "signup_plans": ", ".join(SiteSettings.load().signup_plans.values_list("name", flat=True)),
    }
