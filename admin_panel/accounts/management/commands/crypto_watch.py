"""Keeps reading the blockchains for crypto payments (started by vps_start.bat).
Customers do not need to keep the app open: a payment is matched and the plan activated here
within about a minute of the blockchain confirmations. Networks are read only while an order
is open (or closed less than a day ago, for late payments)."""
import time

from django.core.management.base import BaseCommand
from django.db.models import Q

from accounts import crypto
from accounts.models import CryptoOrder


class Command(BaseCommand):
    help = "Watch crypto payments and activate paid plans"

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="check once and exit")

    def handle(self, *args, **options):
        self.stdout.write("Crypto watcher running (reads the blockchains every 20 seconds while payments are open).")
        while True:
            crypto.expire_old_orders()
            networks = set(CryptoOrder.objects.filter(status="confirming").values_list("network", flat=True))
            for network in crypto_networks_to_watch():
                networks.add(network)
            for network in sorted(networks):
                before = dict(CryptoOrder.objects.filter(network=network).exclude(
                    status__in=("paid", "rejected")).values_list("pk", "status"))
                try:
                    crypto.scan_network(network, force=True)
                except Exception as e:  # noqa: BLE001 - one bad network must not stop the watcher
                    self.stderr.write(f"{network}: {e}")
                    continue
                for pk, status in CryptoOrder.objects.filter(pk__in=before).values_list("pk", "status"):
                    if status != before[pk]:
                        self.stdout.write(f"order #{pk}: {before[pk]} -> {status}")
            if options["once"]:
                return
            time.sleep(20)


def crypto_networks_to_watch():
    """Networks with an order a new payment may still belong to."""
    candidates = set(CryptoOrder.objects.filter(txid__isnull=True).filter(
        Q(status="waiting") | Q(status__in=("expired", "cancelled"))).values_list("network", flat=True))
    return {n for n in candidates if crypto._watch_orders(n).exists()}
