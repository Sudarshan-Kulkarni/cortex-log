---
doc: spec
status: approved
---

# Cortex Log — Technical Spec

## How This Works, In Plain Language

Cortex Log is split into three pieces that talk to each other through a cloud database (**Neon Postgres**) and a message queue (**GCP Pub/Sub**):

1. **The Web App (Next.js / React):** Runs in your browser with two tabs (`Calendar` and `Flashcards`) styled like a warm manila-paper technical blueprint. You click a day on the monthly calendar to log a blog URL (or raw text), and switch to the Flashcards tab to review, edit, dismiss (`✕`), or approve (`✓`) generated multiple-choice flashcards inside each blog's accordion.
2. **The Backend API & Worker (Python / FastAPI + GCP Pub/Sub + Gemini):**
   - When you log a blog, FastAPI checks **Neon Postgres** to see if that blog URL or text hash has already been scraped. If it's already processed, it links the existing blog to your calendar date immediately.
   - If it's a new blog, FastAPI publishes a job to the **`blog-ingestion` Pub/Sub topic**. The background worker pulls that message, scrapes the article body, splits it into chunks so minute single-sentence details aren't lost, calls the **Gemini API** to generate a summary and multiple-choice flashcards, and saves them to Neon Postgres.
   - When you click **`✓`** on a card, FastAPI marks that card as `queued_for_anki` for your user and publishes a message to the **`anki-delivery` Pub/Sub topic**.
3. **The Custom Anki Add-on (`cortex_log_sync` inside Anki Desktop):**
   - Because a cloud server cannot connect inbound to `localhost` behind your home Wi-Fi router, we include a lightweight ~50-line Python add-on installed in Anki Desktop's `addons21/` folder.
   - Every time you open Anki Desktop (or click `Tools → Sync Cortex Log Cards`), the add-on makes an outbound request to FastAPI (`POST /api/anki/pull`), which consumes your pending messages from the **`anki-delivery` Pub/Sub subscription**, inserts the formatted Multiple-Choice flashcards directly into your `"Cortex Log"` Anki deck, and acknowledges (`POST /api/anki/ack`) so those cards flip to **`Synced to Anki`** in the web app.

