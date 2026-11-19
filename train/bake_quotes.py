#!/usr/bin/env python3
"""Bake framed Gemma whole-word paths; run with mlx-lm==0.32.2, offline.

Needs the model already downloaded to the Hugging Face cache (HF_HOME, default ~/.cache/huggingface)
or pass --snapshot DIR. Usage: python3 train/bake_quotes.py --out puzzle/quotes.json
"""
import argparse
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import sys
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

MODEL = "mlx-community/gemma-4-26b-a4b-it-6bit"
REVISION = "968a9faa4b69230f3fc316b5755cb937a29c7ddc"
HF_HOME = Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface"))
SNAPSHOT = HF_HOME / "hub/models--mlx-community--gemma-4-26b-a4b-it-6bit/snapshots" / REVISION
REVIEWED = True
DISTRACTORS = 11
MLX_LM_VERSION = "0.32.2"
FRAME = '<bos><|turn>user\nComplete this famous quotation exactly: {quote}<turn|>\n<|turn>model\n<|channel>thought\n<channel|>"{quote}'
# Keys are zero-based step indexes. Lead-approved exclusions, shared by both models.
EXCLUDES = {"hamlet": {0: ["de", "bi"]}, "cogito": {0: ["de", "l"], 1: ["exist", "exists", "de"]}, "stage": {0: ["stagy", "sstage"]}, "fear": {2: ["itelf"]}, "liberty": {0: ["eller", "oder", "atau"], 2: ["deat", "em"]}, "apollo": {4: ["humankind", "humanity", "humanidad"]}, "socrates": {0: ["de"], 1: ["de", "nicht"], 2: ["de"], 3: ["de"]}, "dickens": {1: ["ws"], 4: ["de"]}, "jfk": {1: ["apa"], 3: ["dapat", "kann", "de", "con"], 4: ["de", "con"], 5: ["para", "de"], 6: ["votre"]}, "caesar": {0: ["de"], 1: ["unto", "render"], 5: ["yang", "which"], 6: ["belong"]}, "violent": {0: ["haben", "hanno"], 2: ["deat"]}}
AUTO_EXCLUDES = {'26b-chat': {'hamlet': {0: {'mbe': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'cogito': {0: {'sum': 'non-English token in English quotation', 'ergo': 'non-English token in English quotation'}, 1: {'m': 'fragment / abbreviation / typo'}}, 'stage': {0: {'etapa': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'fear': {0: {}, 1: {}, 2: {'fucking': 'profanity / slur', 'x': 'fragment / abbreviation / typo'}}, 'liberty': {0: {'ou': 'non-English token in English quotation'}, 1: {}, 2: {}, 3: {}}, 'apollo': {0: {}, 1: {}, 2: {}, 3: {}, 4: {'manhkind': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'socrates': {0: {'es': 'non-English token in English quotation'}, 1: {'nt': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'nnot': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {}, 3: {'lving': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'gettysburg': {0: {}, 1: {}, 2: {}}, 'dickens': {0: {'de': 'non-English token in English quotation'}, 1: {'vs': 'fragment / abbreviation / typo'}, 2: {}, 3: {}, 4: {}, 5: {}}, 'jfk': {0: {}, 1: {}, 2: {}, 3: {}, 4: {'da': 'non-English token in English quotation', 'di': 'non-English token in English quotation'}, 5: {'liye': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 6: {}, 7: {}}, 'caesar': {0: {}, 1: {'kepada': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {'His': 'valid alternative wording / translation'}}, 'violent': {0: {}, 1: {}, 2: {}}}, '31b-raw': {'hamlet': {0: {'lbe': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'cogito': {0: {'ambiance': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'que': 'non-English token in English quotation', 'amistad': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'EXISTSION': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'residentsal': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {'jugando': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'leakinging': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'cidade': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'acquiringing': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'establishery': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'perishinging': 'typo: repeated -ing suffix', 'blinkinging': 'typo: repeated -ing suffix', 'spasmess': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'responsabilidad': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'pandemi': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'spoile': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'meditatinging': 'typo: repeated -ing suffix'}}, 'stage': {0: {'stge': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'fear': {0: {'adalah': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'que': 'non-English token in English quotation'}, 1: {'miedo': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'medo': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'peur': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'takut': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'feeear': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {'stessa': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'samymse': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'misma': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'stesso': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'italicized': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'liberty': {0: {}, 1: {'la': 'non-English token in English quotation'}, 2: {'lme': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'la': 'non-English token in English quotation'}, 3: {'l': 'fragment / abbreviation / typo'}}, 'apollo': {0: {'etc': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'que': 'non-English token in English quotation', 'overally': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {'lgiant': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {'leopardy': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'lept': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 3: {'la': 'non-English token in English quotation'}, 4: {'la': 'non-English token in English quotation', 'mennesket': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'humanoidity': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'mansionkind': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'socrates': {0: {}, 1: {}, 2: {'warto': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'wordth': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'wohrt': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'la': 'non-English token in English quotation'}, 3: {'viviendo': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'gettysburg': {0: {'faaliyetleri': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {}, 2: {'mensen': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'popolo': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'pessoas': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'ppl': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'ludzie': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'dickens': {0: {'etc': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {'became': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {}, 3: {'worthest': 'fragment / abbreviation / typo', 'Worcestershire': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'wersest': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 4: {'ostatnich': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 5: {}}, 'jfk': {0: {'perguntue': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'pergunta': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {'wat': 'fragment / abbreviation / typo'}, 2: {'yolu': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'kannst': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'ou': 'non-English token in English quotation', 'potete': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'yeh': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 3: {'kunnen': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'kannst': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'pouvez': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'puedes': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 4: {}, 5: {'voor': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'untuk': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'pentru': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'Your': 'different-cased variant of current or next gold word'}, 6: {'apne': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'yako': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'iyong': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'Ihrer': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'jour': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'gour': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'Ihre': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'deine': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'widget': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'vostre': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'vostro': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'colour': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'deiner': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'deinen': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 7: {'kraj': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'coutry': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'checklist': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'colour': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'caesar': {0: {'etc': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'saith': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 1: {'give': 'valid alternative wording / translation', 'kepada': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'what': 'valid alternative wording / translation'}, 2: {'la': 'non-English token in English quotation', 'l': 'fragment / abbreviation / typo'}, 3: {'what': 'valid alternative wording / translation'}, 4: {'dingen': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 5: {'que': 'non-English token in English quotation', 'of': 'valid alternative wording / translation'}, 6: {'sont': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'zijn': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'be': 'valid alternative wording / translation'}, 7: {'godziny': 'fragment / typo / non-English: absent from system English lexicon and inflections', 'godine': 'fragment / typo / non-English: absent from system English lexicon and inflections', "Gdy's": 'fragment / typo / non-English: absent from system English lexicon and inflections', 'His': 'valid alternative wording / translation', 'godz': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}, 'violent': {0: {}, 1: {'vitesses': 'fragment / typo / non-English: absent from system English lexicon and inflections'}, 2: {'endlesss': 'fragment / abbreviation / typo', 'endets': 'fragment / typo / non-English: absent from system English lexicon and inflections'}}}}  # Persisted per-configuration screening reasons.
CONFIGURATION = "31b-raw"
DISTRACTOR_STOPLIST = {"a", "an", "the", "own"}
EXCLUDES["cogito"][1].extend(["Fits", "adsorption"])
EXCLUDES["caesar"][7] = ["Gods"]
FINAL_EXCLUDES = {"liberty": {1: ["gie"]}, "socrates": {1: ["quey"]}, "dickens": {1: ["aws"], 3: ["Worcesters"]}, "jfk": {6: ["lour", "COUNTRY"]}, "caesar": {2: ["l'Etat"], 5: ["thar"], 7: ["Grid's", "Gode's", "Gad's", "Go's"]}, "apollo": {3: ["humankind", "mankind"]}, "cogito": {0: ["exists"]}}
for level_id, steps in FINAL_EXCLUDES.items():
    for step_index, words in steps.items():
        EXCLUDES.setdefault(level_id, {}).setdefault(step_index, []).extend(words)
LEXICON = frozenset(Path("/usr/share/dict/words").read_text().casefold().splitlines())
ENGLISH_EXTRAS = {"a", "i", "am", "are", "is", "was", "were", "has", "had", "does", "did", "gone", "men", "women", "children", "people", "most", "least", "best", "worst", "deadliest", "oldest", "his", "its", "our", "your", "their", "theirs", "ours", "yours", "america", "caesar", "god", "shakespeare", "socrates", "lincoln", "kennedy", "descartes", "okay", "ok", "cannot", "hast", "hath", "google", "godzilla"}
NON_ENGLISH = {"de", "bi", "eller", "oder", "atau", "ou", "und", "der", "die", "das", "ein", "eine", "nicht", "ist", "sind", "haben", "hanno", "kann", "dapat", "para", "votre", "yang", "apa", "que", "qui", "con", "da", "del", "el", "los", "las", "les", "des", "le", "la", "un", "una", "acerca", "humanidad", "sekaligus", "sum", "ergo", "est", "es", "et", "il", "di", "per", "von", "manusia", "menschen", "muerte", "mort", "menschheit"} - {"die"}


def auto_reason(word, level_id, step_index):
    key = word.casefold()
    completion = next(c[3] for c in CAMPAIGN if c[0] == level_id)
    gold_words = [m[0] for m in re.findall(r"([A-Za-z]+(?:'[A-Za-z]+)?)([.!]?)", completion)]
    gold = gold_words[step_index]
    if word.isupper() and not gold.isupper():
        return "all-caps distractor while gold is not all-caps"
    for target in gold_words[step_index:step_index + 2]:
        if word != target and key == target.casefold():
            return "different-cased variant of current or next gold word"
    if level_id == "caesar" and step_index == 7 and re.fullmatch(r"G[A-Za-z]*'s", word):
        base = key[:-2]
        if base not in LEXICON and base not in ENGLISH_EXTRAS:
            return "non-word G___'s possessive"
    if key in {"fuck", "fucking", "shit", "bitch", "cunt", "nigger", "faggot"}:
        return "profanity / slur"
    if len(key) == 1 and key not in {"a", "i"} or key in {"vs", "nt", "ws", "deat", "itelf", "worthest", "wat", "endlesss"}:
        return "fragment / abbreviation / typo"
    if key.endswith("inging") and key[:-3] not in {"bring", "cling", "fling", "sling", "spring", "sting", "string", "swing", "wring", "sing", "ring", "wing", "ding", "ping"} and key not in LEXICON:
        return "typo: repeated -ing suffix"
    if key in NON_ENGLISH:
        return "non-English token in English quotation"
    variants = {("cogito", 1): {"exist", "exists"}, ("apollo", 4): {"humankind", "humanity"}, ("caesar", 1): {"unto", "render", "give", "pay", "what"}, ("caesar", 3): {"what"}, ("caesar", 5): {"which", "of"}, ("caesar", 6): {"belong", "be"}, ("caesar", 7): {"his"}}
    if key in variants.get((level_id, step_index), set()):
        return "valid alternative wording / translation"
    base = key.split("'")[0]
    stems = {base, base[:-1] if base.endswith("s") else base,
             base[:-2] if base.endswith(("es", "ed")) else base,
             base[:-3] if base.endswith("ing") else base,
             base[:-3] + "e" if base.endswith("ing") else base,
             base[:-3] + "y" if base.endswith("ies") else base,
             base[:-3] if base.endswith("est") else base,
             base[:-3] + "e" if base.endswith("est") else base}
    if key not in ENGLISH_EXTRAS and not (stems & (LEXICON | ENGLISH_EXTRAS)):
        return "fragment / typo / non-English: absent from system English lexicon and inflections"
    return None
COUNTS = [1, 2, 1, 3, 4, 5, 4, 3, 6, 8, 8, 3]
CAMPAIGN = [
    ("hamlet", "I · BOOT", "To be, or not to", "be.", "William Shakespeare", "Hamlet", "c. 1600"),
    ("cogito", "I · BOOT", "I think, therefore", "I am.", "René Descartes", "Discourse on the Method", "1637"),
    ("stage", "I · BOOT", "All the world's a", "stage.", "William Shakespeare", "As You Like It", "c. 1599"),
    ("fear", "II · CALIBRATION", "The only thing we have to fear", "is fear itself.", "Franklin D. Roosevelt", "First Inaugural Address", "1933"),
    ("liberty", "II · CALIBRATION", "Give me liberty,", "or give me death!", "Patrick Henry", "Speech to the Second Virginia Convention", "1775"),
    ("apollo", "II · CALIBRATION", "That's one small step for man,", "one giant leap for mankind.", "Neil Armstrong", "Apollo 11", "1969"),
    ("socrates", "II · CALIBRATION", "The unexamined life", "is not worth living.", "Socrates", "Plato, Apology", "c. 399 BC"),
    ("gettysburg", "II · CALIBRATION", "…government of the people, by the people,", "for the people.", "Abraham Lincoln", "Gettysburg Address", "1863"),
    ("dickens", "III · DEEP RECALL", "It was the best of times,", "it was the worst of times.", "Charles Dickens", "A Tale of Two Cities", "1859"),
    ("jfk", "III · DEEP RECALL", "Ask not what your country can do for you;", "ask what you can do for your country.", "John F. Kennedy", "Inaugural Address", "1961"),
    ("caesar", "III · DEEP RECALL", "Render to Caesar the things that are Caesar's,", "and to God the things that are God's.", "Gospel of Matthew", "Matthew 22:21", "—"),
    ("violent", "FINALE", "These violent delights", "have violent ends.", "William Shakespeare", "Romeo and Juliet · Westworld", "c. 1597"),
]
WORD = re.compile(r"^[A-Za-z]+(?:'[A-Za-z]+)?$")
PARTIAL = re.compile(r"^[A-Za-z]+(?:'[A-Za-z]*)?$")


def protect_hf_cache():
    """Deny Python filesystem mutations in the shared Hugging Face cache."""
    root = HF_HOME.resolve()

    def protected(value):
        return isinstance(value, (str, bytes, os.PathLike)) and Path(os.fsdecode(value)).resolve().is_relative_to(root)

    def audit(event, args):
        if event == "open":
            path, mode, flags = args
            writing = (mode is not None and any(c in mode for c in "wax+")) or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            if writing and protected(path):
                raise PermissionError(f"Refusing HF cache write: {path}")
        elif event in {"os.remove", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.utime", "os.truncate"}:
            if protected(args[0]):
                raise PermissionError(f"Refusing HF cache mutation: {event} {args[0]}")
        elif event in {"os.rename", "os.link", "os.symlink"}:
            if any(protected(p) for p in args[:2]):
                raise PermissionError(f"Refusing HF cache mutation: {event}")
    sys.addaudithook(audit)


def reason(word, gold, exclude):
    key, target = word.casefold(), gold.casefold()
    if not WORD.fullmatch(word):
        return "not a whole ASCII word"
    if key in DISTRACTOR_STOPLIST:
        return "global distractor stoplist"
    if key == target:
        return "gold (case-insensitive)"
    if key.startswith(target) or target.startswith(key):
        return "prefix overlap with gold"
    if key in {w.casefold() for w in exclude}:
        return "authored exclude"
    return None


def record(word, ids, logprob, tokenizer):
    return {"word": word, "ids": ids[:], "pieces": tokenizer.convert_ids_to_tokens(ids),
            "prob": float(format(math.exp(logprob), ".6g"))}


def validate(data):
    assert data["version"] == 1
    assert data["bake"]["distractors"] == DISTRACTORS
    assert [x["id"] for x in data["levels"]] == [x[0] for x in CAMPAIGN]
    for level, authored, count in zip(data["levels"], CAMPAIGN, COUNTS):
        assert len(level["steps"]) == count, level["id"]
        text = level["prefix"] + "".join(" " + s["gold"]["word"] + s["after"] for s in level["steps"])
        assert text == authored[2] + " " + authored[3], (level["id"], text)
        for step in level["steps"]:
            candidates = step["candidates"]
            assert len(candidates) == DISTRACTORS
            assert len({c["word"].casefold() for c in candidates}) == DISTRACTORS
            assert all(reason(c["word"], step["gold"]["word"], step["exclude"]) is None for c in candidates), (level["id"], step)
            assert all(auto_reason(c["word"], level["id"], level["steps"].index(step)) is None for c in candidates)
            assert candidates == sorted(candidates, key=lambda c: c["prob"], reverse=True)
            assert step["after"] in {"", ".", "!"}
            for choice in [step["gold"], *candidates]:
                assert WORD.fullmatch(choice["word"])
                assert choice["ids"] and len(choice["ids"]) == len(choice["pieces"])
                assert all(isinstance(i, int) and 0 <= i < 262144 for i in choice["ids"])
                assert math.isfinite(choice["prob"]) and 0 < choice["prob"] <= 1


def self_test():
    assert reason("being", "be", []) == "prefix overlap with gold"
    assert reason("Be", "be", []) == "gold (case-insensitive)"
    assert reason("is", "am", ["IS"]) == "authored exclude"
    assert reason("the", "am", []) == "global distractor stoplist"
    assert reason("God's", "Caesar", []) is None
    assert not WORD.fullmatch("God'") and not WORD.fullmatch("half-word")
    assert PARTIAL.fullmatch("God'")
    assert auto_reason("x", "fear", 2) == "fragment / abbreviation / typo"
    assert auto_reason("de", "cogito", 0) == "non-English token in English quotation"
    assert auto_reason("Be", "hamlet", 0) == "different-cased variant of current or next gold word"
    assert auto_reason("simplest", "dickens", 3) is None
    assert auto_reason("hath", "violent", 0) is None
    assert auto_reason("blinkinging", "cogito", 1) == "typo: repeated -ing suffix"
    assert auto_reason("bringing", "cogito", 1) is None
    assert auto_reason("endings", "violent", 2) is None
    assert auto_reason("COUNTRY", "jfk", 6) == "all-caps distractor while gold is not all-caps"
    assert auto_reason("Country", "jfk", 6) == "different-cased variant of current or next gold word"
    assert auto_reason("country", "jfk", 6) is None
    rejected = {"SOME": auto_reason("SOME", "jfk", 6)}
    exclude = [word for word, why in rejected.items() if why not in {"all-caps distractor while gold is not all-caps", "different-cased variant of current or next gold word"}]
    assert reason("some", "your", exclude) is None
    assert auto_reason("some", "jfk", 6) is None
    assert auto_reason("am", "cogito", 0) is None
    assert auto_reason("Godfrey's", "caesar", 7) is None
    assert auto_reason("Gxyz's", "caesar", 7) == "non-word G___'s possessive"
    assert auto_reason("unto", "caesar", 1) == auto_reason("what", "caesar", 3) == auto_reason("be", "caesar", 6) == "valid alternative wording / translation"
    assert [len(re.findall(r"([A-Za-z]+(?:'[A-Za-z]+)?)([.!]?)", c[3])) for c in CAMPAIGN] == COUNTS
    print("Self-test passed", flush=True)


def bake(out):
    started = time.perf_counter()
    protect_hf_cache()
    import mlx.core as mx
    import mlx_lm
    from mlx_lm.models.cache import make_prompt_cache

    version = importlib.metadata.version("mlx-lm")
    assert version == MLX_LM_VERSION, f"STOP: unexpected mlx-lm {version}"
    assert SNAPSHOT.is_dir(), "STOP: local snapshot missing"
    config = json.loads((SNAPSHOT / "config.json").read_text())
    assert config["model_type"] == "gemma4"
    expected_layers = 60 if CONFIGURATION == "31b-raw" else 30
    assert config["text_config"]["num_hidden_layers"] == expected_layers
    assert config["text_config"]["vocab_size"] == 262144
    print(f"mlx-lm={version}; snapshot={SNAPSHOT}; pid={os.getpid()}", flush=True)
    loading = time.perf_counter()
    model, tokenizer = mlx_lm.load(str(SNAPSHOT), tokenizer_config={"local_files_only": True, "trust_remote_code": False})
    load_seconds = time.perf_counter() - loading
    assert tokenizer.bos_token_id == 2
    assert len(model.layers) == expected_layers
    print(f"Loaded in {load_seconds:.3f}s; BOS=2; layers={expected_layers}", flush=True)

    def encode(text):
        ids = tokenizer.encode(text, add_special_tokens=False)
        assert tokenizer.decode(ids, clean_up_tokenization_spaces=False) == text, f"Decode changed context: {text!r}"
        assert tokenizer.decode(ids) == text, f"Default decode cleanup changed context: {text!r}"
        return [2] + ids

    def frame_context(quote):
        if CONFIGURATION == "31b-raw":
            return quote, encode(quote)
        rendered = tokenizer.apply_chat_template(
            [{"role": "user", "content": "Complete this famous quotation exactly: " + quote}],
            tokenize=False, add_generation_prompt=True, enable_thinking=False,
        ) + '"' + quote
        assert rendered == FRAME.replace("{quote}", quote), "Cached chat template changed"
        token_ids = tokenizer.encode(rendered, add_special_tokens=False)
        assert token_ids[0] == 2 and token_ids.count(2) == 1
        assert tokenizer.decode(token_ids, clean_up_tokenization_spaces=False) == rendered
        return rendered, token_ids

    def logprobs(inputs, cache):
        logits = model(mx.array(inputs), cache=cache)[:, -1].astype(mx.float32)
        assert logits.shape[-1] == 262144
        assert bool(mx.all(mx.isfinite(logits)).item()), "Nonfinite logits"
        result = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
        mx.eval(result)
        return result

    def fork_cache(cache, batch=1):
        result = []
        for c in cache:
            # Independent cache objects/arrays: no mutable prompt-cache aliasing.
            assert c.offset < 1024
            state = tuple(mx.repeat(x, batch, axis=0) if isinstance(x, mx.array) else x for x in c.state)
            new = type(c).from_state(state)
            result.append(new)
        return result

    def filter_cache(cache, indices):
        ix = mx.array(indices)
        for c in cache:
            c.keys = c.keys[ix]
            c.values = c.values[ix]

    special = set(tokenizer.all_special_ids)
    pieces = tokenizer.convert_ids_to_tokens(list(range(262144)))
    dump = ["# Gemma chat-echo candidate review", "", f"Model: `{MODEL}` · revision `{REVISION}` · mlx-lm `{version}`", "", "Verbatim hidden frame (`{quote}` is the accepted quote-so-far):", "", "```text", FRAME, "```", "", "Step indexes are zero-based. r = path probability / maximum distractor probability. Pruned rows show first-token upper bounds, not completed word probabilities.", ""]
    levels, widened, gold_rank_one = [], [], 0
    for authored in CAMPAIGN:
        level_id, act, prefix, completion, speaker, work, year = authored
        level = {"id": level_id, "act": act, "prefix": prefix,
                 "attribution": {"speaker": speaker, "work": work, "year": year}, "steps": []}
        dump.extend([f"## {level_id} — {act}", "", f"{prefix} **{completion}**", ""])
        context = prefix
        for step_index, (gold_word, after) in enumerate(re.findall(r"([A-Za-z]+(?:'[A-Za-z]+)?)([.!]?)", completion)):
            step_started = time.perf_counter()
            exclude = list(EXCLUDES.get(level_id, {}).get(step_index, []))
            exclude.extend(sorted(DISTRACTOR_STOPLIST))
            auto_for_step = AUTO_EXCLUDES.setdefault(CONFIGURATION, {}).setdefault(level_id, {}).setdefault(step_index, {})
            case_only_reasons = {"all-caps distractor while gold is not all-caps", "different-cased variant of current or next gold word"}
            exclude.extend(w for w, why in auto_for_step.items() if w not in exclude and why not in case_only_reasons)
            encode(context)  # UI text round-trip, independent of hidden framing.
            framed, ids = frame_context(context)
            extended = tokenizer.encode(framed + " " + gold_word, add_special_tokens=False)
            if CONFIGURATION == "31b-raw":
                extended = [2] + extended
            assert len(extended) > len(ids) and extended[:len(ids)] == ids, f"Boundary instability: {level_id}/{step_index}"
            gold_ids = extended[len(ids):]
            assert tokenizer.decode(gold_ids, clean_up_tokenization_spaces=False) == " " + gold_word
            assert tokenizer.decode(gold_ids) == " " + gold_word
            base_cache = make_prompt_cache(model)
            base_lp = logprobs([ids], base_cache)[0]
            gold_rank = int(mx.sum(base_lp > base_lp[gold_ids[0]]).item()) + 1
            gold_rank_one += gold_rank == 1
            # Teacher-force gold, excluding the probability of a following boundary.
            gold_cache = fork_cache(base_cache)
            lp, gold_logprob = base_lp, 0.0
            for n, token in enumerate(gold_ids):
                gold_logprob += float(lp[token].item())
                if n + 1 < len(gold_ids):
                    lp = logprobs([[token]], gold_cache)[0]
            gold = record(gold_word, gold_ids, gold_logprob, tokenizer)
            del gold_cache
            order = mx.argsort(-base_lp)[:512].tolist()
            first_lp = {token: float(base_lp[token].item()) for token in order}
            accepted, rejected, cursor, limit = {}, [], 0, 128
            pruned = []

            def finish(path, forced_reason=None):
                word = path["word"]
                why = forced_reason or reason(word, gold_word, exclude)
                if why is None:
                    why = auto_reason(word, level_id, step_index)
                    if why:
                        auto_for_step[word] = why
                        if why not in case_only_reasons:
                            exclude.append(word)
                if why is None:
                    decoded = tokenizer.decode(path["ids"], clean_up_tokenization_spaces=False)
                    assert decoded == " " + word, (word, path["ids"], decoded)
                    assert tokenizer.decode(path["ids"]) == decoded
                    key = word.casefold()
                    if key not in accepted or path["lp"] > accepted[key]["lp"]:
                        if key in accepted:
                            rejected.append((accepted[key], "duplicate casefolded word"))
                        accepted[key] = path
                    else:
                        rejected.append((path, "duplicate casefolded word"))
                else:
                    rejected.append((path, why))

            while True:
                ranked = sorted(accepted.values(), key=lambda p: p["lp"], reverse=True)
                if len(ranked) >= DISTRACTORS and (cursor >= limit or ranked[DISTRACTORS - 1]["lp"] >= first_lp[order[cursor]]):
                    for token in order[cursor:limit]:
                        piece = pieces[token]
                        if token not in special and re.match(r"^▁[A-Za-z]", piece):
                            pruned.append(({"word": piece[1:], "ids": [token], "lp": first_lp[token]}, "pruned: first-token upper bound"))
                            if len(pruned) == 5:
                                break
                    break
                if cursor >= limit:
                    if limit == 512:
                        raise RuntimeError(f"Fewer than {DISTRACTORS} distractors: {level_id}/{step_index}")
                    limit = 512
                    widened.append(f"{level_id}/{step_index}")
                    print(f"Widening {level_id}/{step_index} to 512", flush=True)
                starts = []
                # Small same-length batches bound cache memory; pruning occurs between batches.
                while cursor < limit and len(starts) < 8:
                    token = order[cursor]
                    cursor += 1
                    piece = pieces[token]
                    if token in special or not re.match(r"^▁[A-Za-z]", piece):
                        continue
                    path = {"word": piece[1:], "ids": [token], "lp": first_lp[token]}
                    if not PARTIAL.fullmatch(path["word"]):
                        finish(path, "invalid first-token word shape")
                    elif len(path["word"]) > 32:
                        finish(path, "32-character limit")
                    else:
                        starts.append(path)
                if not starts:
                    continue
                cache = fork_cache(base_cache, len(starts))
                active = starts
                while active:
                    batch_lp = logprobs([[p["ids"][-1]] for p in active], cache)
                    next_ids = mx.argmax(batch_lp, axis=-1).tolist()
                    survivors, survivor_indices = [], []
                    for row, (path, token) in enumerate(zip(active, next_ids)):
                        piece = pieces[token]
                        word = path["word"]
                        # A bare apostrophe only belongs to the word if the next piece is letters.
                        pending = word.endswith("'")
                        can_extend = token not in special and not piece.startswith("▁") and bool(re.fullmatch(r"[A-Za-z]+(?:'[A-Za-z]*)?|'[A-Za-z]*", piece))
                        if pending:
                            can_extend = token not in special and bool(re.fullmatch(r"[A-Za-z]+", piece))
                        if not can_extend:
                            if pending:
                                if "before_apostrophe" in path:
                                    path = path["before_apostrophe"]
                                else:
                                    finish(path, "unclosed apostrophe in token")
                                    continue
                            finish(path)
                            continue
                        combined = word + piece
                        if not PARTIAL.fullmatch(combined):
                            finish(path)
                            continue
                        if len(path["ids"]) >= 12 or len(combined) > 32:
                            finish(path, "12-token or 32-character limit")
                            continue
                        updated = {"word": combined, "ids": path["ids"] + [token],
                                   "lp": path["lp"] + float(batch_lp[row, token].item())}
                        if piece == "'":
                            updated["before_apostrophe"] = path
                        survivors.append(updated)
                        survivor_indices.append(row)
                    if survivors:
                        filter_cache(cache, survivor_indices)
                    active = survivors
                del cache
            ranked = sorted(accepted.values(), key=lambda p: p["lp"], reverse=True)
            distractors = [record(p["word"], p["ids"], p["lp"], tokenizer) for p in ranked[:DISTRACTORS]]
            step = {"gold": gold, "after": after, "exclude": exclude, "candidates": distractors}
            level["steps"].append(step)
            maximum = max(c["prob"] for c in distractors)
            dump.extend([f"### Step {step_index} — `{context}`", "", "| Role | Word | prob | r | Pieces |", "|---|---|---:|---:|---|"])
            for role, choice in [("gold", gold), *[("distractor", c) for c in distractors]]:
                dump.append(f"| {role} | {choice['word']} | {choice['prob']:.6g} | {choice['prob'] / maximum:.6g} | `{' · '.join(choice['pieces'])}` |")
            runners = [(p, f"accepted runner-up; below top {DISTRACTORS}") for p in ranked[DISTRACTORS:]] + rejected + pruned
            runners.sort(key=lambda x: x[0]["lp"], reverse=True)
            dump.extend(["", "Runner-ups / rejected / pruned (pruned probability is an upper bound):", "", "| Word / start | prob | r | Pieces | Reason |", "|---|---:|---:|---|---|"])
            for p, why in runners[:5]:
                prob = math.exp(p["lp"])
                ps = tokenizer.convert_ids_to_tokens(p["ids"])
                dump.append(f"| {p['word']} | {prob:.6g} | {prob / maximum:.6g} | `{' · '.join(ps)}` | {why} |")
            dump.extend(["", f"Gold first-token rank: {gold_rank}.", "", "Auto-excludes for this step:"])
            dump.extend(f"- `{word}`: {why}" for word, why in auto_for_step.items())
            if not auto_for_step:
                dump.append("- none")
            dump.append("")
            elapsed = time.perf_counter() - step_started
            print(f"{level_id}/{step_index} gold={gold_word!r} prob={gold['prob']:.6g} distractors={','.join(c['word'] for c in distractors)} scanned={cursor}/{limit} seconds={elapsed:.3f}", flush=True)
            context += " " + gold_word + after
            del base_cache, base_lp
            mx.clear_cache()
        levels.append(level)
    data = {"version": 1, "bake": {"model": MODEL, "revision": REVISION, "mlxLm": version,
            "bosId": 2, "vocabSize": 262144,
            "algorithm": "Token-path probabilities inside verbatim frame " + json.dumps(FRAME, ensure_ascii=False) + "; {quote}=accepted quote-so-far; one BOS; teacher-forced gold; top-128/512 starts, greedy batched extensions, exact first-token-bound pruning; system-English-lexicon screening with persisted exclusions.",
            "frame": FRAME,
            "distractors": DISTRACTORS,
            "reviewed": REVIEWED}, "levels": levels}
    validate(data)
    total_seconds = time.perf_counter() - started
    peak = mx.get_peak_memory()
    dump.extend(["## Bake metrics", "", f"- Load seconds: {load_seconds:.3f}", f"- Total seconds: {total_seconds:.3f}",
                 f"- Peak MLX allocated bytes: {peak}", f"- Widened steps: {', '.join(widened) or 'none'}", ""])
    out.mkdir(parents=True, exist_ok=True)
    (out / "quotes.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (out / "candidates.md").write_text("\n".join(dump), encoding="utf-8")
    source_path = Path(__file__)
    source_text = source_path.read_text()
    source_text = re.sub(r"^AUTO_EXCLUDES = .*?$", "AUTO_EXCLUDES = " + repr(AUTO_EXCLUDES) + "  # Persisted per-configuration screening reasons.", source_text, flags=re.MULTILINE)
    source_path.write_text(source_text, encoding="utf-8")
    source = source_text.encode("utf-8")
    auto_count = sum(len(words) for steps in AUTO_EXCLUDES.get(CONFIGURATION, {}).values() for words in steps.values())
    print(f"COMPARISON gold_rank_one={gold_rank_one}/48 minimum_gold_prob={min(s['gold']['prob'] for l in levels for s in l['steps'])} auto_excludes={auto_count}", flush=True)
    if Path(__file__).resolve() != (out / "bake_quotes.py").resolve():
        (out / "bake_quotes.py").write_bytes(source)
    print("Tokenization notes:", flush=True)
    for text in ["…government", "world's", "Caesar's", " God's", "you;", " mankind"]:
        token_ids = tokenizer.encode(text, add_special_tokens=False)
        print(repr(text), token_ids, tokenizer.convert_ids_to_tokens(token_ids), flush=True)
    print(f"VALIDATED load_seconds={load_seconds:.3f} total_seconds={total_seconds:.3f} peak_mlx_bytes={peak} widened={widened}", flush=True)
    print(f"DELIVERY {out}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--snapshot", type=Path, help="model snapshot directory (default: HF cache)")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--configuration", choices=["26b-chat", "31b-raw"], default="31b-raw")
    args = parser.parse_args()
    CONFIGURATION = args.configuration
    if CONFIGURATION == "31b-raw":
        MODEL = "mlx-community/gemma-4-31b-it-8bit"
        REVISION = "f5f3dc92ab4af76724c36c21eb6bedadb3a851be"
        SNAPSHOT = HF_HOME / "hub/models--mlx-community--gemma-4-31b-it-8bit/snapshots" / REVISION
        FRAME = "{quote}"
    if args.snapshot:
        SNAPSHOT = args.snapshot
    self_test()
    if not args.self_test:
        if args.out is None:
            parser.error("--out is required for a bake")
        bake(args.out.resolve())
