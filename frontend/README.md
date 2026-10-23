This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Sign-in and first-time setup

Zuri uses Supabase Auth for email/password accounts. First-time visitors see a short product introduction before sign-up or sign-in. Completing or skipping it is remembered in this browser; signing out does not show it again. Deleting an account from **Settings → Security** resets the introduction for the next visit. New accounts also complete a short preferences onboarding before entering the workspace. Email confirmation and password reset are supported. Onboarding completion is saved to Auth metadata; profile details and preferences are saved in Supabase PostgreSQL.

Signed-in users can update their display name and request an email change from **Settings → Account**. Account details are read-only until **Edit details** is selected. Display names are saved to the user's profile and Auth metadata. Email changes follow Supabase's configured confirmation flow; the existing sign-in email remains active until the change is confirmed. Trading experience is displayed as read-only account information.

## Database foundation

Supabase Auth and Supabase PostgreSQL are the source of truth for Zuri accounts and user-owned data. The migrations in `supabase/migrations/` create:

- `profiles` for a user's display name and onboarding preferences.
- `user_preferences` for typed display, chart, trading, risk, and notification settings. Broker credentials and account balances do not belong in this table.
- `journal_entries` for user-owned trade notes and plans.
- `watchlist_items` for each user's ordered symbols.

Every table is linked to `auth.users`, has row-level security enabled, and only permits signed-in users to access their own rows. New and existing Auth users receive a profile and default preferences. Deleting an Auth user cascades to their database rows.

To create or update the schema in the Supabase project, open **SQL Editor** and run each migration in timestamp order, once: [`20261023000000_initial_user_data.sql`](../supabase/migrations/20261023000000_initial_user_data.sql), [`20261023000001_atomic_watchlist_update.sql`](../supabase/migrations/20261023000001_atomic_watchlist_update.sql), [`20261023000002_backfill_existing_profiles.sql`](../supabase/migrations/20261023000002_backfill_existing_profiles.sql), then [`20261023000003_add_workspace_preferences.sql`](../supabase/migrations/20261023000003_add_workspace_preferences.sql). If the initial schema migration was already applied, run only the newer migration(s). Keep future database changes as new, timestamped SQL migrations under `supabase/migrations/`; do not edit an already-applied migration. The app reads and writes the profile, user preferences, journal, and watchlist tables directly through the signed-in user's Supabase session and row-level security. Existing browser journal and watchlist data is imported for the signed-in user on their first workspace load, then removed from local storage only after a successful import. Some preferences are stored for future use but do not yet change app behavior. Broker controls, balances, executions, and other prototype data remain simulated and are not saved as real broker data.

To connect authentication:

