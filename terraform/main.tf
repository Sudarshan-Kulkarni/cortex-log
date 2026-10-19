# ---------------------------------------------------------------------------
# 1. Enable Required Google Cloud APIs
# ---------------------------------------------------------------------------
data "google_project" "current" {
  project_id = var.gcp_project_id
}

locals {
  required_gcp_apis = toset([
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
  ])

  compute_sa_member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  artifact_repo_base = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}"
  backend_image_uri  = var.backend_image != "" ? var.backend_image : "${local.artifact_repo_base}/backend:latest"
  frontend_image_uri = var.frontend_image != "" ? var.frontend_image : "${local.artifact_repo_base}/frontend:latest"

  # Construct SQLAlchemy psycopg v3 URL from Neon project connection details
  neon_sqlalchemy_url = format(
    "postgresql+psycopg://%s:%s@%s/%s?sslmode=require",
    neon_project.cortex_log.database_user,
    neon_project.cortex_log.database_password,
    neon_project.cortex_log.database_host,
    neon_project.cortex_log.database_name,
  )
}

resource "google_project_service" "apis" {
  for_each           = local.required_gcp_apis
  project            = var.gcp_project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# 2. Neon Serverless PostgreSQL Database
# ---------------------------------------------------------------------------
resource "neon_project" "cortex_log" {
  name                      = "cortex-log"
  org_id                    = var.neon_org_id
  region_id                 = var.neon_region_id
  pg_version                = 16
  history_retention_seconds = 21600 # 6 hours (Neon free-tier maximum)
}

# ---------------------------------------------------------------------------
# 3. GCP Pub/Sub Topics & Pull Subscriptions
# ---------------------------------------------------------------------------
resource "google_pubsub_topic" "blog_ingestion" {
  name       = "blog-ingestion"
  project    = var.gcp_project_id
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_subscription" "blog_ingestion_sub" {
  name                       = "blog-ingestion-sub"
  topic                      = google_pubsub_topic.blog_ingestion.id
  project                    = var.gcp_project_id
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }
}

resource "google_pubsub_topic" "anki_delivery" {
  name       = "anki-delivery"
  project    = var.gcp_project_id
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_subscription" "anki_delivery_sub" {
  name                       = "anki-delivery-sub"
  topic                      = google_pubsub_topic.anki_delivery.id
  project                    = var.gcp_project_id
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days
}

# ---------------------------------------------------------------------------
# 4. GCP Artifact Registry, Cloud Build IAM, & Automated Image Push
# ---------------------------------------------------------------------------
resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.gcp_region
  repository_id = "cortex-log"
  description   = "Docker images for Cortex Log FastAPI backend and Next.js frontend"
  format        = "DOCKER"
  project       = var.gcp_project_id
  depends_on    = [google_project_service.apis]
}

