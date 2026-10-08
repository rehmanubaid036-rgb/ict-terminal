import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import (ApiToken, Device, DeviceClaim, LoginEvent, OAuthLogin, Payment, PaymentMethod, Plan,
                     SiteSettings, SocialAccount, Subscription, TrialGrant)

User = get_user_model()
SECRET = "test-internal-secret"
PASSWORD = "Str0ng-Passw0rd!"


@override_settings(INTERNAL_API_SECRET=SECRET)
class ApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.plan = Plan.objects.create(name="VIP Monthly", slug="vip-monthly", duration_days=30, max_mobile=2)

    # helpers
    def post(self, url, data=None, **headers):
        return self.client.post(f"/api/v1/{url}", json.dumps(data or {}), content_type="application/json",
                                headers=headers)

    def get(self, url, **headers):
        return self.client.get(f"/api/v1/{url}", headers=headers)

    def make_user(self, email="trader@example.com"):
        return User.objects.create_user(username=email, email=email, password=PASSWORD)

    def login(self, email="trader@example.com", device="phone-1"):
        return self.post("auth/login", {"email": email, "password": PASSWORD, "device_id": device, "platform": "android"})

    # registration
    def test_register_without_signup_plans_is_free_tier(self):
        r = self.post("auth/register", {"email": "New@Example.com", "password": PASSWORD, "name": "Ali Khan"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["access"]["is_vip"])
        self.assertEqual(User.objects.get().email, "new@example.com")
        self.assertEqual(Subscription.objects.count(), 0)

    def test_email_register_gets_no_trial(self):
        """Free trials are only for Google / Facebook accounts (see SocialLoginTests)."""
        trial = Plan.objects.create(name="VIP Trial", slug="vip-trial", duration_days=7)
        SiteSettings.load().signup_plans.set([trial])
        r = self.post("auth/register", {"email": "new@example.com", "password": PASSWORD,
                                        "device_id": "phone-1", "platform": "android"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["access"]["is_vip"])
        self.assertEqual(Subscription.objects.count(), 0)

    def test_register_rejects_duplicate_and_weak_password(self):
        self.make_user()
        self.assertEqual(self.post("auth/register", {"email": "trader@example.com", "password": PASSWORD}).status_code, 409)
        self.assertEqual(self.post("auth/register", {"email": "x@example.com", "password": "123"}).status_code, 400)

    def test_register_can_be_closed_in_settings(self):
        s = SiteSettings.load()
        s.allow_signup = False
        s.save()
        self.assertEqual(self.post("auth/register", {"email": "a@example.com", "password": PASSWORD}).status_code, 403)
        self.assertFalse(self.get("health").json()["signup_open"])

    # login / sessions
    def test_login_with_active_subscription_is_vip(self):
        user = self.make_user()
        Subscription.objects.create(user=user, plan=self.plan)
        r = self.login()
        self.assertEqual(r.status_code, 200)
        access = r.json()["access"]
        self.assertTrue(access["is_vip"])
        self.assertEqual(access["plan"], "VIP Monthly")
        self.assertEqual(Device.objects.filter(user=user).count(), 1)

    def test_expired_and_suspended_subscriptions_lose_vip(self):
        user = self.make_user()
        sub = Subscription.objects.create(user=user, plan=self.plan)
        sub.expires_at = timezone.now() - timedelta(days=1)
        sub.save()
        access = self.login().json()["access"]
        self.assertFalse(access["is_vip"])
        self.assertEqual(access["status"], "expired")
        sub.expires_at = timezone.now() + timedelta(days=5)
        sub.status = Subscription.STATUS_SUSPENDED
        sub.save()
        self.assertEqual(self.login().json()["access"]["status"], "suspended")

    def test_wrong_password_and_rate_limit(self):
        self.make_user()
        for _ in range(10):
            self.assertEqual(self.post("auth/login", {"email": "trader@example.com", "password": "nope"}).status_code, 401)
        self.assertEqual(self.login().status_code, 429)
        self.assertEqual(LoginEvent.objects.filter(success=False).count(), 10)

    def test_me_logout_and_token_revocation(self):
        self.make_user()
        token = self.login().json()["token"]
        auth = {"Authorization": f"Bearer {token}"}
        self.assertEqual(self.get("auth/me", **auth).status_code, 200)
        self.assertEqual(self.post("auth/logout", **auth).status_code, 200)
        self.assertEqual(self.get("auth/me", **auth).status_code, 401)
        self.assertEqual(self.get("auth/me", Authorization="Bearer garbage").status_code, 401)

    def test_tokens_are_stored_hashed(self):
        self.make_user()
        token = self.login().json()["token"]
        self.assertFalse(ApiToken.objects.filter(key_hash=token).exists())
        self.assertTrue(ApiToken.objects.filter(key_hash=ApiToken.hash(token)).exists())

    def test_device_limit_per_account(self):
        user = self.make_user()
        Subscription.objects.create(user=user, plan=self.plan)  # max 2 devices
        for dev in ("a", "b", "a"):
            r = self.login(device=dev)
            self.assertTrue(r.json()["access"]["is_vip"], dev)
        r = self.login(device="c")
        self.assertFalse(r.json()["access"]["is_vip"])
        self.assertIn("Device limit", r.json()["warning"])
        # logging out frees the slot
        token_b = self.login(device="b").json()["token"]
        self.post("auth/logout", Authorization=f"Bearer {token_b}")
        self.assertTrue(self.login(device="c").json()["access"]["is_vip"])

    def test_license_key_endpoints_are_gone(self):
        self.assertEqual(self.post("license/activate", {"license_key": "X"}).status_code, 404)
        self.assertEqual(self.post("auth/link-license", {"license_key": "X"}).status_code, 404)

    # copy trading
    def test_app_config_has_partner_link(self):
        cfg = self.get("app-config").json()
        self.assertEqual(cfg["broker"]["name"], "Axi")
        self.assertIn("promocode=4735876", cfg["broker"]["partner_link"])

    def test_copy_token_settings_and_ea_checkin(self):
        svc = {"X-Service-Key": SECRET}
        user = self.make_user()
        auth = {"Authorization": f"Bearer {self.login().json()['token']}"}
        # no plan yet: EA check-in is refused with a reason
        raw = self.post("copy/token", **auth).json()["ea_token"]
        self.assertTrue(raw.startswith("ea_"))
        r = self.post("internal/ea", {"ea_token": raw, "mt5_login": "123", "balance": 2500}, **svc).json()
        self.assertFalse(r["valid"])
        self.assertIn("auto-trading", r["reason"])
        # a plan without auto-trading is not enough
        Subscription.objects.create(user=user, plan=self.plan)
        self.post("copy/settings", {"copy_enabled": True}, **auth)
        r = self.post("internal/ea", {"ea_token": raw}, **svc).json()
        self.assertFalse(r["valid"])
        self.assertIn("auto-trading", r["reason"])
        # auto-trading plan but no approved model -> connected, not trading
        self.plan.can_auto_trade = True
        self.plan.save()
        r = self.post("internal/ea", {"ea_token": raw}, **svc).json()
        self.assertFalse(r["valid"])
        self.assertIn("No model is approved", r["reason"])
        site = SiteSettings.load(); site.auto_trade_models = "M9, m4"; site.save()
        r = self.post("copy/settings", {"copy_enabled": True, "multiplier": 2}, **auth).json()["copy"]
        self.assertTrue(r["copy_enabled"])
        self.assertEqual(r["multiplier"], 2.0)
        r = self.post("internal/ea", {"ea_token": raw, "mt5_login": "123", "mt5_server": "Axi-US",
                                      "balance": 2500, "open_copies": 1}, **svc).json()
        self.assertTrue(r["valid"], r)
        self.assertEqual(r["copy"]["lot_per_1000"], 0.01)
        self.assertEqual(r["copy"]["models"], ["M9", "M4"])
        status = self.get("copy/settings", **auth).json()["copy"]
        self.assertTrue(status["ea_online"])
        self.assertEqual(status["mt5_login"], "123")
        self.assertEqual(status["balance"], 2500.0)
        # a new token replaces the old one
        self.post("copy/token", **auth)
        self.assertFalse(self.post("internal/ea", {"ea_token": raw}, **svc).json()["valid"])
        # multiplier bounds and admin master switch
        self.assertEqual(self.post("copy/settings", {"multiplier": 50}, **auth).status_code, 400)
        site = SiteSettings.load(); site.copy_trading_enabled = False; site.save()
        raw2 = self.post("copy/token", **auth).json()["ea_token"]
        self.assertIn("paused", self.post("internal/ea", {"ea_token": raw2}, **svc).json()["reason"])

    def test_copy_endpoints_need_login_and_secret(self):
        self.assertEqual(self.get("copy/settings").status_code, 401)
        self.assertEqual(self.post("copy/token").status_code, 401)
        self.assertEqual(self.post("internal/ea", {"ea_token": "x"}).status_code, 403)

    # internal verify used by api_server.py
    def test_internal_verify_requires_secret(self):
        self.assertEqual(self.post("internal/verify", {"token": "x"}).status_code, 403)
        self.assertEqual(self.post("internal/verify", {}, **{"X-Service-Key": "wrong"}).status_code, 403)

    def test_internal_verify_token_and_guest(self):
        svc = {"X-Service-Key": SECRET}
        user = self.make_user()
        sub = Subscription.objects.create(user=user, plan=self.plan)
        token = self.login().json()["token"]
        r = self.post("internal/verify", {"token": token}, **svc).json()
        self.assertTrue(r["valid"])
        self.assertEqual(r["access"]["expiry"], sub.expires_at.date().isoformat())
        self.assertFalse(self.post("internal/verify", {"token": "nope"}, **svc).json()["valid"])
        guest = self.post("internal/verify", {}, **svc).json()
        self.assertFalse(guest["access"]["is_vip"])

    def test_site_feature_settings(self):
        svc = {"X-Service-Key": SECRET}
        self.assertTrue(self.get("app-config").json()["features"]["backtest_enabled"])
        f = self.client.get("/api/v1/internal/site", headers=svc).json()["features"]
        self.assertEqual((f["backtest_enabled"], f["backtest_free"], f["time_offset_hours"]), (True, False, 3))
        s = SiteSettings.load()
        s.backtest_enabled, s.backtest_free = False, True
        s.save()
        f = self.client.get("/api/v1/internal/site", headers=svc).json()["features"]
        self.assertEqual((f["backtest_enabled"], f["backtest_free"]), (False, True))
        self.assertFalse(self.get("app-config").json()["features"]["backtest_enabled"])

    def test_plan_features_for_a_free_plan(self):
        svc = {"X-Service-Key": SECRET}
        user = self.make_user()
        free = Plan.objects.create(name="Free", slug="free", price=0, duration_days=0, is_vip=False,
                                   signal_delay_minutes=30, allowed_models="M1", max_charts=1,
                                   can_auto_trade=True, ai_messages_per_day=0, alerts_limit=3)
        Subscription.objects.create(user=user, plan=free)
        token = self.login().json()["token"]
        f = self.post("internal/verify", {"token": token}, **svc).json()["access"]["features"]
        self.assertEqual((f["signals"], f["signal_delay_minutes"], f["models"], f["max_charts"]), (True, 30, ["M1"], 1))
        # auto-trading needs a paid (VIP) plan even when the tick is set
        self.assertEqual((f["auto_trade"], f["max_mt_accounts"], f["alerts_limit"]), (False, 0, 3))
        guest = self.post("internal/verify", {}, **svc).json()["access"]["features"]
        self.assertEqual((guest["signals"], guest["models"], guest["auto_trade"]), (False, [], False))

    def test_plan_features_combine_across_plans(self):
        svc = {"X-Service-Key": SECRET}
        user = self.make_user()
        a = Plan.objects.create(name="Pro", slug="pro", price=29, allowed_models="M1,M4", signal_delay_minutes=5,
                                max_charts=2, ai_messages_per_day=20, alerts_limit=10)
        b = Plan.objects.create(name="Auto", slug="auto", price=49, allowed_models="m2", can_auto_trade=True,
                                max_mt_accounts=2, ai_messages_per_day=50, alerts_limit=0)
        Subscription.objects.create(user=user, plan=a)
        Subscription.objects.create(user=user, plan=b)
        token = self.login().json()["token"]
        f = self.post("internal/verify", {"token": token}, **svc).json()["access"]["features"]
        self.assertEqual(f["models"], ["M1", "M2", "M4"])
        self.assertEqual((f["signal_delay_minutes"], f["max_charts"], f["ai_messages_per_day"]), (0, 4, 50))
        self.assertEqual((f["auto_trade"], f["max_mt_accounts"], f["alerts_limit"]), (True, 2, 0))  # 0 = unlimited

    def test_all_models_plan(self):
        p = Plan(name="Elite", slug="elite", allowed_models=" ALL ")
        self.assertIsNone(p.model_ids)
        self.assertEqual(Plan(name="x", slug="x", allowed_models="m1, M13 ,").model_ids, ["M1", "M13"])

    # password flows
    def test_password_reset_flow(self):
        self.make_user()
        old_token = self.login().json()["token"]
        self.assertEqual(self.post("auth/password/reset", {"email": "trader@example.com"}).status_code, 200)
        self.assertEqual(self.post("auth/password/reset", {"email": "nobody@example.com"}).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        code = mail.outbox[0].body.split("Reset code: ")[1].split()[0]
        r = self.post("auth/password/reset/confirm", {"code": code, "new_password": "An0ther-Good-Pass"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.get("auth/me", Authorization=f"Bearer {old_token}").status_code, 401)
        self.assertEqual(self.post("auth/login", {"email": "trader@example.com", "password": "An0ther-Good-Pass"}).status_code, 200)

    def test_password_change(self):
        self.make_user()
        token = self.login().json()["token"]
        auth = {"Authorization": f"Bearer {token}"}
        self.assertEqual(self.post("auth/password/change", {"old_password": "bad", "new_password": "x"}, **auth).status_code, 400)
        r = self.post("auth/password/change", {"old_password": PASSWORD, "new_password": "Brand-New-Pass9"}, **auth)
        self.assertEqual(r.status_code, 200)

    def test_plans_public_listing(self):
        Plan.objects.create(name="Hidden", slug="hidden", is_public=False)
        names = [p["name"] for p in self.get("plans").json()["plans"]]
        self.assertEqual(names, ["VIP Monthly"])

    def test_plans_listing_shows_ict_features_for_the_website(self):
        Plan.objects.create(name="Starter", slug="starter", price=10, is_vip=False, can_view_signals=True,
                            signal_delay_minutes=15, allowed_models="M1, M9", max_charts=2, can_auto_trade=True)
        plans = {p["name"]: p for p in self.get("plans").json()["plans"]}
        f = plans["Starter"]["features"]
        self.assertEqual(f["signal_delay_minutes"], 15)
        self.assertEqual(f["models"], ["M1", "M9"])
        self.assertEqual(f["max_charts"], 2)
        self.assertFalse(f["auto_trade"])          # auto-trading is a VIP-plan feature only
        self.assertIn("features", plans["VIP Monthly"])


class ModelTests(TestCase):
    def test_extend_never_loses_paid_time(self):
        plan = Plan.objects.create(name="P", slug="p", duration_days=30)
        user = User.objects.create_user("u@example.com", "u@example.com", PASSWORD)
        sub = Subscription.objects.create(user=user, plan=plan)
        before = sub.expires_at
        sub.extend(30)
        self.assertEqual((sub.expires_at - before).days, 30)
        sub.expires_at = timezone.now() - timedelta(days=10)  # lapsed: renew from today
        sub.extend(30)
        self.assertGreaterEqual(sub.days_left, 29)

    def test_site_settings_is_a_single_row(self):
        SiteSettings.load()
        SiteSettings(allow_signup=False).save()
        self.assertEqual(SiteSettings.objects.count(), 1)
        self.assertFalse(SiteSettings.load().allow_signup)

    def test_payment_admin_action_extends_once(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        from .admin import PaymentAdmin
        plan = Plan.objects.create(name="P", slug="p", duration_days=30)
        user = User.objects.create_user("u@example.com", "u@example.com", PASSWORD)
        sub = Subscription.objects.create(user=user, plan=plan)
        before = sub.expires_at
        payment = Payment.objects.create(subscription=sub, amount=10)
        admin_user = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        request = RequestFactory().post("/")
        request.user = admin_user
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        pa = PaymentAdmin(Payment, site)
        pa.approve(request, Payment.objects.filter(pk=payment.pk))
        pa.approve(request, Payment.objects.filter(pk=payment.pk))
        sub.refresh_from_db()
        self.assertEqual((sub.expires_at - before).days, 30)


@override_settings(INTERNAL_API_SECRET=SECRET, SUPPORT_WHATSAPP="923304040740")
class PaymentFlowTests(TestCase):
    """Customer pays -> "I have paid" in the app -> pending in the admin -> approve -> plan."""

    def setUp(self):
        cache.clear()
        self.plan = Plan.objects.create(name="VIP Monthly", slug="vip-monthly", price=30, duration_days=30)
        self.jazz = PaymentMethod.objects.create(name="JazzCash", kind="jazzcash", account_title="Ubaid",
                                                 account_number="03001234567")
        PaymentMethod.objects.create(name="Old bank", kind="bank", account_number="X", is_active=False)
        self.user = User.objects.create_user("buyer@example.com", "buyer@example.com", PASSWORD)
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "buyer@example.com", "password": PASSWORD,
                                                               "device_id": "p1", "platform": "android"}),
                             content_type="application/json")
        self.auth = {"Authorization": "Bearer " + r.json()["token"]}

    def submit(self, **data):
        payload = {"plan": "vip-monthly", "method": self.jazz.pk, "reference": "TX123456", "source": "app"}
        payload.update(data)
        return self.client.post("/api/v1/payments/submit", json.dumps(payload), content_type="application/json",
                                headers=self.auth)

    def approve(self, payment):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        from .admin import PaymentAdmin
        request = RequestFactory().post("/")
        request.user = (User.objects.filter(username="boss").first()
                        or User.objects.create_superuser("boss", "boss@example.com", PASSWORD))
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        PaymentAdmin(Payment, site).approve(request, Payment.objects.filter(pk=payment.pk))

    def test_public_methods_list_only_active(self):
        r = self.client.get("/api/v1/payments/methods")
        self.assertEqual(r.status_code, 200)
        methods = r.json()["methods"]
        self.assertEqual([m["name"] for m in methods], ["JazzCash"])
        self.assertEqual(methods[0]["account_number"], "03001234567")
        self.assertEqual(r.json()["support"]["whatsapp"], "923304040740")

    def test_submit_creates_pending_payment_and_whatsapp_link(self):
        r = self.submit(note="sent from my wife's account")
        self.assertEqual(r.status_code, 200, r.content)
        p = Payment.objects.get()
        self.assertEqual((p.status, p.user, p.plan, p.payment_method, p.method, p.source),
                         ("pending", self.user, self.plan, self.jazz, "jazzcash", "app"))
        self.assertEqual(str(p.amount), "30.00")
        link = r.json()["whatsapp_url"]
        self.assertTrue(link.startswith("https://wa.me/923304040740?text="))
        self.assertIn("TX123456", link)
        self.assertIn(f"Payment%20%23{p.pk}", link)
        # nothing is unlocked before the admin approves
        self.assertFalse(self.client.get("/api/v1/auth/me", headers=self.auth).json()["access"]["is_vip"])

    def test_submit_needs_login_and_valid_data(self):
        r = self.client.post("/api/v1/payments/submit", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.submit(plan="nope").status_code, 400)
        self.assertEqual(self.submit(method=999).status_code, 400)
        self.assertEqual(self.submit(reference="x").status_code, 400)
        inactive = PaymentMethod.objects.get(name="Old bank")
        self.assertEqual(self.submit(method=inactive.pk).status_code, 400)
        self.assertEqual(Payment.objects.count(), 0)

    def test_duplicate_reference_and_pending_limit(self):
        self.assertEqual(self.submit().status_code, 200)
        self.assertIn("already submitted", self.submit().json()["detail"])
        for i in range(4):
            self.assertEqual(self.submit(reference=f"REF{i:04d}").status_code, 200)
        self.assertEqual(self.submit(reference="REF9999").status_code, 400)   # 5 pending max

    def test_approve_creates_subscription_once(self):
        self.submit()
        p = Payment.objects.get()
        self.approve(p)
        self.approve(p)                                     # second click does nothing more
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual(sub.plan, self.plan)
        self.assertAlmostEqual((sub.expires_at - timezone.now()).days, 29, delta=1)
        p.refresh_from_db()
        self.assertEqual((p.status, p.applied, p.subscription), ("paid", True, sub))
        self.assertTrue(self.client.get("/api/v1/auth/me", headers=self.auth).json()["access"]["is_vip"])

    def test_approve_renewal_extends_existing_subscription(self):
        sub = Subscription.objects.create(user=self.user, plan=self.plan)
        before = sub.expires_at
        self.submit()
        self.approve(Payment.objects.get())
        sub.refresh_from_db()
        self.assertEqual(Subscription.objects.filter(user=self.user).count(), 1)
        self.assertEqual((sub.expires_at - before).days, 30)

    def test_saving_status_paid_in_admin_form_applies(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        from .admin import PaymentAdmin
        self.submit()
        p = Payment.objects.get()
        p.status = "paid"
        request = RequestFactory().post("/")
        request.user = User.objects.create_superuser("boss2", "boss2@example.com", PASSWORD)
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        PaymentAdmin(Payment, site).save_model(request, p, form=None, change=True)
        self.assertTrue(Subscription.objects.filter(user=self.user, plan=self.plan).exists())
        p.refresh_from_db()
        self.assertTrue(p.applied)

    def test_reject_keeps_plan_locked(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        from .admin import PaymentAdmin
        self.submit()
        request = RequestFactory().post("/")
        request.user = User.objects.create_superuser("boss3", "boss3@example.com", PASSWORD)
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        PaymentAdmin(Payment, site).reject(request, Payment.objects.all())
        self.assertEqual(Payment.objects.get().status, "failed")
        self.assertFalse(Subscription.objects.exists())

    def test_my_payments_list(self):
        self.submit()
        rows = self.client.get("/api/v1/payments/mine", headers=self.auth).json()["payments"]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["status"], rows[0]["paid_to"], rows[0]["plan"]), ("pending", "JazzCash", "VIP Monthly"))

    def test_local_amount_is_saved_and_sent_on_whatsapp(self):
        r = self.submit(local_amount="≈ 2,770 PKR")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Payment.objects.get().local_amount, "≈ 2,770 PKR")
        self.assertIn("2%2C770%20PKR", r.json()["whatsapp_url"])


@override_settings(INTERNAL_API_SECRET=SECRET)
class DeviceProtectionTests(TestCase):
    """Per-type device limits (mobile app / Windows app / web terminal), idle release,
    device-bound login tokens and the phone id migration of app 2.13."""

    def setUp(self):
        cache.clear()
        self.trial = Plan.objects.create(name="VIP Trial", slug="vip-trial", duration_days=7)   # 1 / 1 / 1
        self.user = User.objects.create_user("t@example.com", "t@example.com", PASSWORD)
        self.sub = Subscription.objects.create(user=self.user, plan=self.trial)

    def login(self, device, platform="android", **extra):
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "t@example.com", "password": PASSWORD,
                                                               "device_id": device, "platform": platform,
                                                               "device_name": f"{platform} {device}", **extra}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def me(self, token, device, platform="android", **headers):
        return self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}", "X-Device-Id": device,
                                                           "X-Device-Platform": platform, **headers})

    def test_one_of_each_type_on_trial(self):
        self.assertTrue(self.login("phone-1")["access"]["is_vip"])
        self.assertTrue(self.login("pc-1", "windows")["access"]["is_vip"])
        self.assertTrue(self.login("web-1", "web")["access"]["is_vip"])
        second_phone = self.login("phone-2")
        self.assertFalse(second_phone["access"]["is_vip"])
        self.assertIn("Log out on that device first", second_phone["warning"])
        self.assertIn("android phone-1", second_phone["warning"])
        self.assertFalse(self.login("web-2", "web")["access"]["is_vip"])
        self.assertEqual(sorted(Device.objects.values_list("kind", flat=True)), ["desktop", "mobile", "web"])
        self.assertTrue(LoginEvent.objects.filter(method="device", success=False).exists())

    def test_quarterly_plan_and_customer_override(self):
        quarterly = Plan.objects.create(name="Q", slug="q", duration_days=90, max_mobile=2, max_desktop=2, max_web=2)
        Subscription.objects.create(user=self.user, plan=quarterly)
        for d in ("p1", "p2"):
            self.assertTrue(self.login(d)["access"]["is_vip"], d)
        self.assertFalse(self.login("p3")["access"]["is_vip"])
        self.sub.max_mobile = 3        # admin gives this one customer a third phone
        self.sub.save()
        self.assertTrue(self.login("p3")["access"]["is_vip"])
        access = self.login("p3")["access"]
        self.assertEqual(access["device_limits"], {"mobile": 3, "desktop": 2, "web": 2})
        self.assertEqual(access["device_limit"], 7)

    def test_unlimited(self):
        self.trial.max_web = 0
        self.trial.save()
        for d in ("w1", "w2", "w3"):
            self.assertTrue(self.login(d, "web")["access"]["is_vip"], d)

    def test_idle_device_is_replaced_and_logged_out(self):
        old = self.login("phone-1")
        Device.objects.filter(device_id="phone-1").update(last_seen=timezone.now() - timedelta(hours=3))
        new = self.login("phone-2")
        self.assertTrue(new["access"]["is_vip"], new)
        self.assertFalse(Device.objects.filter(device_id="phone-1").exists())
        self.assertEqual(self.me(old["token"], "phone-1").status_code, 401)   # old phone is logged out
        self.assertTrue(LoginEvent.objects.filter(method="device", success=True, reason__contains="replaced").exists())

    def test_idle_release_can_be_switched_off(self):
        site = SiteSettings.load()
        site.device_idle_hours = 0
        site.save()
        self.login("phone-1")
        Device.objects.update(last_seen=timezone.now() - timedelta(days=5))
        blocked = self.login("phone-2")
        self.assertFalse(blocked["access"]["is_vip"])
        self.assertNotIn("unused", blocked["warning"])

    def test_active_device_is_not_replaced(self):
        self.login("phone-1")
        Device.objects.update(last_seen=timezone.now() - timedelta(minutes=90))
        self.assertFalse(self.login("phone-2")["access"]["is_vip"])

    def test_token_only_works_on_its_own_device(self):
        token = self.login("phone-1")["token"]
        self.assertEqual(self.me(token, "phone-1").status_code, 200)
        self.assertEqual(self.me(token, "someone-else").status_code, 401)          # copied token
        self.assertEqual(self.me(token, "phone-1", platform="web").status_code, 401)  # moved to a browser
        svc = {"X-Service-Key": SECRET}
        r = self.client.post("/api/v1/internal/verify", json.dumps({"token": token, "device_id": "x", "platform": "web"}),
                             content_type="application/json", headers=svc).json()
        self.assertFalse(r["valid"])
        self.assertTrue(r["logout"])
        good = self.client.post("/api/v1/internal/verify", json.dumps({"token": token, "device_id": "phone-1",
                                                                       "platform": "android"}),
                                content_type="application/json", headers=svc).json()
        self.assertTrue(good["valid"], good)

    def test_new_login_on_same_device_closes_the_old_session(self):
        first = self.login("phone-1")["token"]
        second = self.login("phone-1")["token"]
        self.assertEqual(self.me(first, "phone-1").status_code, 401)
        self.assertEqual(self.me(second, "phone-1").status_code, 200)
        self.assertEqual(Device.objects.count(), 1)

    def test_app_update_keeps_the_phone_slot(self):
        token = self.login("app-random-old")["token"]
        r = self.me(token, "and-stable", **{"X-Device-Legacy-Id": "app-random-old"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["access"]["is_vip"])
        self.assertEqual(list(Device.objects.values_list("device_id", flat=True)), ["and-stable"])
        self.assertEqual(ApiToken.objects.get(key_hash=ApiToken.hash(token)).device_id, "and-stable")
        self.assertEqual(self.me(token, "and-stable").status_code, 200)
        # logging in again from the updated app does not take a second slot either
        self.assertTrue(self.login("and-stable", legacy_id="app-random-old")["access"]["is_vip"])
        self.assertEqual(Device.objects.count(), 1)

    def test_missing_device_id_keeps_vip_locked(self):
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "t@example.com", "password": PASSWORD}),
                             content_type="application/json").json()
        self.assertFalse(r["access"]["is_vip"])
        self.assertIn("update", r["warning"])

    def test_my_devices_list_and_logout_frees_slot(self):
        token = self.login("phone-1")["token"]
        self.login("web-1", "web")
        devices = self.me(token, "phone-1").json()["devices"]
        self.assertEqual(devices["limits"], {"mobile": 1, "desktop": 1, "web": 1})
        self.assertEqual(devices["idle_hours"], 2)
        self.assertEqual({d["type"] for d in devices["list"]}, {"mobile", "web"})
        self.assertEqual([d["this_device"] for d in devices["list"] if d["type"] == "mobile"], [True])
        self.client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
        self.assertTrue(self.login("phone-2")["access"]["is_vip"])

    def test_admin_log_out_action_frees_slot(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory

        from .admin import DeviceAdmin, UserAdmin
        token = self.login("phone-1")["token"]
        request = RequestFactory().post("/")
        request.user = User.objects.create_superuser("boss", "boss@example.com", PASSWORD)
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        DeviceAdmin(Device, site).log_out(request, Device.objects.all())
        self.assertEqual(self.me(token, "phone-1").status_code, 401)
        self.assertTrue(self.login("phone-2")["access"]["is_vip"])
        token2 = self.login("phone-2")["token"]
        UserAdmin(User, site).reset_devices(request, User.objects.filter(pk=self.user.pk))
        self.assertEqual(self.me(token2, "phone-2").status_code, 401)
        self.assertFalse(Device.objects.exists())

    def test_plans_listing_shows_limits(self):
        self.trial.is_public = True
        self.trial.save()
        plan = self.client.get("/api/v1/plans").json()["plans"][0]
        self.assertEqual(plan["device_limits"], {"mobile": 1, "desktop": 1, "web": 1})
        self.assertEqual(plan["max_devices"], 3)


@override_settings(INTERNAL_API_SECRET=SECRET, GOOGLE_CLIENT_ID="gid", GOOGLE_CLIENT_SECRET="gsec",
                   FACEBOOK_APP_ID="fid", FACEBOOK_APP_SECRET="fsec", PUBLIC_API_URL="https://api.example.test")
class SocialLoginTests(TestCase):
    """Google / Facebook sign-in (identity from the provider is simulated), login switches,
    automatic free trial rules, device locks and the per-IP account limit."""

    def setUp(self):
        cache.clear()
        self.trial = Plan.objects.create(name="VIP Trial", slug="vip-trial", duration_days=7)
        SiteSettings.load().signup_plans.set([self.trial])
        self.identity = {"uid": "g-1", "email": "ali@gmail.com", "name": "Ali Khan"}
        from unittest import mock
        patcher = mock.patch("accounts.oauth.fetch_identity", side_effect=lambda provider, code: dict(self.identity))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.n = 0

    def sign_in(self, provider="google", device="and-phone1", platform="android", ip="1.1.1.1", confirm=True, **extra):
        self.n += 1
        session = f"session-{self.n}-" + "x" * 24
        q = {"session": session, "device_id": device, "platform": platform, "device_name": f"{platform} {device}",
             **extra}
        svc = {"X-Service-Key": SECRET, "X-Client-IP": ip}
        r = self.client.get(f"/api/v1/oauth/{provider}/start", q, headers=svc)
        self.assertEqual(r.status_code, 302, r.content[:300])
        self.assertIn("accounts.google.com" if provider == "google" else "facebook.com", r["Location"])
        state = OAuthLogin.objects.get(session_hash=__import__("hashlib").sha256(session.encode()).hexdigest()).state
        page = self.client.get(f"/api/v1/oauth/{provider}/callback", {"state": state, "code": "abc"})
        self.assertEqual(page.status_code, 200)
        key = OAuthLogin.objects.get(state=state).confirm_key
        if confirm:
            self.client.post("/api/v1/oauth/finish", {"key": key})
        poll = self.client.post("/api/v1/oauth/poll", json.dumps({"session": session}),
                                content_type="application/json").json()
        return poll

    def test_google_signup_in_app_gets_trial_once(self):
        r = self.sign_in()
        self.assertEqual(r["status"], "done", r)
        self.assertTrue(r["access"]["is_vip"])
        self.assertIn("free VIP Trial has started", r["trial_message"])
        user = User.objects.get(email="ali@gmail.com")
        self.assertFalse(user.has_usable_password())
        self.assertTrue(TrialGrant.objects.filter(user=user).exists())
        self.assertEqual(DeviceClaim.objects.get(device_id="and-phone1").user, user)
        # the token works on that phone only
        me = self.client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + r["token"],
                                                         "X-Device-Id": "and-phone1", "X-Device-Platform": "android"})
        self.assertEqual(me.status_code, 200)
        # poll hands the token out only once
        again = self.client.post("/api/v1/oauth/poll", json.dumps({"session": "session-1-" + "x" * 24}),
                                 content_type="application/json").json()
        self.assertEqual(again["status"], "pending")
        # signing in again: same account, no second trial
        r2 = self.sign_in()
        self.assertEqual(r2["status"], "done")
        self.assertEqual(r2["trial_message"], "")
        self.assertEqual(Subscription.objects.filter(user=user).count(), 1)

    def test_second_account_on_same_phone_is_blocked(self):
        self.sign_in()
        self.identity = {"uid": "g-2", "email": "fake2@gmail.com", "name": "Fake"}
        r = self.sign_in()
        self.assertEqual(r["status"], "error")
        self.assertIn("already registered to al***@gmail.com", r["detail"])
        self.assertIn("whatsapp_url", r["support"])
        self.assertFalse(User.objects.filter(email="fake2@gmail.com").exists())
        self.assertEqual(DeviceClaim.objects.get(device_id="and-phone1").blocked_attempts, 1)

    def test_admin_unlock_allows_new_account_but_no_second_trial(self):
        self.sign_in()
        DeviceClaim.objects.update(user=None)            # admin: Unlock
        self.identity = {"uid": "g-2", "email": "wife@gmail.com", "name": "Wife"}
        r = self.sign_in()
        self.assertEqual(r["status"], "done", r)
        self.assertFalse(r["access"]["is_vip"])
        self.assertIn("already used on this device", r["trial_message"])

    def test_web_signup_gets_trial_at_once_but_only_once(self):
        r = self.sign_in(device="web-" + "a" * 24, platform="web")
        self.assertEqual(r["status"], "done")
        self.assertTrue(r["access"]["is_vip"], r)
        self.assertIn("has started", r["trial_message"])
        self.assertFalse(DeviceClaim.objects.exists())          # browsers are not device-locked
        # the same Google account later on a phone: no second trial, still VIP from the first
        r = self.sign_in(device="and-phone1", platform="android")
        self.assertEqual(r["trial_message"], "")
        self.assertEqual(Subscription.objects.count(), 1)

    def test_old_email_account_is_linked_and_keeps_plan(self):
        old = User.objects.create_user("ali@gmail.com", "ali@gmail.com", PASSWORD)
        monthly = Plan.objects.create(name="VIP Monthly", slug="m", duration_days=30)
        Subscription.objects.create(user=old, plan=monthly)
        r = self.sign_in(provider="facebook")
        self.assertEqual(r["status"], "done")
        self.assertEqual(r["access"]["plan"], "VIP Monthly")
        self.assertEqual(SocialAccount.objects.get().user, old)
        self.assertFalse(TrialGrant.objects.exists())     # paying customer: no trial

    def test_facebook_without_email(self):
        self.identity = {"uid": "fb-77", "email": "", "name": "No Mail"}
        r = self.sign_in(provider="facebook")
        self.assertEqual(r["status"], "done", r)
        self.assertEqual(User.objects.get(username="facebook_fb-77").first_name, "No")

    def test_signups_per_ip_limit(self):
        for i in range(3):
            self.identity = {"uid": f"g-{i}", "email": f"u{i}@gmail.com", "name": "U"}
            self.assertEqual(self.sign_in(device=f"and-p{i}")["status"], "done")
        self.identity = {"uid": "g-9", "email": "u9@gmail.com", "name": "U"}
        r = self.sign_in(device="and-p9")
        self.assertEqual(r["status"], "error")
        self.assertIn("Too many new accounts", r["detail"])
        self.assertEqual(self.sign_in(device="and-p9", ip="2.2.2.2")["status"], "done")   # other network is fine

    def test_not_confirmed_gives_no_token(self):
        r = self.sign_in(confirm=False)
        self.assertEqual(r["status"], "pending")
        self.assertFalse(User.objects.exists())

    def test_login_switches(self):
        site = SiteSettings.load()
        site.allow_email_login = False
        site.allow_signup = False
        site.allow_facebook_login = False
        site.save()
        User.objects.create_user("old@x.com", "old@x.com", PASSWORD)
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "old@x.com", "password": PASSWORD}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "email_login_disabled")
        self.assertIn("Google or Facebook", r.json()["detail"])
        r = self.client.post("/api/v1/auth/register", json.dumps({"email": "n@x.com", "password": PASSWORD}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.client.get("/api/v1/oauth/facebook/start", {"session": "s" * 30}).status_code, 404)
        login = self.client.get("/api/v1/app-config").json()["login"]
        self.assertEqual(login, {"email_signup": False, "email_login": False, "google": True, "facebook": False, "guest": True})

    def test_bad_links(self):
        self.assertEqual(self.client.get("/api/v1/oauth/google/start", {"session": "short"}).status_code, 400)
        self.assertEqual(self.client.get("/api/v1/oauth/google/callback", {"state": "nope", "code": "x"}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/oauth/finish", {"key": "nope"}).status_code, 400)


class CryptoPaymentTests(TestCase):
    """Crypto checkout rules; the blockchain answers are simulated."""

    ADDR = "0x1111111111111111111111111111111111111111"

    def setUp(self):
        from unittest import mock
        from .models import CryptoWallet
        cache.clear()
        self.plan = Plan.objects.create(name="VIP Monthly", slug="vip-monthly", price=30, duration_days=30)
        CryptoWallet.objects.create(network="bep20_usdt", address=self.ADDR)
        self.user = User.objects.create_user("c@example.com", "c@example.com", PASSWORD)
        self.auth = self.login("c@example.com", "and-x")
        self.transfers = []          # what the chain "shows" for our address
        self.receipts = {}           # txid -> verify_tx answer
        p1 = mock.patch("accounts.crypto_chain.incoming_transfers", side_effect=lambda n, a, since: list(self.transfers))
        p2 = mock.patch("accounts.crypto_chain.verify_tx", side_effect=lambda n, t, a: self.receipts.get(t))
        p3 = mock.patch("accounts.crypto.SCAN_IN_BACKGROUND", False)     # status checks read inline here
        p1.start(); p2.start(); p3.start()
        self.addCleanup(p1.stop); self.addCleanup(p2.stop); self.addCleanup(p3.stop)

    def login(self, email, device):
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": email, "password": PASSWORD,
                                                               "device_id": device, "platform": "android"}),
                             content_type="application/json")
        return {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": device, "X-Device-Platform": "android"}

    def create(self, network="bep20_usdt", plan="vip-monthly", auth=None):
        return self.client.post("/api/v1/payments/crypto/order", json.dumps({"plan": plan, "network": network}),
                                content_type="application/json", headers=auth or self.auth)

    def order(self, **kw):
        r = self.create(**kw)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["order"]

    def status(self, oid, auth=None):
        from .models import CryptoScanState
        CryptoScanState.objects.update(scanned_at=None)                  # skip the 15 s throttle
        return self.client.get(f"/api/v1/payments/crypto/order/{oid}", headers=auth or self.auth).json()["order"]

    def pay(self, amount, txid="0x" + "a" * 64, conf=20):
        from decimal import Decimal
        self.transfers.append({"txid": txid, "value": int(Decimal(str(amount)) * 10 ** 18), "from": "0xfeed",
                               "confirmations": conf})

    def cancel(self, oid, auth=None):
        return self.client.post(f"/api/v1/payments/crypto/order/{oid}/cancel", "{}", content_type="application/json",
                                headers=auth or self.auth)

    def test_networks_listing_and_order(self):
        nets = self.client.get("/api/v1/payments/crypto/networks").json()["networks"]
        self.assertEqual([n["network"] for n in nets], ["bep20_usdt"])
        o = self.order()
        self.assertEqual(o["address"], self.ADDR)
        self.assertTrue(30 < float(o["amount"]) < 31)
        self.assertIn("ONLY USDT", o["warning"])
        self.assertIn("Receive amount", o["exchange_tip"])
        self.assertTrue(o["can_cancel"])
        r = self.create()                                        # same plan + network again: the same order
        self.assertEqual((r.json()["order"]["id"], r.json()["resumed"]), (o["id"], True))
        other = User.objects.create_user("d@example.com", "d@example.com", PASSWORD)
        o2 = self.order(auth=self.login(other.email, "and-z"))
        self.assertNotEqual(o["amount"], o2["amount"])           # every open order has its own amount

    def test_exact_payment_activates_plan(self):
        o = self.order()
        self.assertEqual(self.status(o["id"])["status"], "waiting")
        self.pay(o["amount"])
        s = self.status(o["id"])
        self.assertEqual(s["status"], "paid", s)
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual(sub.plan, self.plan)
        p = Payment.objects.get()
        self.assertEqual((p.status, p.method, p.applied), ("paid", "crypto", True))

    def test_exchange_fee_within_allowed_difference_is_accepted(self):
        from decimal import Decimal
        from .models import CryptoTransfer
        o = self.order()
        self.pay(Decimal(o["amount"]) - 3)                       # 3 USDT short (exchange fee): still OK
        s = self.status(o["id"])
        self.assertEqual(s["status"], "paid", s)
        self.assertIn("within the allowed difference", s["note"])
        self.assertEqual(CryptoTransfer.objects.get().status, "matched")

    def test_percentage_difference_for_big_plans(self):
        from decimal import Decimal
        Plan.objects.create(name="VIP Year", slug="vip-year", price=249, duration_days=365)
        o = self.order(plan="vip-year")
        self.pay(Decimal(o["amount"]) - Decimal("4.9"))           # 2% of 249 = 4.98
        self.assertEqual(self.status(o["id"])["status"], "paid")

    def test_bigger_difference_keeps_the_order_open_and_names_it(self):
        from decimal import Decimal
        from .models import CryptoTransfer
        o = self.order()
        self.pay(Decimal(o["amount"]) - Decimal("3.5"))
        self.assertEqual(self.status(o["id"])["status"], "waiting")          # not closed on a guess
        t = CryptoTransfer.objects.get()
        self.assertEqual(t.status, "unmatched")
        self.assertIn(f"#{o['id']}", t.note)                                 # the admin sees the likely order
        self.assertFalse(Subscription.objects.exists())
        # the customer pastes their transaction id: their order goes to review
        self.receipts["0x" + "a" * 64] = {"value": int(t.value), "confirmations": 30}
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": "0x" + "a" * 64}),
                             content_type="application/json", headers=self.auth)
        self.assertIn("different from the order", r.json()["detail"])
        self.assertEqual(r.json()["order"]["status"], "review")
        self.assertEqual(CryptoTransfer.objects.get().status, "matched")
        self.assertFalse(Subscription.objects.exists())

    def test_allowed_difference_is_set_in_admin(self):
        from decimal import Decimal
        st = SiteSettings.load()
        st.crypto_diff_usd, st.crypto_diff_percent = Decimal("0"), Decimal("0")
        st.save()
        o = self.order()
        self.pay(Decimal(o["amount"]) - Decimal("0.5"))
        self.assertEqual(self.status(o["id"])["status"], "waiting")          # no difference allowed now

    def test_small_overpayment_is_accepted_big_one_is_listed(self):
        from decimal import Decimal
        from .models import CryptoTransfer
        o = self.order()
        self.pay(Decimal(o["amount"]) + 2)
        s = self.status(o["id"])
        self.assertEqual(s["status"], "paid")
        self.assertIn("within the allowed difference", s["note"])
        o2 = self.order()                                        # a new order after the first was paid
        self.pay(Decimal(o2["amount"]) + 10, txid="0x" + "e" * 64)
        self.assertEqual(self.status(o2["id"])["status"], "waiting")         # e.g. the owner's own deposit
        self.assertEqual(CryptoTransfer.objects.get(txid="0x" + "e" * 64).status, "unmatched")

    def test_unrelated_transfer_is_kept_but_not_matched(self):
        from .models import CryptoTransfer
        o = self.order()
        self.pay("5")
        self.assertEqual(self.status(o["id"])["status"], "waiting")
        t = CryptoTransfer.objects.get()
        self.assertEqual(t.status, "unmatched")
        self.assertFalse(Subscription.objects.exists())

    def test_admin_can_pay_an_unmatched_transfer_to_an_order(self):
        from . import crypto
        from .models import CryptoTransfer
        o = self.order()
        self.pay("5")
        self.status(o["id"])
        t = CryptoTransfer.objects.get()
        self.assertEqual(crypto.pay_linked_order(t, by="boss")[1], "Pick the customer's order on the transfer first.")
        t.order_id = o["id"]
        t.save()
        t = CryptoTransfer.objects.select_related("order").get()
        order, problem = crypto.pay_linked_order(t, by="boss")
        self.assertEqual((problem, order.status), ("", "paid"))
        self.assertTrue(Subscription.objects.filter(user=self.user).exists())

    def test_payment_that_fits_two_customers_closes_no_order(self):
        from decimal import Decimal
        from .models import CryptoOrder, CryptoTransfer
        o1 = self.order()
        other = User.objects.create_user("d@example.com", "d@example.com", PASSWORD)
        o2 = self.order(auth=self.login(other.email, "and-z"))
        self.pay(Decimal("28.5"))                                # within 3 USDT of both orders
        self.status(o1["id"])
        orders = CryptoOrder.objects.filter(pk__in=[o1["id"], o2["id"]])
        self.assertEqual(sorted(o.status for o in orders), ["waiting", "waiting"])
        note = CryptoTransfer.objects.get().note
        self.assertIn(f"#{o1['id']}", note)
        self.assertIn(f"#{o2['id']}", note)
        self.assertFalse(Subscription.objects.exists())

    def test_waits_for_confirmations(self):
        o = self.order()
        self.pay(o["amount"], conf=3)
        self.assertEqual(self.status(o["id"])["status"], "confirming")
        self.receipts["0x" + "a" * 64] = {"value": int(__import__("decimal").Decimal(o["amount"]) * 10 ** 18),
                                          "confirmations": 20}
        self.assertEqual(self.status(o["id"])["status"], "paid")

    def test_one_transaction_pays_one_order_only(self):
        o1 = self.order()
        self.pay(o1["amount"])
        self.assertEqual(self.status(o1["id"])["status"], "paid")
        r = self.client.post(f"/api/v1/payments/crypto/order/{self.order()['id']}/txid",
                             json.dumps({"txid": "0x" + "a" * 64}), content_type="application/json", headers=self.auth)
        self.assertEqual(r.status_code, 400)
        self.assertIn("already used", r.json()["detail"])
        self.assertEqual(Payment.objects.count(), 1)

    def test_late_payment_goes_to_review_and_admin_can_approve(self):
        from .models import CryptoOrder
        from . import crypto
        o = self.order()
        CryptoOrder.objects.filter(pk=o["id"]).update(expires_at=timezone.now() - timedelta(minutes=1))
        crypto.expire_old_orders()                               # the watcher closes it first
        self.assertEqual(CryptoOrder.objects.get(pk=o["id"]).status, "expired")
        self.pay(o["amount"])
        crypto.scan_network("bep20_usdt", force=True)            # the watcher keeps reading for 24 h
        order = CryptoOrder.objects.get(pk=o["id"])
        self.assertEqual(order.status, "review")
        self.assertIn("after the order expired", order.note)
        self.assertFalse(Subscription.objects.exists())
        crypto.approve(order, by="boss")
        self.assertEqual(CryptoOrder.objects.get(pk=o["id"]).status, "paid")
        self.assertTrue(Subscription.objects.filter(user=self.user).exists())

    def test_one_open_payment_at_a_time_and_cancel(self):
        from .models import CryptoOrder, CryptoWallet
        CryptoWallet.objects.create(network="base_usdc", address="0x2222222222222222222222222222222222222222")
        o = self.order()
        r = self.create(network="base_usdc")                     # another network while one is open
        self.assertEqual(r.status_code, 409)
        self.assertEqual((r.json()["code"], r.json()["order"]["id"]), ("open_order", o["id"]))
        self.assertIn("cancel it first", r.json()["detail"])
        open_now = self.client.get("/api/v1/payments/crypto/open", headers=self.auth).json()["order"]
        self.assertEqual(open_now["id"], o["id"])
        r = self.cancel(o["id"])
        self.assertEqual(r.json()["order"]["status"], "cancelled")
        self.assertIsNone(self.client.get("/api/v1/payments/crypto/open", headers=self.auth).json()["order"])
        o2 = self.order(network="base_usdc")
        self.assertEqual(o2["network"], "base_usdc")
        self.assertEqual(CryptoOrder.objects.filter(status__in=("waiting", "confirming")).count(), 1)

    def test_cancel_is_refused_once_the_money_is_seen(self):
        o = self.order()
        self.pay(o["amount"], conf=3)                            # on its way
        r = self.cancel(o["id"])
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["order"]["status"], "confirming")

    def test_payment_after_cancel_goes_to_review(self):
        from .models import CryptoOrder
        from . import crypto
        o = self.order()
        self.assertEqual(self.cancel(o["id"]).status_code, 200)
        self.pay(o["amount"])
        crypto.scan_network("bep20_usdt", force=True)
        order = CryptoOrder.objects.get(pk=o["id"])
        self.assertEqual(order.status, "review")
        self.assertIn("cancelled", order.note)

    def test_only_one_process_reads_a_network_at_a_time(self):
        from .models import CryptoScanState
        from . import crypto
        self.order()
        CryptoScanState.objects.update_or_create(network="bep20_usdt",
                                                 defaults={"lease_until": timezone.now() + timedelta(seconds=60)})
        self.assertFalse(crypto.scan_network("bep20_usdt", force=True))
        CryptoScanState.objects.update(lease_until=None)
        self.assertTrue(crypto.scan_network("bep20_usdt", force=True))

    def test_status_check_never_waits_for_the_chain(self):
        from unittest import mock
        from .models import CryptoScanState
        o = self.order()
        with mock.patch("accounts.crypto.SCAN_IN_BACKGROUND", True), \
                mock.patch("accounts.crypto.threading.Thread") as thread:
            self.assertEqual(self.status(o["id"])["status"], "waiting")      # no watcher read yet
            thread.return_value.start.assert_called_once()
            CryptoScanState.objects.update_or_create(network="bep20_usdt", defaults={"scanned_at": timezone.now()})
            self.client.get(f"/api/v1/payments/crypto/order/{o['id']}", headers=self.auth)
            self.assertEqual(thread.return_value.start.call_count, 1)        # the watcher is fresh: no read

    def test_watcher_command_runs_once(self):
        from io import StringIO
        from django.core.management import call_command
        o = self.order()
        self.pay(o["amount"])
        out = StringIO()
        call_command("crypto_watch", "--once", stdout=out)
        self.assertIn("waiting -> paid", out.getvalue())

    def test_txid_rules(self):
        o = self.order()
        bad = "0x" + "b" * 64
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": bad}),
                             content_type="application/json", headers=self.auth)
        self.assertIn("not on the blockchain", r.json()["detail"])          # unknown tx
        self.receipts[bad] = {"value": 0, "confirmations": 0, "failed": True}
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": bad}),
                             content_type="application/json", headers=self.auth)
        self.assertIn("did not send the official", r.json()["detail"])      # failed / fake token
        good = "0x" + "c" * 64
        self.receipts[good] = {"value": int(__import__("decimal").Decimal("29.5") * 10 ** 18), "confirmations": 30}
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": good}),
                             content_type="application/json", headers=self.auth)
        self.assertIn("different from the order", r.json()["detail"])       # pasted, not exact -> review
        self.assertFalse(Subscription.objects.exists())
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": "nonsense"}),
                             content_type="application/json", headers=self.auth)
        self.assertEqual(r.status_code, 400)

    def test_pasted_exact_txid_activates(self):
        from decimal import Decimal
        o = self.order()
        tx = "0x" + "d" * 64
        self.receipts[tx] = {"value": int(Decimal(o["amount"]) * 10 ** 18), "confirmations": 30}
        r = self.client.post(f"/api/v1/payments/crypto/order/{o['id']}/txid", json.dumps({"txid": tx}),
                             content_type="application/json", headers=self.auth)
        self.assertEqual(r.json()["order"]["status"], "paid", r.content)

    def test_login_required_and_orders_are_private(self):
        o = self.order()
        self.assertEqual(self.client.post("/api/v1/payments/crypto/order", "{}", content_type="application/json").status_code, 401)
        other = User.objects.create_user("o@example.com", "o@example.com", PASSWORD)
        auth = self.login(other.email, "and-y")
        self.assertEqual(self.client.get(f"/api/v1/payments/crypto/order/{o['id']}", headers=auth).status_code, 404)
        self.assertEqual(self.cancel(o["id"], auth=auth).status_code, 404)             # someone else's order

    def test_admin_address_validation_and_audit(self):
        from django.contrib.admin.sites import site
        from django.test import RequestFactory
        from .admin import CryptoWalletAdmin, CryptoWalletForm
        from .models import CryptoWallet, CryptoWalletChange
        form = CryptoWalletForm(data={"network": "trc20_usdt", "address": "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSX",
                                      "is_active": True})
        self.assertFalse(form.is_valid())                                   # checksum wrong
        form = CryptoWalletForm(data={"network": "trc20_usdt", "address": "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi",
                                      "is_active": True})
        self.assertTrue(form.is_valid(), form.errors)
        request = RequestFactory().post("/")
        request.user = User.objects.create_superuser("boss", "boss@example.com", PASSWORD)
        request._messages = type("M", (), {"add": lambda *a, **k: None})()
        CryptoWalletAdmin(CryptoWallet, site).save_model(request, form.save(commit=False), form, change=False)
        self.assertEqual(CryptoWalletChange.objects.get().new_address, "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi")

    def test_fake_token_is_ignored_by_the_tron_reader(self):
        from unittest import mock
        from . import crypto_chain
        fake = {"data": [{"transaction_id": "f" * 64, "token_info": {"address": "TFakeUSDTcontract000000000000000000"},
                          "to": "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi", "type": "Transfer", "value": "30000000",
                          "block_timestamp": 0},
                         {"transaction_id": "e" * 64, "token_info": {"address": crypto_chain.NETWORKS["trc20_usdt"]["contract"]},
                          "to": "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi", "type": "Transfer", "value": "30000000",
                          "block_timestamp": 0}]}
        with mock.patch.object(crypto_chain, "_http_json", return_value=fake):
            got = crypto_chain._tron_transfers("trc20_usdt", "TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi", 0)
        self.assertEqual([t["txid"] for t in got], ["e" * 64])


