"""Admin > Statistics: website traffic, terminal use, accounts, money, ads, community and alerts.

Traffic and terminal use come from the ICT API's counters in ICT's own database (data/ict.db, tables
usage_counts / usage_unique: no IPs or emails, visitors are a daily hash). Everything else is read from
this panel's own tables.
"""
import sqlite3
from collections import defaultdict
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.template.response import TemplateResponse
from django.utils import timezone

from .models import (Ad, AlertDelivery, ChatMessage, CryptoOrder, Donation, EaConnection, Idea, LoginEvent, Payment,
                     Subscription)

RANGES = (7, 30, 90)


def _usage(since_day: str) -> dict:
    """Counters from ICT's database; empty when it is not there (fresh install)."""
    from .alerts import ict_db
    path = ict_db()
    out = {"counts": [], "unique": []}
    if not path.exists():
        return out
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            out["counts"] = [dict(r) for r in con.execute(
                "SELECT day, metric, key, n FROM usage_counts WHERE day >= ?", (since_day,))]
            out["unique"] = [dict(r) for r in con.execute(
                "SELECT day, metric, COUNT(*) AS n FROM usage_unique WHERE day >= ? GROUP BY day, metric", (since_day,))]
        finally:
            con.close()
    except sqlite3.Error:            # the API has not created the tables yet
        pass
    return out


def _fmt_minutes(m: int) -> str:
    """125 -> "2 h 5 min", 40 -> "40 min"."""
    m = int(m or 0)
    return f"{m // 60} h {m % 60} min" if m >= 60 else f"{m} min"


def daily_rows(labels, uniq, per, joined, logins) -> list[dict]:
    """One row per day, newest first: visitors, page views, terminal users, opens, time on screen,
    average time a user, new accounts and logins."""
    rows = []
    for d in reversed(labels):
        users = uniq["terminal_user"].get(d, 0)
        minutes = per["terminal_minute"].get(d, 0)
        rows.append({"day": d, "visitors": uniq["site_visitor"].get(d, 0), "views": per["site_view"].get(d, 0),
                     "users": users, "opens": per["terminal_open"].get(d, 0), "minutes": minutes,
                     "time": _fmt_minutes(minutes), "avg": _fmt_minutes(round(minutes / users)) if users else "-",
                     "joined": joined.get(d, 0), "logins": logins.get(d, 0)})
    return rows


def today_summary(rows: list[dict]) -> list[dict]:
    """Today's numbers with the change against yesterday (rows: newest first)."""
    t = rows[0] if rows else {}
    y = rows[1] if len(rows) > 1 else {}
    out = []
    for key, label in (("users", "Terminal users today"), ("minutes", "Time on the terminal today"), ("visitors", "Website visitors today"),
                       ("joined", "New accounts today"), ("logins", "Logins today")):
        a, b = t.get(key, 0), y.get(key, 0)
        out.append({"label": label, "value": _fmt_minutes(a) if key == "minutes" else a,
                    "delta": a - b, "yesterday": _fmt_minutes(b) if key == "minutes" else b})
    return out


