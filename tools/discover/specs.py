"""Rule-based extraction of catalogue facts from spec text, keeping the snippet each value
came from.

Every candidate records its source line verbatim. Lines that name a different model than
the product (a retailer page for the S100 quoting the S10's current draw) are kept, but with
low confidence and a note, so the reviewer sees the trap instead of a wrong value.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

NUM = r"(\d+(?:[.,]\d+)?)"
X = r"\s*[x×*]\s*"


def num(s: str) -> float:
    return float(s.replace(",", "."))


@dataclass
class Candidate:
    #: Catalogue field path: front.cutout, front.bezel, front.protrusion, rear.depth, rear.body,
    #: weightG, power.currentA, power.voltage, power.supplyV, connectors.types, connectors.pinout
    path: str
    value: Any
    snippet: str
    source: str
    url: str
    confidence: float
    method: str
    unit: str | None = None
    page: int | None = None
    note: str | None = None

    def to_json(self) -> dict:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


@dataclass
class Context:
    source: str
    url: str
    model: str
    #: Other model names that may appear in the same text (siblings in a range).
    others: list[str] = field(default_factory=list)
    page: int | None = None
    #: Manuals are first-hand; retailer text is second-hand.
    base: float = 0.6


def split_lines(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Sentences, without splitting decimals ("2.5 W") or abbreviations before digits.
        out.extend(s.strip() for s in re.split(r"(?<=[.!?;])\s+(?=[A-Z])", line) if s.strip())
    return out


def model_pattern(model: str) -> re.Pattern[str]:
    """Matches a model name as a whole token: S10 does not match S100; 'LX 9070' matches 'LX9070'."""
    tokens = [re.escape(t) for t in re.split(r"[\s-]+", model.strip()) if t]
    return re.compile(r"(?<![A-Za-z0-9])" + r"[\s-]?".join(tokens) + r"(?![A-Za-z0-9])", re.I)


MODEL_CODE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{1,4}-?\d{1,4}[A-Z]{0,2})(?![A-Za-z0-9])")


def siblings(line: str, model: str) -> list[str]:
    """Model-like codes in a line that share our model's letter prefix but are not it
    (S8D or S10 on an S100 page), whether or not the adapter knows them."""
    m = re.match(r"[A-Za-z]{1,4}", model.strip())
    if not m or not re.search(r"\d", model):
        return []
    prefix = m[0].upper()
    own = model_pattern(model)
    out = []
    for code in MODEL_CODE.findall(line):
        if code.upper().startswith(prefix) and not own.fullmatch(code) and code.upper() != model.upper().replace(" ", ""):
            out.append(code)
    return out


def named_models(text: str, ctx: Context) -> tuple[bool, list[str]]:
    own = bool(model_pattern(ctx.model).search(text)) if ctx.model else False
    named = [o for o in ctx.others if o.lower() != ctx.model.lower() and model_pattern(o).search(text) and not (own and model_pattern(o).pattern in model_pattern(ctx.model).pattern)]
    for sib in siblings(text, ctx.model):
        if not any(model_pattern(n).fullmatch(sib) for n in named):
            named.append(sib)
    # A known sibling that only matched inside our own name (S10 in "S100") does not count.
    named = [n for n in named if not (own and model_pattern(n).search(model_pattern(ctx.model).sub("", text)) is None)]
    return own, named


def scope(text: str, ctx: Context) -> tuple[float, str | None]:
    """Confidence adjustment and note for text, by which models it names."""
    own, named = named_models(text, ctx)
    if named and not own:
        return 0.3, f"This line names {', '.join(named)}, not {ctx.model}; it may not apply."
    if named and own:
        return 0.8, f"This line names {ctx.model} and {', '.join(named)}; check which figure is which."
    if own:
        return 1.15, None
    return 1.0, None


def segments(line: str, ctx: Context) -> list[str]:
    """Split a line that gives figures for several models ("Depth: S100 98 mm, S80 101 mm")
    into one piece per model, each keeping the line's label. Other lines come back whole."""
    names = [ctx.model, *ctx.others, *siblings(line, ctx.model)]
    marks = sorted({m.start() for n in names if n for m in model_pattern(n).finditer(line)})
    if len(marks) < 2:
        return [line]
    label = line[: marks[0]].strip()
    pieces = [line[a:b].strip(" ,;") for a, b in zip(marks, [*marks[1:], len(line)])]
    if not label:
        return [line]
    return [f"{label} {p}" for p in pieces]


def _mk_scoped(path, value, line, ctx: Context, conf, method, unit=None, note=None, scoped: str | None = None) -> Candidate:
    k, scope_note = scope(scoped if scoped is not None else line, ctx)
    notes = "; ".join(n for n in (note, scope_note) if n) or None
    return Candidate(path, value, line, ctx.source, ctx.url, round(min(0.95, conf * k), 2), method, unit, ctx.page, notes)


