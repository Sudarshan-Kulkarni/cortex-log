from datetime import date
from typing import Literal
from pydantic import BaseModel, Field


class LogBlogRequest(BaseModel):
    logged_date: date = Field(description="Date on the calendar (YYYY-MM-DD)")
    url: str | None = Field(default=None, description="Blog post URL")
    raw_text: str | None = Field(
        default=None, description="Optional raw article text fallback"
    )
    title: str | None = Field(
        default=None, description="Optional explicit blog title override"
    )


class SubmitRawTextRequest(BaseModel):
    raw_text: str = Field(
        min_length=20, description="Pasted article text for scraping fallback"
    )
    title: str | None = Field(
        default=None, description="Optional updated title for the blog"
    )


class LoggedBlogEntry(BaseModel):
    user_blog_id: int
    blog_id: int
    logged_date: str
    canonical_url: str | None
    title: str
    status: Literal["processing", "ready", "scrape_failed"] | str
    error_message: str | None = None
    summary: str | None = None
    deduplicated: bool = False


class DayCalendarStatus(BaseModel):
    date: str
    indicator: Literal["green", "yellow", "none"]
    blog_count: int
    blogs: list[LoggedBlogEntry]


class CalendarMonthResponse(BaseModel):
    month: str
    today: str
    streak_days: int
    total_logged_blogs: int
    days: dict[str, DayCalendarStatus]


class FlashcardItemResponse(BaseModel):
    card_id: int = Field(description="UserFlashcard ID used for curation actions")
    canonical_flashcard_id: int | None = None
    blog_id: int
    chunk_index: int = 0
    question: str
    options: list[str]
    answer: str
    status: Literal["candidate", "dismissed", "queued_for_anki", "synced_to_anki"] | str
    is_custom: bool = False
    is_edited: bool = False


class UpdateFlashcardRequest(BaseModel):
    question: str | None = Field(default=None, description="Edited question text")
    options: list[str] | None = Field(
        default=None, description="Edited multiple-choice options"
    )
    answer: str | None = Field(
        default=None, description="Edited answer and explanation"
    )


class CreateCustomFlashcardRequest(BaseModel):
    question: str = Field(min_length=3, description="Custom flashcard question")
    options: list[str] = Field(
        default_factory=list,
        description="Optional multiple-choice options (can be empty for open Q&A)",
    )
    answer: str = Field(min_length=1, description="Custom flashcard answer")


class LoggedBlogAccordionResponse(BaseModel):
    blog_id: int
    title: str
    canonical_url: str | None
    logged_date: str
    all_logged_dates: list[str]
    status: Literal["processing", "ready", "scrape_failed"] | str
    error_message: str | None = None
    summary: str | None = None
    flashcards: list[FlashcardItemResponse] = []