class AdTests(TestCase):
    """Ad manager: who sees ads, where, when, and the counters the advertiser gets."""

    def setUp(self):
        import tempfile
        from .models import Ad
        cache.clear()
        self.media = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, self.media, True)
        self.override = override_settings(MEDIA_ROOT=self.media, PUBLIC_API_URL="https://api.test")
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.ad = Ad.objects.create(name="Axi offer", headline="Trade with Axi", link="https://www.axi.com/offer",
                                    show_app_banner=True, show_web_banner=False, show_app_popup=True)

    def ads(self, placement, auth=None):
        return self.client.get(f"/api/v1/ads?placement={placement}", headers=auth or {}).json()["ads"]

    def login_with(self, plan):
        user = User.objects.create_user("u@example.com", "u@example.com", PASSWORD)
        if plan:
            Subscription.objects.create(user=user, plan=plan)
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "u@example.com", "password": PASSWORD,
                                                               "device_id": "and-ad", "platform": "android"}),
                             content_type="application/json")
        return {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": "and-ad", "X-Device-Platform": "android"}

    def test_guest_sees_running_ad_in_its_places_only(self):
        from .models import Ad
        got = self.ads("app_banner")
        self.assertEqual([a["headline"] for a in got], ["Trade with Axi"])
        self.assertEqual(got[0]["click_url"], f"https://api.test/api/v1/ads/{self.ad.pk}/click")
        self.assertEqual(got[0]["image"], "")
        self.assertEqual(self.ads("web_banner"), [])                  # not ticked for the web
        self.assertEqual(len(self.ads("app_popup")), 1)
        self.assertEqual(self.ads("somewhere"), [])
        self.assertEqual(Ad.objects.get().impressions, 2)

    def test_schedule_and_switches(self):
        from .models import Ad
        Ad.objects.update(ends_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.ads("app_banner"), [])                  # ended
        Ad.objects.update(ends_at=None, starts_at=timezone.now() + timedelta(days=1))
        self.assertEqual(self.ads("app_banner"), [])                  # not started
        Ad.objects.update(starts_at=timezone.now(), is_active=False)
        self.assertEqual(self.ads("app_banner"), [])                  # switched off
        Ad.objects.update(is_active=True)
        s = SiteSettings.load()
        s.ads_enabled = False
        s.save()
        self.assertEqual(self.ads("app_banner"), [])                  # all ads off
        s.ads_enabled, s.ads_for_free = True, False
        s.save()
        self.assertEqual(self.ads("app_banner"), [])                  # guests excluded

    def test_vip_never_sees_ads_trial_does(self):
        vip = Plan.objects.create(name="VIP", slug="vip", price=30, duration_days=30)
        self.assertEqual(self.ads("app_banner", self.login_with(vip)), [])
        Subscription.objects.all().delete()
        trial = Plan.objects.create(name="Trial", slug="trial", price=0, duration_days=7, show_ads=True)
        Subscription.objects.create(user=User.objects.get(email="u@example.com"), plan=trial)
        cache.clear()
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "u@example.com", "password": PASSWORD,
                                                               "device_id": "and-ad", "platform": "android"}),
                             content_type="application/json")
        auth = {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": "and-ad", "X-Device-Platform": "android"}
        self.assertEqual(len(self.ads("app_banner", auth)), 1)
        Subscription.objects.create(user=User.objects.get(email="u@example.com"), plan=vip)   # trial + VIP
        self.assertEqual(self.ads("app_banner", auth), [])

    def test_click_is_counted_and_redirects(self):
        from .models import Ad
        r = self.client.get(f"/api/v1/ads/{self.ad.pk}/click")
        self.assertEqual((r.status_code, r["Location"]), (302, "https://www.axi.com/offer"))
        self.assertEqual(Ad.objects.get().clicks, 1)
        self.assertEqual(self.client.get("/api/v1/ads/999/click").status_code, 404)

    def test_image_upload_rules_and_serving(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .admin import AdForm
        base = {"name": "x", "headline": "h", "link": "https://a.com", "button_text": "Go",
                "starts_at": timezone.now(), "priority": 0, "is_active": True, "show_app_banner": True}
        big = SimpleUploadedFile("big.png", b"0" * (2 * 1024 * 1024 + 1), content_type="image/png")
        self.assertIn("2 MB", str(AdForm(data=base, files={"image": big}).errors))
        exe = SimpleUploadedFile("virus.exe", b"MZ", content_type="application/octet-stream")
        self.assertIn("PNG", str(AdForm(data=base, files={"image": exe}).errors))
        nowhere = dict(base, show_app_banner=False)
        self.assertIn("at least one place", str(AdForm(data=nowhere).errors))
        png = SimpleUploadedFile("banner.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png")
        form = AdForm(data=base, files={"image": png})
        self.assertTrue(form.is_valid(), form.errors)
        ad = form.save()
        r = self.client.get(f"/api/v1/ads/{ad.pk}/image")
        self.assertEqual((r.status_code, r["Content-Type"]), (200, "image/png"))
        self.assertEqual(b"".join(r.streaming_content), b"\x89PNG\r\n\x1a\nfake")
        self.assertTrue(self.ads("app_banner")[0]["image"].endswith(f"/api/v1/ads/{ad.pk}/image"))


class CommunityTests(TestCase):
    """Community chat: accounts only, nickname + rules, filters, limits, reports, moderation."""

    def setUp(self):
        cache.clear()
        s = SiteSettings.load()
        s.community_wait_minutes = 0
        s.save()
        self.a = self.make("a@example.com", "and-a")
        self.b = self.make("b@example.com", "and-b")

    def make(self, email, device):
        User.objects.create_user(email, email, PASSWORD)
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": email, "password": PASSWORD,
                                                               "device_id": device, "platform": "android"}),
                             content_type="application/json")
        return {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": device, "X-Device-Platform": "android"}

    def join(self, auth, nick, accept=True):
        return self.client.post("/api/v1/community/join", json.dumps({"nickname": nick, "accept_rules": accept}),
                                content_type="application/json", headers=auth)

    def say(self, auth, text, room="general"):
        from .models import ChatMessage
        ChatMessage.objects.update(created_at=timezone.now() - timedelta(seconds=10))   # skip the 5 s limit
        return self.client.post("/api/v1/community/messages", json.dumps({"room": room, "text": text}),
                                content_type="application/json", headers=auth)

    def test_accounts_only(self):
        self.assertEqual(self.client.get("/api/v1/community/status").status_code, 401)
        self.assertEqual(self.client.get("/api/v1/community/messages?room=general").status_code, 401)

    def test_join_needs_rules_and_a_clean_unique_nickname(self):
        st = self.client.get("/api/v1/community/status", headers=self.a).json()
        self.assertIn("Be respectful", st["rules"])
        self.assertEqual((st["nickname"], st["rules_accepted"]), ("", False))
        self.assertEqual(self.join(self.a, "GoldHunter", accept=False).json()["code"], "rules_needed")
        for bad in ("ab", "has space", "Admin_1", "ICCsupport", "harami_1"):
            self.assertEqual(self.join(self.a, bad).status_code, 400, bad)
        self.assertEqual(self.join(self.a, "GoldHunter").status_code, 200)
        self.assertIn("taken", self.join(self.b, "goldhunter").json()["detail"])
        self.assertEqual(self.say(self.b, "hello").json()["code"], "join_needed")

    def test_messages_show_nickname_never_email(self):
        self.join(self.a, "GoldHunter")
        self.join(self.b, "FxNinja")
        self.assertEqual(self.say(self.a, "Gold looks strong after COT").status_code, 200)
        rows = self.client.get("/api/v1/community/messages?room=general", headers=self.b).json()["messages"]
        self.assertEqual((rows[0]["nick"], rows[0]["mine"]), ("GoldHunter", False))
        self.assertNotIn("a@example.com", json.dumps(rows))
        self.say(self.b, "agreed")
        newer = self.client.get(f"/api/v1/community/messages?room=general&after_id={rows[0]['id']}", headers=self.a).json()
        self.assertEqual([m["text"] for m in newer["messages"]], ["agreed"])
        self.assertEqual(self.client.get("/api/v1/community/messages?room=gold", headers=self.a).json()["messages"], [])

    def test_abuse_and_contact_filters_strike_then_mute(self):
        from .models import ChatMessage, ChatProfile
        self.join(self.a, "GoldHunter")
        self.assertIn("respectful", self.say(self.a, "you are a harami").json()["detail"])
        self.assertIn("Links", self.say(self.a, "join www.signals.com").json()["detail"])
        r = self.say(self.a, "call 0300 1234567")
        self.assertEqual((r.status_code, r.json()["code"]), (403, "muted"))
        self.assertEqual(self.say(self.a, "normal message").json()["code"], "muted")
        self.assertEqual(ChatMessage.objects.count(), 0)                     # nothing bad got through
        ChatProfile.objects.update(muted_until=None)
        s = SiteSettings.load()
        s.community_blocked_words = "scammer"
        s.save()
        self.assertEqual(self.say(self.a, "what a scammer").status_code, 400)  # admin's extra word

    def test_rate_limits_and_new_account_wait(self):
        from .models import ChatMessage
        self.join(self.a, "GoldHunter")
        self.assertEqual(self.say(self.a, "first").status_code, 200)
        r = self.client.post("/api/v1/community/messages", json.dumps({"room": "general", "text": "second"}),
                             content_type="application/json", headers=self.a)
        self.assertEqual(r.status_code, 429)                                  # 5 s between messages
        self.assertEqual(self.say(self.a, "first").json()["code"], "duplicate")
        s = SiteSettings.load()
        s.community_wait_minutes = 60
        s.save()
        self.join(self.b, "FxNinja")
        self.assertEqual(self.say(self.b, "hi all").json()["code"], "wait")   # new account: read only first
        self.assertEqual(self.client.get("/api/v1/community/messages", headers=self.b).status_code, 200)
        self.assertEqual(ChatMessage.objects.count(), 1)

    def test_three_reports_hide_a_message_and_ban_blocks(self):
        from .models import ChatProfile
        self.join(self.a, "GoldHunter")
        mid = self.say(self.a, "buy everything now").json()["message"]["id"]
        self.assertEqual(self.client.post(f"/api/v1/community/messages/{mid}/report", "{}", content_type="application/json",
                                          headers=self.a).status_code, 400)  # not your own
        reporters = [self.b, self.make("c@example.com", "and-c"), self.make("d@example.com", "and-d")]
        for i, auth in enumerate(reporters):
            r = self.client.post(f"/api/v1/community/messages/{mid}/report", json.dumps({"reason": "spam"}),
                                 content_type="application/json", headers=auth).json()
            self.assertEqual(r["hidden"], i == 2)
        self.assertEqual(self.client.get("/api/v1/community/messages", headers=self.b).json()["messages"], [])
        ChatProfile.objects.filter(nickname="GoldHunter").update(banned=True)
        self.assertEqual(self.say(self.a, "hello again").json()["code"], "banned")
        self.assertEqual(self.client.get("/api/v1/community/messages", headers=self.a).status_code, 403)

    def test_switch_off(self):
        s = SiteSettings.load()
        s.community_enabled = False
        s.save()
        self.assertFalse(self.client.get("/api/v1/app-config").json()["community"]["enabled"])
        self.assertEqual(self.join(self.a, "GoldHunter").status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=True, SECURE_REDIRECT_EXEMPT=[r"^api/"])
class HttpsBehindTunnelTests(TestCase):
    """VPS (DJANGO_HTTPS=true): browsers are sent to https, the ICT API's internal http calls are not."""

    def test_admin_pages_redirect_to_https(self):
        r = self.client.get("/admin/login/")
        self.assertEqual(r.status_code, 301)
        self.assertTrue(r["Location"].startswith("https://"))

    def test_internal_api_calls_are_not_redirected(self):
        r = self.client.get("/api/v1/plans")
        self.assertNotEqual(r.status_code, 301)


@override_settings(INTERNAL_API_SECRET=SECRET)
class GuestLoginTests(TestCase):
    """"Continue as guest" in the web terminal: features from Settings > Guest features."""

    def setUp(self):
        cache.clear()

    def post(self, url, data=None, **headers):
        return self.client.post(f"/api/v1/{url}", json.dumps(data or {}), content_type="application/json",
                                headers=headers)

    def guest(self, device="browser-1"):
        return self.post("auth/guest", {"device_id": device, "platform": "web"})

    def test_migration_gives_guests_every_terminal_feature(self):
        site = SiteSettings.load()
        self.assertTrue(site.guest_login_enabled)
        self.assertEqual(site.guest_plan.slug, "guest")
        self.assertFalse(site.guest_plan.is_public)
        r = self.guest()
        self.assertEqual(r.status_code, 200, r.content)
        a = r.json()["access"]
        self.assertTrue(a["guest"])
        self.assertEqual(a["status"], "active")
        self.assertEqual(a["plan"], "Guest")
        f = a["features"]
        self.assertTrue(f["signals"] and f["ict_indicators"] and f["backtest"])
        self.assertEqual(f["models"], "all")
        self.assertEqual(f["max_charts"], 4)
        self.assertEqual(f["signal_delay_minutes"], 0)
        self.assertTrue(r.json()["token"])

    def test_same_browser_keeps_its_guest_account_and_browsers_are_separate(self):
        a1 = self.guest("browser-1").json()["access"]["user"]
        a2 = self.guest("browser-1").json()["access"]["user"]
        b = self.guest("browser-2").json()["access"]["user"]
        self.assertEqual(a1, a2)
        self.assertNotEqual(a1, b)
        self.assertTrue(a1.startswith("guest-"))
        self.assertEqual(User.objects.filter(username__startswith="guest-").count(), 2)
        self.assertTrue(LoginEvent.objects.filter(method="guest", success=True).exists())

    def test_admin_switches_guest_features_on_the_plan(self):
        plan = SiteSettings.load().guest_plan
        plan.max_charts, plan.allowed_models, plan.signal_delay_minutes, plan.can_use_backtest = 1, "M1,M17", 30, False
        plan.save()
        f = self.guest().json()["access"]["features"]
        self.assertEqual((f["max_charts"], f["models"], f["signal_delay_minutes"], f["backtest"]), (1, ["M1", "M17"], 30, False))

    def test_token_is_verified_for_the_api(self):
        token = self.guest().json()["token"]
        r = self.post("internal/verify", {"token": token, "device_id": "browser-1", "platform": "web"},
                      **{"X-Service-Key": SECRET})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["access"]["status"], "active")
        self.assertTrue(r.json()["access"]["features"]["signals"])

    def test_guest_login_off(self):
        site = SiteSettings.load()
        site.guest_login_enabled = False
        site.save()
        r = self.guest()
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "guest_disabled")
        self.assertFalse(self.client.get("/api/v1/app-config").json()["login"]["guest"])

    def test_existing_guest_is_locked_when_switched_off(self):
        token = self.guest().json()["token"]
        site = SiteSettings.load()
        site.guest_login_enabled = False
        site.save()
        r = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}", "X-Device-Id": "browser-1"})
        a = r.json()["access"]
        self.assertEqual(a["status"], "guest_disabled")
        self.assertFalse(a["features"]["signals"])

    def test_needs_a_device_id(self):
        self.assertEqual(self.post("auth/guest", {}).status_code, 400)


