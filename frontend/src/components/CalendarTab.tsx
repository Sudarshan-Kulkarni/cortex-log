"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Flame,
  Link2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import {
  CalendarMonthResponse,
  fetchCalendarMonth,
  getLocalTodayIso,
  logBlogEntry,
  LoggedBlogEntry,
} from "@/lib/api";

interface CalendarTabProps {
  onSwitchToFlashcards?: () => void;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getMonthParts(monthIso: string): { year: number; monthIndex: number } {
  const [y, m] = monthIso.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}

function formatMonthIso(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export default function CalendarTab({ onSwitchToFlashcards }: CalendarTabProps) {
  const { getToken } = useAuth();
  const todayIso = useMemo(() => getLocalTodayIso(), []);
  const initialMonth = useMemo(() => todayIso.slice(0, 7), [todayIso]);

  const [currentMonth, setCurrentMonth] = useState<string>(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [calendarData, setCalendarData] =
    useState<CalendarMonthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Log form state
  const [urlInput, setUrlInput] = useState<string>("");
  const [rawTextInput, setRawTextInput] = useState<string>("");
  const [titleInput, setTitleInput] = useState<string>("");
  const [showRawText, setShowRawText] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: "success" | "error";
    message: string;
    deduplicated?: boolean;
  } | null>(null);

  const loadMonth = useCallback(
    async (monthStr: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const data = await fetchCalendarMonth(monthStr, token, todayIso);
        setCalendarData(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load calendar."
        );
      } finally {
        setLoading(false);
      }
    },
    [todayIso]
  );

  useEffect(() => {
    loadMonth(currentMonth);
  }, [currentMonth, loadMonth]);

  const { year, monthIndex } = getMonthParts(currentMonth);
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const handlePrevMonth = () => {
    const prevDate = new Date(year, monthIndex - 1, 1);
    const nextMonthStr = formatMonthIso(
      prevDate.getFullYear(),
      prevDate.getMonth()
    );
    setCurrentMonth(nextMonthStr);
    setSelectedDate(`${nextMonthStr}-01`);
    setSubmitFeedback(null);
  };

  const isCurrentOrFutureMonth = currentMonth >= todayIso.slice(0, 7);

  const handleNextMonth = () => {
    if (isCurrentOrFutureMonth) return;
    const nextDate = new Date(year, monthIndex + 1, 1);
    const nextMonthStr = formatMonthIso(
      nextDate.getFullYear(),
      nextDate.getMonth()
    );
    setCurrentMonth(nextMonthStr);
    setSelectedDate(
      nextMonthStr === todayIso.slice(0, 7) ? todayIso : `${nextMonthStr}-01`
    );
    setSubmitFeedback(null);
  };

  const handleJumpToday = () => {
    setCurrentMonth(todayIso.slice(0, 7));
    setSelectedDate(todayIso);
    setSubmitFeedback(null);
  };

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() && !rawTextInput.trim()) {
      setSubmitFeedback({
        type: "error",
        message: "Paste a blog URL or raw article text before logging.",
      });
      return;
    }

