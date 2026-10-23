from dataclasses import dataclass
from datetime import datetime, timezone
import re

@dataclass(frozen=True)
class Candidate:
    key: str
    title: str
    published: str
    word_count: int

def precheck(item: Candidate, seen: set[str]) -> tuple[bool,str]:
    if not re.fullmatch(r"[a-zA-Z0-9:_-]{1,180}",item.key): return False,"invalid_id"
    if item.key in seen: return False,"duplicate"
    if len(item.title.strip()) < 8 or len(item.title)>300: return False,"invalid_title"
    if item.word_count<100: return False,"too_short"
    try:
        dt=datetime.fromisoformat(item.published.replace("Z","+00:00"))
        if not dt.tzinfo or dt>datetime.now(timezone.utc): return False,"invalid_date"
    except ValueError: return False,"invalid_date"
    return True,"eligible"

def comment_precheck(text: str) -> tuple[bool,str]:
    if len(text.strip())<20 or len(text)>750:return False,"invalid_length"
    if re.search(r"https?://|subscribe to|check out my",text,re.I):return False,"potential_promotion"
    return True,"semantic_review_needed"
