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
