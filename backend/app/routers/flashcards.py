from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import DEFAULT_USER_ID
from app.database import get_db
from app.models import Blog, Flashcard, UserBlog, UserFlashcard
from app.schemas import (
    CreateCustomFlashcardRequest,
    FlashcardItemResponse,
    LoggedBlogAccordionResponse,
    UpdateFlashcardRequest,
)

router = APIRouter(prefix="/api", tags=["flashcards"])


def _serialize_single_user_flashcard(
    db: Session, uc: UserFlashcard
) -> FlashcardItemResponse:
    canonical = (
        db.execute(
            select(Flashcard).where(Flashcard.id == uc.canonical_flashcard_id)
        ).scalar_one_or_none()
        if uc.canonical_flashcard_id is not None
        else None
    )

    question = (
        uc.question_override
        if uc.question_override is not None
        else (canonical.question if canonical else "")
    )
    options = (
        uc.options_override_json
        if uc.options_override_json is not None
        else (canonical.options_json if canonical else [])
    )
    answer = (
        uc.answer_override
        if uc.answer_override is not None
        else (canonical.answer if canonical else "")
    )

    is_edited = any(
        x is not None
        for x in (
            uc.question_override,
            uc.options_override_json,
            uc.answer_override,
        )
    ) and (uc.canonical_flashcard_id is not None)

    return FlashcardItemResponse(
        card_id=uc.id,
        canonical_flashcard_id=uc.canonical_flashcard_id,
        blog_id=uc.blog_id,
        chunk_index=canonical.chunk_index if canonical else 0,
        question=question,
        options=list(options),
        answer=answer,
        status=uc.status,
        is_custom=uc.canonical_flashcard_id is None,
        is_edited=is_edited,
    )


def _resolve_user_flashcard(
    db: Session, user_id: int, card_id: int
) -> UserFlashcard:
    uc = db.execute(
        select(UserFlashcard).where(
            UserFlashcard.id == card_id,
            UserFlashcard.user_id == user_id,
        )
    ).scalar_one_or_none()
    if uc is not None:
        return uc

    # Fallback: check if caller passed a canonical_flashcard_id
    uc_by_canon = db.execute(
        select(UserFlashcard).where(
            UserFlashcard.canonical_flashcard_id == card_id,
            UserFlashcard.user_id == user_id,
        )
    ).scalar_one_or_none()
    if uc_by_canon is not None:
        return uc_by_canon

    canon = db.execute(
        select(Flashcard).where(Flashcard.id == card_id)
    ).scalar_one_or_none()
    if canon is not None:
        new_uc = UserFlashcard(
            user_id=user_id,
            blog_id=canon.blog_id,
            canonical_flashcard_id=canon.id,
            status="candidate",
        )
        db.add(new_uc)
        db.commit()
        db.refresh(new_uc)
        return new_uc

    raise HTTPException(status_code=404, detail=f"Flashcard {card_id} not found.")


def _sync_and_serialize_flashcards_for_blog(
    db: Session, user_id: int, blog_id: int
) -> list[FlashcardItemResponse]:
    """Merge canonical flashcards with per-user user_flashcards rows, hiding dismissed cards."""
    canonical_cards = (
        db.execute(
            select(Flashcard)
            .where(Flashcard.blog_id == blog_id)
            .order_by(Flashcard.chunk_index.asc(), Flashcard.id.asc())
        )
        .scalars()
        .all()
    )

    user_cards = (
        db.execute(
            select(UserFlashcard)
            .where(
                UserFlashcard.user_id == user_id,
                UserFlashcard.blog_id == blog_id,
            )
            .order_by(UserFlashcard.id.asc())
        )
        .scalars()
        .all()
    )

    by_canonical_id: dict[int, UserFlashcard] = {
        uc.canonical_flashcard_id: uc
        for uc in user_cards
        if uc.canonical_flashcard_id is not None
    }

    created_new = False
    for fc in canonical_cards:
        if fc.id not in by_canonical_id:
            uf = UserFlashcard(
                user_id=user_id,
                blog_id=blog_id,
                canonical_flashcard_id=fc.id,
                status="candidate",
            )
            db.add(uf)
            by_canonical_id[fc.id] = uf
            created_new = True

    if created_new:
        db.commit()
        for uf in by_canonical_id.values():
            db.refresh(uf)

    canonical_lookup: dict[int, Flashcard] = {fc.id: fc for fc in canonical_cards}

    all_user_cards = (
        db.execute(
            select(UserFlashcard)
            .where(
                UserFlashcard.user_id == user_id,
                UserFlashcard.blog_id == blog_id,
            )
            .order_by(UserFlashcard.id.asc())
        )
        .scalars()
        .all()
    )

    items: list[FlashcardItemResponse] = []
    for uc in all_user_cards:
        if uc.status == "dismissed":
            continue

        canonical = (
            canonical_lookup.get(uc.canonical_flashcard_id)
            if uc.canonical_flashcard_id is not None
            else None
        )

        question = (
            uc.question_override
            if uc.question_override is not None
            else (canonical.question if canonical else "")
        )
        options = (
            uc.options_override_json
            if uc.options_override_json is not None
            else (canonical.options_json if canonical else [])
        )
        answer = (
            uc.answer_override
            if uc.answer_override is not None
            else (canonical.answer if canonical else "")
        )

        is_edited = any(
            x is not None
            for x in (
                uc.question_override,
                uc.options_override_json,
                uc.answer_override,
            )
        ) and (uc.canonical_flashcard_id is not None)

        items.append(
            FlashcardItemResponse(
                card_id=uc.id,
                canonical_flashcard_id=uc.canonical_flashcard_id,
                blog_id=blog_id,
                chunk_index=canonical.chunk_index if canonical else 0,
                question=question,
                options=list(options),
                answer=answer,
                status=uc.status,
                is_custom=uc.canonical_flashcard_id is None,
                is_edited=is_edited,
            )
        )

    return items