```
┌────────────────────────┐        ┌──────────────────────────┐        ┌─────────────────────┐
│   Next.js Web App      │        │    FastAPI Backend       │        │    Neon Postgres    │
│ (Calendar & Flashcard  │◄──────►│  REST API + Pub/Sub      │◄──────►│ (users, blogs,      │
│      Accordions)       │  HTTP  │  Background Subscriber   │  SQL   │  user_blogs, cards) │
└────────────────────────┘        └──────┬────────────┬──────┘        └─────────────────────┘
                                         │            │
                        Pub/Sub Topic 1  │            │ Pub/Sub Topic 2
                       (blog-ingestion)  ▼            ▼ (anki-delivery)
                                  ┌─────────────┐  ┌──────────────────────────┐
                                  │ Gemini API  │  │ Custom Anki Add-on       │
                                  │ (Chunked    │  │ (Pulls queued cards into │
                                  │  MC Cards)  │  │  "Cortex Log" deck on    │
                                  └─────────────┘  │  Anki startup & acks)    │
                                                   └──────────────────────────┘
```

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`

1. **Opening the Calendar (`GET /api/calendar?month=YYYY-MM`):** Next.js fetches the current user's logged dates from FastAPI (`user_blogs` joined with `blogs`). Days with ≥1 blog render a **green circle** in the corner; today renders a **yellow circle** if unlogged.
2. **Logging a Blog (`POST /api/blogs/log`):** You click a day cell, paste a URL (or raw text), and click **"Log it"**.
   - FastAPI normalizes the URL / computes a SHA-256 content hash and queries `blogs`.
   - It inserts a row into `user_blogs` for that `user_id` and `logged_date` (turning that day's dot **green** right away).
   - If the `blogs` row is new (`status = 'processing'`), FastAPI publishes `{ "blog_id": id }` to GCP Pub/Sub topic `blog-ingestion`.
3. **Background Scraping & Chunked Extraction (Pub/Sub Worker):**
   - The FastAPI background worker receives `{ "blog_id": id }` from `blog-ingestion-sub`.
   - It fetches the URL using `httpx` + `trafilatura` / `BeautifulSoup` to extract clean article text. If scraping fails (403/paywall/empty), it updates `blogs.status = 'scrape_failed'` with the error message and `ack`s the message.
   - If scraping succeeds, the worker splits the article into ~1,000-word overlapping chunks and calls **Gemini (`gemini-2.5-flash`)** with a structured JSON schema to extract an overall summary plus concrete, detail-oriented Multiple-Choice flashcards (`question`, `options` A–D, `answer` with explanation).
   - The worker writes the canonical cards to `flashcards`, sets `blogs.status = 'ready'`, and `ack`s the Pub/Sub message.
4. **Curating Cards in the Accordion (`GET /api/blogs/logged`):**
   - On the **Flashcards** tab, Next.js renders an Accordion for each logged blog.
   - Expanding a `processing` blog shows *"The cards haven't been generated yet, check back in a bit."*
   - Expanding a `scrape_failed` blog shows the error and a raw-text form (`POST /api/blogs/{id}/raw-text`), which saves the pasted text, resets `status = 'processing'`, and re-publishes to `blog-ingestion`.
   - Expanding a `ready` blog merges the canonical `flashcards` with the user's `user_flashcards` rows (filtering out `dismissed` cards and applying any user text/option overrides or custom cards) in a **2-column grid**.
5. **Editing, Custom Cards, Dismissing (`✕`), and Approving (`✓`):**
   - Inline edits (`PATCH /api/flashcards/{card_id}`) and custom cards (`POST /api/blogs/{id}/custom-card`) write to `user_flashcards` for `user_id = 1`, leaving canonical `flashcards` untouched.
   - Clicking **`✕`** (`POST /api/flashcards/{card_id}/dismiss`) sets `user_flashcards.status = 'dismissed'`.
   - Clicking **`✓`** (`POST /api/flashcards/{card_id}/approve`) sets `user_flashcards.status = 'queued_for_anki'` and publishes the card payload to GCP Pub/Sub topic `anki-delivery`.
6. **Seamless Delivery into Anki (`POST /api/anki/pull` & `POST /api/anki/ack`):**
   - When you open Anki Desktop (or click `Tools → Sync Cortex Log Cards`), the `cortex_log_sync` Anki add-on calls `POST /api/anki/pull`.
   - FastAPI pulls waiting messages from `anki-delivery-sub` (with DB fallback for `queued_for_anki` rows) and returns them to the add-on.
   - The add-on creates/opens the `"Cortex Log"` deck in Anki, adds each note (`Front`: Question + A/B/C/D options; `Back`: Correct answer + explanation + source URL), and calls `POST /api/anki/ack` so FastAPI acknowledges the Pub/Sub messages and updates `user_flashcards.status = 'synced_to_anki'`.

## Stack

- **Frontend:** [Next.js 15 (App Router, TypeScript)](https://nextjs.org/docs) + [Tailwind CSS](https://tailwindcss.com/docs) + [Lucide React](https://lucide.dev)
  - *Rationale:* Fast component development for the 2-tab interface, monthly calendar grid, and accordion flashcard editor.
- **Backend API & Worker:** [Python 3.11+](https://docs.python.org/3/) + [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/)
  - *Rationale:* Learner's preferred backend framework; cleanly hosts both the REST endpoints and the background Pub/Sub subscriber lifecycle.
- **Database & ORM:** [Neon Serverless PostgreSQL](https://neon.tech/docs/introduction) + [SQLAlchemy 2.0](https://docs.sqlalchemy.org/en/20/) + [psycopg (v3)](https://www.psycopg.org/psycopg3/docs/)
  - *Rationale:* Managed serverless Postgres with zero provisioning wait or hourly instance charges; standard Postgres connection string (`DATABASE_URL`).
- **Message Queue:** [Google Cloud Pub/Sub (`google-cloud-pubsub`)](https://cloud.google.com/pubsub/docs/reference/libraries#client-libraries-install-python) (with automatic in-process async queue fallback if GCP credentials are omitted during offline testing)
  - *Rationale:* Learner is familiar with GCP Pub/Sub concepts and wants hands-on practice wiring asynchronous ingestion and Anki delivery queues.
- **LLM API:** [Google Gemini API (`google-genai` SDK)](https://ai.google.dev/gemini-api/docs) using `gemini-2.5-flash` with Structured Outputs
  - *Rationale:* Fast, low-latency structured JSON extraction for chunked multiple-choice flashcards; learner already has Gemini API keys ready.
- **Article Scraping:** [httpx](https://www.python-httpx.org/) + [trafilatura](https://trafilatura.readthedocs.io/) / [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/bs4/doc/)
  - *Rationale:* Extracts clean main-article prose and title from engineering blog URLs while stripping navbars and ads.
- **Anki Integration:** Custom [Anki 2.1+ Python Add-on (`aqt` / `gui_hooks`)](https://addon-docs.ankiweb.net/)
  - *Rationale:* Runs inside Anki Desktop to pull approved cards outbound from the backend on Anki launch, solving the cloud-to-local NAT problem without requiring AnkiConnect or CORS workarounds.
- **Infrastructure as Code & Cloud Deployment:** [Terraform](https://developer.hashicorp.com/terraform/docs) (`hashicorp/google` + `kislerdm/neon` providers) + [Docker](https://docs.docker.com/) + [Google Cloud Run](https://cloud.google.com/run/docs) + [GCP Artifact Registry](https://cloud.google.com/artifact-registry/docs)
  - *Rationale:* Allows the entire stack (Neon Postgres database, GCP Pub/Sub topics/subscriptions, Artifact Registry, and Cloud Run instances for FastAPI and Next.js) to be provisioned and destroyed cleanly with `terraform apply` and `terraform destroy`.

## Where It Runs and How Someone Tries It

- **Runtime Environment (Local Dev & Cloud Deployed via Terraform):**
  - **Backend (`backend/`):** Runs locally on `http://localhost:8000` during development, and deploys as a container image (`backend/Dockerfile`) to **Google Cloud Run** via Terraform.
  - **Frontend (`frontend/`):** Runs locally on `http://localhost:3000` during development, and deploys as a container image (`frontend/Dockerfile`) to **Google Cloud Run** via Terraform.
  - **Database & Queue:** Cloud-hosted **Neon Postgres** (`DATABASE_URL`) and **GCP Pub/Sub** (`blog-ingestion` and `anki-delivery` topics/subscriptions), provisioned via Terraform (`terraform/main.tf`).
  - **Anki Add-on (`anki_addon/cortex_log_sync/`):** Installed into Anki Desktop's `addons21/` folder (`~/Library/Application Support/Anki2/addons21/cortex_log_sync` on macOS); `config.json` points to either `http://localhost:8000` or the Terraform-outputted Cloud Run backend URL.
