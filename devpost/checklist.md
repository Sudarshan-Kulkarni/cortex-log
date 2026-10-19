---
doc: checklist
status: approved
---

# Build Checklist

Build mode: learn

## Slices

- [x] **1. Log a blog on the monthly reading calendar and persist it with deduplication**
  Becomes usable: A running two-tab web app in the manila-paper blueprint theme where today shows a yellow circle on the monthly calendar, clicking any day lets you log a blog URL or raw text via "Log it", that day's circle immediately turns green, and logged entries persist in Postgres with automatic canonical URL/content-hash deduplication.
  Why now: Bootstraps the Next.js frontend, FastAPI backend, and multi-user Postgres schema (`users`, `blogs`, `user_blogs`) end to end on the first step of the core journey so every later slice has a working foundation.
  PRD ref: `prd.md > The Core Journey` (steps 1-3), `prd.md > 1. Monthly Reading Calendar & Logging`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Components`, `spec.md > Data Model`, `spec.md > File Structure`, `spec.md > Look and Feel`
  Build: Scaffold `backend/` (FastAPI entrypoint, config, SQLAlchemy 2.0 models, seeded default user `user_id = 1`, `GET /api/calendar`, `POST /api/blogs/log` with URL normalization and SHA-256 content-hash deduplication) and `frontend/` (Next.js App Router, Tailwind manila-paper theme `#F3E9D2`, top tab navigation, and `CalendarTab.tsx` with 7-column monthly grid, green/yellow corner dots, and selected-day log drawer).
  Verify (mechanical): Start FastAPI and Next.js, verify `GET /api/calendar` returns the month state, call `POST /api/blogs/log` twice with the same URL on two dates to confirm `blogs` deduplicates to one canonical row while `user_blogs` stores both logged dates, and confirm the frontend builds with no errors.
  Learner check: Open `http://localhost:3010`, verify today has a yellow circle on the manila-paper calendar, click a day to paste a blog URL and click "Log it", and confirm the corner circle turns green and stays green after refreshing the page.
  Commit: `Add monthly reading calendar and deduplicated blog logging`

