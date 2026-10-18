import calendar
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import DEFAULT_USER_ID
from app.database import get_db
from app.models import Blog, UserBlog
from app.schemas import (
    CalendarMonthResponse,
    DayCalendarStatus,
    LogBlogRequest,
    LoggedBlogEntry,
)
from app.services.scraper import (
    compute_content_hash,
    derive_initial_title,
    normalize_url,
)

router = APIRouter(prefix="/api", tags=["calendar"])


def _calculate_streak(logged_dates: set[date], today_date: date) -> int:
    """Calculate consecutive reading streak up to today (or yesterday if today isn't logged yet)."""
    if not logged_dates:
        return 0
    cursor = today_date if today_date in logged_dates else (today_date - timedelta(days=1))
    streak = 0
    while cursor in logged_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@router.get("/calendar", response_model=CalendarMonthResponse)
def get_calendar_month(
    month: str | None = Query(
        default=None, description="Month in YYYY-MM format (defaults to current month)"
    ),
    today: str | None = Query(
        default=None, description="Client local today date in YYYY-MM-DD format"
    ),
    db: Session = Depends(get_db),
) -> CalendarMonthResponse:
    today_date = date.today()
    if today:
        try:
            today_date = datetime.strptime(today, "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid 'today' format. Expected YYYY-MM-DD."
            ) from exc

    if month:
        try:
            year_num, month_num = map(int, month.split("-"))
            first_day = date(year_num, month_num, 1)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid 'month' format. Expected YYYY-MM."
            ) from exc
    else:
        year_num, month_num = today_date.year, today_date.month
        first_day = date(year_num, month_num, 1)

    _, days_in_month = calendar.monthrange(year_num, month_num)
    month_str = f"{year_num:04d}-{month_num:02d}"

    # Fetch all user_blogs for the user to compute overall streak and total count,
    # as well as the entries in the requested month.
    rows = db.execute(
        select(UserBlog, Blog)
        .join(Blog, UserBlog.blog_id == Blog.id)
        .where(UserBlog.user_id == DEFAULT_USER_ID)
        .order_by(UserBlog.logged_date.desc(), UserBlog.id.desc())
    ).all()

    all_logged_dates: set[date] = set()
    entries_by_date: dict[str, list[LoggedBlogEntry]] = {}

    for user_blog, blog in rows:
        all_logged_dates.add(user_blog.logged_date)
        date_str = user_blog.logged_date.isoformat()
        entries_by_date.setdefault(date_str, []).append(
            LoggedBlogEntry(
                user_blog_id=user_blog.id,
                blog_id=blog.id,
                logged_date=date_str,
                canonical_url=blog.canonical_url,
                title=blog.title,
                status=blog.status,
                error_message=blog.error_message,
                summary=blog.summary,
                deduplicated=False,
            )
        )

    days_map: dict[str, DayCalendarStatus] = {}
    for day_num in range(1, days_in_month + 1):
        current_date = date(year_num, month_num, day_num)
        date_str = current_date.isoformat()
        day_entries = entries_by_date.get(date_str, [])
        if len(day_entries) > 0:
            indicator = "green"
        elif current_date == today_date:
            indicator = "yellow"
        else:
            indicator = "none"

        days_map[date_str] = DayCalendarStatus(
            date=date_str,
            indicator=indicator,
            blog_count=len(day_entries),
            blogs=day_entries,
        )

    return CalendarMonthResponse(
        month=month_str,
        today=today_date.isoformat(),
        streak_days=_calculate_streak(all_logged_dates, today_date),
        total_logged_blogs=len(rows),
        days=days_map,
    )


@router.post("/blogs/log", response_model=LoggedBlogEntry)
def log_blog(
    payload: LogBlogRequest,
    db: Session = Depends(get_db),
) -> LoggedBlogEntry:
    raw_url = (payload.url or "").strip()
    raw_text = (payload.raw_text or "").strip()
    explicit_title = (payload.title or "").strip()

    if not raw_url and not raw_text:
        raise HTTPException(
            status_code=400,
            detail="Please provide either a blog URL or raw article text to log.",
        )

    canonical_url = normalize_url(raw_url) if raw_url else None
    content_hash = compute_content_hash(
        canonical_url=canonical_url, raw_text=raw_text if raw_text else None
    )

    # Check if canonical blog already exists by canonical_url or content_hash
    conditions = [Blog.content_hash == content_hash]
    if canonical_url:
        conditions.append(Blog.canonical_url == canonical_url)

    existing_blog = db.execute(
        select(Blog).where(or_(*conditions))
    ).scalars().first()

    deduplicated = False
    if existing_blog is not None:
        blog = existing_blog
        deduplicated = True
        if explicit_title and blog.title.startswith(("http", "Untitled")):
            blog.title = explicit_title
        if raw_text and not blog.raw_text:
            blog.raw_text = raw_text
        db.commit()
        db.refresh(blog)
    else:
        title = derive_initial_title(
            canonical_url=canonical_url,
            raw_text=raw_text if raw_text else None,
            explicit_title=explicit_title if explicit_title else None,
        )
        blog = Blog(
            canonical_url=canonical_url,
            content_hash=content_hash,
            title=title,
            raw_text=raw_text if raw_text else None,
            status="processing",
        )
        db.add(blog)
        db.commit()
        db.refresh(blog)

    # Link blog to user_blogs for the selected calendar date (avoid duplicate join row on same date)
    existing_user_blog = db.execute(
        select(UserBlog).where(
            UserBlog.user_id == DEFAULT_USER_ID,
            UserBlog.blog_id == blog.id,
            UserBlog.logged_date == payload.logged_date,
        )
    ).scalar_one_or_none()

    if existing_user_blog is not None:
        user_blog = existing_user_blog
    else:
        user_blog = UserBlog(
            user_id=DEFAULT_USER_ID,
            blog_id=blog.id,
            logged_date=payload.logged_date,
        )
        db.add(user_blog)
        db.commit()
        db.refresh(user_blog)

    return LoggedBlogEntry(
        user_blog_id=user_blog.id,
        blog_id=blog.id,
        logged_date=user_blog.logged_date.isoformat(),
        canonical_url=blog.canonical_url,
        title=blog.title,
        status=blog.status,
        error_message=blog.error_message,
        summary=blog.summary,
        deduplicated=deduplicated,
    )