@router.get("/blogs/logged", response_model=list[LoggedBlogAccordionResponse])
def get_logged_blogs_with_flashcards(
    db: Session = Depends(get_db),
) -> list[LoggedBlogAccordionResponse]:
    rows = db.execute(
        select(UserBlog, Blog)
        .join(Blog, UserBlog.blog_id == Blog.id)
        .where(UserBlog.user_id == DEFAULT_USER_ID)
        .order_by(UserBlog.created_at.desc(), UserBlog.id.desc())
    ).all()

    grouped: dict[int, tuple[Blog, list[str]]] = {}
    for user_blog, blog in rows:
        date_str = user_blog.logged_date.isoformat()
        if blog.id not in grouped:
            grouped[blog.id] = (blog, [date_str])
        else:
            if date_str not in grouped[blog.id][1]:
                grouped[blog.id][1].append(date_str)

    accordions: list[LoggedBlogAccordionResponse] = []
    for blog_id, (blog, logged_dates) in grouped.items():
        cards = (
            _sync_and_serialize_flashcards_for_blog(db, DEFAULT_USER_ID, blog_id)
            if blog.status == "ready"
            else []
        )
        accordions.append(
            LoggedBlogAccordionResponse(
                blog_id=blog.id,
                title=blog.title,
                canonical_url=blog.canonical_url,
                logged_date=logged_dates[0],
                all_logged_dates=logged_dates,
                status=blog.status,
                error_message=blog.error_message,
                summary=blog.summary,
                flashcards=cards,
            )
        )

    return accordions


@router.patch("/flashcards/{card_id}", response_model=FlashcardItemResponse)
def update_user_flashcard(
    card_id: int,
    payload: UpdateFlashcardRequest,
    db: Session = Depends(get_db),
) -> FlashcardItemResponse:
    uc = _resolve_user_flashcard(db, DEFAULT_USER_ID, card_id)

    if payload.question is not None:
        cleaned_q = payload.question.strip()
        if not cleaned_q:
            raise HTTPException(
                status_code=400, detail="Question cannot be empty."
            )
        uc.question_override = cleaned_q

    if payload.options is not None:
        cleaned_opts = [opt.strip() for opt in payload.options if opt.strip()]
        uc.options_override_json = cleaned_opts

    if payload.answer is not None:
        cleaned_a = payload.answer.strip()
        if not cleaned_a:
            raise HTTPException(status_code=400, detail="Answer cannot be empty.")
        uc.answer_override = cleaned_a

    db.commit()
    db.refresh(uc)
    return _serialize_single_user_flashcard(db, uc)


@router.post(
    "/blogs/{blog_id}/custom-card", response_model=FlashcardItemResponse
)
def create_custom_flashcard(
    blog_id: int,
    payload: CreateCustomFlashcardRequest,
    db: Session = Depends(get_db),
) -> FlashcardItemResponse:
    blog = db.execute(select(Blog).where(Blog.id == blog_id)).scalar_one_or_none()
    if blog is None:
        raise HTTPException(status_code=404, detail=f"Blog {blog_id} not found.")

    cleaned_options = [opt.strip() for opt in payload.options if opt.strip()]

    custom_uc = UserFlashcard(
        user_id=DEFAULT_USER_ID,
        blog_id=blog.id,
        canonical_flashcard_id=None,
        question_override=payload.question.strip(),
        options_override_json=cleaned_options,
        answer_override=payload.answer.strip(),
        status="candidate",
    )
    db.add(custom_uc)
    db.commit()
    db.refresh(custom_uc)
    return _serialize_single_user_flashcard(db, custom_uc)


@router.post(
    "/flashcards/{card_id}/dismiss", response_model=FlashcardItemResponse
)
def dismiss_user_flashcard(
    card_id: int,
    db: Session = Depends(get_db),
) -> FlashcardItemResponse:
    uc = _resolve_user_flashcard(db, DEFAULT_USER_ID, card_id)
    uc.status = "dismissed"
    db.commit()
    db.refresh(uc)
    return _serialize_single_user_flashcard(db, uc)