- **Required Environment Variables (`backend/.env` / `terraform/terraform.tfvars`):**
  - `DATABASE_URL` — Neon Postgres connection string (`postgresql+psycopg://...`, provisioned and output by Terraform)
  - `GEMINI_API_KEY` — Google Gemini API key
  - `GCP_PROJECT_ID` — GCP Project ID for Pub/Sub and Cloud Run (optional local queue fallback enabled if unset locally)
  - `GOOGLE_APPLICATION_CREDENTIALS` — Path to GCP credentials (or `gcloud auth application-default login`)
  - `NEON_API_KEY` — Neon API key used by the Terraform Neon provider to create/destroy the Postgres project
  - `PUBSUB_BLOG_TOPIC` / `PUBSUB_BLOG_SUB` — Topic & subscription names for blog ingestion
  - `PUBSUB_ANKI_TOPIC` / `PUBSUB_ANKI_SUB` — Topic & subscription names for Anki delivery
- **How to Start Locally:**
  1. Start Backend: `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`
  2. Start Frontend: `cd frontend && npm run dev`
  3. Open `http://localhost:3000` in browser to log a blog on the Calendar, curate generated flashcards in the Accordion, click `✓`, and open Anki Desktop to watch the cards sync into the `"Cortex Log"` deck.
- **How to Deploy & Destroy the Entire Stack with Terraform:**
  1. Deploy: `cd terraform && terraform init && terraform apply` (provisions Neon Postgres, GCP Pub/Sub topics/subscriptions, Service Account/IAM, Artifact Registry, and Cloud Run services for backend and frontend, outputting the live URLs and `.env` values).
  2. Destroy: `cd terraform && terraform destroy` (tears down all cloud instances, queues, and database resources cleanly).