CONNECTORS = re.compile(
    r"(?<![A-Za-z0-9])(RJ-?45|RJ-?12|RJ-?11|D-?Sub\s?-?\d{1,2}|DB-?\d{1,2}|DE-?9|Mini-?USB|Micro-?USB|USB-?C|SMA|BNC|TNC|Molex(?:\s+Micro-?Fit|\s+Mini-?Fit)?|JST(?:-[A-Z]{2})?|Deutsch|M12)(?![A-Za-z0-9])",
    re.I,
)


def extract(text: str, ctx: Context) -> list[Candidate]:
    out: list[Candidate] = []
    for full in split_lines(text):
        for seg in segments(full, ctx):
            out.extend(_extract_line(seg, full, ctx))
    return dedupe(out)


def _extract_line(line: str, snippet: str, ctx: Context) -> list[Candidate]:
    """Candidates from one line (or one model's piece of it); `snippet` is the full line."""
    out: list[Candidate] = []
    b = ctx.base

    def mk(path, value, _line, ctx_, conf, method, unit=None, note=None) -> Candidate:
        # Matched on this line's piece, scoped by the model it names; the snippet is the whole line.
        return _mk_scoped(path, value, snippet, ctx_, conf, method, unit, note, line)


    low = line.lower()
    # ---- cutouts
    for m in re.finditer(r"(?:cut-?\s?out|panel\s+cut|panel\s+hole|mounting\s+hole|hole)[^0-9\n]{0,25}" + NUM + X + NUM + r"\s*mm", line, re.I):
        out.append(mk("front.cutout", {"kind": "rect", "w": num(m[1]), "h": num(m[2])}, line, ctx, b + 0.15, "rule:cutout-rect", "mm"))
    for m in re.finditer(r"(?:cut-?\s?out|panel\s+hole|mounting\s+hole|hole)[^0-9\n]{0,25}(?:Ø|ø|⌀|dia(?:meter)?\.?\s*)?" + NUM + r"\s*mm(?!\s*[x×*])", line, re.I):
        out.append(mk("front.cutout", {"kind": "circle", "d": num(m[1])}, line, ctx, b + 0.15, "rule:cutout-circle", "mm"))
    for m in re.finditer(NUM + r"\s*mm\s+(?:panel\s+)?(?:hole|cut-?\s?out)", line, re.I):
        out.append(mk("front.cutout", {"kind": "circle", "d": num(m[1])}, line, ctx, b + 0.1, "rule:cutout-circle", "mm"))
    for m in re.finditer(r"(?:standard\s+)?" + r"(57|58|80|81)\s*mm\s+(?:instrument|panel|housing|size|hole|version)", line, re.I):
        out.append(mk("front.cutout", {"kind": "circle", "d": num(m[1])}, line, ctx, b, "rule:instrument-size", "mm", "Standard instrument size; the cutout is usually this diameter."))
    # ---- overall dimensions W × H × D
    for m in re.finditer(NUM + X + NUM + X + NUM + r"\s*mm", line, re.I):
        w, h, d = num(m[1]), num(m[2]), num(m[3])
        labelled = bool(re.search(r"dimension|size|w\s*x\s*h\s*x\s*d|\(w", low))
        c = b + (0.05 if labelled else -0.1)
        out.append(mk("front.bezel", {"kind": "rect", "w": w, "h": h}, line, ctx, c, "rule:dims-whd", "mm", "First two figures of W × H × D, taken as the front face."))
        out.append(mk("rear.depth", d, line, ctx, c - 0.05, "rule:dims-whd", "mm", "Third figure of W × H × D. Check whether it is depth behind the panel or overall."))
    for m in re.finditer(r"depth[^\n]{0,40}?(?<![\d.,])" + NUM + r"\s*mm(?!\s*[x×*])", line, re.I):
        behind = "behind" in low or "panel" in low
        out.append(mk("rear.depth", num(m[1]), line, ctx, b + (0.2 if behind else 0.1), "rule:depth", "mm"))
    for m in re.finditer(r"(?:protrud\w*|projects?|in front of the panel)[^0-9\n]{0,30}" + NUM + r"\s*mm", line, re.I):
        out.append(mk("front.protrusion", num(m[1]), line, ctx, b + 0.1, "rule:protrusion", "mm"))
    # ---- weight
    for m in re.finditer(NUM + r"\s*(kg|g|grams?)(?![A-Za-z])", line, re.I):
        g = num(m[1]) * (1000 if m[2].lower() == "kg" else 1)
        near = bool(re.search(r"weigh|mass", low))
        if not near and m[2].lower() == "g" and g < 20:
            continue
        out.append(mk("weightG", g, line, ctx, b + (0.15 if near else -0.15), "rule:weight", "g"))
    # ---- power
    power_words = bool(re.search(r"current|consumption|draw|power|supply|@|\bat\b", low))
    for m in re.finditer(NUM + r"\s*(mA|A)(?![A-Za-z])(?:[^0-9\n]{0,12}(?:at|@)\s*" + NUM + r"\s*V)?", line):
        a = num(m[1]) / (1000 if m[2] == "mA" else 1)
        if not power_words:
            continue
        out.append(mk("power.currentA", a, line, ctx, b + 0.1, "rule:current", "A"))
        if m[3]:
            out.append(mk("power.voltage", num(m[3]), line, ctx, b, "rule:current-at-voltage", "V", "The voltage the current was quoted at."))
    for m in re.finditer(NUM + r"\s*W(?![A-Za-z])[^0-9\n]{0,12}(?:at|@)\s*" + NUM + r"\s*V", line):
        w, v = num(m[1]), num(m[2])
        out.append(mk("power.currentA", round(w / v, 4), line, ctx, b, "rule:power-at-voltage", "A", f"Worked out as {w} W ÷ {v} V."))
        out.append(mk("power.voltage", v, line, ctx, b - 0.05, "rule:power-at-voltage", "V"))
    for m in re.finditer(NUM + r"\s*(?:-|–|to)\s*" + NUM + r"\s*V(?:\s*DC)?(?![A-Za-z])", line):
        out.append(mk("power.supplyV", {"min": num(m[1]), "max": num(m[2])}, line, ctx, b, "rule:supply-range", "V", "Supply range; for reference, not a catalogue field."))
    # ---- connectors
    types = sorted({re.sub(r"\s+", " ", c.upper().replace("-", "")) for c in CONNECTORS.findall(line)})
    if types:
        out.append(mk("connectors.types", types, line, ctx, b - 0.1, "rule:connector-names", note="Connector types named in the text; pinouts come from manuals."))
    return out


