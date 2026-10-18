---
doc: prd
status: approved
---

# Cortex Log — Product Requirements

A technical reading tracker and Anki companion for software engineers that logs daily blog reading on a monthly calendar, scrapes and chunks articles via a message queue to generate detail-focused flashcards, and queues approved cards for delivery to Anki via AnkiConnect.
Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`, `scope.md > The Core Loop`.

## The Core Journey
Source: `scope.md > The Core Loop`, `scope.md > What "Working" Looks Like`

1. **Arrival on the Calendar Tab:** You open Cortex Log and land on the **Calendar** tab showing the current month. Days where you already logged at least one blog show a **green circle** in the corner. Today's date shows a **yellow circle** in the corner if you haven't logged a blog yet today (and other unlogged days show no circle).
2. **Logging a Blog:** You click on today's date (or any day cell) on the calendar. An input form appears for that day where you paste a blog URL (or raw text, plus an optional title if pasting raw text) and click **"Log it"**.
3. **Immediate Streak Update & Background Ingestion:** As soon as you click **"Log it"**, that day's corner indicator turns **green**. Behind the scenes, Cortex Log checks if this blog has already been scraped (by normalized URL or content hash):
   - If already scraped and processed, it immediately links the existing blog and its canonical flashcards to your reading log.
   - If new, it publishes a blog-processing job to the message queue so a background worker scrapes the article body, chunks it, generates a summary, and extracts detail-level multiple-choice/Q&A flashcards into Postgres.
4. **Switching to the Flashcards Tab:** You click the **Flashcards (Dashboard)** tab. You see an **Accordion list** of every blog you've logged (displaying the blog title on each accordion header, along with a status badge).
5. **Reviewing & Curating Flashcards:** You click a blog's accordion header to expand it:
   - While the background worker is still running, the expanded panel says: *"The cards haven't been generated yet, check back in a bit."*
   - If the URL scrape failed (e.g., paywall or bot protection), the expanded panel displays the scrape error message alongside a raw-text paste form so you can submit the article text directly into the same processing pipeline.
   - Once processed, the expanded panel displays the generated flashcards in a **2-column grid layout**, plus an **"Add Custom Card"** button.
6. **Editing, Customizing, and Approving Cards (`✓` / `✕`):**
   - Each card shows the question, editable multiple-choice options, and the answer/explanation. You can edit the card's text or options inline, or add a brand-new custom card for that blog.
   - At the bottom of each card are two action buttons: **Check (`✓`)** and **X (`✕`)**.
   - Pressing **`✕`** dismisses/deletes the card *for your user only* (hiding it from your view while keeping the canonical generated card in the database for other users).
   - Pressing **`✓`** pushes that card (including any edits you made) onto the **Anki delivery message queue** and marks it as queued/synced for Anki.
7. **Delivery to Anki:** The background worker consumes the Anki delivery queue and pushes the approved card into your local Anki deck (`"Cortex Log"`) via AnkiConnect (or holds it in a **"Queued for Anki"** state with retry if Anki isn't currently open).

## Screens and Layout
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`

Cortex Log is a single-page web application with a top navigation bar switching between **two tabs**:

1. **Tab 1 — Reading Calendar (`Calendar`):**
   - **Header & Streak Summary:** Project title, current month/year navigation, and a quick indicator of your reading streak.
   - **Monthly Calendar Grid:** Standard 7-column monthly calendar. Each day cell displays the day number in the corner alongside a status dot:
     - **Green circle:** At least 1 blog logged on that date.
     - **Yellow circle:** Current day (today) when 0 blogs have been logged so far today.
     - **No circle:** Any past or future day with 0 blogs logged.
   - **Selected Day Drawer / Panel:** Clicking any day cell opens the day panel showing blogs already logged on that date and the **"Log a Blog"** form (URL input, optional raw text input, optional title override, and the **"Log it"** submit button).

2. **Tab 2 — Flashcard Curation Dashboard (`Flashcards`):**
   - **Top Bar:** Shows AnkiConnect connection status / queued card count and a manual **"Retry / Sync Queued Cards"** trigger if Anki was closed earlier.
   - **Blog Accordions:** Vertical stack of accordion items—one per logged blog—labelled with the **blog title**, logged date, and processing status badge (`Processing`, `Needs Raw Text`, or `X Cards Ready`).
   - **Expanded Accordion Body:**
     - Brief article summary at the top and an **"+ Add Custom Card"** button.
     - **2-Column Flashcard Grid:** Each card tile displays the question, editable multiple-choice options, answer reveal/editor, and the bottom action bar with **`✓` (Approve & Queue for Anki)** and **`✕` (Dismiss for Me)**.

