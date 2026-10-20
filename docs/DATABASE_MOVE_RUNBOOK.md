# Moving the database from Seoul to Ohio (R-292, D-0166)

**Why:** the database is in Seoul and the server is in Ohio, so every question the app asks the database crosses the world (~200 ms). Pages take seconds. Moving the database next to the server fixes most of it.
**What does not change:** the app's address (so links in already-sent emails and the Google / Microsoft sign-in keep working), the server, the code. Only two settings on Render change at the end.
**How big:** 44 MB of data (59 tables in `public`, plus `outreach` and `backups`) and 116 files (14 MB) in storage. A copy takes a few minutes.
**Safety:** the old database is never written to. It stays untouched for at least a week as the way back.

## What the owner does (plain steps)

### 1. Create the new project (one time, I can do it once you say yes to the monthly cost)
Supabase → New project → organisation **PACE** → name **PACE Ohio** → region **East US (Ohio)** → choose a database password and keep it.
*(Creating a second active project on the Pro plan can add to the Supabase bill; the price is shown before anything is created.)*

### 2. Collect four things (copy and paste, nothing to understand)
For **each** project (old = "PrinceThomas37's Project", new = "PACE Ohio"):
- **Connection string:** project → **Connect** → **Session pooler** → copy it and put your database password in place of `[YOUR-PASSWORD]`. It must start `postgresql://postgres.<project>:` and contain `pooler.supabase.com`. *(For the OLD project, if you do not know the password: Project Settings → Database → Reset database password. The app does not use that password — it talks to Supabase another way — so resetting it is safe.)*
- **Secret key:** Project Settings → API Keys → the **service_role** key (or the "secret" key) → copy.

### 3. Give them to GitHub (one time)
GitHub → the repository → Settings → Secrets and variables → Actions → **New repository secret**, four times:
`SRC_DB_URL` (old connection string) · `DST_DB_URL` (new) · `SRC_SERVICE_KEY` (old secret key) · `DST_SERVICE_KEY` (new).
*(GitHub hides them from everyone, including in its logs. I never see them.)*

### 4. Rehearsal (as many times as you like, any time — the app keeps working)
GitHub → Actions → **Database move** → Run workflow → mode **rehearsal**. It copies everything into the new project and then checks it: every table's rows and a fingerprint of its contents, the policies and indexes, the files in storage, and that the app's kind of key can read the new database. It ends with `RESULT: THE COPY MATCHES THE OLD DATABASE` or a list of what differs. Tell me when it has run and I will read it and compare the two projects myself, independently.

### 5. The switch (a quiet 15 minutes; after the outreach has finished — it has gone quiet today)
1. Tell the team to stop for 15 minutes (no sends, no edits).
2. **Admin → Stop all sending** (the platform emergency stop).
3. Actions → Database move → Run workflow → mode **final**, type `YES` in the box.
4. When it says the copy matches: on **Render → the service → Environment**, change `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to the new project's (Project Settings → API). Render redeploys by itself (~1 minute). *(Or send me the two values and I set them — your choice.)*
5. I check the live app and the new database together: sign-in, leads, a mailbox, the reply sweep.
6. Turn sending back on.

### 6. The way back
If anything is wrong after the switch: put the two Render settings back to the old values (1 minute). Anything saved after the switch is only in the new database, so tell me first and I will copy it back.
After a week of everything working: pause or delete the old project (that also ends its cost).

## What I do
Build and test the tool (done: `scripts/db-move/`, `.github/workflows/db-move.yml`, `test/db-move-guards-smoke.mjs`), read every rehearsal result, compare the two projects myself with queries, do the Render settings and the post-switch checks, write it all down.

## What the tool refuses to do (all tested)
Run if the "old" secret is not the real old project; run if old and new are the same; run if the new database is not in Ohio; do a final copy unless you typed `YES`; start on a schedule; upload anything (this repository is public, so its logs are too — the tool prints counts and table names, never rows); write to the old database; delete any file.

## Not moved on purpose
`pm_sim` (a scratch schema nothing uses), Supabase's own `auth` (0 users — the app has its own sign-in), `realtime`, `vault`, and the migrations ledger. The app uses only the `public` schema through Supabase's web API; it makes no direct database connection.
