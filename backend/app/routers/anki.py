import html
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import DEFAULT_USER_ID
from app.database import get_db
from app.models import Blog, Flashcard, UserFlashcard
from app.routers.flashcards import (
    _resolve_user_flashcard,
    _serialize_single_user_flashcard,
)
from app.schemas import (
    AnkiAckRequest,
    AnkiAckResponse,
    AnkiPullResponse,
    AnkiQueuedCardPayload,
    AnkiQueueStatusResponse,
    FlashcardItemResponse,
)
from app.services.pubsub import (
    ack_anki_messages,
    publish_anki_delivery,
    pull_anki_messages,
)

router = APIRouter(prefix="/api", tags=["anki"])

DEFAULT_DECK_NAME = "Cortex Log"


def _build_anki_card_html(
    blog_title: str,
    source_url: str | None,
    question: str,
    options: list[str],
    answer: str,
) -> tuple[str, str]:
    esc_title = html.escape(blog_title)
    esc_q = html.escape(question).replace("\n", "<br>")
    esc_a = html.escape(answer).replace("\n", "<br>")

    options_html = ""
    if options:
        items = "".join(
            f"<li style='margin-bottom:6px;'>{html.escape(opt)}</li>"
            for opt in options
        )
        options_html = (
            f"<ul style='list-style:none;padding-left:0;margin-top:12px;'>{items}</ul>"
        )

    front_html = (
        f"<div style='font-family:monospace;font-size:11px;color:#57534E;margin-bottom:8px;'>"
        f"[CORTEX LOG // {esc_title}]</div>"
        f"<div style='font-size:16px;font-weight:600;line-height:1.4;'>{esc_q}</div>"
        f"{options_html}"
    )

    source_html = ""
    if source_url:
        esc_url = html.escape(source_url)
        source_html = (
            f"<div style='margin-top:12px;font-family:monospace;font-size:11px;'>"
            f"Source: <a href='{esc_url}'>{esc_url}</a></div>"
        )

    back_html = (
        f"<div style='font-size:15px;line-height:1.5;'>{esc_a}</div>"
        f"{source_html}"
    )
    return front_html, back_html


@router.get("/anki/status", response_model=AnkiQueueStatusResponse)
def get_anki_queue_status(
    db: Session = Depends(get_db),
) -> AnkiQueueStatusResponse:
    queued_count = (
        db.scalar(
            select(func.count())
            .select_from(UserFlashcard)
            .where(
                UserFlashcard.user_id == DEFAULT_USER_ID,
                UserFlashcard.status == "queued_for_anki",
            )
        )
        or 0
    )
    synced_count = (
        db.scalar(
            select(func.count())
            .select_from(UserFlashcard)
            .where(
                UserFlashcard.user_id == DEFAULT_USER_ID,
                UserFlashcard.status == "synced_to_anki",
            )
        )
        or 0
    )
    return AnkiQueueStatusResponse(
        deck_name=DEFAULT_DECK_NAME,
        queued_count=queued_count,
        synced_count=synced_count,
    )


@router.post(
    "/flashcards/{card_id}/approve", response_model=FlashcardItemResponse
)
def approve_flashcard_for_anki(
    card_id: int,
    db: Session = Depends(get_db),
) -> FlashcardItemResponse:
    uc = _resolve_user_flashcard(db, DEFAULT_USER_ID, card_id)
    uc.status = "queued_for_anki"
    db.commit()
    db.refresh(uc)

    serialized = _serialize_single_user_flashcard(db, uc)
    blog = db.execute(
        select(Blog).where(Blog.id == uc.blog_id)
    ).scalar_one_or_none()
    blog_title = blog.title if blog else "Technical Blog"
    source_url = blog.canonical_url if blog else None

    front_html, back_html = _build_anki_card_html(
        blog_title=blog_title,
        source_url=source_url,
        question=serialized.question,
        options=serialized.options,
        answer=serialized.answer,
    )

    publish_anki_delivery(
        {
            "user_flashcard_id": uc.id,
            "blog_id": uc.blog_id,
            "blog_title": blog_title,
            "source_url": source_url,
            "deck_name": DEFAULT_DECK_NAME,
            "question": serialized.question,
            "options": serialized.options,
            "answer": serialized.answer,
            "front_html": front_html,
            "back_html": back_html,
        }
    )

    return serialized


@router.post("/anki/pull", response_model=AnkiPullResponse)
def pull_queued_anki_cards(
    db: Session = Depends(get_db),
) -> AnkiPullResponse:
    queued_rows = (
        db.execute(
            select(UserFlashcard, Blog)
            .join(Blog, UserFlashcard.blog_id == Blog.id)
            .where(
                UserFlashcard.user_id == DEFAULT_USER_ID,
                UserFlashcard.status == "queued_for_anki",
            )
            .order_by(UserFlashcard.id.asc())
        )
        .all()
    )

    if not queued_rows:
        return AnkiPullResponse(
            deck_name=DEFAULT_DECK_NAME,
            count=0,
            cards=[],
        )

    ack_map = pull_anki_messages(max_messages=max(50, len(queued_rows)))

    cards: list[AnkiQueuedCardPayload] = []
    for uc, blog in queued_rows:
        canonical = (
            db.execute(
                select(Flashcard).where(
                    Flashcard.id == uc.canonical_flashcard_id
                )
            ).scalar_one_or_none()
            if uc.canonical_flashcard_id is not None
            else None
        )

        question = (
            uc.question_override
            if uc.question_override is not None
            else (canonical.question if canonical else "")
        )
        options = list(
            uc.options_override_json
            if uc.options_override_json is not None
            else (canonical.options_json if canonical else [])
        )
        answer = (
            uc.answer_override
            if uc.answer_override is not None
            else (canonical.answer if canonical else "")
        )

        front_html, back_html = _build_anki_card_html(
            blog_title=blog.title,
            source_url=blog.canonical_url,
            question=question,
            options=options,
            answer=answer,
        )

        cards.append(
            AnkiQueuedCardPayload(
                user_flashcard_id=uc.id,
                blog_id=blog.id,
                blog_title=blog.title,
                source_url=blog.canonical_url,
                deck_name=DEFAULT_DECK_NAME,
                question=question,
                options=options,
                answer=answer,
                front_html=front_html,
                back_html=back_html,
                ack_id=ack_map.get(uc.id),
            )
        )

    return AnkiPullResponse(
        deck_name=DEFAULT_DECK_NAME,
        count=len(cards),
        cards=cards,
    )


@router.post("/anki/ack", response_model=AnkiAckResponse)
def acknowledge_anki_cards(
    payload: AnkiAckRequest,
    db: Session = Depends(get_db),
) -> AnkiAckResponse:
    if payload.ack_ids:
        ack_anki_messages(payload.ack_ids)

    updated_ids: list[int] = []
    if payload.user_flashcard_ids:
        rows = (
            db.execute(
                select(UserFlashcard).where(
                    UserFlashcard.user_id == DEFAULT_USER_ID,
                    UserFlashcard.id.in_(payload.user_flashcard_ids),
                )
            )
            .scalars()
            .all()
        )
        for uc in rows:
            uc.status = "synced_to_anki"
            updated_ids.append(uc.id)
        db.commit()

    return AnkiAckResponse(
        synced_count=len(updated_ids),
        user_flashcard_ids=updated_ids,
    )
