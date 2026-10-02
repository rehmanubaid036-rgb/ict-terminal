"""Creates the default superadmin from DJANGO_SUPERUSER_EMAIL / DJANGO_SUPERUSER_PASSWORD
in admin_panel/.env (never committed). An existing account is left untouched, so a
password changed later in the admin is not overwritten."""
import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the default superadmin from .env if it does not exist yet."

    def handle(self, *args, **options):
        email = os.getenv("DJANGO_SUPERUSER_EMAIL", "").strip().lower()
        password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "")
        if not email or not password:
            self.stdout.write("DJANGO_SUPERUSER_EMAIL / DJANGO_SUPERUSER_PASSWORD not set in .env; skipped.")
            return

        User = get_user_model()
        if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
            self.stdout.write(f"exists   superadmin {email} (password unchanged)")
            return
        User.objects.create_superuser(username=email, email=email, password=password)
        self.stdout.write(f"created  superadmin {email}")
