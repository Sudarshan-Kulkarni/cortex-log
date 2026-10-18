---
doc: scope
status: approved
---

# Cortex Log

A technical reading tracker and Anki companion that logs the engineering blogs you read on a streak calendar, scrapes and chunks them in the background via a message queue, extracts detail-level flashcards, and pushes your chosen cards straight to Anki via AnkiConnect.

## The Unique Kernel
Most tools either track reading habits without helping you retain anything, or generate surface-level AI summaries that gloss over the single crucial sentence in a technical post. Cortex Log pairs a visual daily reading-streak calendar with an asynchronous, chunk-based extraction pipeline that hunts for concrete technical mechanisms and minute details—turning today's blog post into curated Anki flashcards in one flow.

## Who It's For
Software engineers (starting with the creator) who read technical blogs regularly to keep up with engineering trends and already use Anki for spaced repetition, but lack a seamless bridge from "I just finished reading this post" to "it's logged in my reading history and the best technical details are in my Anki deck."

## The Core Loop
1. Finish reading a tech blog and paste the URL (or raw text) on the Calendar/Log tab.
2. Today's square on the reading calendar turns green immediately. If the blog (by canonical URL or content hash) has already been scraped and processed, it links straight to your reading log; otherwise, a message queue dispatches a background worker to scrape the article body once, chunk it, generate a summary, and extract candidate Q&A flashcards into Postgres.
3. Switch to the Flashcards/Dashboard tab, select the candidate flashcards worth keeping from your logged blogs, and click to push them straight into Anki via AnkiConnect.

## Inspiration & Identity
- **Green Reading Calendar:** GitHub-style daily activity calendar where days with at least one logged blog light up green.
- **Anki Companion:** Built to feed directly into a local Anki setup via AnkiConnect rather than reinventing spaced repetition.

## Why This Matters to the Learner
Built first for their own daily engineering reading workflow—with a multi-user-ready database schema so other engineers can adopt it too—while practicing agentic software engineering best practices and hands-on message-queue architecture.

## What "Working" Looks Like
You paste a tech blog URL into Cortex Log. The reading calendar marks today green, and the blog entry moves through background processing via the message queue (or resolves immediately if that blog was already scraped). Once ready, you switch to the Dashboard/Flashcards tab to view the blog's summary and chunk-extracted candidate flashcards, check the boxes on the cards you want to keep, click "Send to Anki," and see those flashcards appear inside your local Anki deck via AnkiConnect.

## The POC Boundary
- **In for the PoC:**
  - Paste a blog URL (plus raw text fallback) to log a reading entry.
  - Deduplication check before scraping/processing: canonical `blogs` table (keyed by URL/content hash) separated from a `user_blogs` reading-log table so a given blog is only scraped and extracted once across all users.
  - Reading-streak calendar tab marking days green when at least one blog is logged.
  - Background worker powered by a message queue that scrapes new blogs, chunks the text, and uses an LLM to produce a summary and detail-focused candidate flashcards.
  - Postgres database designed with a multi-user schema (`users`, `blogs`, `user_blogs` join table, seeded with a default user for the PoC).
  - Separate Dashboard/Flashcard curation tab where you review logged blogs, select which generated cards to keep, and push them to Anki via AnkiConnect.

## Later
- **Vector embeddings & semantic search:** Querying across logged blog chunks (or providing a focus hint) to retrieve specific passages and generate targeted flashcards.
- **User authentication & login UI:** Hooking up login flows on top of the multi-user Postgres schema.
- **PDF upload & parsing:** Supporting full books and research paper PDFs alongside blog URLs.

## Explicitly Cut
- **Built-in spaced repetition review engine:** Anki already handles scheduling and review; Cortex Log's job is logging reading and feeding curated cards into Anki.
- **Social/community feeds & public profiles:** Not needed to prove the personal reading-to-Anki loop.