def dedupe(cands: list[Candidate]) -> list[Candidate]:
    """One candidate per (path, value, source, snippet): keep the most confident."""
    best: dict[tuple, Candidate] = {}
    for c in cands:
        k = (c.path, repr(c.value), c.source, c.snippet)
        if k not in best or c.confidence > best[k].confidence:
            best[k] = c
    return list(best.values())


# ---------------------------------------------------------------- pinout tables

SIGNALS = [
    (re.compile(r"\b(gnd|ground|0\s?v|minus|-ve)\b", re.I), "ground"),
    (re.compile(r"(\+\s?12|\+\s?\d+\s?v|power|vcc|supply|\bv\+|\+ve|ub\b|battery)", re.I), "power"),
    (re.compile(r"\b(tx|rx|rs-?232|rs-?485|nmea|data)\b", re.I), "serial"),
    (re.compile(r"\b(can[-_ ]?h|can[-_ ]?l|can)\b", re.I), "bus"),
    (re.compile(r"\b(audio|speaker|mic|phone|headset|ptt)\b", re.I), "audio"),
    (re.compile(r"\b(antenna|rf|coax)\b", re.I), "rf"),
]


def signal_of(function: str) -> str:
    for rx, sig in SIGNALS:
        if rx.search(function):
            return sig
    return "other"


def direction_of(function: str) -> str | None:
    f = function.lower()
    if re.search(r"\btx\b|transmit|output|\bout\b", f):
        return "out"
    if re.search(r"\brx\b|receive|input|\bin\b", f):
        return "in"
    return None


def pinout_from_rows(rows: list[list[str | None]]) -> list[dict] | None:
    """Pins from a table: one column of pin numbers, one of functions. None if it isn't a pinout."""
    clean = [[(c or "").strip() for c in r] for r in rows if r and any(c for c in r)]
    if len(clean) < 3:
        return None
    width = max(len(r) for r in clean)
    pin_col = None
    for c in range(width):
        vals = [r[c] if c < len(r) else "" for r in clean]
        hits = sum(1 for v in vals if re.fullmatch(r"(pin\s*)?\d{1,2}[a-z]?", v, re.I))
        if hits >= max(3, len(clean) * 0.6):
            pin_col = c
            break
    if pin_col is None:
        return None
    pins = []
    for r in clean:
        n = r[pin_col] if pin_col < len(r) else ""
        mm = re.fullmatch(r"(?:pin\s*)?(\d{1,2}[a-z]?)", n, re.I)
        if not mm:
            continue
        func = " ".join(x for i, x in enumerate(r) if i != pin_col and x).strip()
        pin = {"number": mm[1], "function": func or "?", "signal": signal_of(func)}
        d = direction_of(func)
        if d:
            pin["direction"] = d
        pins.append(pin)
    return pins if len(pins) >= 3 else None