- [x] **2. Scrape logged blogs via the message queue, generate chunked flashcards with Gemini, and view them in the Flashcards accordion**
  Becomes usable: Logging a new blog dispatches a job over the `blog-ingestion` message queue (GCP Pub/Sub with local async fallback); the background worker scrapes the article, chunks the text, calls Gemini (`gemini-2.5-flash`) to extract a summary and detail-focused multiple-choice flashcards, and renders them in a 2-column grid inside the expandable blog accordion on the Flashcards tab (with an inline raw-text fallback if scraping fails).
  Why now: Proves the unique kernel and highest-risk integrations—message-queue worker, article scraping, and chunked Gemini structured extraction—as soon as a blog can be logged.
  PRD ref: `prd.md > The Core Journey` (steps 3-5), `prd.md > 2. Asynchronous Scraping & Chunked Card Generation`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Components`, `spec.md > External Services and Dependencies`, `spec.md > Important Failure Modes`
  Build: Implement `backend/app/services/pubsub.py` (GCP Pub/Sub publisher/subscriber for `blog-ingestion` with automatic in-process async queue fallback), `backend/app/services/scraper.py` (`httpx` + `trafilatura` / `BeautifulSoup4`), `backend/app/services/llm.py` (~1,000-word chunker + Gemini `gemini-2.5-flash` structured JSON extraction), `backend/app/worker.py`, `GET /api/blogs/logged`, and `POST /api/blogs/{id}/raw-text`. Build `frontend/src/components/FlashcardsTab.tsx` with expandable blog accordions (`Processing`, `Needs Raw Text` recovery form, and `X Cards Ready` with summary and 2-column flashcard grid).
  Verify (mechanical): Log a blog URL via the API, verify the `blog-ingestion` queue worker processes it to `status = 'ready'` and populates `flashcards`, test an unscrapable URL to confirm `scrape_failed` recovers to `ready` via `POST /api/blogs/{id}/raw-text`, and verify `GET /api/blogs/logged` returns the summary and cards.
  Learner check: Log a technical blog URL on the Calendar tab, switch to the Flashcards tab to watch its accordion badge update from `Processing` to `Ready`, expand it to read the summary and 2-column multiple-choice flashcards, and test pasting raw text on a failed scrape.
  Commit: `Add message-queue blog scraper, chunked Gemini card generator, and accordion view`

- [x] **3. Curate flashcards per user with inline editing, custom cards, and dismissal (`✕`)**
  Becomes usable: Inside any expanded blog accordion on the Flashcards tab, you can edit a flashcard's question, multiple-choice options, or answer inline, add a new card with "+ Add Custom Card", or click `✕` to dismiss unwanted cards—saving all changes to your per-user state (`user_flashcards`) without altering the canonical `flashcards` rows for other users.
  Why now: Completes per-user card curation before wiring Anki delivery so that any edits or custom cards you create are the exact payloads sent when you approve a card.
  PRD ref: `prd.md > The Core Journey` (step 6), `prd.md > 3. Per-User Flashcard Curation, Editing, and Custom Cards`
  Spec ref: `spec.md > Components`, `spec.md > Data Model`
  Build: Add `PATCH /api/flashcards/{card_id}` (saving `question_override`, `options_override_json`, `answer_override` in `user_flashcards`), `POST /api/blogs/{id}/custom-card` (inserting a `user_flashcards` row with `canonical_flashcard_id = NULL`), and `POST /api/flashcards/{card_id}/dismiss` (marking `status = 'dismissed'`). Update `FlashcardsTab.tsx` with inline card editing, the "+ Add Custom Card" form, and the `✕` dismiss button.
  Verify (mechanical): Edit a canonical card via `PATCH /api/flashcards/{card_id}`, create a custom card via `POST /api/blogs/{id}/custom-card`, and dismiss a card via `POST /api/flashcards/{card_id}/dismiss`; verify `GET /api/blogs/logged` reflects the overrides and hides the dismissed card while the `flashcards` table remains untouched.
  Learner check: Expand a processed blog on the Flashcards tab, edit a card's question or options, add a custom card, and click `✕` on another card—then refresh the page to confirm your edits and custom card persist and the dismissed card stays hidden.
  Commit: `Add per-user flashcard inline editing, custom cards, and dismissal`

- [x] **4. Approve cards (`✓`) onto the Anki delivery queue and sync them into Anki Desktop via the custom add-on**
  Becomes usable: Clicking `✓` on a flashcard marks it `Queued for Anki` and publishes it to the `anki-delivery` message queue; opening Anki Desktop (or clicking `Tools -> Sync Cortex Log Cards` via the `cortex_log_sync` add-on) pulls queued cards from the backend, creates the `"Cortex Log"` deck, adds the formatted Multiple-Choice notes, and acknowledges delivery so the cards flip to `Synced to Anki`.
  Why now: Completes the end-to-end journey from daily reading log to local Anki deck once card extraction and per-user curation are in place.
  PRD ref: `prd.md > The Core Journey` (steps 6-7), `prd.md > 4. Queued Delivery to Anki`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Components`, `spec.md > File Structure`, `spec.md > External Services and Dependencies`
  Build: Implement `POST /api/flashcards/{card_id}/approve` (marking `queued_for_anki` and publishing to the `anki-delivery` Pub/Sub topic), `POST /api/anki/pull` (returning queued cards from Pub/Sub / DB), and `POST /api/anki/ack` (acknowledging Pub/Sub messages and updating status to `synced_to_anki`). Wire the `✓` button and top-bar Anki queue status in `FlashcardsTab.tsx`. Create `anki_addon/cortex_log_sync/__init__.py`, `config.json`, and `install_addon.sh` hooking `gui_hooks.profile_did_open` and `Tools -> Sync Cortex Log Cards`.
  Verify (mechanical): Approve two cards via `POST /api/flashcards/{card_id}/approve`, call `POST /api/anki/pull` to confirm both cards and their overrides are returned, call `POST /api/anki/ack` with their IDs, and verify their status flips to `synced_to_anki` and a second pull returns empty; verify `anki_addon/cortex_log_sync/__init__.py` compiles cleanly.
  Learner check: Click `✓` on one or more flashcards to queue them for Anki, install the add-on via `./anki_addon/cortex_log_sync/install_addon.sh`, open Anki Desktop (or trigger `Tools -> Sync Cortex Log Cards`), and confirm the cards land in your `"Cortex Log"` Anki deck and update to `Synced to Anki` in the web app.
  Commit: `Add Anki delivery queue endpoints and custom Anki sync add-on`

