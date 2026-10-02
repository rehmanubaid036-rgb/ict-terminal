"""Community chat: traders talk under a nickname (never their name or email).

Who can write: logged-in accounts only (a guest sees "create an account / log in"), after
choosing a nickname and accepting the rules, once the account is older than the admin's wait
time (bots usually start right after signing up). Every message passes:
  * the abusive-language filter (English, Roman Urdu / Hindi, Urdu script; spaced-out or
    disguised spellings like "f u c k", "fuuuck", "f*ck", "b1tch" are caught too),
  * the links / contact filter (no URLs, emails, phone numbers, @handles: rules 3 and 4),
  * rate limits (one message per 5 s, 20 per 10 minutes, no repeating the same text).
A blocked message is a strike; 3 strikes mute the account for 30 minutes. A message reported
by 3 different users is hidden until an admin looks at it. Admins delete, mute and ban.
"""
import re
import unicodedata
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .models import ChatMessage, ChatProfile, ChatReport, SiteSettings

ROOMS = dict(ChatMessage.ROOMS)
PAGE = 50
SLOW_SECONDS = 5
BURST_LIMIT, BURST_MINUTES = 20, 10
STRIKES_TO_MUTE, MUTE_MINUTES = 3, 30
HIDE_AFTER_REPORTS = 3
NICK_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
RESERVED_NICKS = ("admin", "administrator", "moderator", "mod", "support", "icc", "iccterminal", "official", "staff")

# Built-in abusive words (normalised: lower case, letters only, repeated letters collapsed).
# The admin adds more in Settings -> Community -> Extra blocked words.
BAD_WORDS = {
    # English
    "fuck", "fuk", "fck", "fuc", "motherfucker", "fucker", "fucking", "shit", "bullshit", "bitch", "biatch", "bastard",
    "asshole", "ashole", "dick", "dickhead", "cunt", "whore", "slut", "pussy", "cock", "wanker", "twat", "prick",
    "nigger", "nigga", "faggot", "fag", "ass", "retard", "porn", "sex", "rape", "rapist", "jackass", "dumbass",
    # Roman Urdu / Hindi
    "madarchod", "madarchot", "maderchod", "behenchod", "bhenchod", "benchod", "bhencho", "behnchod",
    "chutiya", "chutia", "chutiye", "chootiya", "gandu", "gaandu", "gand", "gaand", "harami", "haramzada",
    "haramzadi", "haramkhor", "kutta", "kutte", "kutti", "kuttiya", "kamina", "kamine", "kameena", "kamini",
    "randi", "rundi", "randwa", "lund", "lauda", "loda", "lodu", "bhosdi", "bhosdike", "bhosda", "bhosdiwala",
    "kanjar", "kanjari", "dalla", "dalli", "khanki", "suar", "suwar", "ullu", "tatte", "tatti", "jhant", "jhaant",
    "chod", "chodu", "teriamaki", "terimaaki", "maakichut", "behnkelode",
}
# Urdu script (matched inside the text, after removing diacritics)
BAD_URDU = ("حرامی", "حرامزادہ", "کتا", "کتی", "کمینہ", "کمینی", "گانڈو", "رنڈی", "بہن چود", "ماں چود", "مادرچود",
            "چوتیا", "لن", "بھوسڑی", "کنجر", "دلا")
# Disguised letters: f*ck, b1tch, sh!t, @ss
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
                      "!": "i", "|": "i", "*": "u"})

URL_RE = re.compile(r"(https?://|www\.|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|dot)\s*(com|net|org|io|me|pk|in|co|xyz|ly|gg|link|"
                    r"site|info|biz|app|trade|online|club|top|vip|live)\b|t\.me/|wa\.me/|bit\.ly)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+\s*(@|\(at\)|\[at\])\s*[\w-]+\s*(\.|dot)\s*\w+", re.I)
HANDLE_RE = re.compile(r"(^|\s)@[A-Za-z0-9_]{3,}")
PHONE_RE = re.compile(r"(\+?\d[\d\s\-().]{7,}\d)")
CONTACT_WORDS = re.compile(r"\b(whats\s*app|whatsapp|telegram|t\s*\.\s*me|signal\s*group|dm\s*me|inbox\s*me)\b", re.I)


