# Cortex Log (`[CORTEX LOG // REV 01]`)

**Cortex Log** is a technical reading tracker and spaced-repetition companion web app built in a **Techy Manila Blueprint** (`#F3E9D2`) aesthetic. Log the technical engineering blogs you read on a monthly calendar, automatically scrape and chunk them through a message queue (`GCP Pub/Sub`) into detail-focused multiple-choice flashcards with **Gemini (`gemini-2.5-flash`)**, curate or edit cards per user, and sync approved cards straight into **Anki Desktop** via a lightweight custom Anki add-on.

---

## Architecture Overview

1. **Monthly Reading Calendar & Deduplicated Blog Store (`Next.js` + `FastAPI` + `PostgreSQL`):**
   - Today's calendar cell displays a **yellow** corner indicator until you log a blog; logging any blog immediately turns that date's indicator **green** and increments your reading streak.
   - Canonical URL normalization and SHA-256 content-hash deduplication ensure the same article is scraped and processed by Gemini only once (`blogs`, `flashcards`), while each user maintains independent reading logs (`user_blogs`) and flashcard overrides/curation state (`user_flashcards`).
2. **Asynchronous Scraping & Chunked Gemini Extraction (`GCP Pub/Sub` + `gemini-2.5-flash`):**
   - Logging a new blog publishes a job to the `blog-ingestion` Pub/Sub topic (with automatic in-process queue fallback when running offline).
   - The background worker scrapes the article with `httpx` + `trafilatura` / `BeautifulSoup4`, splits the text into ~900-word overlapping chunks, and prompts Gemini (`gemini-2.5-flash`) with a strict Pydantic JSON schema to extract a concise summary and detail-focused multiple-choice flashcards.
   - If a site blocks automated scraping (paywall/Cloudflare), the Flashcards accordion switches to **`Needs Raw Text`** so you can paste the article text inline and resume generation.
3. **Per-User Curation & Outbound Anki 2.1+ Sync Add-on (`anki-delivery` + `cortex_log_sync`):**
   - Edit any card's question, options, or answer inline, add custom cards, or dismiss (`✕`) unwanted cards without affecting canonical cards.
   - Clicking **`✓ Approve`** publishes the HTML-formatted card to the `anki-delivery` Pub/Sub queue.
   - Because a cloud backend cannot initiate inbound connections to `localhost:8765` behind home Wi-Fi NAT, our custom Anki add-on (`anki_addon/cortex_log_sync/`) hooks into `aqt.gui_hooks.profile_did_open` (and `Tools -> Sync Cortex Log Cards`), makes an outbound `POST /api/anki/pull` request, adds the cards to the **`"Cortex Log"`** deck, and calls `POST /api/anki/ack`.

---

## Local Development Quickstart

### 1. Backend (`FastAPI` + Worker)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Populate DATABASE_URL (Neon Postgres or local SQLite fallback),
# GEMINI_API_KEY, and GCP_PROJECT_ID in backend/.env

uvicorn app.main:app --reload --port 8010
```

### 2. Frontend (`Next.js` App Router)

```bash
cd frontend
npm install
npm run dev
```

Open **`http://localhost:3010`** in your browser.

### 3. Install the Custom Anki Desktop Add-on

```bash
./anki_addon/cortex_log_sync/install_addon.sh
```

Restart **Anki Desktop** (or click **`Tools -> Sync Cortex Log Cards`** from Anki's menu bar) to pull approved cards into your **`"Cortex Log"`** deck.

---

## End-to-End Cloud Deployment with Terraform (`terraform/`)

The `terraform/` directory provisions and tears down the entire stack across **Neon Serverless PostgreSQL** and **Google Cloud Platform** (`GCP Pub/Sub`, `Artifact Registry`, least-privilege `Service Account` IAM, and `Cloud Run v2` services for both backend and frontend).

### Prerequisites
- [Terraform](https://developer.hashicorp.com/terraform/install) `>= 1.3`
- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) authenticated via:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```
- A **Neon API Key** (from your Neon Console -> Account Settings -> API Keys)
- A **Gemini API Key** (from Google AI Studio)

### Step 1: Configure `terraform.tfvars`

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your gcp_project_id, neon_api_key, and gemini_api_key
```

### Step 2: Build & Push Container Images (Optional before first apply, or after Artifact Registry is created)

```bash
# From the repository root:
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"

gcloud builds submit ./backend \
  --tag "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/cortex-log/backend:latest"

gcloud builds submit ./frontend \
  --tag "${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/cortex-log/frontend:latest"
```

### Step 3: Provision the Entire Stack (`init`, `plan`, `apply`)

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

When `terraform apply` completes, it outputs:
- `frontend_cloud_run_url` — public HTTPS URL for the Next.js web app
- `backend_cloud_run_url` — public HTTPS URL for the FastAPI API & Pub/Sub worker (point `anki_addon/cortex_log_sync/config.json > backend_url` here to sync Anki against the cloud deployment)
- `pubsub_topics` & `pubsub_subscriptions` — `blog-ingestion` and `anki-delivery`
- `neon_project_id` & `neon_database_url` (sensitive)

### Step 4: Tear Down All Cloud Resources (`destroy`)

To cleanly destroy all provisioned Cloud Run services, Pub/Sub queues, Artifact Registry repositories, and the Neon Postgres project:

```bash
cd terraform
terraform destroy
```