    setSubmitting(true);
    setSubmitFeedback(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const logged: LoggedBlogEntry = await logBlogEntry(
        {
          logged_date: selectedDate,
          url: urlInput.trim() || undefined,
          raw_text: rawTextInput.trim() || undefined,
          title: titleInput.trim() || undefined,
        },
        token
      );

      // Optimistically update the selected day cell so its corner dot turns green immediately
      setCalendarData((prev) => {
        if (!prev) return prev;
        const existingDay = prev.days[selectedDate] || {
          date: selectedDate,
          indicator: "none",
          blog_count: 0,
          blogs: [],
        };
        const alreadyInList = existingDay.blogs.some(
          (b) => b.user_blog_id === logged.user_blog_id
        );
        const updatedBlogs = alreadyInList
          ? existingDay.blogs
          : [logged, ...existingDay.blogs];

        return {
          ...prev,
          total_logged_blogs: alreadyInList
            ? prev.total_logged_blogs
            : prev.total_logged_blogs + 1,
          streak_days:
            selectedDate === todayIso && prev.streak_days === 0
              ? 1
              : prev.streak_days,
          days: {
            ...prev.days,
            [selectedDate]: {
              ...existingDay,
              indicator: "green",
              blog_count: updatedBlogs.length,
              blogs: updatedBlogs,
            },
          },
        };
      });

      setUrlInput("");
      setRawTextInput("");
      setTitleInput("");
      setSubmitFeedback({
        type: "success",
        message: logged.deduplicated
          ? `Linked existing canonical blog "${logged.title}" to ${selectedDate} (skipped duplicate scrape).`
          : `Logged "${logged.title}" for ${selectedDate} and queued for extraction.`,
        deduplicated: logged.deduplicated,
      });

      // Refresh calendar in background to sync exact streak count
      loadMonth(currentMonth);
    } catch (err) {
      setSubmitFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to log blog.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDayInfo = calendarData?.days[selectedDate] || {
    date: selectedDate,
    indicator: selectedDate === todayIso ? "yellow" : "none",
    blog_count: 0,
    blogs: [],
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 8 Columns: Monthly Calendar Grid */}
      <div className="lg:col-span-8 blueprint-card p-5">
        {/* Calendar Header & Month Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-ink">
          <div>
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-ink" />
              <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                Reading Log Matrix // {currentMonth}
              </span>
            </div>
            <h2 className="font-mono text-2xl font-bold tracking-tight mt-0.5">
              {MONTH_NAMES[monthIndex]} {year}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Streak & Total Counter */}
            <div className="flex items-center gap-3 bg-manila px-3 py-1.5 border border-ink font-mono text-xs">
              <span className="inline-flex items-center gap-1 font-semibold">
                <Flame className="w-3.5 h-3.5 text-status-yellow fill-status-yellow" />
                {calendarData?.streak_days ?? 0}d streak
              </span>
              <span className="text-ink-muted">|</span>
              <span>{calendarData?.total_logged_blogs ?? 0} logged</span>
            </div>

            {/* Month Controls */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="blueprint-btn-secondary px-2 py-1.5"
                aria-label="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleJumpToday}
                className="blueprint-btn-secondary px-2.5 py-1.5"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                disabled={isCurrentOrFutureMonth}
                className="blueprint-btn-secondary px-2 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Legend Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 font-mono text-xs text-ink-muted">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-status-green border border-ink inline-block" />
              Logged (≥1 blog)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-status-yellow border border-ink inline-block" />
              Today (unlogged)
            </span>
          </div>
          <span>Click any day cell to view or log reading</span>
        </div>

        {error && (
          <div className="mb-4 p-3 border border-status-red bg-status-red/10 text-status-red font-mono text-xs">
            {error}
          </div>
        )}

        {/* 7-Column Weekday Headers */}
        <div className="grid grid-cols-7 border-t border-l border-ink bg-manila-muted">
          {WEEKDAYS.map((dayName) => (
            <div
              key={dayName}
              className="py-2 text-center font-mono text-xs font-bold tracking-wider border-r border-b border-ink"
            >
              {dayName}
            </div>
          ))}
        </div>

        {/* 7-Column Calendar Cells */}
        <div className="grid grid-cols-7 border-l border-ink">
          {/* Leading Empty Padding Cells */}
          {Array.from({ length: firstWeekday }).map((_, idx) => (
            <div
              key={`pad-${idx}`}
              className="h-24 sm:h-28 bg-manila/50 border-r border-b border-ink"
            />
          ))}

          {/* Actual Month Day Cells */}
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const dayNum = idx + 1;
            const dateStr = `${currentMonth}-${String(dayNum).padStart(
              2,
              "0"
            )}`;
            const dayStatus = calendarData?.days[dateStr];
            const indicator =
              dayStatus?.indicator ??
              (dateStr === todayIso ? "yellow" : "none");
            const blogsForDay = dayStatus?.blogs ?? [];
            const isSelected = selectedDate === dateStr;
            const isToday = dateStr === todayIso;
            const isFuture = dateStr > todayIso;

            return (
              <button
                key={dateStr}
                type="button"
                disabled={isFuture}
                onClick={() => {
                  if (isFuture) return;
                  setSelectedDate(dateStr);
                  setSubmitFeedback(null);
                }}
                data-testid={`calendar-day-${dateStr}`}
                data-indicator={indicator}
                className={`h-24 sm:h-28 p-2 text-left border-r border-b border-ink flex flex-col justify-between transition-colors relative group ${
                  isFuture
                    ? "bg-manila/40 opacity-45 cursor-not-allowed"
                    : isSelected
                    ? "bg-manila-muted ring-2 ring-inset ring-ink"
                    : "bg-manila-card hover:bg-manila"
                }`}
              >
                {/* Top Corner Row: Day Number + Corner Circle */}
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`font-mono text-xs sm:text-sm font-bold ${
                      isFuture
                        ? "text-ink-muted"
                        : isToday
                        ? "underline decoration-2 underline-offset-4"
                        : "text-ink"
                    }`}
                  >
                    {String(dayNum).padStart(2, "0")}
                  </span>

                  {/* Status Dot in Corner */}
                  {indicator === "green" && (
                    <span
                      title={`${blogsForDay.length} blog(s) logged on ${dateStr}`}
                      data-testid={`dot-green-${dateStr}`}
                      className="w-3 h-3 rounded-full bg-status-green border border-ink shadow-[1px_1px_0px_#1C1B18]"
                    />
                  )}
                  {indicator === "yellow" && (
                    <span
                      title="Today — no blog logged yet"
                      data-testid={`dot-yellow-${dateStr}`}
                      className="w-3 h-3 rounded-full bg-status-yellow border border-ink shadow-[1px_1px_0px_#1C1B18]"
                    />
                  )}
                </div>

                {/* Bottom Preview of Logged Blogs */}
                <div className="w-full space-y-1 overflow-hidden">
                  {blogsForDay.slice(0, 2).map((b) => (
                    <div
                      key={b.user_blog_id}
                      className="text-[11px] font-mono truncate px-1.5 py-0.5 bg-manila border border-ink/60 text-ink"
                    >
                      {b.title}
                    </div>
                  ))}
                  {blogsForDay.length > 2 && (
                    <div className="text-[10px] font-mono text-ink-muted">
                      +{blogsForDay.length - 2} more
                    </div>
                  )}
                  {blogsForDay.length === 0 && isToday && (
                    <div className="text-[10px] font-mono text-ink-muted opacity-80">
                      Click to log today
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right 4 Columns: Selected Day Drawer / Log Panel */}
      <div className="lg:col-span-4 space-y-5">
        <div className="blueprint-card p-5">
          {/* Selected Date Header */}
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-ink">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted block">
                Selected Date
              </span>
              <h3 className="font-mono text-lg font-bold flex items-center gap-2">
                {selectedDate}
                {selectedDate === todayIso && (
                  <span className="text-[11px] px-1.5 py-0.5 bg-manila border border-ink font-normal">
                    TODAY
                  </span>
                )}
              </h3>
            </div>

            {/* Day Status Indicator Pill */}
            <div className="flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 border border-ink bg-manila">
              {selectedDayInfo.indicator === "green" && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-status-green border border-ink" />
                  <span>LOGGED</span>
                </>
              )}
              {selectedDayInfo.indicator === "yellow" && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-status-yellow border border-ink" />
                  <span>UNLOGGED TODAY</span>
                </>
              )}
              {selectedDayInfo.indicator === "none" && (
                <span className="text-ink-muted">NO LOGS</span>
              )}
            </div>
          </div>

          {/* Log a Blog Form */}
          <form onSubmit={handleLogSubmit} className="space-y-3.5">
            <div>
              <label
                htmlFor="blog-url-input"
                className="block font-mono text-xs font-bold uppercase tracking-wider mb-1"
              >
                <span className="inline-flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5" />
                  Technical Blog URL
                </span>
              </label>
              <input
                id="blog-url-input"
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://engineering.example.com/post-slug"
                className="blueprint-input font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="blog-title-input"
                className="block font-mono text-xs uppercase tracking-wider text-ink-muted mb-1"
              >
                Optional Title Override
              </label>
              <input
                id="blog-title-input"
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Auto-detected from article if left blank"
                className="blueprint-input"
              />
            </div>

            {/* Toggleable Raw Text Fallback */}
            <div>
              <button
                type="button"
                onClick={() => setShowRawText((prev) => !prev)}
                className="font-mono text-xs underline underline-offset-4 text-ink-muted hover:text-ink inline-flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                {showRawText
                  ? "Hide raw article text fallback"
                  : "Or paste raw article text directly"}
              </button>

