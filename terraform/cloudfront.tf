resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-oac-${var.environment}"
  description                       = "OAC for ${var.project_name} S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}


resource "aws_cloudfront_function" "auth_check" {
  name    = "${var.project_name}-auth-check-${var.environment}"
  runtime = "cloudfront-js-2.0"
  comment = "Validates __session cookie before serving any content"
  publish = true

  code = templatefile("${path.module}/../functions/edge/auth-check.js.tpl", {
    jwt_secret = var.jwt_secret
    login_path = "/login"
  })
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

  # Lambda auth origin — /auth/* routes here so the session cookie is set
  # on the CloudFront domain, not the Lambda URL domain
  origin {
    domain_name = trimprefix(trimsuffix(aws_lambda_function_url.auth.function_url, "/"), "https://")
    origin_id   = "lambda-auth"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
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

  # /auth/* goes directly to Lambda — no auth check, no caching
  # Cookie set here lands on the CloudFront domain, not the Lambda URL domain
  ordered_cache_behavior {
    path_pattern           = "/auth/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "lambda-auth"
    viewer_protocol_policy = "redirect-to-https"
    compress               = false

    # AWS managed CachingDisabled policy
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # Forward all query strings and headers (except Host) to Lambda
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

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
