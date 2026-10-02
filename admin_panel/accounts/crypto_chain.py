"""Reads incoming stablecoin payments straight from the blockchains (watch-only: no private
keys anywhere on the server, so nothing here can move money).

Networks: USDT on TRON (TRC20), USDT on BNB Smart Chain (BEP20), USDC on Base.
Every transfer is taken from the chain itself and must pass:
  * the OFFICIAL token contract (fake / "flash" USDT with the same name is ignored),
  * the amount read from the real Transfer event (not from what a wallet shows),
  * a successful receipt (failed / reverted transactions are ignored),
  * enough confirmations (a transaction that could still be dropped is not trusted).

Sources: TronGrid (free API key, TRONGRID_API_KEY) and public JSON-RPC nodes for BSC / Base
(BSC_RPC_URLS / BASE_RPC_URLS in .env override the defaults).
"""
import json
import logging
import os
import time
from decimal import Decimal
from urllib.request import Request, urlopen

log = logging.getLogger("accounts")
TIMEOUT = 15
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

NETWORKS = {
    "trc20_usdt": {"label": "USDT · TRON (TRC20)", "token": "USDT", "chain": "tron", "decimals": 6,
                   "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "confirmations": 19,
                   "explorer": "https://tronscan.org/#/transaction/"},
    "bep20_usdt": {"label": "USDT · BNB Smart Chain (BEP20)", "token": "USDT", "chain": "evm", "decimals": 18,
                   "contract": "0x55d398326f99059fF775485246999027B3197955", "confirmations": 15,
                   "block_seconds": 0.75, "rpc_env": "BSC_RPC_URLS",
                   "rpcs": ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org",
                            "https://bsc-dataseed1.defibit.io"],
                   "explorer": "https://bscscan.com/tx/"},
    "base_usdc": {"label": "USDC · Base", "token": "USDC", "chain": "evm", "decimals": 6,
                  "contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "confirmations": 20,
                  "block_seconds": 2, "rpc_env": "BASE_RPC_URLS",
                  "rpcs": ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
                  "explorer": "https://basescan.org/tx/"},
}


class ChainError(Exception):
    """The chain could not be read right now (network / node problem). Try again later."""


# ── address checks ───────────────────────────────────────────────────────────
_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58decode(s):
    n = 0
    for ch in s:
        n = n * 58 + _B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + raw


def tron_to_hex(address):
    """T... base58check address -> 20-byte hex (no 41 prefix), validating the checksum."""
    import hashlib
    data = _b58decode(address)
    if len(data) != 25 or data[0] != 0x41:
        raise ValueError("not a TRON address")
    body, check = data[:21], data[21:]
    if hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4] != check:
        raise ValueError("TRON address checksum is wrong")
    return body[1:].hex()


def valid_address(network, address):
    """Returns "" when the address fits the network, else the reason."""
    address = (address or "").strip()
    if NETWORKS[network]["chain"] == "tron":
        if not (address.startswith("T") and len(address) == 34):
            return "A TRON (TRC20) address starts with T and has 34 characters."
        try:
            tron_to_hex(address)
        except (ValueError, IndexError):
            return "This is not a valid TRON address (checksum failed). Copy it again from your wallet."
        return ""
    if not (address.startswith("0x") and len(address) == 42):
        return "A BEP20 / Base address starts with 0x and has 42 characters."
    try:
        int(address[2:], 16)
    except ValueError:
        return "This is not a valid 0x address."
    return ""


def units(network, amount):
    """Decimal token amount -> integer smallest units."""
    return int((Decimal(str(amount)) * (Decimal(10) ** NETWORKS[network]["decimals"])).to_integral_value())


# ── HTTP helpers ─────────────────────────────────────────────────────────────
def _http_json(url, payload=None, headers=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, data=body, headers={"Content-Type": "application/json", "Accept": "application/json",
                                           "User-Agent": "ICC-Terminal-payments", **(headers or {})})
    try:
        with urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001 - any network / JSON problem means "try later"
        raise ChainError(str(e)) from e


def _rpcs(net):
    custom = [u.strip() for u in os.getenv(net.get("rpc_env", ""), "").split(",") if u.strip()]
    return custom or net["rpcs"]


