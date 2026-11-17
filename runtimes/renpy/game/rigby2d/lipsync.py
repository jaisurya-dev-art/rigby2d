# SPDX-License-Identifier: MIT OR Apache-2.0
"""Viseme lip-sync: speech timing (words, or mouth cues from other tools) turned into mouth shapes.

A port of the editor's ``src/core/lipsync.js``, so a character speaks the same in Ren'Py as in
Rigby2D. The mouth shapes (visemes) follow the 9-shape set animators use:

    A (ah), E (eh), I (ee, and most consonants: C D G K N R S T Y Z), O (oh), U (oo, w),
    MBP (lips closed), FV (lip on teeth), L (tongue up: L, TH), rest (silence).

Mouths land a little before their sound (``lead``), are held at least ``min_hold`` frames so they
never flicker, and close to ``rest`` in pauses.
"""

import json
import re
import unicodedata

VISEMES = ("A", "E", "I", "O", "U", "MBP", "FV", "L", "rest")
VOWELS = frozenset(("A", "E", "I", "O", "U"))

# Common words whose spelling misleads, as mouth shapes.
SAY = {
    "a": ["A"], "i": ["A", "I"], "i'm": ["A", "I", "MBP"], "i've": ["A", "I", "FV"], "i'll": ["A", "I", "L"],
    "hi": ["I", "A", "I"], "my": ["MBP", "A", "I"], "by": ["MBP", "A", "I"], "eye": ["A", "I"], "the": ["L", "A"],
    "are": ["A", "I"], "one": ["U", "A", "I"], "once": ["U", "A", "I", "I"], "two": ["I", "U"], "to": ["I", "U"],
    "too": ["I", "U"], "do": ["I", "U"], "who": ["U"], "you": ["I", "U"], "your": ["I", "O", "I"],
    "you're": ["I", "O", "I"], "what": ["U", "A", "I"], "where": ["U", "E", "I"], "was": ["U", "A", "I"],
    "said": ["I", "E", "I"], "says": ["I", "E", "I"], "have": ["A", "A", "FV"], "give": ["I", "I", "FV"],
    "live": ["L", "I", "FV"], "love": ["L", "A", "FV"], "come": ["I", "A", "MBP"], "some": ["I", "A", "MBP"],
    "done": ["I", "A", "I"], "gone": ["I", "O", "I"], "none": ["I", "A", "I"], "move": ["MBP", "U", "FV"],
    "lovely": ["L", "A", "FV", "L", "I"], "four": ["FV", "O", "I"], "bezier": ["MBP", "E", "I", "E", "I"],
    "through": ["L", "I", "U"], "though": ["L", "O"], "thought": ["L", "O", "I"], "laugh": ["L", "A", "FV"],
    "people": ["MBP", "I", "MBP", "L"], "again": ["A", "I", "E", "I"], "any": ["E", "I", "I"],
    "many": ["MBP", "E", "I", "I"], "been": ["MBP", "I", "I"], "could": ["I", "U", "I"], "would": ["U", "U", "I"],
    "should": ["I", "U", "I"], "of": ["A", "FV"], "now": ["I", "A", "U"], "how": ["A", "U"], "out": ["A", "U", "I"],
    "our": ["A", "U", "I"], "be": ["MBP", "I"], "he": ["I"], "she": ["I", "I"], "we": ["U", "I"], "me": ["MBP", "I"],
    "so": ["I", "O"], "no": ["I", "O"], "go": ["I", "O"], "ok": ["O", "I", "E", "I"], "okay": ["O", "I", "E", "I"],
    "oh": ["O"], "hmm": ["MBP"], "mm": ["MBP"], "uh": ["A"], "um": ["A", "MBP"], "yes": ["I", "E", "I"],
    "very": ["FV", "E", "I", "I"], "every": ["E", "FV", "I", "I"], "video": ["FV", "I", "I", "I", "O"],
    "audio": ["O", "I", "I", "O"], "idea": ["A", "I", "I", "I", "A"], "ready": ["I", "E", "I", "I"],
    "friend": ["FV", "I", "E", "I", "I"],
}

NUMBERS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")

