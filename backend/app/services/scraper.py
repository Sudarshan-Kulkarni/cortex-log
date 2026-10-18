import hashlib
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


TRACKING_QUERY_PREFIXES = ("utm_", "fbclid", "gclid", "mc_cid", "mc_eid", "ref")


def normalize_url(raw_url: str) -> str:
    """Normalize a blog URL so duplicate posts resolve to a single canonical URL."""
    cleaned = raw_url.strip()
    if not cleaned:
        return ""
    if not cleaned.startswith(("http://", "https://")):
        cleaned = "https://" + cleaned

    parsed = urlparse(cleaned)
    scheme = parsed.scheme.lower() or "https"
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]

    path = parsed.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")

    filtered_query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if not k.lower().startswith(TRACKING_QUERY_PREFIXES)
    ]
    filtered_query.sort()
    query_str = urlencode(filtered_query)

    return urlunparse((scheme, netloc, path, "", query_str, ""))


def compute_content_hash(
    canonical_url: str | None = None, raw_text: str | None = None
) -> str:
    """Compute a deterministic SHA-256 content hash from normalized text or canonical URL."""
    if raw_text and raw_text.strip():
        normalized_text = " ".join(raw_text.strip().split()).lower()
        return hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()
    if canonical_url and canonical_url.strip():
        return hashlib.sha256(
            f"url:{canonical_url.strip()}".encode("utf-8")
        ).hexdigest()
    raise ValueError("Either canonical_url or raw_text must be provided.")


def derive_initial_title(
    canonical_url: str | None = None,
    raw_text: str | None = None,
    explicit_title: str | None = None,
) -> str:
    """Derive a clean readable title before or without scraping."""
    if explicit_title and explicit_title.strip():
        return explicit_title.strip()[:500]

    if canonical_url:
        parsed = urlparse(canonical_url)
        slug = parsed.path.strip("/").split("/")[-1] if parsed.path.strip("/") else ""
        if slug:
            readable = slug.replace("-", " ").replace("_", " ").strip().title()
            return f"{readable} ({parsed.netloc})"[:500]
        return parsed.netloc or canonical_url[:500]

    if raw_text and raw_text.strip():
        first_line = raw_text.strip().splitlines()[0].strip()
        return (first_line[:80] + ("..." if len(first_line) > 80 else "")) or "Raw Text Entry"

    return "Untitled Technical Blog"
