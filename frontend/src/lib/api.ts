const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8010";

export interface LoggedBlogEntry {
  user_blog_id: number;
  blog_id: number;
  logged_date: string;
  canonical_url: string | null;
  title: string;
  status: "processing" | "ready" | "scrape_failed" | string;
  error_message: string | null;
  summary: string | null;
  deduplicated: boolean;
}

export interface DayCalendarStatus {
  date: string;
  indicator: "green" | "yellow" | "none";
  blog_count: number;
  blogs: LoggedBlogEntry[];
}

export interface CalendarMonthResponse {
  month: string;
  today: string;
  streak_days: number;
  total_logged_blogs: number;
  days: Record<string, DayCalendarStatus>;
}

export interface LogBlogPayload {
  logged_date: string;
  url?: string;
  raw_text?: string;
  title?: string;
}

export interface FlashcardItem {
  card_id: number;
  canonical_flashcard_id: number | null;
  blog_id: number;
  chunk_index: number;
  question: string;
  options: string[];
  answer: string;
  status: "candidate" | "dismissed" | "queued_for_anki" | "synced_to_anki" | string;
  is_custom: boolean;
  is_edited: boolean;
}

export interface LoggedBlogAccordion {
  blog_id: number;
  title: string;
  canonical_url: string | null;
  logged_date: string;
  all_logged_dates: string[];
  status: "processing" | "ready" | "scrape_failed" | string;
  error_message: string | null;
  summary: string | null;
  flashcards: FlashcardItem[];
}

export function getLocalTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function fetchCalendarMonth(
  month: string,
  today?: string
): Promise<CalendarMonthResponse> {
  const todayParam = today || getLocalTodayIso();
  const res = await fetch(
    `${API_BASE_URL}/api/calendar?month=${encodeURIComponent(
      month
    )}&today=${encodeURIComponent(todayParam)}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to load calendar (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function logBlogEntry(
  payload: LogBlogPayload
): Promise<LoggedBlogEntry> {
  const res = await fetch(`${API_BASE_URL}/api/blogs/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Failed to log blog (${res.status})`;
    try {
      const errData = await res.json();
      if (errData.detail) message = errData.detail;
    } catch {
      // ignore json parse failure
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchLoggedBlogsWithFlashcards(): Promise<
  LoggedBlogAccordion[]
> {
  const res = await fetch(`${API_BASE_URL}/api/blogs/logged`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to load logged blogs (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function submitBlogRawText(
  blogId: number,
  rawText: string,
  title?: string
): Promise<LoggedBlogEntry> {
  const res = await fetch(`${API_BASE_URL}/api/blogs/${blogId}/raw-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_text: rawText,
      title: title?.trim() || undefined,
    }),
  });
  if (!res.ok) {
    let message = `Failed to submit raw text (${res.status})`;
    try {
      const errData = await res.json();
      if (errData.detail) message = errData.detail;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json();
}