## Look and Feel
Source: `scope.md > Inspiration & Identity`

- **Color Palette:** Warm **manila-paper background** (`#F3E9D2` / `#EFE4CE` parchment tones) paired with crisp dark charcoal/ink text (`#1C1B18`), exposed thin technical grid borders, **emerald green** (`#16A34A`) for completed reading-day circles and `✓` actions, **amber yellow** (`#EAB308`) for today's unlogged indicator, and muted rust red for `✕` / error states.
- **Aesthetic & Typography ("Techy Manila Blueprint"):** Feels like an engineer's tactile technical blueprint or field manual—combining the warm manila paper backdrop with monospace typography (e.g., `JetBrains Mono` / `IBM Plex Mono`) for dates, badges, queue statuses, and card metadata, and clean sans-serif for readable flashcard bodies.
- **Avoid:** Generic purple/indigo AI gradients or sterile pure-white corporate SaaS templates.

## Features and Behavior

### 1. Monthly Reading Calendar & Logging (`scope.md > The Core Loop`, `scope.md > The POC Boundary`)
- As a software engineer logging my daily reading, I want to click a day on a monthly calendar and submit a blog URL (or raw text) so that my reading habit is visually tracked and the blog is queued for extraction.
  - [ ] Today's calendar cell displays a **yellow circle** in the corner when no blogs are logged for today, and immediately changes to a **green circle** once a blog is logged for today.
  - [ ] Any calendar day with at least one logged blog displays a **green circle** in the corner; other days with zero blogs display no circle.
  - [ ] Clicking a day cell reveals the blogs logged on that date and the form to submit a URL (or raw text) via the **"Log it"** button.
  - [ ] Submitting a URL that already exists in the canonical `blogs` table (and is already processed) links it to the user's log immediately without re-scraping or re-running the LLM.

### 2. Asynchronous Scraping & Chunked Card Generation (`scope.md > The Unique Kernel`, `scope.md > The POC Boundary`)
- As a reader, I want a background worker to scrape new blog URLs, chunk the content, and extract detail-oriented flashcards via a message queue so that minute technical details are captured without blocking the UI.
  - [ ] Submitting a new blog URL enqueues a background job and sets the blog's initial status to `processing`.
  - [ ] Expanding an unprocessed blog's accordion on the Flashcards tab displays: *"The cards haven't been generated yet, check back in a bit."*
  - [ ] When scraping fails (e.g., invalid URL, 403/paywall, or empty body), the blog status updates to `scrape_failed` and expanding its accordion displays the specific error message alongside a raw-text input form and submit button that sends the raw text through the same chunking + LLM generation pipeline.
  - [ ] When processing succeeds, the canonical blog title, summary, and chunk-extracted flashcards (question, multiple-choice options, and answer/explanation) are saved to Postgres and visible in the expanded accordion's 2-column grid.

### 3. Per-User Flashcard Curation, Editing, and Custom Cards (`scope.md > The Core Loop`, `scope.md > The POC Boundary`)
- As a learner curating flashcards, I want to edit card text/options, add custom cards, or dismiss unwanted cards (`✕`) on a per-user basis so that my deck is tailored to me without corrupting the canonical blog cards for other users.
  - [ ] Generated flashcards inside an expanded blog accordion render in a **2-column grid**, each with **`✓`** and **`✕`** buttons at the bottom.
  - [ ] Clicking **`✕`** marks the card as dismissed for the current user and removes it from their grid, while the canonical flashcard row remains intact in Postgres.
  - [ ] Users can edit a card's question text, multiple-choice options, or answer inline before approving; edits are saved to the user's card state without overwriting the canonical card.
  - [ ] Users can click **"+ Add Custom Card"** inside any processed blog accordion to create a user-specific flashcard with question, options (optional), and answer.

### 4. Queued Delivery to Anki (`scope.md > What "Working" Looks Like`, `scope.md > The POC Boundary`)
- As an Anki user, I want clicking **`✓`** on a card to push it onto a message queue so that my local Anki Desktop app (via the Cortex Log Anki add-on) pulls and adds curated cards to my Anki deck automatically.
  - [ ] Clicking **`✓`** on a flashcard updates its state to **`Queued for Anki`** and publishes a delivery job to the message queue.
  - [ ] When Anki Desktop opens (or when sync is triggered via the Cortex Log Anki add-on), it pulls all queued cards from the backend queue, creates the target deck (`Cortex Log`, if not already present), adds the formatted note (Front: Question + choices; Back: Answer + source blog link), and acknowledges delivery so the card state updates to **`Synced to Anki`**.
  - [ ] If Anki Desktop is closed when `✓` is clicked, the card remains visibly in the **`Queued for Anki`** state and syncs automatically the next time Anki opens.