# Spelling rules, most specific first: (pattern at the start of the rest of the word, shapes).
RULES = [(re.compile(p), shapes) for p, shapes in (
    (r"^tion", ["I", "U", "I"]),
    (r"^sion", ["I", "U", "I"]),
    (r"^igh", ["A", "I"]),
    (r"^ough", ["O"]),
    (r"^augh", ["O"]),
    (r"^eigh", ["E", "I"]),
    (r"^th", ["L"]),
    (r"^(sh|ch|tch|dg)", ["I"]),
    (r"^(ph|gh$)", ["FV"]),
    (r"^ck", ["I"]),
    (r"^qu", ["I", "U"]),
    (r"^wh", ["U"]),
    (r"^(oo|ew|ue)", ["U"]),
    (r"^(ou|ow)(?=[nd])", ["A", "U"]),
    (r"^(ow|oa|oe)", ["O"]),
    (r"^(ou)", ["A", "U"]),
    (r"^(au|aw)", ["O"]),
    (r"^(oi|oy)", ["O", "I"]),
    (r"^(ai|ay|ey)", ["E", "I"]),
    (r"^(ee|ea|ie|ei)", ["I"]),
    # A vowel, one consonant and a silent e: "made", "like", "home", "cute".
    (r"^a(?=[bcdfgklmnpstvz]e(?![a-z]))", ["E", "I"]),
    (r"^i(?=[bcdfgklmnpstvz]e(?![a-z]))", ["A", "I"]),
    (r"^o(?=[bcdfgklmnpstvz]e(?![a-z]))", ["O"]),
    (r"^u(?=[bcdfgklmnpstvz]e(?![a-z]))", ["I", "U"]),
    (r"^e$", []),  # a silent final e
    (r"^a", ["A"]),
    (r"^e", ["E"]),
    (r"^(i|y)", ["I"]),
    (r"^o", ["O"]),
    (r"^u", ["A"]),
    (r"^w", ["U"]),
    (r"^[mbp]", ["MBP"]),
    (r"^[fv]", ["FV"]),
    (r"^l", ["L"]),
    (r"^[cdgknrstxzqhj]", ["I"]),
)]

_DOUBLED = re.compile(r"([bcdfgklmnprstvz])\1")


def _merge(lst):
    """Repeated shapes merge: the mouth holds rather than flickering."""
    return [v for i, v in enumerate(lst) if i == 0 or v != lst[i - 1]]


def _normalize(raw):
    s = unicodedata.normalize("NFD", str(raw))
    s = "".join(ch for ch in s if not unicodedata.category(ch).startswith("M"))  # accents off
    s = s.lower().replace("’", "'").replace("‘", "'")
    return re.sub(r"[^a-z0-9'\-]", "", s)


def word_visemes(raw):
    """Mouth shapes for one word (letters, apostrophes and digits; anything else is ignored)."""
    key = _normalize(raw)
    if not key:
        return []
    if key in SAY:
        return _merge(SAY[key])
    # Hyphenated words and digits are spelled part by part ("lip-synced", "4k").
    if re.search(r"[-0-9]", key):
        parts = [p for p in re.split(r"[\s-]+", re.sub(r"(\d)", r" \1 ", key)) if p]
        out = []
        for p in parts:
            out.extend(word_visemes(NUMBERS[int(p)] if re.match(r"^\d$", p) else p))
        return _merge(out)
    out = []
    w = key.replace("'", "")
    # Doubled consonants sound once.
    w = _DOUBLED.sub(r"\1", w)
    while w:
        for pattern, shapes in RULES:
            m = pattern.match(w)
            if m:
                out.extend(shapes)
                w = w[len(m.group(0)) or 1:]
                break
        else:
            w = w[1:]
    return _merge(out)


def tidy(cues, hold_t=0.0):
    """Sorts cues ``[(time, viseme)]``, drops repeats and folds cues shorter than ``hold_t`` into
    their neighbour."""
    out = []
    for time, viseme in sorted(cues, key=lambda c: c[0]):
        if out and viseme == out[-1][1]:
            continue
        if out and time - out[-1][0] < hold_t - 1e-9 and len(out) > 1:
            # Keep the vowel when a short consonant and a vowel compete for the same frames.
            if viseme in VOWELS and out[-1][1] not in VOWELS:
                out[-1] = (out[-1][0], viseme)
            continue
        out.append((time, viseme))
    # Folding can leave neighbours equal: merge them.
    return [c for i, c in enumerate(out) if i == 0 or c[1] != out[i - 1][1]]