resource "google_project_iam_member" "cloudbuild_storage_admin" {
  project    = var.gcp_project_id
  role       = "roles/storage.admin"
  member     = local.compute_sa_member
  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "cloudbuild_artifact_writer" {
  project    = var.gcp_project_id
  role       = "roles/artifactregistry.writer"
  member     = local.compute_sa_member
  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "cloudbuild_log_writer" {
  project    = var.gcp_project_id
  role       = "roles/logging.logWriter"
  member     = local.compute_sa_member
  depends_on = [google_project_service.apis]
}

resource "null_resource" "build_and_push_images" {
  triggers = {
    backend_dockerfile  = filesha256("${path.module}/../backend/Dockerfile")
    frontend_dockerfile = filesha256("${path.module}/../frontend/Dockerfile")
    frontend_src_hash = sha256(join("", [
      filesha256("${path.module}/../frontend/src/app/layout.tsx"),
      filesha256("${path.module}/../frontend/src/app/page.tsx"),
      filesha256("${path.module}/../frontend/src/components/CalendarTab.tsx"),
      filesha256("${path.module}/../frontend/src/components/FlashcardsTab.tsx"),
    ]))
    repo_id = google_artifact_registry_repository.docker_repo.id
  }

  provisioner "local-exec" {
    command = <<-EOT
      export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
      if ! gcloud artifacts docker images describe "${local.backend_image_uri}" --project "${var.gcp_project_id}" >/dev/null 2>&1; then
        gcloud builds submit "${path.module}/../backend" \
          --tag "${local.backend_image_uri}" \
          --project "${var.gcp_project_id}" \
          --quiet
      else
        echo "Backend image ${local.backend_image_uri} already exists in Artifact Registry; skipping rebuild."
      fi
      gcloud builds submit "${path.module}/../frontend" \
        --tag "${local.frontend_image_uri}" \
        --project "${var.gcp_project_id}" \
        --quiet
    EOT
  }

  depends_on = [
    google_artifact_registry_repository.docker_repo,
    google_project_iam_member.cloudbuild_storage_admin,
    google_project_iam_member.cloudbuild_artifact_writer,
    google_project_iam_member.cloudbuild_log_writer,
  ]
}

# ---------------------------------------------------------------------------
# 5. Backend Service Account & Least-Privilege Pub/Sub IAM Roles
# ---------------------------------------------------------------------------
resource "google_service_account" "backend_sa" {
  account_id   = "cortex-log-backend-sa"
  display_name = "Cortex Log Backend & Pub/Sub Worker Service Account"
  project      = var.gcp_project_id
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "backend_pubsub_publisher" {
  project = var.gcp_project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.backend_sa.email}"
}

resource "google_project_iam_member" "backend_pubsub_subscriber" {
  project = var.gcp_project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.backend_sa.email}"
}

resource "google_project_iam_member" "backend_pubsub_viewer" {
  project = var.gcp_project_id
  role    = "roles/pubsub.viewer"
  member  = "serviceAccount:${google_service_account.backend_sa.email}"
}

# ---------------------------------------------------------------------------
# 6. Cloud Run v2 — FastAPI Backend + Background Pub/Sub Worker
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "backend" {
  name                = "cortex-log-backend"
  location            = var.gcp_region
  project             = var.gcp_project_id
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend_sa.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.backend_image_uri

      ports {
        container_port = 8080
      }

      env {
        name  = "DATABASE_URL"
        value = local.neon_sqlalchemy_url
      }
      env {
        name  = "GEMINI_API_KEY"
        value = var.gemini_api_key
      }
      env {
        name  = "GEMINI_MODEL"
        value = var.gemini_model
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }
      env {
        name  = "PUBSUB_BLOG_TOPIC"
        value = google_pubsub_topic.blog_ingestion.name
      }
      env {
        name  = "PUBSUB_BLOG_SUB"
        value = google_pubsub_subscription.blog_ingestion_sub.name
      }
      env {
        name  = "PUBSUB_ANKI_TOPIC"
        value = google_pubsub_topic.anki_delivery.name
      }
      env {
        name  = "PUBSUB_ANKI_SUB"
        value = google_pubsub_subscription.anki_delivery_sub.name
      }
      env {
        name  = "CORS_ORIGINS"
        value = "*"
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_pubsub_subscription.blog_ingestion_sub,
    google_pubsub_subscription.anki_delivery_sub,
    null_resource.build_and_push_images,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public_invoker" {
  project  = google_cloud_run_v2_service.backend.project
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# 7. Cloud Run v2 — Next.js Frontend
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "frontend" {
  name                = "cortex-log-frontend"
  location            = var.gcp_region
  project             = var.gcp_project_id
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.frontend_image_uri

      ports {
        container_port = 8080
      }

      env {
        name  = "BACKEND_API_URL"
        value = google_cloud_run_v2_service.backend.uri
      }
      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = google_cloud_run_v2_service.backend.uri
      }
      env {
        name  = "IMAGE_REVISION_HASH"
        value = null_resource.build_and_push_images.triggers["frontend_src_hash"]
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.backend,
    null_resource.build_and_push_images,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public_invoker" {
  project  = google_cloud_run_v2_service.frontend.project
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
