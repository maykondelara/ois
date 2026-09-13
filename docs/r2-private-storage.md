# Cloudflare R2 private storage

Configure Railway with server-only values for `FILE_STORAGE_PROVIDER=r2`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_REGION=auto`, `FILE_UPLOAD_URL_TTL_SECONDS=900`, and
`FILE_DOWNLOAD_URL_TTL_SECONDS=300`. Do not expose these as `NEXT_PUBLIC_*`
values. The R2 bucket must remain private.

Direct browser PUT requests need bucket CORS. Restrict `AllowedOrigins` to the
exact application origins, not `*`; allow only `PUT`, `GET`, and `HEAD`; allow
the headers used by signed requests (at minimum `content-type` and `x-amz-*`);
and expose no unnecessary response headers. Example:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 300
  }
]
```

The API keeps exact `APP_URL` origin validation. Object keys, bucket names,
credentials, and permanent public URLs are never client-facing API data.
