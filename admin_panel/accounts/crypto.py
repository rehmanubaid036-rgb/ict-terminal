"""Crypto checkout: orders with a unique amount, matched against the blockchain and turned
into a paid Payment that activates the plan.

How a payment is found (scan_network, run by the watcher every 20 s and by status checks):
  * every official-token transfer to our address is stored once (CryptoTransfer), so nothing
    that reaches the wallet is lost from view, matched or not;
  * exact unique amount                         -> that order, plan starts by itself;
  * within the allowed difference (admin: USD or %, the larger counts; exchanges take their
    withdrawal fee out of the amount) of exactly one order -> that order, plan starts by itself;
  * the same, but paid after the order expired / was cancelled -> that order, "Needs review";
  * a bigger difference, or it fits several customers -> no order is closed on a guess: the
    transfer is "Not matched" in the admin with the likely order(s) named, to link by hand
    (or the customer pastes the transaction id: their order goes to review).
The chain side (crypto_chain) only returns transfers of the official contract with a
successful receipt, and a plan starts only after enough confirmations. A transaction id can
pay one order only (unique in the database).

A customer has one open order at a time: picking another network shows the open one, which
they can pay or cancel (cancelling first looks at the chain once more).
"""
import logging
import random
import threading
import time
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from decimal import ROUND_DOWN, Decimal

from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.utils import timezone

from . import crypto_chain, services
from .models import CryptoOrder, CryptoScanState, CryptoTransfer, CryptoWallet, Payment, Plan, SiteSettings

log = logging.getLogger("accounts")
ORDER_MINUTES = 60
CHECK_EVERY_SECONDS = 15
WATCHER_FRESH_SECONDS = 45     # a network read more recently than this is left to the watcher
SCAN_IN_BACKGROUND = True      # status checks start a stale read in a thread (tests read inline)
LATE_GRACE_HOURS = 24          # payments up to this long after an order closed still go to review
SCAN_LEASE_SECONDS = 120
OPEN = ("waiting", "confirming")
FAR_LOW, FAR_HIGH = Decimal("0.5"), Decimal("2")   # a bigger difference in this range names the likely order


def active_networks():
    """[{"network", "label", "token", "fingerprint"}] of the wallets switched on in the admin."""
    out = []
    for w in CryptoWallet.objects.filter(is_active=True).exclude(address=""):
        if w.network in crypto_chain.NETWORKS and not crypto_chain.valid_address(w.network, w.address):
            net = crypto_chain.NETWORKS[w.network]
            out.append({"network": w.network, "label": net["label"], "token": net["token"],
                        "fingerprint": w.fingerprint})
    return out


def allowed_difference(amount):
    """How far a payment may be from the order amount and still count (admin settings)."""
    s = SiteSettings.load()
    return max(Decimal(s.crypto_diff_usd), Decimal(amount) * Decimal(s.crypto_diff_percent) / 100).quantize(
        Decimal("0.0001"))


def _unique_amount(price, network):
    """Plan price plus 0.0101-0.9999 so no other open order on this network has the same amount."""
    taken = set(CryptoOrder.objects.filter(network=network, status__in=OPEN).values_list("amount", flat=True))
    for _ in range(200):
        amount = (Decimal(price) + Decimal(random.randint(101, 9999)) / Decimal(10000)).quantize(Decimal("0.0001"))
        if amount not in taken:
            return amount
    raise RuntimeError("no free amount")


def open_order(user):
    expire_old_orders(user)
    return CryptoOrder.objects.select_related("plan").filter(user=user, status__in=OPEN).order_by("-created_at").first()