## States and Boundaries

- **First Use / Empty State:**
  - Calendar Tab: Current month is shown with today marked by a **yellow circle** in the corner and all other days blank. Clicking today invites you to log your first blog.
  - Flashcards Tab (0 blogs logged): Displays an empty-state message prompting you to log a blog on the Calendar tab first.
- **Processing State:** Accordion header shows a `Processing` badge; expanded body shows *"The cards haven't been generated yet, check back in a bit."*
- **Scrape Failed State:** Accordion header shows a `Needs Raw Text` badge; expanded body explains why the URL couldn't be scraped and provides a textarea + button to paste the article text and resume processing.
- **Anki Offline / Queued State:** Cards approved with `✓` while Anki Desktop is closed stay in `Queued for Anki` status in Postgres/queue rather than failing silently, and sync when Anki is opened and retry is triggered.
- **Persistence & Multi-User Boundary:** All canonical blogs, canonical flashcards, user reading logs (`user_blogs`), and per-user flashcard states/edits/custom cards persist in Postgres scoped to `user_id` (seeded with a default user for the PoC).

## Product Decisions

- **Monthly calendar with green/yellow corner dots over a full-year heatmap:** Chosen because the monthly calendar is easier to read and interact with day-by-day, using yellow to nudge today's reading and green to reward logged days.
- **Accordion list + 2-column flashcard grid on a separate tab:** Keeps the Calendar tab clean and dedicated to habit tracking/logging while giving flashcards enough horizontal space to read and edit.
- **Per-user card actions (`✓`, `✕`, edits, custom cards) separated from canonical generated cards:** Ensures that scraping and LLM extraction happen once per blog across all users while each user controls their own Anki curation.
- **Message queue used for both Blog Ingestion and Anki Delivery:** Decouples both slow/external operations (web scraping + LLM generation, and local AnkiConnect network calls) from UI clicks.
- **Scrape failure falls back to inline raw-text entry inside the accordion:** Websites frequently block scrapers; letting the user paste raw text right inside the failed blog's accordion recovers the workflow without creating a duplicate blog log.
- **Manila-paper + techy blueprint aesthetic:** Gives the app a distinctive, readable engineering-notebook feel rather than generic AI-app styling.

## What We're Building
1. Two-tab web UI (`Calendar` and `Flashcards`) styled in the techy manila-paper aesthetic.
2. Monthly calendar with green/yellow corner indicators and click-to-log drawer (`URL` or `raw text` + **"Log it"** button).
3. Multi-user Postgres schema (`users`, `blogs`, `user_blogs`, canonical `flashcards`, and `user_flashcards` for per-user status/edits/custom cards) with URL/content-hash deduplication.
4. Message-queue-backed background worker for:
   - Blog scraping, text chunking, LLM summary + detail-focused multiple-choice flashcard generation.
   - Delivering `✓`-approved flashcards to Anki via AnkiConnect (`Cortex Log` deck).
5. Flashcard curation accordion view with 2-column card grid, inline editing of question/options/answer, custom card creation, per-user `✓` / `✕` actions, and scrape-failure raw-text recovery.

## Deferred From the POC
- **User Login / Auth Screens:** The database schema supports multiple users via `user_id`, but the PoC uses a seeded default user so the build focuses on the core calendar, message queue, and Anki pipeline.
- **Vector Embeddings & Semantic Search:** Chunks are extracted for detail-level flashcard generation now; storing vector embeddings (`pgvector`) for semantic querying across blogs is saved for Phase 2.
- **PDF Book & Paper Upload:** Deferred until after the URL and raw-text pipeline is proven.

## Possible Later Enhancements
- **Per-User Duplicate Log Prevention / Warning:** Detect when the same user attempts to log a blog URL they already logged on an earlier date and warn or prevent duplicate `user_blogs` entries across dates.
- **Custom Anki Deck & Tag Selector per Blog:** Let users pick different Anki sub-decks (e.g., `Cortex Log::Distributed Systems`) when approving cards.
- **Highlight / Focus Hint on Log:** Optional field when logging a blog to tell the LLM which section or concept you care about most.

## Non-Goals
- **In-app Spaced Repetition Scheduling:** Cortex Log does not schedule reviews or replace Anki; Anki is the review engine.

## Open Questions
- None blocking `4-spec`. (In `4-spec`, we will choose the exact web stack, Postgres setup, and message queue implementation.)