## Look and Feel
PRD ref: `prd.md > Look and Feel`, `scope.md > Inspiration & Identity`

- **Background & Surfaces:** Warm manila-paper / parchment primary canvas (`#F3E9D2`), slightly lighter cream/manila card surfaces (`#FAF3E3`), and crisp exposed `1px solid #1C1B18` dark ink borders with subtle offset blueprint shadows (`2px 2px 0px #1C1B18`).
- **Status & Action Colors:**
  - **Completed Reading Day / Approve (`✓`):** Emerald green (`#16A34A`)
  - **Today Unlogged Dot / Processing Badge:** Amber yellow (`#EAB308`)
  - **Dismiss (`✕`) / Scrape Failed Badge:** Rust red (`#DC2626`)
- **Typography:** Monospace (`JetBrains Mono` / `Geist Mono`) for calendar day numbers, status badges, queue indicators, and section headers; clean sans-serif (`Inter` / `Geist`) for blog summaries and flashcard question/answer prose.

## Components

### 1. Monthly Reading Calendar & Log Drawer (`frontend/src/components/CalendarTab.tsx`)
Implements `prd.md > 1. Monthly Reading Calendar & Logging` and `prd.md > Screens and Layout`.
- Renders a 7-column monthly grid with month navigation.
- Computes corner status circles per day: **green circle** if ≥1 blog logged on that date; **yellow circle** on today's date if 0 blogs logged today; no circle otherwise.
- Clicking any date opens the Selected Day panel showing blogs logged on that date and the **"Log a Blog"** form (URL input, optional raw text textarea, optional title input, and **"Log it"** button).

### 2. Blog Ingestion & Deduplication Service (`backend/app/routers/blogs.py`, `backend/app/services/pubsub.py`)
Implements `prd.md > 1. Monthly Reading Calendar & Logging` and `prd.md > 2. Asynchronous Scraping & Chunked Card Generation`.
- Handles `POST /api/blogs/log` and `POST /api/blogs/{id}/raw-text`.
- Normalizes URLs and computes SHA-256 content hashes to deduplicate against `blogs`.
- Links the blog to `user_blogs` for the selected calendar date and, if the blog hasn't been processed yet, publishes `{ "blog_id": blog.id }` to GCP Pub/Sub (`blog-ingestion`).

### 3. Scraper, Chunker & Gemini Flashcard Worker (`backend/app/services/scraper.py`, `backend/app/services/llm.py`, `backend/app/worker.py`)
Implements `prd.md > 2. Asynchronous Scraping & Chunked Card Generation`.
- Subscribes to `blog-ingestion-sub`.
- Scrapes the URL with `httpx` + `trafilatura` (falling back to `BeautifulSoup4`). On failure or empty body, sets `blogs.status = 'scrape_failed'` and stores the error reason.
- Splits the article body into logical paragraph chunks (~1,000 words) and prompts `gemini-2.5-flash` to extract a concise summary and detail-focused multiple-choice flashcards (`question`, 4 `options`, `answer` with explanation).
- Saves canonical cards to `flashcards` and sets `blogs.status = 'ready'`.

### 4. Flashcard Curation Accordion & 2-Column Grid (`frontend/src/components/FlashcardsTab.tsx`)
Implements `prd.md > 3. Per-User Flashcard Curation, Editing, and Custom Cards` and `prd.md > States and Boundaries`.
- Displays logged blogs as expandable Accordions showing title, logged date, and status badge (`Processing`, `Needs Raw Text`, `X Cards Ready`).
- Renders the appropriate state inside the expanded accordion:
  - `processing` → *"The cards haven't been generated yet, check back in a bit."*
  - `scrape_failed` → Error message + inline raw-text paste form to retry processing.
  - `ready` → Summary + **"+ Add Custom Card"** modal/form + **2-column grid** of flashcards.
- Each card supports inline editing of question, multiple-choice options, and answer, plus bottom **`✓`** (approve & enqueue) and **`✕`** (dismiss for current user) buttons.