def viseme_cues(words, fps=30.0, lead=2, min_hold=2, rest_gap=0.14):
    """Mouth cues from timed words ``[(word, start, end)]`` (seconds) -> ``[(time, viseme)]``."""
    lead_t = lead / float(fps)
    hold_t = min_hold / float(fps)
    out = []
    timed = sorted([w for w in words if w[1] == w[1] and w[2] == w[2]], key=lambda w: w[1])
    for i, (word, start, end) in enumerate(timed):
        shapes = word_visemes(word)
        if not shapes:
            continue
        # Vowels hold longer than consonants.
        weights = [1.6 if v in VOWELS else 1.0 for v in shapes]
        total = sum(weights)
        span = max(hold_t * len(shapes), end - start)
        t = start
        for k, v in enumerate(shapes):
            out.append((t - lead_t, v))
            t += span * weights[k] / total
        nxt = timed[i + 1] if i + 1 < len(timed) else None
        if nxt is None or nxt[1] - end > rest_gap:
            out.append((end - lead_t + 1.0 / fps, "rest"))
    return tidy(out, hold_t)


_WORD_RE = re.compile(r"\S+")
_PAUSE_RE = re.compile(r"[,;:]$")
_STOP_RE = re.compile(r"[.!?…]+[\"')\]]*$")


def time_text(text, duration=None, cps=14.0, pause=0.18, stop=0.32):
    """Times a line of dialogue: words in order, each taking time in proportion to its mouth shapes,
    with short pauses after commas and longer ones after full stops. When ``duration`` is given
    (the length of the voice clip), the timing is stretched to fill it; otherwise words are timed
    at ``cps`` characters per second. Returns ``[(word, start, end)]``."""
    words = [w for w in _WORD_RE.findall(strip_text_tags(text)) if word_visemes(w)]
    if not words:
        return []
    out = []
    t = 0.0
    for w in words:
        length = max(len(_normalize(w)), 1) / float(cps)
        length = max(length, 0.12)
        out.append([w, t, t + length])
        t += length
        if _STOP_RE.search(w):
            t += stop
        elif _PAUSE_RE.search(w):
            t += pause
        else:
            t += 0.04
    total = out[-1][2]
    if duration is not None and duration > 0.0 and total > 0.0:
        f = duration / total
        out = [[w, s * f, e * f] for w, s, e in out]
    return [tuple(w) for w in out]


_TAG_RE = re.compile(r"\{[^{}]*\}")


def strip_text_tags(text):
    """Text without Ren'Py text tags (``{b}``, ``{w=0.5}``) and with ``{{`` read as ``{``."""
    return _TAG_RE.sub("", str(text).replace("{{", "\x00")).replace("\x00", "{")


# ---- timing files ---------------------------------------------------------------------------------------------

# Rhubarb Lip Sync's mouth shapes as visemes.
RHUBARB = {"A": "MBP", "B": "I", "C": "E", "D": "A", "E": "O", "F": "U", "G": "FV", "H": "L", "X": "rest"}
# Papagayo / Moho phonemes as visemes.
PAPAGAYO = {"AI": "A", "E": "E", "O": "O", "U": "U", "etc": "I", "L": "L", "WQ": "U", "MBP": "MBP", "FV": "FV", "rest": "rest"}


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float("nan")
    return f


def _words_from_characters(a):
    chars = a.get("characters") or []
    starts = a.get("character_start_times_seconds") or []
    ends = a.get("character_end_times_seconds") or []
    words = []
    cur = None
    for i, ch in enumerate(chars):
        if ch.isspace():
            if cur:
                words.append(cur)
            cur = None
            continue
        if cur is None:
            cur = [ "", _num(starts[i]) if i < len(starts) else float("nan"), _num(ends[i]) if i < len(ends) else float("nan")]
        cur[0] += ch
        cur[2] = _num(ends[i]) if i < len(ends) else cur[2]
    if cur:
        words.append(cur)
    return [tuple(w) for w in words if re.search(r"[a-z0-9]", w[0], re.I)]


def _words_from_json(o):
    al = None
    if isinstance(o, dict):
        al = o.get("normalized_alignment") or o.get("alignment") or (o if isinstance(o.get("characters"), list) else None)
    if isinstance(al, dict) and al.get("characters"):
        return _words_from_characters(al)
    if isinstance(o, list):
        lst = o
    elif isinstance(o, dict):
        lst = o.get("words") or o.get("chunks")
        if lst is None and isinstance(o.get("segments"), list):
            lst = [w for s in o["segments"] for w in (s.get("words") or [])]
    else:
        lst = None
    if isinstance(lst, list):
        out = []
        for w in lst:
            if not isinstance(w, dict):
                continue
            word = str(w.get("word", w.get("text", "")) or "").strip()
            ts = w.get("timestamp") or [None, None]
            start = _num(w.get("start", w.get("start_time", ts[0] if len(ts) > 0 else None)))
            end = _num(w.get("end", w.get("end_time", ts[1] if len(ts) > 1 else None)))
            if word and start == start and end == end:
                out.append((word, start, end))
        return out
    return None


