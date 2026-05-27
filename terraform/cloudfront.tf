resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-oac-${var.environment}"
  description                       = "OAC for ${var.project_name} S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# KVS stores the JWT secret so the edge function can validate sessions
# without calling out to SSM on every request
resource "aws_cloudfront_key_value_store" "auth" {
  name    = "${var.project_name}-auth-${var.environment}"
  comment = "JWT secret for edge session validation"
}

resource "aws_cloudfront_key_value_store_key" "jwt_secret" {
  key_value_store_arn = aws_cloudfront_key_value_store.auth.arn
  key                 = "jwt_secret"
  value               = var.jwt_secret
}

resource "aws_cloudfront_function" "auth_check" {
  name    = "${var.project_name}-auth-check-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "Validates __session cookie before serving any content"
  publish = true

  # templatefile injects the KVS ARN so the function can reference it
  code = templatefile("${path.module}/../functions/edge/auth-check.js.tpl", {
    kvs_arn       = aws_cloudfront_key_value_store.auth.arn
    login_path    = "/login"
  })

  key_value_store_associations {
    key_value_store_arn = aws_cloudfront_key_value_store.auth.arn
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  comment             = "${var.project_name} (${var.environment})"
  aliases             = var.site_domain != "" ? [var.site_domain] : []

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Default behavior: all requests gated by auth check
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # AWS managed CachingOptimized policy
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.auth_check.arn
    }
  }

  # /login page is allowed through without a valid session
  # (the edge function handles this path exemption internally)

  # Astro build output (_astro/ chunk files) - long cache, no auth penalty
  ordered_cache_behavior {
    path_pattern           = "/_astro/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.auth_check.arn
    }
  }

  # SPA fallback: 403/404 from S3 returns index.html so client-side routing works
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/404.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.site_domain == ""
    acm_certificate_arn            = var.site_domain != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.site_domain != "" ? "sni-only" : null
    minimum_protocol_version       = var.site_domain != "" ? "TLSv1.2_2021" : null
  }
}
