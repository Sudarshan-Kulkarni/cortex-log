import hashlib
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
import httpx
import trafilatura
from bs4 import BeautifulSoup


TRACKING_QUERY_PREFIXES = ("utm_", "fbclid", "gclid", "mc_cid", "mc_eid", "ref")

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class ScrapeError(Exception):
    """Raised when a blog URL cannot be scraped cleanly."""


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
        return (
            first_line[:80] + ("..." if len(first_line) > 80 else "")
        ) or "Raw Text Entry"

    return "Untitled Technical Blog"


def scrape_blog_url(url: str) -> tuple[str, str]:
    """Fetch a blog URL and extract clean (title, article_text) or raise ScrapeError."""
    if not url or not url.strip():
        raise ScrapeError("No URL provided to scrape.")

    try:
        with httpx.Client(
            headers=BROWSER_HEADERS, follow_redirects=True, timeout=15.0
        ) as client:
            response = client.get(url)
    except httpx.RequestError as exc:
        raise ScrapeError(
            f"Could not connect to {url} ({exc.__class__.__name__}). Paste the raw article text below to process it directly."
        ) from exc

    if response.status_code in (401, 403, 429):
        raise ScrapeError(
            f"Site blocked automated scraping (HTTP {response.status_code}). Paste the raw article text below to continue."
        )
    if response.status_code >= 400:
        raise ScrapeError(
            f"URL returned HTTP {response.status_code}. Paste the raw article text below to continue."
        )

    html = response.text or ""
    if not html.strip():
        raise ScrapeError(
            "Server returned an empty HTML response. Paste the raw article text below to continue."
        )

    extracted_text = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=True,
        no_fallback=False,
    )
    metadata = trafilatura.extract_metadata(html)
    title = metadata.title if metadata and metadata.title else None

    soup = BeautifulSoup(html, "html.parser")
    if not title:
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif soup.find("h1"):
            title = soup.find("h1").get_text(strip=True)

    if not extracted_text or len(extracted_text.strip()) < 150:
        # Fallback to BeautifulSoup paragraph extraction
        for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
            tag.decompose()
        container = soup.find("article") or soup.find("main") or soup.body or soup
        paragraphs = [
            p.get_text(" ", strip=True)
            for p in container.find_all(["p", "li", "pre", "h2", "h3"])
            if len(p.get_text(" ", strip=True)) > 25
        ]
        extracted_text = "\n\n".join(paragraphs)

    cleaned_text = (extracted_text or "").strip()
    if len(cleaned_text) < 120:
        raise ScrapeError(
            "Article body appears empty or locked behind a JavaScript/paywall gate. Paste the raw article text below to generate flashcards."
        )

    final_title = (title or "").strip() or derive_initial_title(canonical_url=url)
    return final_title[:500], cleaned_text