def read_timing(text, papagayo_fps=24.0):
    """Reads a timing file: ElevenLabs timestamps JSON, word-timing JSON (including Whisper output),
    Rhubarb Lip Sync (TSV or JSON) or a Papagayo/Moho switch file. Returns ``("words", [(word,
    start, end)])`` or ``("cues", [(time, viseme)])``; raises ValueError when not understood."""
    src = str(text).lstrip("﻿").strip()
    if re.match(r"^MohoSwitch1", src, re.I):
        cues = []
        for line in src.splitlines()[1:]:
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            frame, ph = parts[0], parts[1]
            cues.append((max(0.0, (_num(frame) - 1) / papagayo_fps), PAPAGAYO.get(ph) or PAPAGAYO.get(ph.upper()) or "I"))
        if not cues:
            raise ValueError("The Papagayo file has no mouth keys.")
        return ("cues", tidy(cues))
    if src[:1] in ("[", "{"):
        o = json.loads(src)
        if isinstance(o, dict) and isinstance(o.get("mouthCues"), list):
            return ("cues", tidy([(_num(c.get("start")), RHUBARB.get(c.get("value"), "I")) for c in o["mouthCues"]]))
        words = _words_from_json(o)
        if words:
            return ("words", words)
        raise ValueError("No word timings found in this JSON.")
    rows = [l.strip().split() for l in src.splitlines()]
    rows = [r for r in rows if len(r) >= 2 and _num(r[0]) == _num(r[0])]
    if rows and all(r[1] in RHUBARB for r in rows):
        return ("cues", tidy([(_num(r[0]), RHUBARB[r[1]]) for r in rows]))
    raise ValueError("Not a timing file Rigby2D reads (ElevenLabs or word-timing JSON, Rhubarb, Papagayo).")


# ---- mouths ---------------------------------------------------------------------------------------------------------

# Name tokens that mean each mouth shape, best first.
MOUTH_WORDS = {
    "A": ["a", "ai", "ah", "aa", "open"],
    "E": ["e", "eh"],
    "I": ["i", "ee", "etc", "cdgknrstxyz", "consonant", "consonants", "teeth", "half"],
    "O": ["o", "oh"],
    "U": ["u", "oo", "w", "wq", "ou"],
    "MBP": ["mbp", "m", "b", "p", "closed"],
    "FV": ["fv", "f", "v"],
    "L": ["l", "th", "tongue"],
    "rest": ["rest", "neutral", "smile", "idle", "x", "closed"],
}


def match_mouths(names):
    """Picks an image for each mouth shape from a mouth slot's attachment names, by name
    ("mouth_viseme_A", "A", "ah", "MBP", "mouth_closed"...). Returns ``{viseme: name or None}``."""
    tokens = [(n, [t for t in re.split(r"[^a-z0-9]+", str(n).lower()) if t]) for n in names]
    used = set()
    out = {}
    # Viseme-labelled images first, so "mouth_viseme_A" wins over "mouth_open" for A.
    for v in VISEMES:
        best = None
        for rank, word in enumerate(MOUTH_WORDS[v]):
            hit = None
            for n, t in tokens:
                if n not in used and t and t[-1] == word and "viseme" in t:
                    hit = n
                    break
            if hit is None:
                for n, t in tokens:
                    if n not in used and t and t[-1] == word:
                        hit = n
                        break
            if hit is not None and (best is None or rank < best[0]):
                best = (rank, hit)
            if best is not None and best[0] == 0:
                break
        out[v] = best[1] if best is not None else None
        if best is not None and v != "rest":
            used.add(best[1])
    return out


class Track(object):
    """Mouth cues being spoken: ``viseme_at(t)`` gives the shape at ``t`` seconds into the line."""

    def __init__(self, cues):
        self.cues = list(cues)
        self.end = self.cues[-1][0] if self.cues else 0.0

    def viseme_at(self, t):
        shape = "rest"
        for time, v in self.cues:
            if time > t:
                break
            shape = v
        return shape

    @staticmethod
    def from_text(text, duration=None, cps=14.0, fps=30.0):
        return Track(viseme_cues(time_text(text, duration, cps), fps=fps))

    @staticmethod
    def from_timing(text, fps=30.0):
        kind, data = read_timing(text)
        if kind == "cues":
            return Track(data)
        return Track(viseme_cues(data, fps=fps))
