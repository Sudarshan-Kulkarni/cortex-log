import logging
from sqlalchemy import delete, select

from app.database import SessionLocal
from app.models import Blog, Flashcard
from app.services.llm import generate_summary_and_flashcards
from app.services.pubsub import publish_blog_ingestion, start_blog_subscriber
from app.services.scraper import ScrapeError, scrape_blog_url

logger = logging.getLogger(__name__)


def process_blog_job(blog_id: int) -> None:
    """Worker callback invoked when a blog-ingestion message arrives from Pub/Sub."""
    logger.info("Worker starting processing for blog_id=%s", blog_id)
    with SessionLocal() as db:
        blog = db.execute(select(Blog).where(Blog.id == blog_id)).scalar_one_or_none()
        if blog is None:
            logger.warning("Blog id=%s not found in database; skipping.", blog_id)
            return

        # Step 1: Determine article prose (use raw_text if already provided, else scrape canonical_url)
        article_text = (blog.raw_text or "").strip()
        scraped_title: str | None = None

        if not article_text:
            if not blog.canonical_url:
                blog.status = "scrape_failed"
                blog.error_message = (
                    "No URL or raw text available. Paste the raw article text below."
                )
                db.commit()
                return

            try:
                scraped_title, article_text = scrape_blog_url(blog.canonical_url)
            except ScrapeError as exc:
                logger.warning("Scrape failed for blog_id=%s: %s", blog_id, exc)
                blog.status = "scrape_failed"
                blog.error_message = str(exc)
                db.commit()
                return
            except Exception as exc:
                logger.exception("Unexpected scrape error for blog_id=%s", blog_id)
                blog.status = "scrape_failed"
                blog.error_message = f"Unexpected error while scraping URL: {exc}. Paste raw article text below."
                db.commit()
                return

        # Step 2: Update blog raw_text and title if discovered during scrape
        blog.raw_text = article_text
        if scraped_title and (
            not blog.title
            or "(" in blog.title
            or blog.title.startswith(("http", "Untitled"))
        ):
            blog.title = scraped_title

        # Step 3: Chunk text and generate summary + detail-level flashcards via Gemini
        try:
            summary, generated_cards = generate_summary_and_flashcards(
                title=blog.title, text=article_text
            )
        except Exception as exc:
            logger.exception("Flashcard generation failed for blog_id=%s", blog_id)
            blog.status = "scrape_failed"
            blog.error_message = f"Card generation error: {exc}"
            db.commit()
            return

        # Step 4: Save canonical flashcards and mark blog status = 'ready'
        db.execute(delete(Flashcard).where(Flashcard.blog_id == blog.id))
        for card_data in generated_cards:
            db.add(
                Flashcard(
                    blog_id=blog.id,
                    chunk_index=card_data["chunk_index"],
                    question=card_data["question"],
                    options_json=card_data["options_json"],
                    answer=card_data["answer"],
                )
            )

        blog.summary = summary
        blog.status = "ready"
        blog.error_message = None
        db.commit()
        logger.info(
            "Worker completed blog_id=%s (%s canonical flashcards generated)",
            blog.id,
            len(generated_cards),
        )


def start_worker_and_enqueue_pending() -> None:
    """Start the Pub/Sub subscriber loop and enqueue any blogs currently stuck in 'processing'."""
    start_blog_subscriber(process_blog_job)

    with SessionLocal() as db:
        pending_blogs = (
            db.execute(select(Blog).where(Blog.status == "processing"))
            .scalars()
            .all()
        )
        for b in pending_blogs:
            publish_blog_ingestion(b.id)