1. Create a Supabase project and enable the **Email** and **Google** sign-in providers under **Authentication → Sign In / Providers**. Email/password remains available as a fallback.
2. Configure **Google** in the Google Cloud Console: create an OAuth client with application type **Web application**, add your Zuri origins (`http://localhost:3000` and `http://127.0.0.1:3000`) as authorized JavaScript origins, and add the Supabase callback URL shown in Supabase's Google provider settings as an authorized redirect URI. Copy the Google client ID and secret into the Supabase Google provider fields. Set up Google's consent-screen branding as Zuri Markets; Google may require app verification before general-public use.
3. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/email-verified` and `http://127.0.0.1:3000/email-verified` to the redirect URL allow list for signup confirmations. Also allow `http://localhost:3000` and `http://127.0.0.1:3000` for sign-in, OAuth, and password reset.
4. Copy the project's URL and its publishable (or legacy anon) key from the Supabase project settings. Copy the publishable/anon key only; never put a `service_role` or secret key in the frontend.
5. Copy `frontend/.env.example` to `frontend/.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Copy `backend/.env.example` to `backend/.env` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the same project values. To enable account deletion, also set `SUPABASE_SERVICE_ROLE_KEY` to the project's server-side service role key. Keep this key only in the backend environment; never put it in frontend code or `frontend/.env.local`. Keep any existing private integration keys in this file.
7. Restart the frontend, then try **Continue with Google** from the welcome or sign-in screen. Google accounts must create a Zuri password before continuing to preferences onboarding; they can use it to sign in with email as well as Google. Email/password signup still uses email confirmation; after verification, the link opens a confirmation page that tells the user to return to their original Zuri tab.

### Keep users signed in

The browser client uses Supabase's PKCE authorization-code flow, stores the resulting session across reloads, and automatically refreshes access tokens. After changing the flow, sign in once again so Supabase can establish a PKCE session. To allow users to return after a day without signing in again, open **Authentication → Sessions** in Supabase and make sure the **Inactivity timeout** is disabled or longer than one day and the **Time-boxed session** is disabled or longer than one day. A user is still signed out if they choose **Sign out**, delete their account, clear browser storage, or their refresh token is revoked.

Google sign-in authenticates the Zuri account only. It does not connect a brokerage account or grant Zuri access to trading data.

The backend verifies Supabase access tokens for account, position, order, trade-execution, and AI-chat endpoints. Market news remains public. The browser-side workspace gate is for navigation; backend token verification is the security boundary. The current workspace still contains simulated account and quote data, and account onboarding does not connect a brokerage account.

Account deletion is performed by the backend using the authenticated user's verified Supabase ID and the server-only `SUPABASE_SERVICE_ROLE_KEY`. It permanently removes that Supabase Auth user, and the schema's foreign keys also delete that user's profile, preferences, journal entries, and watchlist rows. Configure the backend service-role key before using **Settings → Security → Delete account**.

### Brand account emails as Zuri

The sender name and sender address are controlled by the SMTP provider, not by the email HTML. Supabase's built-in sender appears as **Supabase Auth** and is intended for testing; use a custom SMTP provider to send as a verified Zuri domain. Supabase currently limits its default sender to project-team addresses and low send volume.

1. Choose a transactional email provider that supports SMTP (for example, Resend, Postmark, Brevo, or Amazon SES). Create/verify a sending domain you own. For authentication mail, a dedicated subdomain such as `auth.yourdomain.com` is a good choice; do not use a domain you do not control.
2. In that provider's domain setup, add the DNS records it gives you for SPF and DKIM. Add a DMARC record for the domain as well. Wait for the provider to verify the domain before sending. DNS records and verification can take time to propagate.
3. In the email provider, create/copy its SMTP credentials. In Supabase, open **Authentication → SMTP Settings** (sometimes labeled **Project Settings → Auth → SMTP Settings**), enable custom SMTP, and enter the provider's SMTP host, port, username, and password. Set the sender email to an address permitted by the verified domain, such as `no-reply@auth.yourdomain.com`, and the sender name to `Zuri Markets`. Save the settings. SMTP credentials belong only in this Supabase dashboard; never put them in frontend code or share them in chat.
4. In Supabase, open **Authentication → Email Templates → Confirm signup**. Set the subject to `Confirm your Zuri account`. Replace the message body with the complete contents of [`email-templates/confirm-signup.html`](./email-templates/confirm-signup.html), then save. The button text is `Verify my email`; `{{ .ConfirmationURL }}` is the one-time confirmation link and must remain in both link locations.
5. In **Authentication → Email Templates → Reset password**, set the subject to `Reset your Zuri password`. Replace the body with [`email-templates/reset-password.html`](./email-templates/reset-password.html), then save. The button says `Choose a new password`. Keep both `{{ .ConfirmationURL }}` values intact.
6. In **Authentication → URL Configuration**, set the Site URL to your app's actual URL. For local testing, Zuri currently uses `http://127.0.0.1:3000`; allow both `http://127.0.0.1:3000` and `http://localhost:3000` as Redirect URLs. For production, add your HTTPS production URL and use it as the Site URL.
7. Test signup and password reset with an inbox you control. Verify the sender display name/address, subject, layout, button wording, and that both links return to Zuri and complete the correct flow.

Editing the template changes the visible copy and link label, but it cannot change the sender identity on its own. A custom SMTP server and a verified sending domain are required for the message to come from Zuri. Supabase's delivery and branding options can vary by project; see its [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [email templates](https://supabase.com/docs/guides/auth/auth-email-templates) guides.

For Gmail or Google Workspace SMTP, use `smtp.gmail.com`, port `465` with SSL or `587` with TLS, the full sender email as the username, and a Google app password (not the regular account password). Confirm custom SMTP is enabled in Supabase and use the same sender address configured with the SMTP provider. See Google's [SMTP setup guide](https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app).

## Zuri AI assistant

The floating Zuri assistant sends chat requests to the FastAPI backend at `http://127.0.0.1:8000` by default. Set `NEXT_PUBLIC_BACKEND_URL` in the frontend environment when the backend runs at a different URL. Add the frontend origin to the backend's comma-separated `FRONTEND_ORIGINS` setting if it is not `http://localhost:3000` or `http://127.0.0.1:3000`.

The assistant provides educational trading support and does not submit orders. It uses each user's saved onboarding market interests to prioritize relevant terminology and context, without treating interests as proof of expertise or a substitute for accuracy. These interests guide each conversation; they do not train or change the underlying AI model. The workspace's displayed market quotes and account figures are demo data.

## Market briefing

The Dashboard and Charts briefing loads attributed headlines from CNBC US Top News and BBC Business/World through the backend's `GET /api/market-news` endpoint. The browser requests updates every five minutes, and the backend caches publisher feeds for five minutes. Stories include a publication time when the publisher provides one, a source label, a link to the original article, and an optional symbol match based on simple headline/excerpt keyword matching.

Use **Ask Zuri** on a story to include its title, excerpt, source, time, and link as context in the assistant conversation. Zuri treats that publisher material as untrusted input and can discuss possible relevance, not confirm causation or predict price direction. A missing feed is reported in the briefing; if all feeds are unavailable, the endpoint returns an error rather than fabricated headlines.

Publisher RSS reuse, attribution, and commercial-use terms have not been cleared for production. Review each publisher's current terms and obtain any required permissions before deploying this feed commercially. The current three-feed set is an initial briefing, not comprehensive real-time financial news.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