              {showRawText && (
                <textarea
                  id="blog-raw-text-input"
                  rows={5}
                  value={rawTextInput}
                  onChange={(e) => setRawTextInput(e.target.value)}
                  placeholder="Paste full technical blog or paper prose here..."
                  className="blueprint-input mt-2 font-sans"
                />
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              data-testid="log-it-button"
              className="blueprint-btn w-full py-2.5 text-sm font-bold"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Log it
                </>
              )}
            </button>
          </form>

          {/* Submission Feedback Banner */}
          {submitFeedback && (
            <div
              className={`mt-4 p-3 border font-mono text-xs space-y-2 ${
                submitFeedback.type === "success"
                  ? "border-status-green bg-status-green/10 text-ink"
                  : "border-status-red bg-status-red/10 text-status-red"
              }`}
            >
              <div className="flex items-start gap-2">
                {submitFeedback.type === "success" && (
                  <CheckCircle2 className="w-4 h-4 text-status-green shrink-0 mt-0.5" />
                )}
                <span>{submitFeedback.message}</span>
              </div>
              {submitFeedback.type === "success" && onSwitchToFlashcards && (
                <button
                  type="button"
                  onClick={onSwitchToFlashcards}
                  className="blueprint-btn-secondary w-full text-center mt-1"
                >
                  Open Flashcards Accordion →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Blogs Logged on Selected Date */}
        <div className="blueprint-card p-5">
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-ink">
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Logged on {selectedDate} ({selectedDayInfo.blogs.length})
            </h4>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          </div>

          {selectedDayInfo.blogs.length === 0 ? (
            <p className="text-xs font-mono text-ink-muted py-3">
              No blogs logged for {selectedDate} yet. Paste a URL above and
              click &ldquo;Log it&rdquo; to turn this day&apos;s indicator
              green.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {selectedDayInfo.blogs.map((blog) => (
                <li
                  key={blog.user_blog_id}
                  className="p-3 bg-manila border border-ink text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-ink leading-snug">
                      {blog.title}
                    </span>
                    <span
                      className={`font-mono text-[10px] uppercase px-1.5 py-0.5 border border-ink shrink-0 ${
                        blog.status === "ready"
                          ? "bg-status-green text-white"
                          : blog.status === "scrape_failed"
                          ? "bg-status-red text-white"
                          : "bg-status-yellow text-ink"
                      }`}
                    >
                      {blog.status}
                    </span>
                  </div>

                  {blog.canonical_url && (
                    <a
                      href={blog.canonical_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-ink-muted hover:text-ink underline inline-flex items-center gap-1 break-all"
                    >
                      {blog.canonical_url}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
