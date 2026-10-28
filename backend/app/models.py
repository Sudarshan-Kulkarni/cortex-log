from datetime import date, datetime, timezone
from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

JSONVariant = JSON().with_variant(JSONB(), "postgresql")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clerk_user_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class APIKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    hashed_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Blog(Base):
    __tablename__ = "blogs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    canonical_url: Mapped[str | None] = mapped_column(
        String(2048), nullable=True, index=True
    )
    content_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), default="processing", nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class UserBlog(Base):
    __tablename__ = "user_blogs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    blog_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("blogs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    logged_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class Flashcard(Base):
    __tablename__ = "flashcards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    blog_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("blogs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[list[str]] = mapped_column(JSONVariant, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class UserFlashcard(Base):
    __tablename__ = "user_flashcards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    blog_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("blogs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    canonical_flashcard_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("flashcards.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    question_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    options_override_json: Mapped[list[str] | None] = mapped_column(
        JSONVariant, nullable=True
    )
    answer_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), default="candidate", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
