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

from .models import ChatMessage, ChatProfile, ChatReport, Idea, IdeaComment, IdeaLike, IdeaReport, SiteSettings

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


# ── ideas: chart pictures with the author's view, likes and comments ─────────────────────────────
IDEA_PAGE = 20
IMAGE_MAX, THUMB_MAX, CHART_MAX = 450_000, 70_000, 60_000      # bytes of the data URLs / chart JSON
IDEAS_PER_DAY = 10
SYMBOL_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,30}$")


def _member(user, action="post"):
    """The poster's profile: the same nickname, rules, wait time, bans and mutes as the chat."""
    site = SiteSettings.load()
    if not site.community_enabled:
        raise CommunityError("The community is closed right now.", "closed", 403)
    p = profile_of(user)
    if p is None or not p.rules_accepted_at:
        raise CommunityError("Choose a nickname and accept the rules first.", "join_needed", 403)
    if p.banned:
        raise CommunityError("You are banned from the community.", "banned", 403)
    if p.muted:
        raise CommunityError(f"You are muted until {timezone.localtime(p.muted_until):%H:%M}.", "muted", 403)
    wait = (user.date_joined + timedelta(minutes=site.community_wait_minutes) - timezone.now()).total_seconds()
    if wait > 0:
        raise CommunityError(f"New accounts can {action} after {site.community_wait_minutes} minutes "
                             f"({int(wait // 60) + 1} min left).", "wait", 403)
    return p


def _clean(p, text, what):
    if is_abusive(text):
        _strike(p, f"Please keep it respectful: abusive language is not allowed in the {what} (rule 2).")
    if has_contact(text):
        _strike(p, f"Links, emails, phone numbers and @handles are not allowed in the {what} (rules 3 and 4).")


def _nick(user):
    p = getattr(user, "chat_profile", None)
    return p.nickname if p else "member"


def idea_row(i, me=None, full=False):
    row = {"id": i.pk, "title": i.title, "symbol": i.symbol, "timeframe": i.timeframe, "direction": i.direction,
           "nick": _nick(i.user), "staff": i.user.is_staff, "at": i.created_at.isoformat(), "likes": i.likes,
           "views": i.views, "comments": i.comments_count, "thumb": i.thumb, "mine": bool(me and i.user_id == me.pk),
           "liked": bool(me and IdeaLike.objects.filter(idea=i, user=me).exists()),
           "excerpt": i.body[:160]}
    if full:
        import json
        try:
            chart = json.loads(i.chart) if i.chart else None
        except ValueError:
            chart = None
        row.update(body=i.body, image=i.image, chart=chart,
                   comment_list=[{"id": c.pk, "nick": _nick(c.user), "staff": c.user.is_staff, "text": c.text,
                                  "at": c.created_at.isoformat(), "mine": bool(me and c.user_id == me.pk)}
                                 for c in i.comment_set.select_related("user", "user__chat_profile").filter(hidden=False)])
    return row


def ideas(me=None, symbol="", sort="new", page=1, mine=False):
    qs = Idea.objects.select_related("user", "user__chat_profile").filter(hidden=False).defer("image", "chart")
    if symbol:
        qs = qs.filter(symbol__iexact=symbol.split(":")[-1])
    if mine and me is not None:
        qs = qs.filter(user=me)
    qs = qs.order_by("-likes", "-created_at") if sort == "top" else qs.order_by("-created_at")
    page = max(1, int(page or 1))
    rows = list(qs[(page - 1) * IDEA_PAGE: page * IDEA_PAGE + 1])
    return {"ideas": [idea_row(i, me) for i in rows[:IDEA_PAGE]], "more": len(rows) > IDEA_PAGE, "page": page}


def idea(me, idea_id):
    i = Idea.objects.select_related("user", "user__chat_profile").filter(pk=int(idea_id), hidden=False).first()
    if i is None:
        raise CommunityError("Idea not found.", "missing", 404)
    Idea.objects.filter(pk=i.pk).update(views=F("views") + 1)
    i.views += 1
    return idea_row(i, me, full=True)


def _picture(value, limit, what):
    value = str(value or "")
    if not value:
        return ""
    if not value.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
        raise CommunityError(f"The {what} must be a JPEG, PNG or WebP picture.", "image")
    if len(value) > limit:
        raise CommunityError(f"The {what} is too big.", "image")
    return value


