import time

from django.core.management.base import BaseCommand

from accounts import alerts


class Command(BaseCommand):
    help = "Send new model signals to the users' WhatsApp (auto notify)"

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="check once and exit")
        parser.add_argument("--every", type=int, default=60, help="seconds between checks")

    def handle(self, *args, **options):
        self.stdout.write(f"Signal alerts running (checks {alerts.ict_db()} every {options['every']} s).")
        while True:
            try:
                n = alerts.run_once(log=lambda m: self.stderr.write(m))
                if n:
                    self.stdout.write(f"sent {n} WhatsApp alert(s)")
            except Exception as e:  # noqa: BLE001 - keep watching
                self.stderr.write(f"alerts: {e}")
            if options["once"]:
                return
            time.sleep(max(15, options["every"]))