### 5. Anki Delivery Queue & Custom Anki Add-on (`backend/app/routers/anki.py`, `anki_addon/cortex_log_sync/__init__.py`)
Implements `prd.md > 4. Queued Delivery to Anki via AnkiConnect`.
- Clicking **`✓`** calls `POST /api/flashcards/{id}/approve`, updating `user_flashcards.status = 'queued_for_anki'` and publishing the card message to the `anki-delivery` Pub/Sub topic.
- `POST /api/anki/pull` returns all queued flashcards for the user (pulling from Pub/Sub / `queued_for_anki` rows).
- `POST /api/anki/ack` marks the delivered `user_flashcard_ids` as `synced_to_anki` and acknowledges the Pub/Sub messages.
- The Anki add-on (`anki_addon/cortex_log_sync/__init__.py`) hooks into `gui_hooks.profile_did_open` and adds a `Tools → Sync Cortex Log Cards` menu item inside Anki Desktop to pull, insert into the `"Cortex Log"` deck, and `ack` automatically.

### 6. End-to-End Terraform Infrastructure & Cloud Run Deployment (`terraform/`, `backend/Dockerfile`, `frontend/Dockerfile`)
- Provisions and destroys the entire cloud stack via Terraform:
  - **Neon Postgres (`kislerdm/neon` provider):** Creates the Neon project, branch, database (`cortex_log`), and role, and wires the connection URI into the backend environment.
  - **GCP Pub/Sub & IAM (`hashicorp/google` provider):** Enables required GCP APIs, creates the `blog-ingestion` and `anki-delivery` topics and subscriptions, and sets up the service account + IAM roles.
  - **GCP Artifact Registry & Cloud Run v2 Services:** Creates the container repository and deploys the containerized `backend` (FastAPI + Pub/Sub worker) and `frontend` (Next.js) services with public HTTPS URLs.

## Data Model

All tables live in **Neon PostgreSQL** and are created automatically via SQLAlchemy on startup (with `user_id = 1` seeded as the default user for the PoC):

1. **`users`**
   - `id` (PK, Integer), `email` (String, unique), `name` (String), `created_at` (DateTime)
2. **`blogs`** *(Canonical deduplicated blog store)*
   - `id` (PK, Integer)
   - `canonical_url` (String, nullable, indexed)
   - `content_hash` (String, unique, indexed)
   - `title` (String)
   - `raw_text` (Text, nullable)
   - `summary` (Text, nullable)
   - `status` (String: `'processing'` | `'ready'` | `'scrape_failed'`)
   - `error_message` (Text, nullable)
   - `created_at` (DateTime)
3. **`user_blogs`** *(Join table: which user logged which blog on which date)*
   - `id` (PK, Integer)
   - `user_id` (FK → `users.id`, indexed)
   - `blog_id` (FK → `blogs.id`, indexed)
   - `logged_date` (Date — `YYYY-MM-DD`, indexed)
   - `created_at` (DateTime)
4. **`flashcards`** *(Canonical LLM-generated flashcards per blog)*
   - `id` (PK, Integer)
   - `blog_id` (FK → `blogs.id`, indexed)
   - `chunk_index` (Integer)
   - `question` (Text)
   - `options_json` (JSONB — array of 4 multiple-choice option strings)
   - `answer` (Text — correct option + detailed explanation)
   - `created_at` (DateTime)
5. **`user_flashcards`** *(Per-user curation state, edits, and custom cards)*
   - `id` (PK, Integer)
   - `user_id` (FK → `users.id`, indexed)
   - `blog_id` (FK → `blogs.id`, indexed)
   - `canonical_flashcard_id` (FK → `flashcards.id`, nullable — `NULL` when user creates a custom card)
   - `question_override` (Text, nullable)
   - `options_override_json` (JSONB, nullable)
   - `answer_override` (Text, nullable)
   - `status` (String: `'candidate'` | `'dismissed'` | `'queued_for_anki'` | `'synced_to_anki'`)
   - `updated_at` (DateTime)

## File Structure