def build(days: int) -> dict:
    now = timezone.now()
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    labels = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    usage = _usage(labels[0])
    per = defaultdict(lambda: defaultdict(int))           # metric -> day -> n
    by_key = defaultdict(lambda: defaultdict(int))        # metric -> key -> n
    for r in usage["counts"]:
        per[r["metric"]][r["day"]] += r["n"]
        by_key[r["metric"]][r["key"]] += r["n"]
    uniq = defaultdict(lambda: defaultdict(int))
    for r in usage["unique"]:
        uniq[r["metric"]][r["day"]] += r["n"]
    series = lambda d: [d.get(day, 0) for day in labels]   # noqa: E731

    User = get_user_model()
    people = User.objects.exclude(username__startswith="guest-")
    joined = dict(people.filter(date_joined__gte=start).annotate(d=TruncDate("date_joined")).values("d")
                  .annotate(n=Count("id")).values_list("d", "n"))
    logins_qs = LoginEvent.objects.filter(success=True, created_at__gte=start).exclude(method="trial")
    logins = dict(logins_qs.annotate(d=TruncDate("created_at")).values("d").annotate(n=Count("id")).values_list("d", "n"))
    to_day = lambda m: {str(k): v for k, v in m.items()}   # noqa: E731
    joined, logins = to_day(joined), to_day(logins)

    active = Subscription.objects.filter(status=Subscription.STATUS_ACTIVE).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    paid = Payment.objects.filter(status="paid", paid_at__gte=start)
    revenue = list(paid.values("currency").annotate(total=Sum("amount")).order_by("-total"))
    crypto_paid = CryptoOrder.objects.filter(status="paid", paid_at__gte=start)
    ads = list(Ad.objects.order_by("-impressions").values("name", "impressions", "clicks")[:15])
    for a in ads:
        a["ctr"] = round(100 * a["clicks"] / a["impressions"], 2) if a["impressions"] else 0

    minutes = series(per["terminal_minute"])
    total = lambda d: sum(d.values())                       # noqa: E731
    top = lambda d, n=12: sorted(d.items(), key=lambda kv: -kv[1])[:n]   # noqa: E731
    daily = daily_rows(labels, uniq, per, joined, logins)
    return {
        "days": days, "ranges": RANGES, "labels": labels, "daily": daily, "today": today_summary(daily),
        "cards": [
            ("Website visitors", total(uniq["site_visitor"]), "unique a day, added up"),
            ("Page views", total(per["site_view"]), "website + guide"),
            ("Terminal users", total(uniq["terminal_user"]), "unique a day, added up"),
            ("Terminal opens", total(per["terminal_open"]), "web, app and Windows"),
            ("Terminal hours", round(sum(minutes) / 60, 1), "time on screen"),
            ("New accounts", sum(joined.values()), f"{people.count()} in all"),
            ("Logins", sum(logins.values()), "successful"),
            ("Active subscriptions", active.count(), f"{active.filter(plan__is_vip=True).count()} VIP"),
            ("Paid (bank / wallet)", ", ".join(f"{r['total']:,.0f} {r['currency']}" for r in revenue) or "0", f"{paid.count()} payments"),
            ("Paid by crypto", f"{crypto_paid.filter(kind='plan').aggregate(s=Sum('price'))['s'] or 0:,.0f} USD",
             f"{crypto_paid.filter(kind='plan').count()} plans"),
            ("Donations", f"{Donation.objects.filter(status='received', received_at__gte=start).aggregate(s=Sum('amount'))['s'] or 0:,.0f}",
             f"{Donation.objects.filter(created_at__gte=start).count()} reported"),
            ("Ad impressions", sum(a["impressions"] for a in ads), f"{sum(a['clicks'] for a in ads)} clicks (all time)"),
            ("Alerts sent", AlertDelivery.objects.filter(created_at__gte=start, ok=True).count(), "WhatsApp / Telegram / email"),
            ("Community posts", ChatMessage.objects.filter(created_at__gte=start).count()
             + Idea.objects.filter(created_at__gte=start).count(), "messages + ideas"),
            ("EA online now", sum(1 for c in EaConnection.objects.all() if c.online), f"{EaConnection.objects.filter(copy_enabled=True).count()} with auto-trading ON"),
        ],
        "chart": {
            "visitors": series(uniq["site_visitor"]), "views": series(per["site_view"]),
            "terminal_users": series(uniq["terminal_user"]), "opens": series(per["terminal_open"]),
            "hours": [round(m / 60, 2) for m in minutes],
            "joined": [joined.get(d, 0) for d in labels], "logins": [logins.get(d, 0) for d in labels],
        },
        "pages": top(by_key["site_view"]), "refs": top(by_key["site_ref"]),
        "platforms": top(by_key["terminal_open"]), "plans_seen": top(by_key["terminal_plan"]),
        "login_methods": list(logins_qs.values("method").annotate(n=Count("id")).order_by("-n")),
        "login_platforms": list(logins_qs.exclude(platform="").values("platform").annotate(n=Count("id")).order_by("-n")),
        "subs_by_plan": list(active.values("plan__name").annotate(n=Count("id")).order_by("-n")),
        "ads": ads,
        "has_usage": bool(usage["counts"]),
    }


def stats_view(request):
    from django.contrib import admin
    try:
        days = int(request.GET.get("days", 30))
    except ValueError:
        days = 30
    days = days if days in RANGES else 30
    return TemplateResponse(request, "admin/stats.html", {**admin.site.each_context(request), "title": "Statistics", **build(days)})