class SeedPlansTests(TestCase):
    def test_seed_plans_keeps_a_plan_renamed_in_the_admin(self):
        from django.core.management import call_command
        call_command("seed_plans", stdout=open(__import__("os").devnull, "w"))
        Plan.objects.filter(slug="pro-monthly").update(slug="pro")       # slug changed by the admin
        call_command("seed_plans", stdout=open(__import__("os").devnull, "w"))
        self.assertEqual(Plan.objects.filter(name="Pro Monthly").count(), 1)
        self.assertFalse(Plan.objects.filter(slug="pro-monthly").exists())


class IdeaTests(CommunityTests):
    """Community ideas: open to read, accounts with a nickname post, like and comment; same filters."""
    PIC = "data:image/jpeg;base64," + "A" * 200

    def share(self, auth, **extra):
        data = {"title": "Gold long from the NY AM FVG", "body": "Bias bullish, draw on PDH.", "symbol": "AXI:XAUUSD",
                "timeframe": "5m", "direction": "long", "image": self.PIC, "chart": {"ticker": "AXI:XAUUSD", "tf": "5m"}}
        data.update(extra)
        return self.client.post("/api/v1/community/ideas", json.dumps(data), content_type="application/json", headers=auth)

    def test_share_list_read_like_comment(self):
        self.assertEqual(self.share(self.a).json()["code"], "join_needed")          # nickname first
        self.join(self.a, "GoldHunter")
        r = self.share(self.a)
        self.assertEqual(r.status_code, 200, r.content)
        idea = r.json()["idea"]
        self.assertEqual((idea["symbol"], idea["nick"], idea["direction"]), ("XAUUSD", "GoldHunter", "long"))
        # anyone can read, without logging in
        lst = self.client.get("/api/v1/community/ideas").json()
        self.assertEqual([i["title"] for i in lst["ideas"]], ["Gold long from the NY AM FVG"])
        self.assertNotIn("image", lst["ideas"][0])                                   # the list stays light
        one = self.client.get(f"/api/v1/community/ideas/{idea['id']}").json()["idea"]
        self.assertEqual((one["image"], one["chart"]["tf"], one["views"]), (self.PIC, "5m", 1))
        self.assertEqual(self.client.get("/api/v1/community/ideas?symbol=NAS100").json()["ideas"], [])
        # likes toggle, comments count
        self.join(self.b, "NasTrader")
        like = lambda: self.client.post(f"/api/v1/community/ideas/{idea['id']}/like", headers=self.b).json()
        self.assertEqual(like(), {"success": True, "liked": True, "likes": 1})
        self.assertEqual(like()["likes"], 0)
        c = self.client.post(f"/api/v1/community/ideas/{idea['id']}/comment", json.dumps({"text": "Nice read"}),
                             content_type="application/json", headers=self.b).json()
        self.assertEqual(c["comment"]["nick"], "NasTrader")
        one = self.client.get(f"/api/v1/community/ideas/{idea['id']}", headers=self.a).json()["idea"]
        self.assertEqual((one["comments"], [x["text"] for x in one["comment_list"]], one["mine"]), (1, ["Nice read"], True))

    def test_filters_and_delete(self):
        self.join(self.a, "GoldHunter")
        self.join(self.b, "NasTrader")
        self.assertEqual(self.share(self.a, title="join my telegram t.me/x").json()["code"], "rules")
        self.assertEqual(self.share(self.a, image="javascript:alert(1)").json()["code"], "image")
        self.assertEqual(self.share(self.a, image="").json()["code"], "image")
        idea = self.share(self.a).json()["idea"]
        self.assertEqual(self.client.post(f"/api/v1/community/ideas/{idea['id']}/delete", headers=self.b).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/community/ideas/{idea['id']}/delete", headers=self.a).json()["deleted"], True)
        self.assertEqual(self.client.get("/api/v1/community/ideas").json()["ideas"], [])


class SignalAlertTests(TestCase):
    """WhatsApp auto notify: settings, matching, plan delay / models, one message per signal."""

    def setUp(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        from .models import AlertPrefs, Plan, Subscription
        s = SiteSettings.load()
        s.whatsapp_alerts_enabled, s.whatsapp_phone_number_id, s.whatsapp_token = True, "123", "tok"
        s.save()
        self.user = User.objects.create_user("w@example.com", "w@example.com", PASSWORD)
        plan = Plan.objects.create(name="Pro", slug="pro-x", duration_days=30, price=0, signal_delay_minutes=0,
                                   allowed_models="M1,M5")
        Subscription.objects.create(user=self.user, plan=plan, expires_at=timezone.now() + timedelta(days=30))
        AlertPrefs.objects.create(user=self.user, whatsapp_number="923001234567", auto_notify=True, min_grade="A")
        self.db = Path(tempfile.mkdtemp()) / "ict.db"
        con = sqlite3.connect(self.db)
        con.execute("CREATE TABLE signals (symbol, model_id, direction, created_time, entry, stop, targets, grade, bias_filter)")
        now = timezone.now()
        rows = [("XAUUSD", "M1", 1, now - timedelta(minutes=3), 4000.5, 3995.0, "[[4010, 0.5], [4020, 0.5]]", "A", 1),
                ("XAUUSD", "M1", 1, now - timedelta(minutes=3), 4000.5, 3995.0, "[[4010, 0.5], [4020, 0.5]]", "A", 0),
                ("XAUUSD", "M2", -1, now - timedelta(minutes=2), 4001.0, 4005.0, "[[3990, 1.0]]", "A+", 1),   # not in the plan
                ("NAS100", "M5", 1, now - timedelta(minutes=1), 25000.0, 24990.0, "[[25030, 1.0]]", "B", 1),  # grade too low
                ("XAUUSD", "M5", -1, now - timedelta(days=1), 4100.0, 4110.0, "[[4080, 1.0]]", "A+", 1)]      # too old
        con.executemany("INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)", [(*r[:3], r[3].isoformat(), *r[4:]) for r in rows])
        con.commit()
        con.close()

    def test_matching_signals_are_sent_once(self):
        from . import alerts
        from .models import AlertDelivery
        sent = []
        n = alerts.run_once(path=self.db, sender=lambda num, params, site: sent.append((num, params)))
        self.assertEqual(n, 1)
        self.assertEqual(sent[0][0], "923001234567")
        self.assertEqual(sent[0][1][:6], ["XAUUSD", "M1", "BUY", "A", "4,000.50", "3,995.00"])
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 0)   # never twice
        self.assertEqual(AlertDelivery.objects.filter(ok=True).count(), 1)

    def test_off_switches_and_plan_delay(self):
        from . import alerts
        from .models import AlertPrefs, Plan
        sent = []
        Plan.objects.filter(slug="pro-x").update(signal_delay_minutes=30)
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 0)    # the plan sees it later
        Plan.objects.filter(slug="pro-x").update(signal_delay_minutes=0)
        AlertPrefs.objects.update(auto_notify=False)
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 0)
        AlertPrefs.objects.update(auto_notify=True, min_grade="all")
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 2)    # + the B grade M5

    def test_default_off_model_only_when_listed(self):
        import sqlite3
        from . import alerts
        from .models import AlertPrefs, Plan
        Plan.objects.filter(slug="pro-x").update(allowed_models="all")
        con = sqlite3.connect(self.db)
        con.execute("DELETE FROM signals")
        con.execute("INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)",
                    ("XAUUSD", "M11", 1, (timezone.now() - timedelta(minutes=1)).isoformat(), 4000.0, 3990.0, "[[4020, 1.0]]", "A", 1))
        con.commit()
        con.close()
        sent = []
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 0)     # M11 is off by default
        AlertPrefs.objects.update(models_csv="M11")
        self.assertEqual(alerts.run_once(path=self.db, sender=lambda *a: sent.append(a)), 1)     # chosen: sent

    def test_settings_api(self):
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "w@example.com", "password": PASSWORD,
                                                               "device_id": "d1", "platform": "web"}), content_type="application/json")
        h = {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": "d1", "X-Device-Platform": "web"}
        g = self.client.get("/api/v1/alerts/settings", headers=h).json()["settings"]
        self.assertEqual((g["available"], g["whatsapp_number"], g["auto_notify"]), (True, "923001234567", True))
        bad = self.client.post("/api/v1/alerts/settings", json.dumps({"whatsapp_number": "12"}), content_type="application/json", headers=h)
        self.assertEqual(bad.status_code, 400)
        ok_ = self.client.post("/api/v1/alerts/settings", json.dumps({"whatsapp_number": "+92 300 765 4321", "models": "m1, x9, M5",
                                                                     "min_grade": "A+"}), content_type="application/json", headers=h).json()
        self.assertEqual((ok_["settings"]["whatsapp_number"], ok_["settings"]["models"], ok_["settings"]["min_grade"]),
                         ("923007654321", "M1,M5", "A+"))


@override_settings(INTERNAL_API_SECRET=SECRET)
class AIAssistantSettingsTests(TestCase):
    """The site's AI model and a user's own key for the chart assistant."""

    def setUp(self):
        cache.clear()
        User.objects.create_user("ai@example.com", "ai@example.com", PASSWORD)
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "ai@example.com", "password": PASSWORD,
                                                               "device_id": "d1", "platform": "web"}), content_type="application/json")
        self.h = {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": "d1", "X-Device-Platform": "web"}

    def internal(self, email="", key=SECRET):
        return self.client.post("/api/v1/internal/ai", json.dumps({"email": email}), content_type="application/json",
                                headers={"X-Service-Key": key})

    def test_own_key_is_saved_never_shown_and_reaches_the_api(self):
        g = self.client.get("/api/v1/ai/settings", headers=self.h).json()["settings"]
        self.assertEqual((g["enabled"], g["has_key"]), (False, False))
        self.assertIn("anthropic", [p["id"] for p in g["providers"]])
        bad = self.client.post("/api/v1/ai/settings", json.dumps({"provider": "nope"}), content_type="application/json", headers=self.h)
        self.assertEqual(bad.status_code, 400)
        r = self.client.post("/api/v1/ai/settings", json.dumps({"provider": "anthropic", "api_key": "sk-ant-abcdef123456",
                                                                "enabled": True}), content_type="application/json", headers=self.h).json()
        self.assertEqual((r["settings"]["enabled"], r["settings"]["has_key"]), (True, True))
        self.assertNotIn("sk-ant", json.dumps(r))                                 # the key never comes back
        cfg = self.internal("AI@example.com").json()
        self.assertEqual(cfg["user"], {"provider": "anthropic", "model": "", "api_key": "sk-ant-abcdef123456"})
        self.assertIsNone(cfg["site"])
        # turning it off (or clearing the key) stops it
        self.client.post("/api/v1/ai/settings", json.dumps({"enabled": False}), content_type="application/json", headers=self.h)
        self.assertIsNone(self.internal("ai@example.com").json()["user"])

    def test_site_model_and_internal_guard(self):
        s = SiteSettings.load()
        s.ai_provider, s.ai_model, s.ai_api_key = "gemini", "", "site-key-1234567"
        s.save()
        self.assertEqual(self.internal().json()["site"], {"provider": "gemini", "model": "", "api_key": "site-key-1234567"})
        self.assertEqual(self.internal(key="wrong").status_code, 403)
        self.assertEqual(self.client.get("/api/v1/ai/settings").status_code, 401)


@override_settings(INTERNAL_API_SECRET=SECRET)
class BulkPlanAndDonationTests(TestCase):
    """Giving a plan to many users from the admin panel, and the separate donation window."""

    def setUp(self):
        cache.clear()
        self.plan = Plan.objects.create(name="Gift", slug="gift", duration_days=30, price=0)
        self.users = [User.objects.create_user(f"u{i}@example.com", f"u{i}@example.com", PASSWORD) for i in range(3)]
        self.boss = User.objects.create_superuser("bulkboss", "bulkboss@example.com", PASSWORD)
        self.client.force_login(self.boss)

    def test_grant_plan_creates_and_extends(self):
        from . import services
        from .models import Subscription
        old = Subscription.objects.create(user=self.users[0], plan=self.plan)
        before = old.expires_at
        created, extended = services.grant_plan(self.users, self.plan, days=10, note="gift")
        self.assertEqual((created, extended), (2, 1))
        old.refresh_from_db()
        self.assertGreater(old.expires_at, before)
        new = Subscription.objects.get(user=self.users[1], plan=self.plan)
        self.assertAlmostEqual((new.expires_at - timezone.now()).days, 9, delta=1)
        self.assertIn("gift", new.notes)

    def test_admin_action_selected_users_and_everyone(self):
        from .models import Subscription
        url = "/admin/auth/user/"
        ids = [str(u.pk) for u in self.users[:2]]
        page = self.client.post(url, {"action": "give_plan", "_selected_action": ids})
        self.assertContains(page, "Give the plan")
        self.assertContains(page, "u0@example.com")
        done = self.client.post(url, {"action": "give_plan", "_selected_action": ids, "apply": "1",
                                      "plan": self.plan.pk, "days": "", "note": "promo"}, follow=True)
        self.assertEqual(done.status_code, 200)
        self.assertEqual(Subscription.objects.filter(plan=self.plan).count(), 2)
        # the plan list: this plan to every (active) user
        self.client.post("/admin/accounts/plan/", {"action": "give_to_everyone", "_selected_action": [str(self.plan.pk)],
                                                   "apply": "1", "plan": self.plan.pk, "days": "7", "note": ""}, follow=True)
        self.assertEqual(Subscription.objects.filter(plan=self.plan).values("user").distinct().count(), User.objects.filter(is_active=True).count())

    def test_donations_are_off_until_turned_on_and_separate_from_plans(self):
        from .models import Donation
        bank = PaymentMethod.objects.create(name="Bank", account_number="123", for_plans=True)
        jazz = PaymentMethod.objects.create(name="Jazz", account_number="0300", for_plans=False, for_donations=True)
        info = self.client.get("/api/v1/donations/info").json()
        self.assertFalse(info["enabled"])
        self.assertEqual(info["methods"], [])
        bad = self.client.post("/api/v1/donations", json.dumps({"amount": 5, "method": jazz.pk, "reference": "TX123"}),
                               content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        s = SiteSettings.load()
        s.donations_enabled = True
        s.save()
        info = self.client.get("/api/v1/donations/info").json()
        self.assertEqual([m["name"] for m in info["methods"]], ["Jazz"])          # only the donation methods
        self.assertEqual(info["amounts"], [5.0, 10.0, 25.0, 50.0])
        plans_methods = [m["name"] for m in self.client.get("/api/v1/payments/methods").json()["methods"]]
        self.assertEqual(plans_methods, ["Bank"])                                   # and plans keep theirs
        r = self.client.post("/api/v1/donations", json.dumps({"amount": "12.5", "method": jazz.pk, "reference": "TX-998877",
                                                              "name": "Ali", "public": True}), content_type="application/json")
        self.assertEqual(r.status_code, 200)
        d = Donation.objects.get()
        self.assertEqual((float(d.amount), d.status, d.name, d.public), (12.5, "pending", "Ali", True))
        self.assertEqual(self.client.post("/api/v1/donations", json.dumps({"amount": 5, "method": bank.pk, "reference": "TX1234"}),
                                          content_type="application/json").status_code, 400)   # a plan-only method
        self.client.post("/admin/accounts/donation/", {"action": "mark_received", "_selected_action": [str(d.pk)]}, follow=True)
        d.refresh_from_db()
        self.assertEqual(d.status, "received")
        self.assertIsNotNone(d.received_at)


class FakeHttp:
    """Records the HTTP calls the alert channels make."""

    def __init__(self, updates=None):
        self.calls = []
        self.updates = updates or []

    def post(self, url, json=None, **kw):
        self.calls.append((url, json))
        return type("R", (), {"status_code": 200, "content": b"1", "json": lambda s: {"ok": True, "messages": [{"id": "m"}]}})()

    def get(self, url, params=None, **kw):
        return type("R", (), {"status_code": 200, "json": lambda s: {"ok": True, "result": self.updates}})()


@override_settings(INTERNAL_API_SECRET=SECRET, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ServerChartAlertTests(TestCase):
    """Chart alerts the API server finds: which users it watches, delivery once per channel, Telegram connect."""

    def setUp(self):
        from .models import AlertPrefs, Subscription
        cache.clear()
        s = SiteSettings.load()
        s.whatsapp_alerts_enabled, s.whatsapp_phone_number_id, s.whatsapp_token = True, "123", "tok"
        s.telegram_bot_token, s.telegram_bot_username = "bot:tok", "IctAlertsBot"
        s.save()
        self.user = User.objects.create_user("c@example.com", "c@example.com", PASSWORD)
        plan = Plan.objects.create(name="Pro", slug="pro-c", duration_days=30, price=0, alerts_limit=5)
        Subscription.objects.create(user=self.user, plan=plan, expires_at=timezone.now() + timedelta(days=30))
        self.prefs = AlertPrefs.objects.create(user=self.user, whatsapp_number="923001234567", email_alerts=True)
        User.objects.create_user("free@example.com", "free@example.com", PASSWORD)
        AlertPrefs.objects.create(user=User.objects.get(email="free@example.com"), whatsapp_number="923000000000")

    def post(self, path, data, key=SECRET):
        return self.client.post(path, json.dumps(data), content_type="application/json", headers={"X-Service-Key": key})

    def test_watched_users_need_a_plan_and_a_channel(self):
        r = self.post("/api/v1/internal/alerts/users", {}).json()["users"]
        self.assertEqual([u["email"] for u in r], ["c@example.com"])            # the free user has no plan
        self.assertEqual(r[0]["channels"], ["whatsapp", "email"])
        self.assertEqual(r[0]["features"]["alerts_limit"], 5)
        self.assertEqual(self.post("/api/v1/internal/alerts/users", {}, key="bad").status_code, 403)
        SiteSettings.objects.update(chart_alerts_enabled=False)
        self.assertEqual(self.post("/api/v1/internal/alerts/users", {}).json()["users"], [])

    def test_delivery_once_per_channel(self):
        from . import alerts
        from .models import AlertDelivery
        http = FakeHttp()
        sent = alerts.deliver_chart_alert("c@example.com", "chart|a1|1", "XAUUSD crossed 4000", http=http)
        self.assertEqual(sent, ["whatsapp", "email"])
        self.assertEqual(http.calls[0][1]["template"]["name"], "ict_alert")
        self.assertEqual(http.calls[0][1]["template"]["components"][0]["parameters"][0]["text"], "XAUUSD crossed 4000")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(alerts.deliver_chart_alert("c@example.com", "chart|a1|1", "again", http=http), [])
        self.assertEqual(AlertDelivery.objects.filter(signal_key="chart|a1|1", ok=True).count(), 2)
        bad = self.post("/api/v1/internal/alerts/send", {"email": "c@example.com", "key": "x", "text": "t"})
        self.assertEqual(bad.status_code, 400)

    def test_telegram_connect_and_signals(self):
        from . import alerts
        r = self.client.post("/api/v1/auth/login", json.dumps({"email": "c@example.com", "password": PASSWORD,
                                                               "device_id": "d1", "platform": "web"}), content_type="application/json")
        h = {"Authorization": "Bearer " + r.json()["token"], "X-Device-Id": "d1", "X-Device-Platform": "web"}
        link = self.client.post("/api/v1/alerts/telegram", headers=h).json()
        self.assertTrue(link["url"].startswith("https://t.me/IctAlertsBot?start="))
        alerts._tg_offset["v"] = 0
        http = FakeHttp([{"update_id": 5, "message": {"text": "/start " + link["code"], "chat": {"id": 777}}},
                         {"update_id": 6, "message": {"text": "/start 000000000000", "chat": {"id": 8}}}])
        self.assertEqual(alerts.poll_telegram(http=http), 1)
        self.prefs.refresh_from_db()
        self.assertEqual((self.prefs.telegram_chat_id, self.prefs.telegram_code), ("777", ""))
        g = self.client.get("/api/v1/alerts/settings", headers=h).json()["settings"]
        self.assertEqual((g["telegram_connected"], g["channels"]), (True, ["whatsapp", "telegram", "email"]))
        bad = self.client.post("/api/v1/alerts/settings", json.dumps({"webhook_url": "https://127.0.0.1/x"}),
                               content_type="application/json", headers=h)
        self.assertEqual(bad.status_code, 400)                                  # never a local address
        off = self.client.post("/api/v1/alerts/settings", json.dumps({"telegram_disconnect": True, "email_alerts": False}),
                               content_type="application/json", headers=h).json()["settings"]
        self.assertEqual(off["channels"], ["whatsapp"])

    def test_signals_also_go_to_telegram(self):
        import sqlite3
        import tempfile
        from pathlib import Path
        from . import alerts
        self.prefs.auto_notify, self.prefs.telegram_chat_id, self.prefs.min_grade = True, "777", "all"
        self.prefs.save()
        db = Path(tempfile.mkdtemp()) / "ict.db"
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE signals (symbol, model_id, direction, created_time, entry, stop, targets, grade, bias_filter)")
        con.execute("INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)", ("XAUUSD", "M1", 1, (timezone.now() - timedelta(minutes=1)).isoformat(),
                                                                      4000.0, 3990.0, "[[4020, 1.0]]", "A", 1))
        con.commit()
        con.close()
        wa, tg = [], []
        n = alerts.run_once(path=db, sender=lambda *a: wa.append(a), tg_sender=lambda chat, text, site: tg.append((chat, text)))
        self.assertEqual((n, len(wa), tg[0][0]), (2, 1, "777"))
        self.assertIn("XAUUSD M1 BUY", tg[0][1])


class CryptoDonationTests(CryptoPaymentTests):
    """Crypto donations: the plan checkout's watcher, no plan, no account needed, Donation marked received."""

    def setUp(self):
        super().setUp()
        s = SiteSettings.load()
        s.donations_enabled = True
        s.save()

    def donate(self, amount="25", headers=None, **extra):
        return self.client.post("/api/v1/donations/crypto", json.dumps({"amount": amount, "network": "bep20_usdt", "name": "Ali", **extra}),
                                content_type="application/json", **({"headers": headers} if headers else {}))

    def test_visitor_donation_is_received_automatically(self):
        from .models import CryptoOrder, Donation, Payment
        info = self.client.get("/api/v1/donations/info").json()
        self.assertEqual([n["network"] for n in info["crypto"]], ["bep20_usdt"])
        r = self.donate().json()["order"]
        self.assertEqual((r["kind"], r["plan"]), ("donation", "Donation"))
        self.assertTrue(25 < float(r["amount"]) < 26)
        self.assertEqual(self.client.get(f"/api/v1/donations/crypto/{r['id']}?key=wrong").status_code, 404)
        self.pay(r["amount"])
        from .models import CryptoScanState
        CryptoScanState.objects.update(scanned_at=None)
        st = self.client.get(f"/api/v1/donations/crypto/{r['id']}?key={r['key']}").json()["order"]
        self.assertEqual(st["status"], "paid")
        d = Donation.objects.get()
        self.assertEqual((d.status, d.name, d.user), ("received", "Ali", None))
        self.assertTrue(d.reference.startswith("0x"))
        self.assertFalse(Payment.objects.exists())                          # no plan payment, no plan
        self.assertEqual(CryptoOrder.objects.get().who, "Ali")

    def test_limits_and_switched_off(self):
        self.assertEqual(self.donate(amount="0.2").status_code, 400)
        self.assertEqual(self.donate(network="nope").status_code, 400)
        r = self.donate(headers=self.auth).json()["order"]                 # logged in: the order belongs to the user
        from .models import CryptoOrder
        self.assertEqual(CryptoOrder.objects.get(pk=r["id"]).user, self.user)
        self.assertEqual(self.order()["kind"], "plan")                       # a plan order still works next to it
        SiteSettings.objects.update(donations_enabled=False)
        self.assertEqual(self.donate().status_code, 400)
