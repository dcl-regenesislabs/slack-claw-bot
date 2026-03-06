---
name: upload-file
description: Upload a file (image, video, or any binary) to Cloudflare R2 and get a public URL. Only upload when the user explicitly asks to upload or make a file public.
---

# Upload File to Cloudflare R2

## When to upload

**Only upload files when the user explicitly requests it** — e.g. "upload the image", "make it public", "attach the image to the issue", "allow upload".

If the user does NOT ask to upload:
- Describe the image/video content in your response instead
- If they ask to create a GitHub issue with an image, describe it in the issue body and mention: "I can upload the image to a public URL and add it to the issue if you'd like — just say 'upload the image'."

## Pre-flight check

Before uploading, verify the env vars are set:

```bash
test -n "$CF_R2_ACCOUNT_ID" && test -n "$CF_R2_BUCKET" && test -n "$CF_R2_TOKEN" && test -n "$CF_R2_PUBLIC_DOMAIN" && echo "ready" || echo "not configured"
```

If not configured, tell the user: "File uploads are not configured. I can only describe the image content."

## Upload

Use the Cloudflare API (not the S3-compatible endpoint — that requires AWS Sig V4):

```bash
unique_name="$(date +%s)-${filename}"
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_R2_ACCOUNT_ID}/r2/buckets/${CF_R2_BUCKET}/objects/${unique_name}" \
  -H "Authorization: Bearer ${CF_R2_TOKEN}" \
  -H "Content-Type: ${mime_type}" \
  --data-binary "@${file_path}"
```

- `filename` — the original filename
- `mime_type` — match the file's actual type (e.g. `image/jpeg`, `video/mp4`)
- `file_path` — absolute path to the local file (from the Attached Media section)

A successful upload returns JSON with `"success": true`.

## Public URL

After a successful upload, the file is available at:

```
https://${CF_R2_PUBLIC_DOMAIN}/<unique_name>
```

## Embedding in GitHub issues

Use standard markdown for images:

```markdown
![description](https://${CF_R2_PUBLIC_DOMAIN}/1234567890-screenshot.png)
```

For videos, use an HTML tag:

```markdown
<video src="https://${CF_R2_PUBLIC_DOMAIN}/1234567890-demo.mp4" controls></video>
```

## Environment variables

| Variable | Description |
|---|---|
| `CF_R2_ACCOUNT_ID` | Cloudflare account ID |
| `CF_R2_BUCKET` | R2 bucket name |
| `CF_R2_TOKEN` | R2 API token with write permission |
| `CF_R2_PUBLIC_DOMAIN` | Public domain for the bucket (e.g. `pub-abc123.r2.dev` or a custom domain) |
