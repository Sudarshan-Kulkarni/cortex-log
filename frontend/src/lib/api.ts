function getApiBase(): string {
  if (typeof window !== "undefined") {
    const winUrl = (window as unknown as { __CORTEX_API_URL__?: string })
      .__CORTEX_API_URL__;
    if (winUrl) return winUrl.replace(/\/$/, "");
  }
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:8010"
  );
}

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

export interface UpdateFlashcardPayload {
  question?: string;
  options?: string[];
  answer?: string;
}

export interface CreateCustomFlashcardPayload {
  question: string;
  options: string[];
  answer: string;
}

export interface AnkiQueueStatus {
  deck_name: string;
  queued_count: number;
  synced_count: number;
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
  token: string,
  today?: string
): Promise<CalendarMonthResponse> {
  const todayParam = today || getLocalTodayIso();
  const res = await fetch(
    `${getApiBase()}/api/calendar?month=${encodeURIComponent(
      month
    )}&today=${encodeURIComponent(todayParam)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to load calendar (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function logBlogEntry(
  payload: LogBlogPayload,
  token: string
): Promise<LoggedBlogEntry> {
  const res = await fetch(`${getApiBase()}/api/blogs/log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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

export async function fetchLoggedBlogsWithFlashcards(
  token: string
): Promise<LoggedBlogAccordion[]> {
  const res = await fetch(`${getApiBase()}/api/blogs/logged`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
  token: string,
  title?: string
): Promise<LoggedBlogEntry> {
  const res = await fetch(`${getApiBase()}/api/blogs/${blogId}/raw-text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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

export async function updateFlashcard(
  cardId: number,
  payload: UpdateFlashcardPayload,
  token: string
): Promise<FlashcardItem> {
  const res = await fetch(`${getApiBase()}/api/flashcards/${cardId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Failed to update flashcard (${res.status})`;
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

export async function createCustomFlashcard(
  blogId: number,
  payload: CreateCustomFlashcardPayload,
  token: string
): Promise<FlashcardItem> {
  const res = await fetch(`${getApiBase()}/api/blogs/${blogId}/custom-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Failed to create custom card (${res.status})`;
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

export async function dismissFlashcard(
  cardId: number,
  token: string
): Promise<FlashcardItem> {
  const res = await fetch(`${getApiBase()}/api/flashcards/${cardId}/dismiss`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let message = `Failed to dismiss flashcard (${res.status})`;
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

export async function approveFlashcard(
  cardId: number,
  token: string
): Promise<FlashcardItem> {
  const res = await fetch(`${getApiBase()}/api/flashcards/${cardId}/approve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let message = `Failed to approve flashcard for Anki (${res.status})`;
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

export async function fetchAnkiQueueStatus(
  token: string
): Promise<AnkiQueueStatus> {
  const res = await fetch(`${getApiBase()}/api/anki/status`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to load Anki queue status (${res.status})`);
  }
  return res.json();
}