```
cortex-log/
├── backend/
│   ├── Dockerfile                   # Container image for FastAPI + Pub/Sub worker on Cloud Run
│   ├── .env.example                 # Template for DATABASE_URL, GEMINI_API_KEY, GCP Pub/Sub vars
│   ├── requirements.txt             # FastAPI, SQLAlchemy, psycopg, google-cloud-pubsub, google-genai, trafilatura
│   └── app/
│       ├── main.py                  # FastAPI app entrypoint, CORS, DB init, background worker startup
│       ├── config.py                # Environment variable loading
│       ├── database.py              # SQLAlchemy engine & session setup for Neon Postgres
│       ├── models.py                # SQLAlchemy ORM models (User, Blog, UserBlog, Flashcard, UserFlashcard)
│       ├── schemas.py               # Pydantic request/response schemas
│       ├── worker.py                # Pub/Sub consumer loop for blog ingestion & card extraction
│       ├── routers/
│       │   ├── calendar.py          # GET /api/calendar, POST /api/blogs/log, POST /api/blogs/{id}/raw-text
│       │   ├── flashcards.py        # GET /api/blogs/logged, PATCH/POST edit, custom card, approve (✓), dismiss (✕)
│       │   └── anki.py              # POST /api/anki/pull, POST /api/anki/ack for the Anki add-on
│       └── services/
│           ├── pubsub.py            # GCP Pub/Sub publisher/subscriber wrapper (with local async fallback)
│           ├── scraper.py           # URL normalization, SHA-256 hashing, httpx + trafilatura/BS4 scraping
│           └── llm.py               # Chunking logic + Gemini API structured flashcard generation
├── frontend/
│   ├── Dockerfile                   # Container image for Next.js frontend on Cloud Run
│   ├── package.json
│   ├── tailwind.config.ts           # Manila-paper palette (#F3E9D2) & blueprint borders
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # Fonts (Mono + Sans) & Manila-paper shell
│       │   ├── page.tsx             # Top tab bar switching between CalendarTab and FlashcardsTab
│       │   └── globals.css          # Theme tokens and blueprint card utility styles
│       ├── components/
│       │   ├── CalendarTab.tsx      # Monthly calendar grid with green/yellow dots & day log drawer
│       │   └── FlashcardsTab.tsx    # Blog accordions, 2-col card grid, inline editor, custom card form
│       └── lib/
│           └── api.ts               # Typed fetch client talking to FastAPI (localhost:8000 or Cloud Run URL)
├── anki_addon/
│   └── cortex_log_sync/
│       ├── __init__.py              # Anki 2.1+ add-on: pulls queued cards on profile open & acks
│       ├── config.json              # Default backend URL (http://localhost:8000 or Cloud Run URL) & user_id (1)
│       └── install_addon.sh         # Helper script to symlink/copy add-on into local Anki addons21 folder
├── terraform/
│   ├── versions.tf                  # Required providers (hashicorp/google, kislerdm/neon)
│   ├── variables.tf                 # GCP project, region, Neon API key, Gemini API key, container images
│   ├── main.tf                      # Neon Postgres, GCP Pub/Sub topics/subs, Artifact Registry, Cloud Run services
│   ├── outputs.tf                   # Outputs DATABASE_URL, Pub/Sub names, and Cloud Run backend/frontend URLs
│   └── terraform.tfvars.example     # Example variables file for one-command deploy/destroy
├── devpost/                         # Planning artifacts (learner-profile.md, scope.md, prd.md, spec.md, checklist.md)
└── README.md                        # Setup, local run, and Terraform deploy/destroy instructions
```

## External Services and Dependencies

1. **Neon Serverless PostgreSQL**
   - **Docs:** https://neon.tech/docs/connect/connect-from-any-app
   - **Connection:** Standard `DATABASE_URL` (`postgresql+psycopg://user:pass@ep-...neon.tech/neondb?sslmode=require`)
   - **Cost / Limits:** Free tier (0.5 GB storage, scales to zero).
2. **Google Gemini API (`google-genai`)**
   - **Docs:** https://ai.google.dev/gemini-api/docs/structured-output
   - **Call:** `client.models.generate_content(model="gemini-2.5-flash", contents=..., config={"response_mime_type": "application/json", "response_schema": ...})`
   - **Auth:** `GEMINI_API_KEY` in `backend/.env`.