def _open_order_message(order):
    net = crypto_chain.NETWORKS[order.network]
    if order.status == "confirming":
        return (f"Your {net['label']} payment was found and is being confirmed on the blockchain. "
                "Please wait a few minutes: your plan starts by itself.")
    minutes = max(1, int((order.expires_at - timezone.now()).total_seconds() // 60))
    return (f"You already have an unpaid {net['label']} payment of {order.amount} {net['token']} "
            f"({minutes} min left). Pay that one, or cancel it first and then choose another option. "
            "Do not cancel if you have already sent the money.")


def create_order(user, plan_slug, network, source="app"):
    """Returns (order, error, code). code: "created", "resumed" (the same open order again) or
    "open_order" (another payment is open: order is that one, error explains)."""
    plan = Plan.objects.filter(slug=str(plan_slug), is_active=True, is_public=True).first()
    if plan is None or plan.price <= 0:
        return None, "Please choose a plan.", "invalid"
    wallet = CryptoWallet.objects.filter(network=str(network), is_active=True).first()
    if wallet is None or crypto_chain.valid_address(wallet.network, wallet.address):
        return None, "This crypto network is not available right now.", "invalid"
    current = open_order(user)
    if current is not None:
        if (current.status == "waiting" and current.plan_id == plan.pk and current.network == wallet.network
                and current.address == wallet.address):
            return current, "", "resumed"
        return current, _open_order_message(current), "open_order"
    now = timezone.now()
    order = CryptoOrder.objects.create(
        user=user, plan=plan, network=wallet.network, address=wallet.address, price=plan.price,
        amount=_unique_amount(plan.price, wallet.network), expires_at=now + timedelta(minutes=ORDER_MINUTES),
        source=source if source in ("app", "desktop", "web") else "app")
    log.info("Crypto order #%s: %s %s for %s", order.pk, order.amount, order.network, user.email)
    return order, "", "created"


def cancel_order(order):
    """The customer closes an unpaid order (to choose another network). Returns (order, error)."""
    if order.status == "cancelled":
        return order, ""
    if order.status == "confirming":
        return order, "Your payment was found and is being confirmed, so it can't be cancelled. Please wait."
    if order.status != "waiting":
        return order, "This payment is already closed."
    scan_network(order.network, force=True)          # one last look: money may be on its way
    order.refresh_from_db()
    if order.status != "waiting" or order.txid:
        return order, "We already see a payment for this order, so it can't be cancelled."
    CryptoOrder.objects.filter(pk=order.pk, status="waiting", txid__isnull=True).update(
        status="cancelled", cancelled_at=timezone.now())
    order.refresh_from_db()
    log.info("Crypto order #%s cancelled by the customer", order.pk)
    return order, ""


def expire_old_orders(user=None):
    qs = CryptoOrder.objects.filter(status="waiting", expires_at__lt=timezone.now())
    if user is not None:
        qs = qs.filter(user=user)
    qs.update(status="expired")


def _to_decimal(network, value):
    return (Decimal(value) / (Decimal(10) ** crypto_chain.NETWORKS[network]["decimals"])).quantize(
        Decimal("0.000001"), rounding=ROUND_DOWN)


def _activate(order):
    """Records the paid Payment and gives the plan (once, even if two processes try)."""
    with transaction.atomic():
        won = (CryptoOrder.objects.filter(pk=order.pk, payment__isnull=True)
               .exclude(status__in=("paid", "rejected")).update(status="paid", paid_at=timezone.now()))
        order = CryptoOrder.objects.select_related("plan", "user").get(pk=order.pk)
        if not won:
            return order
        payment = Payment.objects.create(
            user=order.user, plan=order.plan, amount=order.price, currency="USD", method="crypto",
            reference=(order.txid or "")[:120], status="pending",
            source="desktop" if order.source in ("desktop", "web") else "app",
            local_amount=f"{order.paid_amount} {crypto_chain.NETWORKS[order.network]['token']}",
            notes=(f"Crypto order #{order.pk} · {order.get_network_display()} · verified on the blockchain. "
                   f"{order.note}").strip()[:500])
        CryptoOrder.objects.filter(pk=order.pk).update(payment=payment)
        order.payment = payment
    services.apply_payment(payment)
    log.info("Crypto order #%s paid (%s), plan %s active for %s", order.pk, order.txid, order.plan, order.user.email)
    return order


def _fmt(amount):
    """30.500000 -> "30.50", 30.0417 -> "30.0417" (for notes customers and the admin read)."""
    text = f"{Decimal(amount).quantize(Decimal('0.0001')).normalize():f}"
    whole, _, cents = text.partition(".")
    return f"{whole}.{cents.ljust(2, '0')}"


def _claim_tx(order, tx):
    """Stores the matched transaction on the order; False if that tx id was already used."""
    order.txid = tx["txid"]
    order.paid_amount = _to_decimal(order.network, tx["value"])
    order.from_address = (tx.get("from") or "")[:64]
    order.confirmations = int(tx.get("confirmations") or 0)
    try:
        with transaction.atomic():
            order.save()
    except IntegrityError:
        order.txid = None
        return False
    return True


# ── reading the chain ────────────────────────────────────────────────────────
def _watch_orders(network):
    """Orders a new transfer may belong to: open ones, and closed unpaid ones for LATE_GRACE_HOURS."""
    horizon = timezone.now() - timedelta(hours=LATE_GRACE_HOURS)
    return (CryptoOrder.objects.select_related("plan", "user")
            .filter(network=network, txid__isnull=True)
            .filter(Q(status="waiting") | Q(status__in=("expired", "cancelled"), expires_at__gte=horizon)))


def _as_dt(ts):
    return datetime.fromtimestamp(ts, tz=dt_timezone.utc) if ts else None


def _record(network, address, tx):
    """Stores one incoming transfer (once per transaction id); returns it."""
    t, created = CryptoTransfer.objects.get_or_create(
        network=network, txid=tx["txid"],
        defaults={"address": address, "value": Decimal(int(tx["value"])),
                  "amount": _to_decimal(network, tx["value"]), "from_address": (tx.get("from") or "")[:64],
                  "block_time": _as_dt(tx.get("block_time")), "confirmations": int(tx.get("confirmations") or 0)})
    if not created and int(tx.get("confirmations") or 0) > t.confirmations:
        t.confirmations = int(tx["confirmations"])
        t.save(update_fields=["confirmations"])
        if t.order_id:
            CryptoOrder.objects.filter(pk=t.order_id, confirmations__lt=t.confirmations).update(
                confirmations=t.confirmations)
    return t


def _grouped(transfers):
    """One entry per transaction (a transaction can hold several transfers to us)."""
    out = {}
    for tx in transfers:
        if tx["txid"] in out:
            out[tx["txid"]]["value"] += int(tx["value"])
        else:
            out[tx["txid"]] = dict(tx, value=int(tx["value"]))
    return list(out.values())


def scan_network(network, force=False):
    """Reads new transfers for `network`, matches them to orders and activates confirmed ones.
    Returns True when the chain was read. Only one process reads a network at a time."""
    now = timezone.now()
    state, _ = CryptoScanState.objects.get_or_create(network=network)
    if not force and state.scanned_at and (now - state.scanned_at).total_seconds() < CHECK_EVERY_SECONDS:
        return False
    if not CryptoScanState.objects.filter(pk=state.pk).filter(
            Q(lease_until__isnull=True) | Q(lease_until__lt=now)).update(
            lease_until=now + timedelta(seconds=SCAN_LEASE_SECONDS)):
        return False                                   # another process is reading it right now
    cursor, read = state.cursor, False
    try:
        orders = list(_watch_orders(network))
        if orders:
            started = time.time()
            earliest = min(o.created_at for o in orders).timestamp() - 60
            since = max(earliest, cursor - 600) if cursor else earliest   # 10 min overlap between reads
            found = {address: _grouped(crypto_chain.incoming_transfers(network, address, since))
                     for address in sorted({o.address for o in orders})}
            with transaction.atomic():                 # one short write for the whole read
                for address, txs in found.items():
                    for tx in txs:
                        # older than every order: no order can be paid by it, don't list it
                        if not tx.get("block_time") or tx["block_time"] >= earliest:
                            _record(network, address, tx)
            cursor, read = started - 30, True
        _match_new(network)
        _confirm(network)
    except crypto_chain.ChainError as e:
        log.warning("Crypto scan %s: chain not reachable: %s", network, e)
    finally:
        CryptoScanState.objects.filter(pk=state.pk).update(lease_until=None, cursor=cursor, scanned_at=timezone.now())
    return read


def _match_new(network):
    for t in CryptoTransfer.objects.filter(network=network, status="new").order_by("block_time", "pk"):
        _match_transfer(t)


def _match_transfer(t):
    when = t.block_time or t.seen_at
    grace = timedelta(hours=LATE_GRACE_HOURS)
    orders = [o for o in _watch_orders(t.network).filter(address=t.address)
              if o.created_at - timedelta(seconds=60) <= when <= o.expires_at + grace]
    exact = [o for o in orders if crypto_chain.units(t.network, o.amount) == int(t.value)]
    if exact:
        return _assign(t, exact[0], "exact")
    paid = t.amount
    near = [o for o in orders if abs(paid - o.amount) <= allowed_difference(o.amount)]
    if len(near) == 1:
        return _assign(t, near[0], "near")
    # Weak evidence (a very different amount, or it fits several customers): no order is closed
    # on a guess, so the customer's real payment can still match. The admin sees it here and can
    # link it; the customer can paste the transaction id (then their order goes to review).
    maybe = near or [o for o in orders if o.amount * FAR_LOW <= paid <= o.amount * FAR_HIGH]
    t.status = "unmatched"
    t.note = ("Could be for order " + ", ".join(f"#{o.pk} ({o.user.email}, expected {o.amount})" for o in maybe)
              + f": paid {_fmt(paid)}. Check who paid, then link the order." if maybe
              else "No open order fits this payment.")[:250]
    t.save(update_fields=["status", "note"])
    if maybe:
        log.info("Crypto transfer %s (%s) not matched: %s", t.txid, paid, t.note)
    return None


def _assign(t, order, kind):
    """Puts transfer `t` on `order`; the plan starts by itself only for a clean match
    (kind "exact", or "near": within the allowed difference); "far" (a pasted transaction id with
    another amount) and anything late go to review."""
    if not _claim_tx(order, {"txid": t.txid, "value": int(t.value), "from": t.from_address,
                             "confirmations": t.confirmations}):
        t.status, t.note = "unmatched", "This transaction is already on another order."
        t.save(update_fields=["status", "note"])
        return None
    t.status, t.order = "matched", order
    t.save(update_fields=["status", "order"])
    token = crypto_chain.NETWORKS[order.network]["token"]
    paid, expected = _fmt(order.paid_amount), str(order.amount)
    when = t.block_time or t.seen_at
    review, note = "", ""
    if kind == "near":
        note = f"Paid {paid} {token}, expected {expected} (accepted: within the allowed difference)."
    elif kind == "far":
        review = f"Amount differs: paid {paid} {token}, expected {expected}."
    if order.status == "cancelled":
        review = "Paid for an order the customer cancelled. " + (review or note)
    elif when > order.expires_at or order.status == "expired":
        review = "Paid after the order expired. " + (review or note)
    elif when < order.created_at - timedelta(seconds=60):
        review = "Transaction is older than the order. " + (review or note)
    if review:
        order.status, order.note = "review", review.strip()[:250]
        order.save(update_fields=["status", "note"])
        log.info("Crypto order #%s needs review: %s", order.pk, order.note)
        return order
    order.status, order.note = "confirming", note[:250]
    order.save(update_fields=["status", "note"])
    return _maybe_activate(order)


def _maybe_activate(order):
    if order.status == "confirming" and order.confirmations >= crypto_chain.NETWORKS[order.network]["confirmations"]:
        return _activate(order)
    return order


def _confirm(network):
    """Orders waiting for confirmations: re-read their transaction and start the plan when final."""
    need = crypto_chain.NETWORKS[network]["confirmations"]
    for order in CryptoOrder.objects.filter(network=network, status="confirming").exclude(txid=None):
        if order.confirmations < need:
            info = crypto_chain.verify_tx(network, order.txid, order.address)
            if info is None:
                continue
            if info.get("failed") or not info.get("value"):
                order.status, order.note = "rejected", "The transaction failed on the blockchain."
                order.save(update_fields=["status", "note"])
                continue
            order.confirmations = int(info["confirmations"])
            order.save(update_fields=["confirmations"])
        _maybe_activate(order)


def check_order(order, force=False):
    """Status check from the app / admin; returns the order as it is now. The watcher reads the
    chain every 20 s, so a status check only reads it itself when the watcher looks stopped
    (or when forced by the admin): the app's status calls stay fast."""
    if force:
        scan_network(order.network, force=True)
    elif order.status in OPEN:
        state = CryptoScanState.objects.filter(network=order.network).first()
        if state is None or state.scanned_at is None or \
                (timezone.now() - state.scanned_at).total_seconds() > WATCHER_FRESH_SECONDS:
            if SCAN_IN_BACKGROUND:     # never keep the customer's request waiting on the chain
                threading.Thread(target=_background_scan, args=(order.network,), daemon=True).start()
            else:
                scan_network(order.network)
    CryptoOrder.objects.filter(pk=order.pk).update(checked_at=timezone.now())
    order.refresh_from_db()
    return order


def _background_scan(network):
    try:
        scan_network(network)
    except Exception:  # noqa: BLE001 - a background read must never crash the server
        log.exception("Crypto background scan %s failed", network)
    finally:
        connection.close()


def submit_txid(order, txid):
    """The customer pastes the transaction id (e.g. a transfer from an exchange that took long).
    Returns (order, error). A pasted transaction only activates the plan for the exact amount;
    anything else goes to review (anyone can copy a transaction id from the explorer)."""
    txid = (txid or "").strip()
    if crypto_chain.NETWORKS[order.network]["chain"] == "tron":
        txid = txid.removeprefix("0x")
    if order.status == "paid":
        return order, ""
    if order.status == "rejected":
        return order, "This order was rejected. Contact support."
    if not txid:
        return order, "Paste the transaction ID."
    if CryptoOrder.objects.filter(txid__in=[txid, txid.removeprefix("0x")]).exclude(pk=order.pk).exists():
        return order, "This transaction was already used for another payment."
    scan_network(order.network, force=True)           # the watcher may find it right now
    order.refresh_from_db()
    if order.txid:
        if order.txid == txid:
            return order, ""
        return order, "A payment is already linked to this order. Contact support if you paid twice."
    if order.status not in ("waiting", "expired", "cancelled", "review"):
        return order, "This payment is closed."
    try:
        info = crypto_chain.verify_tx(order.network, txid, order.address)
    except ValueError as e:
        return order, str(e)
    except crypto_chain.ChainError:
        return order, "The blockchain could not be checked right now. Try again in a minute."
    if info is None:
        return order, "This transaction is not on the blockchain yet. Wait a minute and try again."
    if info.get("failed") or not info.get("value"):
        return order, ("This transaction did not send the official " +
                       crypto_chain.NETWORKS[order.network]["token"] + " to our address on this network.")
    t = _record(order.network, order.address, {"txid": txid, "value": info["value"], "from": info.get("from", ""),
                                                "block_time": info.get("block_time"),
                                                "confirmations": info["confirmations"]})
    if t.order_id and t.order_id != order.pk:
        return order, "This transaction was already used for another payment."
    exact = int(info["value"]) == crypto_chain.units(order.network, order.amount)
    order = _assign(t, order, "exact" if exact else "far") or order
    order.refresh_from_db()
    if order.status == "review" and not exact:
        return order, "The amount is different from the order. The admin will check it."
    if order.status == "review" and order.note.startswith("Transaction is older"):
        return order, "This transaction is older than the order. The admin will check it."
    return order, ""


def approve(order, by=""):
    """Admin: accept a payment under review (e.g. paid a little late or a bit short)."""
    order.note = (order.note + f" Approved by {by}.")[:250]
    order.save(update_fields=["note"])
    return _activate(order)


def pay_linked_order(t, by=""):
    """Admin: an unmatched transfer was matched by hand to `t.order`. Returns (order, error)."""
    order = t.order
    if order is None:
        return None, "Pick the customer's order on the transfer first."
    if order.status == "paid":
        return order, "That order is already paid."
    if order.status == "rejected":
        return order, "That order was rejected. Pick another order of the customer."
    if order.txid and order.txid != t.txid:
        return order, "That order already has another transaction."
    if not order.txid and not _claim_tx(order, {"txid": t.txid, "value": int(t.value), "from": t.from_address,
                                                 "confirmations": t.confirmations}):
        return order, "This transaction is already on another order."
    t.status = "matched"
    t.note = (t.note + f" Linked by {by}.")[:250]
    t.save(update_fields=["status", "note"])
    return approve(order, by=by), ""


def order_dict(order):
    net = crypto_chain.NETWORKS[order.network]
    network_name = net["label"].split(" · ")[1]
    return {
        "id": order.pk, "status": order.status, "status_label": order.get_status_display(),
        "network": order.network, "network_label": net["label"], "token": net["token"],
        "address": order.address, "amount": str(order.amount), "plan": order.plan.name,
        "paid_amount": str(order.paid_amount) if order.paid_amount is not None else "",
        "expires_at": order.expires_at.isoformat(), "created_at": order.created_at.isoformat(),
        "seconds_left": max(0, int((order.expires_at - timezone.now()).total_seconds())) if order.status == "waiting" else 0,
        "confirmations": order.confirmations, "confirmations_needed": net["confirmations"],
        "txid": order.txid or "", "explorer": (net["explorer"] + order.txid) if order.txid else "",
        "note": order.note, "can_cancel": order.status == "waiting",
        "warning": f"Send ONLY {net['token']} on {network_name} to this address, the EXACT amount. "
                   f"Other tokens or networks are lost.",
        "exchange_tip": (f"Sending from an exchange (Binance, OKX, ...)? The amount that ARRIVES must be "
                         f"{order.amount} {net['token']}: exchanges take their fee out of the amount, so add the "
                         f"fee on top (check \"Receive amount\"). A small difference is accepted automatically."),
    }
