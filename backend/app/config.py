import os
from pathlib import Path
from dotenv import load_dotenv

# Load backend/.env if present
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)


def _normalize_database_url(raw_url: str) -> str:
    url = raw_url.strip()
    if not url:
        return "sqlite:///./cortex_log.db"
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


DATABASE_URL: str = _normalize_database_url(os.getenv("DATABASE_URL", ""))
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
GCP_PROJECT_ID: str = os.getenv("GCP_PROJECT_ID", "").strip()
GOOGLE_APPLICATION_CREDENTIALS: str = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS", ""
).strip()

PUBSUB_BLOG_TOPIC: str = os.getenv("PUBSUB_BLOG_TOPIC", "blog-ingestion").strip()
PUBSUB_BLOG_SUB: str = os.getenv("PUBSUB_BLOG_SUB", "blog-ingestion-sub").strip()
PUBSUB_ANKI_TOPIC: str = os.getenv("PUBSUB_ANKI_TOPIC", "anki-delivery").strip()
PUBSUB_ANKI_SUB: str = os.getenv("PUBSUB_ANKI_SUB", "anki-delivery-sub").strip()

_env_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ORIGINS: list[str] = list(
    dict.fromkeys(
        [
            "http://localhost:3010",
            "http://127.0.0.1:3010",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            *_env_origins,
        ]
    )
)

DEFAULT_USER_ID: int = 1
