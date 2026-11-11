# qsp Share

## Private feedback service

The website's feedback form sends anonymous messages to a separate Cloudflare Worker. Messages are stored in D1 with a timestamp; the public site cannot list or delete them. The admin secret must only be stored in Cloudflare and entered into the owner panel when needed. Never put it in `index.html` or commit it to Git.

### Deploy the Worker

1. Install Node.js, then open a terminal in `feedback-worker`.
2. Create a D1 database:

   ```powershell
   npx wrangler d1 create qsp-share-feedback
   ```

   Copy the returned database ID into `database_id` in `wrangler.toml`.
3. Check `ALLOWED_ORIGINS` in `wrangler.toml`. It must include the exact website origin (currently `https://qspshare.vercel.app`; add any custom domain as a comma-separated origin).
4. Apply the schema and create a private admin secret:

   ```powershell
   npx wrangler d1 migrations apply qsp-share-feedback --remote
   npx wrangler secret put ADMIN_SECRET
   ```

   Use a randomly generated secret with at least 32 characters. Enter it only at Wrangler's prompt and keep it in a password manager.
5. Deploy:

   ```powershell
   npx wrangler deploy
   ```

6. Confirm the deployed URL matches `feedbackApiUrl` in `index.html`. The configured URL is `https://qsp-share-feedback.afghanbadboy619.workers.dev`; if Wrangler shows a different account subdomain, update that setting before publishing the site.

The Worker provides public `POST /api/feedback` submission and secret-protected `GET /api/feedback` and `DELETE /api/feedback/{id}` administration. Until the Worker and D1 database are deployed, the feedback form cannot submit or load messages.
