variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (prod, staging)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be 'prod' or 'staging'."
  }
}

variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
  default     = "skills-registry"
}

variable "google_client_id" {
  description = "Google OAuth client ID from Google Cloud Console"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret from Google Cloud Console"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Secret used to sign JWT session tokens (min 32 chars, use openssl rand -hex 32)"
  type        = string
  sensitive   = true
}

variable "allowed_email_domain" {
  description = "Email domain permitted to access the site"
  type        = string
  default     = "navapbc.com"
}

variable "site_domain" {
  description = "Custom domain (e.g. skills.navapbc.com for prod, skills-staging.navapbc.com for staging). Leave empty to use CloudFront default."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 (required when site_domain is set)"
  type        = string
  default     = ""
}

variable "github_org" {
  description = "GitHub org that owns the skills-registry repo"
  type        = string
  default     = "navapbc"
}

variable "github_repo" {
  description = "GitHub repo name (without org prefix)"
  type        = string
  default     = "skills-registry"
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider in this account. Set to false if another project already created it."
  type        = bool
  default     = true
}
