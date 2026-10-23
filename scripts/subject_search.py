"""Reusable read-only Substack publication search and pagination logic.

The caller supplies an HTTP transport. No credentials, targets, or search
terms are embedded in the repo, printed to logs, or sent to GitHub.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class SubjectSearchSummary:
    publications: list[dict[str, Any]]
    requests: int
    pages: int
    queries: int
    more_available: bool


def search_publications(
    request: Callable[[str, dict[str, Any]], dict[str, Any]],
    subjects: list[str],
    *,
    max_pages_per_subject: int = 4,
    page_limit: int = 25,
    request_budget: int = 24,
) -> SubjectSearchSummary:
    if not 1 <= max_pages_per_subject <= 8 or not 1 <= page_limit <= 25 or not 1 <= request_budget <= 100:
        raise ValueError("search_limits_invalid")
    all_found: dict[int, dict[str, Any]] = {}
    request_count = 0
    page_count = 0
    query_count = 0
    truncated = False
    for term in dict.fromkeys(x.strip() for x in subjects if isinstance(x, str) and 2 <= len(x.strip()) <= 60):
        if request_count >= request_budget:
            truncated = True
            break
        query_count += 1
        visited_ids: set[int] = set()
        for page in range(max_pages_per_subject):
            if request_count >= request_budget:
                truncated = True
                break
            response = request("/api/v1/publication/search", {
                "query": term, "page": page, "limit": page_limit, "sort": "relevance"
            })
            request_count += 1
            page_count += 1
            if not isinstance(response, dict) or not isinstance(response.get("results"), list):
                raise ValueError("unexpected_publication_search_response")
            results = response["results"]
            current_ids: set[int] = set()
            for entry in results:
                if not isinstance(entry, dict) or not isinstance(entry.get("id"), int):
                    continue
                subdomain = entry.get("subdomain")
                if not isinstance(subdomain, str) or not (2 <= len(subdomain) <= 60) or not all(c.islower() or c.isdigit() or c == "-" for c in subdomain):
                    continue
                pub_id = entry["id"]
                current_ids.add(pub_id)
                if pub_id not in all_found:
                    all_found[pub_id] = {
                        "id": pub_id,
                        "subdomain": subdomain,
                        "name": str(entry.get("name") or "")[:140],
                        "matched_terms": [term],
                    }
                elif term not in all_found[pub_id]["matched_terms"]:
                    all_found[pub_id]["matched_terms"].append(term)
            if not response.get("more") or not results or current_ids.issubset(visited_ids):
                break
            visited_ids.update(current_ids)
            if page + 1 >= max_pages_per_subject:
                truncated = True
    return SubjectSearchSummary(
        publications=list(all_found.values()),
        requests=request_count,
        pages=page_count,
        queries=query_count,
        more_available=truncated,
    )
