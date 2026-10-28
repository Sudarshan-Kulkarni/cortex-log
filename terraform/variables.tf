variable "gcp_project_id" {
  description = "Google Cloud Project ID where Pub/Sub, Artifact Registry, and Cloud Run are deployed"
  type        = string
}

variable "gcp_region" {
  description = "Google Cloud region for Artifact Registry and Cloud Run services"
  type        = string
  default     = "us-central1"
}

variable "neon_api_key" {
  description = "Neon API key used to provision and manage the serverless PostgreSQL project"
  type        = string
  sensitive   = true
}

variable "neon_org_id" {
  description = "Neon Organization ID (found on your Neon Organization Settings page, e.g., org-...)"
  type        = string
}

variable "neon_region_id" {
  description = "Neon region identifier (e.g., aws-us-east-1, aws-eu-west-2)"
  type        = string
  default     = "aws-eu-west-2"
}

variable "gemini_api_key" {
  description = "Google Gemini API key injected into the backend Cloud Run service"
  type        = string
  sensitive   = true
}

variable "gemini_model" {
  description = "Gemini model name used for chunked flashcard extraction"
  type        = string
  default     = "gemini-2.5-flash"
}

variable "backend_image" {
  description = "Container image URI for the FastAPI backend (defaults to Artifact Registry path)"
  type        = string
  default     = ""
}

variable "frontend_image" {
  description = "Container image URI for the Next.js frontend (defaults to Artifact Registry path)"
  type        = string
  default     = ""
}

variable "clerk_publishable_key" {
  description = "Clerk Publishable Key (pk_test_... or pk_live_...) for Next.js frontend"
  type        = string
  default     = ""
}

variable "clerk_secret_key" {
  description = "Clerk Secret Key (sk_test_... or sk_live_...) for Next.js frontend"
  type        = string
  sensitive   = true
  default     = ""
}

variable "clerk_issuer_url" {
  description = "Clerk Issuer URL (e.g. https://<your-app>.clerk.accounts.dev) for FastAPI backend JWT verification"
  type        = string
  default     = ""
}
