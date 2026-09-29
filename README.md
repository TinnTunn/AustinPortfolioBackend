# Austin Yang — Portfolio API

The **NestJS** backend for [austinyang.tech](https://www.austinyang.tech). The
frontend (Next.js, separate repo) is display-only; everything server-side lives
here, and every secret (Supabase, Resend, Gemini) stays on this server.

| Area | Endpoints |
|---|---|
| Public content | `GET /content` — published Experience + Projects (EN + ID) |
| Contact form | `POST /contact` — saved to Supabase **and** emailed via Resend |
| Tinn (AI assistant) | `POST /chat` — streams a grounded Gemini reply |
| Visitor stats | `POST /visits` (frontend server only) · `GET /admin/stats` |
| Admin auth | `POST /admin/login` · `POST /admin/logout` · `GET /admin/session` |
| Admin CMS | `GET/POST /admin/{experiences,projects}` · `GET/PUT/DELETE …/:id` · `PATCH …/:id/published` · `POST …/:id/move` |
| Health | `GET /health` |

## Getting started

```bash
npm install
cp .env.example .env    # fill in the keys (see comments inside)
npm run dev             # http://localhost:4000, restarts on change
npm run build && npm start
```

### Database (one time)

In the Supabase dashboard → **SQL Editor**, run these in order:

1. [supabase/schema.sql](supabase/schema.sql) — tables, indexes, RLS, and the stats function
2. [supabase/seed-content.sql](supabase/seed-content.sql) — fills Experience and Projects with the current content (only into empty tables)

Then create the admin user: **Authentication → Users → Add user**, with the
email in `ADMIN_EMAIL` and a strong password (tick *Auto Confirm User*). Also
turn off public sign-ups (**Authentication → Sign In / Providers → Allow new
users to sign up**) — only `ADMIN_EMAIL` can log in anyway, but there's no
reason to let strangers create accounts.

## Security

- **Admin session**: after Supabase Auth checks the password, the API issues its
  own signed token (HMAC-SHA256, 8 h) in an `HttpOnly`, `Secure`,
  `SameSite=Strict` cookie scoped to `/admin`. Every admin route is behind
  `AdminGuard`, which verifies the signature, expiry, and that the email is
  `ADMIN_EMAIL`. Rotating `ADMIN_SESSION_SECRET` logs everyone out.
- **Brute force**: failed logins are counted in the database (5 per IP and 30
  in total per 15 minutes) plus a per-IP request throttle. If the counter can't
  be read, login is refused (fails closed).
- **CSRF**: state-changing browser requests must carry an `Origin` from
  `FRONTEND_ORIGINS`; CORS allows only those origins.
- **Injection**: DTOs are validated with `class-validator`; unknown properties
  are rejected (no mass assignment), text is length-capped and stripped of
  control characters, links must be `http(s)://`, IDs must be UUIDs, and the
  database is only reached through Supabase's parameterized query builder.
  React renders everything as text on the frontend.
- **Database**: RLS is on for every table with no policies, so the public anon
  key can't read or write anything; the stats function is executable by the
  service role only.
- **Headers & limits**: Helmet security headers, a 64 KB body limit, rate
  limits on login, contact, and chat.
- **Privacy**: visitor stats store no cookies and no raw IPs — only a daily
  rotating HMAC of IP + user agent.

## Deploying to Railway

1. New project → deploy this repo. Railway runs `npm run build` and `npm start`.
2. Add every variable from `.env.example` under **Variables** (`NODE_ENV=production`,
   `FRONTEND_ORIGINS=https://www.austinyang.tech,https://austinyang.tech`,
   `FRONTEND_URL=https://www.austinyang.tech`).
3. **Settings → Networking → Custom domain**: `api.austinyang.tech`, then add the
   CNAME record Railway shows at your DNS provider.
4. Set the health check path to `/health`.