class CommunityError(Exception):
    def __init__(self, message, code="rules", status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _norm_word(w):
    w = unicodedata.normalize("NFKD", w.lower().translate(LEET))
    w = "".join(ch for ch in w if "a" <= ch <= "z")
    return re.sub(r"(.)\1+", r"\1", w)          # fuuuck -> fuck, chuttiya -> chutiya


def _bad_words():
    extra = {_norm_word(w) for w in (SiteSettings.load().community_blocked_words or "").splitlines() if w.strip()}
    return {_norm_word(w) for w in BAD_WORDS} | {w for w in extra if w}


def is_abusive(text, words=None):
    words = words or _bad_words()
    raw = [t for t in re.split(r"[\s,.;:()\[\]{}\"'/\\-]+", text) if t]
    # each word twice: with disguise letters read (sh!t, f*ck, b1tch) and with punctuation dropped (kutta!)
    seen = [_norm_word(t) for t in raw]
    plain_tokens = [_norm_word(re.sub(r"[^\w]", "", t)) for t in raw]
    if any(t and t in words for t in seen + plain_tokens):
        return True
    tokens = [t for t in plain_tokens if t]
    # spaced-out letters ("f u c k") and words split in two or three ("behen chod", "teri maa ki")
    run, singles = "", []
    for t in tokens + [""]:
        if len(t) == 1:
            run += t
        else:
            if len(run) >= 2:
                singles.append(run)
            run = ""
    if any(_norm_word(x) in words for x in singles):
        return True
    joined = [a + b for a, b in zip(tokens, tokens[1:])] + [a + b + c for a, b, c in zip(tokens, tokens[1:], tokens[2:])]
    if any(_norm_word(x) in words for x in joined):
        return True
    plain = re.sub(r"[\u064B-\u065F\u0670]", "", text)        # Urdu diacritics
    return any(w in plain for w in BAD_URDU)


def has_contact(text):
    digits = re.sub(r"\D", "", text)
    return bool(URL_RE.search(text) or EMAIL_RE.search(text) or HANDLE_RE.search(text) or CONTACT_WORDS.search(text)
                or (PHONE_RE.search(text) and len(digits) >= 8))


def profile_of(user):
    return ChatProfile.objects.filter(user=user).first()


def status(user):
    """What the app needs before showing the chat."""
    site = SiteSettings.load()
    p = profile_of(user)
    wait = max(0, int((user.date_joined + timedelta(minutes=site.community_wait_minutes) - timezone.now()).total_seconds()))
    return {
        "enabled": site.community_enabled, "rules": site.community_rules,
        "rooms": [{"key": k, "name": v} for k, v in ChatMessage.ROOMS],
        "nickname": p.nickname if p else "", "rules_accepted": bool(p and p.rules_accepted_at),
        "banned": bool(p and p.banned), "ban_reason": p.ban_reason if p and p.banned else "",
        "muted_until": p.muted_until.isoformat() if p and p.muted else None,
        "write_in_seconds": wait,
    }


def join(user, nickname, accept_rules):
    """Chooses the nickname (once) and accepts the rules. Returns the profile."""
    if not SiteSettings.load().community_enabled:
        raise CommunityError("The community is closed right now.", "closed", 403)
    if not accept_rules:
        raise CommunityError("Please read and accept the community rules first.", "rules_needed")
    p = profile_of(user)
    if p and p.banned:
        raise CommunityError("You are banned from the community." + (f" {p.ban_reason}" if p.ban_reason else ""),
                             "banned", 403)
    if p is None:
        nickname = (nickname or "").strip()
        if not NICK_RE.match(nickname):
            raise CommunityError("Nickname: 3-20 letters, numbers or _ (no spaces).", "nickname")
        low = nickname.lower()
        if any(r in low for r in RESERVED_NICKS) or is_abusive(nickname.replace("_", " ")) or is_abusive(nickname):
            raise CommunityError("Please choose another nickname.", "nickname")
        if ChatProfile.objects.filter(nickname__iexact=nickname).exists():
            raise CommunityError("This nickname is taken. Try another one.", "nickname")
        try:
            with transaction.atomic():
                p = ChatProfile.objects.create(user=user, nickname=nickname, rules_accepted_at=timezone.now())
        except IntegrityError:
            raise CommunityError("This nickname is taken. Try another one.", "nickname")
    elif not p.rules_accepted_at:
        p.rules_accepted_at = timezone.now()
        p.save(update_fields=["rules_accepted_at"])
    return p


def _row(m, me):
    return {"id": m.pk, "room": m.room, "nick": m.user.chat_profile.nickname if hasattr(m.user, "chat_profile") else "member",
            "text": m.text, "at": m.created_at.isoformat(), "mine": m.user_id == me.pk, "staff": m.user.is_staff}


def messages(user, room="general", after_id=0, before_id=0):
    """Newest PAGE messages of a room (or only newer than after_id, for polling)."""
    if room not in ROOMS:
        raise CommunityError("Unknown room.", "room")
    p = profile_of(user)
    if p and p.banned:
        raise CommunityError("You are banned from the community.", "banned", 403)
    qs = ChatMessage.objects.select_related("user", "user__chat_profile").filter(room=room, hidden=False)
    if after_id:
        rows = list(qs.filter(pk__gt=int(after_id)).order_by("pk")[:PAGE])
    else:
        if before_id:
            qs = qs.filter(pk__lt=int(before_id))
        rows = list(qs.order_by("-pk")[:PAGE])[::-1]
    return [_row(m, user) for m in rows]


def _strike(p, reason):
    ChatProfile.objects.filter(pk=p.pk).update(strikes=F("strikes") + 1)
    p.refresh_from_db()
    if p.strikes >= STRIKES_TO_MUTE:
        p.muted_until = timezone.now() + timedelta(minutes=MUTE_MINUTES)
        p.strikes = 0
        p.save(update_fields=["muted_until", "strikes"])
        raise CommunityError(f"{reason} You are muted for {MUTE_MINUTES} minutes after repeated rule breaks.", "muted", 403)
    raise CommunityError(reason, "rules")


def post(user, room, text):
    site = SiteSettings.load()
    if not site.community_enabled:
        raise CommunityError("The community is closed right now.", "closed", 403)
    if room not in ROOMS:
        raise CommunityError("Unknown room.", "room")
    p = profile_of(user)
    if p is None or not p.rules_accepted_at:
        raise CommunityError("Choose a nickname and accept the rules first.", "join_needed", 403)
    if p.banned:
        raise CommunityError("You are banned from the community.", "banned", 403)
    if p.muted:
        raise CommunityError(f"You are muted until {timezone.localtime(p.muted_until):%H:%M}.", "muted", 403)
    wait = (user.date_joined + timedelta(minutes=site.community_wait_minutes) - timezone.now()).total_seconds()
    if wait > 0:
        raise CommunityError(f"New accounts can write after {site.community_wait_minutes} minutes "
                             f"({int(wait // 60) + 1} min left). You can read already.", "wait", 403)
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if not text:
        raise CommunityError("Write a message first.", "empty")
    if len(text) > 500:
        raise CommunityError("Messages can be up to 500 characters.", "long")
    now = timezone.now()
    mine = ChatMessage.objects.filter(user=user)
    last = mine.order_by("-pk").first()
    if last and (now - last.created_at).total_seconds() < SLOW_SECONDS:
        raise CommunityError("Slow down a little: one message every 5 seconds.", "slow", 429)
    if mine.filter(created_at__gte=now - timedelta(minutes=BURST_MINUTES)).count() >= BURST_LIMIT:
        raise CommunityError("Too many messages. Take a short break.", "slow", 429)
    if last and last.text.lower() == text.lower() and (now - last.created_at).total_seconds() < 120:
        raise CommunityError("You already sent that.", "duplicate")
    if is_abusive(text):
        _strike(p, "Please keep it respectful: abusive language is not allowed (rule 2).")
    if has_contact(text):
        _strike(p, "Links, emails, phone numbers and @handles are not allowed (rules 3 and 4).")
    m = ChatMessage.objects.create(user=user, room=room, text=text)
    return _row(m, user)


def report(user, message_id, reason=""):
    m = ChatMessage.objects.filter(pk=int(message_id)).first()
    if m is None or m.hidden:
        raise CommunityError("Message not found.", "missing", 404)
    if m.user_id == user.pk:
        raise CommunityError("You can't report your own message.", "own")
    try:
        with transaction.atomic():
            ChatReport.objects.create(message=m, reporter=user, reason=(reason or "")[:120])
    except IntegrityError:
        return {"reported": True, "hidden": m.hidden}          # already reported by this user
    ChatMessage.objects.filter(pk=m.pk).update(reports=F("reports") + 1)
    m.refresh_from_db()
    if m.reports >= HIDE_AFTER_REPORTS and not m.hidden:
        m.hidden, m.hidden_reason = True, f"Hidden after {m.reports} reports"
        m.save(update_fields=["hidden", "hidden_reason"])
    return {"reported": True, "hidden": m.hidden}
