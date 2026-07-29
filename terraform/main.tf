terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      # Pinned exactly: aws 6.57.0 shipped a request-signing/serialization
      # regression that broke the drift check (see git history). Bump
      # deliberately after verifying, not automatically.
      version = "6.56.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Configure backend after first run:
  # terraform init \
  #   -backend-config="bucket=your-tf-state-bucket" \
  #   -backend-config="key=skills-registry/terraform.tfstate" \
  #   -backend-config="region=us-east-1"
  backend "s3" {
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "skills-registry"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
