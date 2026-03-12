# Netlify + Google OAuth

## Netlify environment variables

Set these values in Netlify:

```env
SESSION_SECRET=your-long-random-secret
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DATABASE_URL=postgres://...
```

`BASE_URL` is optional.

- For local development: `BASE_URL=http://localhost:3000`
- For Netlify: leave `BASE_URL` empty, or set it to the exact production domain

## Google OAuth redirect URI

In Google Cloud Console, add the exact callback URL used by the site:

```text
https://YOUR_DOMAIN/auth/google/callback
```

If you sign in through the default Netlify domain, add that too:

```text
https://YOUR_SITE.netlify.app/auth/google/callback
```

Use the exact domain you open in the browser. Google rejects mismatched hosts with `redirect_uri_mismatch`.

## Database note

Netlify does not provide a persistent local database for this app.

- Do not rely on SQLite on Netlify for real data
- Use `DATABASE_URL` with external Postgres instead
- This project already supports Postgres through `DATABASE_URL`