- [x] **5. Provision and deploy the full stack end-to-end with Terraform and Docker**
  Becomes usable: A complete Terraform configuration (`terraform/`) and Docker container setup (`backend/Dockerfile`, `frontend/Dockerfile`) that provisions and tears down the entire stack—Neon Postgres database, GCP Pub/Sub topics and subscriptions, Service Account/IAM bindings, Artifact Registry, and Cloud Run services for both FastAPI and Next.js—via `terraform apply` and `terraform destroy`.
  Why now: Packages the verified application and all cloud resources into a single reproducible Infrastructure-as-Code workflow once the full product loop is working.
  PRD ref: `prd.md > What We're Building`
  Spec ref: `spec.md > Components`, `spec.md > Where It Runs and How Someone Tries It`, `spec.md > File Structure`, `spec.md > External Services and Dependencies`
  Build: Add `backend/Dockerfile` and `frontend/Dockerfile`, and create `terraform/versions.tf`, `terraform/variables.tf`, `terraform/main.tf`, `terraform/outputs.tf`, and `terraform/terraform.tfvars.example` using the `kislerdm/neon` and `hashicorp/google` providers to provision Neon Postgres, GCP Pub/Sub (`blog-ingestion`, `anki-delivery`), Artifact Registry, and Cloud Run v2 services for backend and frontend, plus `README.md` deploy/destroy instructions.
  Verify (mechanical): Validate the Terraform configuration (`terraform fmt -check` and `terraform validate` if Terraform CLI is installed, plus HCL/Dockerfile verification) and confirm `backend/Dockerfile` and `frontend/Dockerfile` match the application entrypoints and runtime environment variables.
  Learner check: Review `terraform/main.tf` and `terraform/outputs.tf`, populate `terraform/terraform.tfvars`, and run `terraform init && terraform plan` (or `terraform apply` / `terraform destroy`) to verify the full stack deploys and tears down cleanly.
  Commit: `Add end-to-end Terraform configuration and Dockerfiles for full-stack deployment`

## Hands-on Checkpoints

- [x] Early usable behavior explored — after Slice 2 (calendar blog logging + message-queue scraping and chunked Gemini flashcard generation in the accordion)
- [x] Final kick-the-tires exploration and feedback completed

## Final Review

- [x] Remove internal architecture jargon from the top app subtitle (`page.tsx`) and Flashcards tab header (`FlashcardsTab.tsx`)
- [x] Grey out and disable future days on the monthly calendar (`CalendarTab.tsx`) and order logged blogs on the Flashcards tab by most recently logged time descending (`flashcards.py`)
- [x] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [x] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [x] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [x] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: Prior practice connected during build and final review — traced GCP Pub/Sub ADC quota-project and subscription delivery (`backend/app/services/pubsub.py`), diagnosed Next.js build-time `NEXT_PUBLIC_API_URL` inlining vs. runtime `envMap["BACKEND_API_URL"]` injection on Cloud Run (`frontend/src/app/layout.tsx`, `frontend/src/lib/api.ts`), and implemented Final Review refinements across `frontend/src/app/page.tsx`, `frontend/src/components/CalendarTab.tsx`, `frontend/src/components/FlashcardsTab.tsx`, and `backend/app/routers/flashcards.py`.
Route and stops: Reference route in `devpost/app-map.html` — Stop 1: `frontend/src/components/FlashcardsTab.tsx` (`handleApproveCard`) -> Stop 2: `backend/app/routers/anki.py` (`approve_flashcard_for_anki`, `pull_queued_anki_cards`, `acknowledge_anki_cards`) & `backend/app/services/pubsub.py` -> Stop 3: `anki_addon/cortex_log_sync/__init__.py` (`_register_anki_hooks`, `sync_cortex_log_cards`).
Edit outcome: Kept and verified Final Review edits (`bbc9e10`, `2aca23e`) — cleaned UI headings in `page.tsx` and `FlashcardsTab.tsx`, disabled future calendar dates in `CalendarTab.tsx`, and ordered flashcards by `UserBlog.created_at.desc()` in `flashcards.py`.
Reflection: Offered alongside `devpost/app-map.html` wrap-up.
Activity mode: Prior practice connected + recap with standalone `devpost/app-map.html`.

## Revisions

- Changed default local dev ports to `http://localhost:3010` (frontend) and `http://localhost:8010` (backend) — local ports `3000` (`code-assist-mcp`) and `8000` were already occupied by existing processes on the machine.
- Added `neon_org_id` variable and `history_retention_seconds = 21600` to `neon_project.cortex_log` in `terraform/main.tf` — Neon's API requires an explicit `org_id` for organization-scoped accounts and enforces a 6-hour (`21600s`) history retention ceiling on the Free Tier (vs. the provider's `86400s` default).
- Added Cloud Build service account IAM bindings (`roles/storage.admin`, `roles/artifactregistry.writer`, `roles/logging.logWriter`), `backend/.gcloudignore`, and `frontend/.gcloudignore` — required so `gcloud builds submit` can read staging tarballs in newer GCP projects and skip uploading `.venv` and `node_modules`.
- Added dynamic runtime lookup (`envMap["BACKEND_API_URL"]`) in `frontend/src/app/layout.tsx` (`window.__CORTEX_API_URL__`) — Next.js inlines `process.env.NEXT_PUBLIC_*` at Docker build time, so reading `BACKEND_API_URL` dynamically at request time allows the Cloud Run frontend container to use the Cloud Run backend URI without a two-pass image build.
