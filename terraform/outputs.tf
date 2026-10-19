output "neon_project_id" {
  description = "Neon Serverless PostgreSQL Project ID"
  value       = neon_project.cortex_log.id
}

output "neon_database_url" {
  description = "SQLAlchemy connection string for the provisioned Neon PostgreSQL database"
  value       = local.neon_sqlalchemy_url
  sensitive   = true
}

output "artifact_registry_repo_url" {
  description = "Artifact Registry Docker repository base URL"
  value       = local.artifact_repo_base
}

output "pubsub_topics" {
  description = "Provisioned GCP Pub/Sub topic names"
  value = {
    blog_ingestion = google_pubsub_topic.blog_ingestion.name
    anki_delivery  = google_pubsub_topic.anki_delivery.name
  }
}

output "pubsub_subscriptions" {
  description = "Provisioned GCP Pub/Sub subscription names"
  value = {
    blog_ingestion_sub = google_pubsub_subscription.blog_ingestion_sub.name
    anki_delivery_sub  = google_pubsub_subscription.anki_delivery_sub.name
  }
}

output "backend_cloud_run_url" {
  description = "Public HTTPS URL of the FastAPI backend on Cloud Run"
  value       = google_cloud_run_v2_service.backend.uri
}

output "frontend_cloud_run_url" {
  description = "Public HTTPS URL of the Next.js web app on Cloud Run"
  value       = google_cloud_run_v2_service.frontend.uri
}