def _rpc(net, method, params):
    last = None
    for url in _rpcs(net):
        try:
            res = _http_json(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        except ChainError as e:
            last = e
            continue
        if "error" in res:
            last = ChainError(f"{url}: {res['error']}")
            continue
        return res.get("result")
    raise last or ChainError("no RPC answered")


# ── EVM (BSC / Base) ─────────────────────────────────────────────────────────
MAX_EVM_BLOCKS = 40000        # one read covers ~8 h on BSC, ~22 h on Base (the watcher reads every 20 s)


def _block_time(net, number, cache=None):
    """Unix time of a block (its header timestamp)."""
    if cache is not None and number in cache:
        return cache[number]
    blk = _rpc(net, "eth_getBlockByNumber", [hex(number), False]) or {}
    ts = int(blk.get("timestamp", "0x0"), 16) or None
    if cache is not None:
        cache[number] = ts
    return ts


def _evm_transfers(network, address, since_ts):
    net = NETWORKS[network]
    head = int(_rpc(net, "eth_blockNumber", []), 16)
    span = int(max(0, time.time() - since_ts) / net["block_seconds"]) + 200
    start = max(0, head - min(span, MAX_EVM_BLOCKS))
    to_topic = "0x" + "0" * 24 + address.lower()[2:]
    out, frm = [], start
    while frm <= head:
        to = min(frm + 1999, head)
        logs = _rpc(net, "eth_getLogs", [{"fromBlock": hex(frm), "toBlock": hex(to), "address": net["contract"],
                                          "topics": [TRANSFER_TOPIC, None, to_topic]}]) or []
        for lg in logs:
            if lg.get("removed"):
                continue
            out.append({"txid": lg["transactionHash"], "value": int(lg["data"], 16),
                        "from": "0x" + lg["topics"][1][-40:], "block": int(lg["blockNumber"], 16)})
        frm = to + 1
    # Exact block times for the newest blocks (a receiving wallet gets few payments); a very busy
    # address would need one call per block, so older ones are estimated from the newest one.
    times, blocks = {}, sorted({t["block"] for t in out}, reverse=True)
    for b in blocks[:20]:
        _block_time(net, b, times)
    ref = blocks[0] if blocks else None
    for t in out:
        t["confirmations"] = head - t["block"] + 1
        t["block_time"] = times.get(t["block"]) or (
            times[ref] - (ref - t["block"]) * net["block_seconds"] if ref and times.get(ref) else None)
    return out


def _evm_verify(network, txid, address):
    """(value paid to address with the official token, confirmations, from) for one tx, or None."""
    net = NETWORKS[network]
    rcpt = _rpc(net, "eth_getTransactionReceipt", [txid])
    if not rcpt:
        return None                                  # unknown / still pending
    if rcpt.get("status") != "0x1":
        return {"value": 0, "confirmations": 0, "failed": True}
    head = int(_rpc(net, "eth_blockNumber", []), 16)
    total, frm = 0, ""
    for lg in rcpt.get("logs", []):
        if (lg.get("address", "").lower() == net["contract"].lower() and lg.get("topics")
                and lg["topics"][0].lower() == TRANSFER_TOPIC and lg["topics"][2][-40:].lower() == address.lower()[2:]):
            total += int(lg["data"], 16)
            frm = "0x" + lg["topics"][1][-40:]
    block = int(rcpt["blockNumber"], 16)
    return {"value": total, "confirmations": head - block + 1, "from": frm, "block_time": _block_time(net, block)}


# ── TRON ─────────────────────────────────────────────────────────────────────
def _tron_headers():
    key = os.getenv("TRONGRID_API_KEY", "").strip()
    return {"TRON-PRO-API-KEY": key} if key else {}


def _tron_transfers(network, address, since_ts):
    net = NETWORKS[network]
    url = (f"https://api.trongrid.io/v1/accounts/{address}/transactions/trc20?only_confirmed=true&only_to=true"
           f"&limit=100&contract_address={net['contract']}&min_timestamp={int(since_ts * 1000)}")
    data = _http_json(url, headers=_tron_headers())
    out = []
    for t in data.get("data", []):
        if (t.get("token_info", {}).get("address") != net["contract"] or t.get("to") != address
                or t.get("type") != "Transfer"):
            continue
        out.append({"txid": t["transaction_id"], "value": int(t["value"]), "from": t.get("from", ""),
                    "block_time": int(t.get("block_timestamp", 0)) / 1000,
                    "confirmations": net["confirmations"]})        # only_confirmed = solidified
    return out


def _tron_verify(network, txid, address):
    net = NETWORKS[network]
    info = _http_json("https://api.trongrid.io/wallet/gettransactioninfobyid", {"value": txid}, _tron_headers())
    if not info or not info.get("id"):
        return None
    if info.get("receipt", {}).get("result") != "SUCCESS":
        return {"value": 0, "confirmations": 0, "failed": True}
    contract_hex = tron_to_hex(net["contract"])
    to_hex = tron_to_hex(address)
    total = 0
    for lg in info.get("log", []):
        topics = lg.get("topics") or []
        if (lg.get("address", "").lower().removeprefix("41") == contract_hex and len(topics) >= 3
                and topics[0].lower() == TRANSFER_TOPIC[2:] and topics[2][-40:].lower() == to_hex):
            total += int(lg.get("data", "0") or "0", 16)
    now = _http_json("https://api.trongrid.io/wallet/getnowblock", {}, _tron_headers())
    head = int(now.get("block_header", {}).get("raw_data", {}).get("number", 0))
    conf = head - int(info.get("blockNumber", head)) + 1
    return {"value": total, "confirmations": conf, "from": "",
            "block_time": int(info.get("blockTimeStamp", 0)) / 1000}


# ── public API ───────────────────────────────────────────────────────────────
def incoming_transfers(network, address, since_ts):
    """Official-token transfers to `address` since `since_ts` (unix seconds):
    [{"txid", "value" (smallest units), "from", "confirmations", ...}]. Raises ChainError."""
    if NETWORKS[network]["chain"] == "tron":
        return _tron_transfers(network, address, since_ts)
    return _evm_transfers(network, address, since_ts)


def verify_tx(network, txid, address):
    """Checks one transaction id against the chain: {"value", "confirmations", "failed"?} or None
    when the chain does not know it (yet). Raises ChainError."""
    txid = (txid or "").strip()
    if NETWORKS[network]["chain"] == "tron":
        txid = txid.removeprefix("0x")
        if len(txid) != 64:
            raise ValueError("A TRON transaction id has 64 characters.")
        return _tron_verify(network, txid, address)
    if not (txid.startswith("0x") and len(txid) == 66):
        raise ValueError("A BSC / Base transaction hash starts with 0x and has 66 characters.")
    return _evm_verify(network, txid, address)