3. **Google Cloud Pub/Sub (`google-cloud-pubsub`)**
   - **Docs:** https://cloud.google.com/pubsub/docs/publish-receive-messages-client-library
   - **Calls:** `PublisherClient.publish(topic_path, data)` and `SubscriberClient.subscribe(subscription_path, callback)` (or synchronous `pull` / `acknowledge` for `/api/anki/pull` and `/api/anki/ack`).
   - **Auth:** `GCP_PROJECT_ID` + Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`). Includes automatic in-memory `asyncio.Queue` fallback if GCP credentials aren't configured yet so local development works offline too.
4. **Anki Desktop (`aqt` internal Python API)**
   - **Docs:** https://addon-docs.ankiweb.net/hooks-and-filters.html
   - **Integration:** Local add-on in `~/Library/Application Support/Anki2/addons21/cortex_log_sync` using `gui_hooks.profile_did_open` and `mw.col.add_note()`.
5. **Terraform (`hashicorp/google` & `kislerdm/neon` providers) + Google Cloud Run**
   - **Docs:** https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service
   - **Integration:** Provisions and tears down Neon Postgres, GCP Pub/Sub topics/subscriptions, Artifact Registry, and Cloud Run services via `terraform apply` and `terraform destroy`.

## Important Failure Modes

- **Blog URL blocks scrapers (403 Forbidden / Cloudflare / Paywall / JS-only body):**
  - *Fallback:* Scraper catches HTTP/empty-content errors and sets `blogs.status = 'scrape_failed'` with a clear reason. Expanding that blog's accordion on the Flashcards tab displays the error alongside a textarea to paste the raw article text and re-run extraction.
- **Anki Desktop is closed when the user clicks `✓`:**
  - *Fallback:* Approved cards remain safely in `queued_for_anki` state (and in the Pub/Sub subscription). The next time the user opens Anki Desktop (or clicks `Tools → Sync Cortex Log Cards`), the add-on pulls all waiting cards and syncs them.
- **GCP Pub/Sub credentials or topics not yet created during initial local boot:**
  - *Fallback:* `pubsub.py` detects if GCP credentials/topics are missing or unreachable and transparently falls back to an in-process Python `asyncio.Queue` + Postgres state so the worker and Anki pull endpoints still function end-to-end while setting up GCP.

## What Was Simplified and Why

- **Seeded default user (`user_id = 1`) instead of OAuth/Login UI:** Preserves the full multi-user relational schema (`users`, `blogs`, `user_blogs`, `user_flashcards`) while focusing build time on the calendar, Pub/Sub worker, chunked Gemini extraction, and Anki add-on.
- **Custom Anki Pull Add-on (`cortex_log_sync`) instead of inbound cloud-to-AnkiConnect tunneling:** Avoids `ngrok` tunnels or CORS issues and works identically whether the backend runs on `localhost:8000` or on Cloud Run.

## Decisions and Open Issues

- **Learner Decisions:**
  - **Backend & Frontend:** Python FastAPI + React/Next.js (`learner-selected`).
  - **Message Queue:** GCP Pub/Sub (`learner-selected`).
  - **Database:** Neon Serverless PostgreSQL (`learner-selected` after weighing GCP Cloud SQL's hourly billing/provisioning overhead against Neon's instant serverless Postgres).
  - **LLM:** Google Gemini (`learner-selected`, API key ready).
  - **Anki Integration:** Custom Anki Desktop Python Add-on (`learner-selected` after exploring how a web-deployed backend crosses the NAT boundary to a user's local Anki app).
  - **Infrastructure as Code:** End-to-end Terraform (`learner-selected`) to provision and destroy the full stack (Neon Postgres, GCP Pub/Sub, Artifact Registry, and Cloud Run services for backend and frontend).
- **Useful Unknown Clarified During Spec:**
  - *Question:* "Is it possible to push from GCP Pub/Sub to a local instance of Anki / Can I alter AnkiConnect's settings to connect to GCP Pub/Sub / Assume Cortex Log will be deployed to the web—then what?"
  - *Clarification:* Explored why a cloud backend cannot make an inbound HTTP call to `localhost:8765` behind a user's home router (NAT), why AnkiConnect is only a passive HTTP listener rather than an outbound queue consumer, and how a ~50-line Python Anki Add-on (`gui_hooks.profile_did_open`) inside Anki Desktop flips the direction—making an outbound pull request from the user's laptop to the backend/queue whenever Anki opens.
- **Open Issues:** None blocking `5-build`.