def post_idea(user, data):
    p = _member(user, "share ideas")
    import json
    title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip()
    text = str(data.get("body") or "").strip()
    symbol = str(data.get("symbol") or "").strip().split(":")[-1].upper()
    tf = str(data.get("timeframe") or "").strip()[:8]
    direction = str(data.get("direction") or Idea.NEUTRAL)
    if len(title) < 5:
        raise CommunityError("Give the idea a title (5-100 characters).", "title")
    if len(title) > 100 or len(text) > 2000:
        raise CommunityError("Title up to 100 characters, description up to 2000.", "long")
    if not SYMBOL_RE.match(symbol):
        raise CommunityError("Pick the symbol of the idea.", "symbol")
    if direction not in dict(Idea.DIRECTIONS):
        direction = Idea.NEUTRAL
    image = _picture(data.get("image"), IMAGE_MAX, "chart picture")
    thumb = _picture(data.get("thumb"), THUMB_MAX, "small picture")
    if not image:
        raise CommunityError("Add a chart picture.", "image")
    chart = data.get("chart")
    chart = json.dumps(chart)[:CHART_MAX] if isinstance(chart, dict) else ""
    if Idea.objects.filter(user=user, created_at__gte=timezone.now() - timedelta(days=1)).count() >= IDEAS_PER_DAY:
        raise CommunityError(f"Up to {IDEAS_PER_DAY} ideas a day.", "slow", 429)
    _clean(p, f"{title} {text}", "idea")
    i = Idea.objects.create(user=user, title=title, body=text, symbol=symbol, timeframe=tf, direction=direction,
                            image=image, thumb=thumb or image if len(image) <= THUMB_MAX else thumb, chart=chart)
    return idea_row(i, user, full=True)


def like_idea(user, idea_id):
    _member(user, "like ideas")
    i = Idea.objects.filter(pk=int(idea_id), hidden=False).first()
    if i is None:
        raise CommunityError("Idea not found.", "missing", 404)
    gone = IdeaLike.objects.filter(idea=i, user=user).delete()[0]
    if gone:
        Idea.objects.filter(pk=i.pk, likes__gt=0).update(likes=F("likes") - 1)
    else:
        try:
            with transaction.atomic():
                IdeaLike.objects.create(idea=i, user=user)
            Idea.objects.filter(pk=i.pk).update(likes=F("likes") + 1)
        except IntegrityError:
            pass
    i.refresh_from_db()
    return {"liked": not gone, "likes": i.likes}


def comment_idea(user, idea_id, text):
    p = _member(user, "comment")
    i = Idea.objects.filter(pk=int(idea_id), hidden=False).first()
    if i is None:
        raise CommunityError("Idea not found.", "missing", 404)
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if not text:
        raise CommunityError("Write a comment first.", "empty")
    if len(text) > 500:
        raise CommunityError("Comments can be up to 500 characters.", "long")
    last = IdeaComment.objects.filter(user=user).order_by("-pk").first()
    if last and (timezone.now() - last.created_at).total_seconds() < SLOW_SECONDS:
        raise CommunityError("Slow down a little: one comment every 5 seconds.", "slow", 429)
    _clean(p, text, "comment")
    c = IdeaComment.objects.create(idea=i, user=user, text=text)
    Idea.objects.filter(pk=i.pk).update(comments_count=F("comments_count") + 1)
    return {"id": c.pk, "nick": _nick(user), "staff": user.is_staff, "text": c.text, "at": c.created_at.isoformat(), "mine": True}


def delete_idea(user, idea_id):
    i = Idea.objects.filter(pk=int(idea_id), hidden=False).first()
    if i is None or (i.user_id != user.pk and not user.is_staff):
        raise CommunityError("Idea not found.", "missing", 404)
    i.hidden, i.hidden_reason = True, "Deleted by the author" if i.user_id == user.pk else f"Deleted by {user}"
    i.save(update_fields=["hidden", "hidden_reason"])
    return {"deleted": True}


def report_idea(user, idea_id):
    i = Idea.objects.filter(pk=int(idea_id), hidden=False).first()
    if i is None:
        raise CommunityError("Idea not found.", "missing", 404)
    if i.user_id == user.pk:
        raise CommunityError("You can't report your own idea.", "own")
    try:
        with transaction.atomic():
            IdeaReport.objects.create(idea=i, reporter=user)
    except IntegrityError:
        return {"reported": True}
    Idea.objects.filter(pk=i.pk).update(reports=F("reports") + 1)
    i.refresh_from_db()
    if i.reports >= HIDE_AFTER_REPORTS:
        i.hidden, i.hidden_reason = True, f"Hidden after {i.reports} reports"
        i.save(update_fields=["hidden", "hidden_reason"])
    return {"reported": True}
