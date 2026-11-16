# AnbudRadar – cost optimization report (16 November 2026)

**Status:** all changes are on branch `claude/anbudradar-saas-launch-eje0gv`, tested, and **not deployed**. Production
is unchanged. No prices, plans, providers or paid services were changed or added.

**Read this first:** AI is switched off in production, so today's real AI spend is $0, and no AI figure in this report
comes from real traffic. Every AI number is an **estimate** from `scripts/cost-model.ts`, which builds the real prompts
for 300 real tenders and prices them with the list prices in the code. The assumptions are listed in §4 and can be
changed in the script. Numbers marked **measured** come from runs on the local database or from the test suite.

## Summary

- **AI is the only cost that grows with every customer.** The existing design already did the big things: one shared
  analysis per public tender, the provider's prompt cache, quotas, a monthly cost cap per organisation and a cheap
  model for summaries. This work adds the following:
  - one call when the same request arrives twice at the same time;
  - the cheap model first wherever its answer can be checked;
  - sharing of bid checklists and outlines built only from public text;
  - smaller inputs;
  - measurement of cost and savings in Admin → AI-bruk.
- **Estimated AI saving in typical use: about 7 %** (3–13 % depending on how often the cheap model's answer is
  rejected). That is roughly **$12 / $116 / $1,160 per month at 100 / 1,000 / 10,000 customers**. The largest AI
  cost, document analysis on the quality model, is deliberately unchanged, because that is where answer quality matters
  most.
- **Measuring caught two problems in my own earlier changes; both are fixed.**
  1. **AI routing:** trying the cheap model first could make follow-up chat questions *more* expensive than before.
     The quality model reads a recently used document from the provider's cache at 5 % of the price, while a retried
     answer starts cold. The routing is now cache-aware, and a guard switches the cheap model off for a feature
     whenever it is rejected more than half the time. With both in place, the after-cost is at or below the
     before-cost at every rejection level the model tests (§4).
  2. **Background worker:** my first version rested 30 s when idle, longer than the database pool keeps an idle
     connection (20 s). It reconnected every round and sent 8.6× more data from the database than before. The rest is
     now 15 s, and it sends less than before (§7).
- **OCR for scanned PDFs now exists.** It runs in the customer's browser at $0 per page, and no document is sent to
  another company.
- **Database load is lower** (measured locally):
  - the daily match refresh scores 69 % fewer pairs and no longer rewrites unchanged rows;
  - the duplicate check uses indexes and is 2–3× faster;
  - the idle background worker makes 74 % fewer database transactions and moves 62 % fewer bytes (measured exactly
    with a counting relay).
- **Fixed infrastructure costs are unchanged** (free plans today). These changes add headroom; they do not lower a
  bill on fixed-price plans.
- **Tests:** everything passes (§8).

## 1. What already existed (audit, step 1)

| Area | Already in place before this work | Gap found |
| --- | --- | --- |
| AI reuse | Same input → same stored answer, no new cost; analyses of public text stored once and shared by all customers | Two identical requests at the same moment both paid; bid checklist/outline never shared |
| Provider prompt cache | Sources sent first with `cache_control` (follow-up questions read them at 5–10 % of the price) | Not measured anywhere |
| Model choice | Quality model for analysis; optional cheap model (`ANTHROPIC_MODEL_FAST`) for summary and weekly overview | Without that variable, *everything* ran on the quality model; chat and bid outline always on the quality model |
| Limits | Quotas per plan (reuse is free), free-plan protections, rate limits, output caps, 120 000-character input cap, monthly cost cap per organisation (`AI_MONTHLY_COST_LIMIT_USD_PER_ORG`, $40) | – |
| Input size | Input cap and source budget | Repeated headers/footers, page-number lines, dotted leaders and duplicate pages sent to AI |
| Features without AI | Matching and ranking, requirement and rejection scan, terms and hidden-cost scan, profitability calculator, market price from award notices, contract expiry radar, pre-assessment, duplicate detection – all computed from stored data, no AI calls | Daily match refresh re-scored every open tender and rewrote every match row; duplicate check computed similarity against every tender in the country |
| Background jobs | One worker for imports, alerts, e-mail, retention | Polled every 5 s and tried to claim 11 scheduled tasks every minute, even with nothing to do |
| E-mail | Newsletter share capped under Resend's free daily quota (urgent mail first) | The 24-hour count had no index |
| OCR | – | Scanned PDFs could not be read at all |
| GitHub Actions | CI skips docs-only pushes and cancels superseded runs; keep-alive and backups on free Actions | No change needed |
| Database size | Retention rules for personal data | Raw source payloads are ~22 % of the local database (trimming them deletes data – needs your approval, §9) |

## 2. What changed

| Change | What it does | Evidence | Commit |
| --- | --- | --- | --- |
| One call for identical simultaneous requests | A lock per request content (`ai_inflight`); the second request waits for and reuses the first answer. Private answers lock per organisation and are never shared | Integration tests: two customers → one call; double-click → one call; private answers never cross organisations | `eeadb1b` |
| Cheap model first, with checks | Claude Haiku 5.5 first for chat and bid outline (summary and weekly overview were already on the cheap tier). Its answer must pass format validation, refusal handling and, for chat and outline, a verbatim check of every quote against the sources. If it fails, the quality model answers; the rejected attempt costs money but does not count against the customer's quota | Integration tests for all three rejection types | `eeadb1b` |
| Haiku 5.5 as default cheap model | Without `ANTHROPIC_MODEL_FAST`, the cheap tier now uses `claude-haiku-5-5` instead of the quality model. Set it equal to `ANTHROPIC_MODEL` to use one model for everything | Unit/integration tests | `eeadb1b` |
| Warm-cache routing (new today) | If the quality model answered the *same* sources less than 5 minutes ago (same organisation for private questions), the next request goes straight to it: its cache is warm, and the cheap model just failed on these sources | Integration test: after a rejection the next question skips the cheap model; another organisation is unaffected. Unit tests: 5-minute expiry, per-organisation keys, memory cap | new commit |
| Guard (new today) | If more than half of a feature's cheap answers were rejected in the last 7 days (at least 20 attempts), that feature uses the quality model directly until the share falls | Integration test: 75 % rejected → cheap model skipped; 30 % → tried again; shown in Admin | new commit |
| Shared bid checklist and outline | Shared between customers when built only from public text; with the customer's own documents they stay private | Integration test: two organisations → one stored answer | `eeadb1b` |
| Smaller AI inputs | Repeated short header/footer lines kept only on page 1, page-number lines removed, dotted leaders shortened, a page identical to an earlier one replaced by a reference. Applies only to what the AI reads; quotes are still checked against the same text | 4 unit tests (synthetic documents). **Effect on real tender documents not measured** | `b5dd7bd` |
| Cost and savings tracking | Per call: cost, saved amount when reused, escalation, provider cache reads/writes. Admin → AI-bruk shows them per feature and organisation, plus the cheap-model status per feature | Integration tests | `eeadb1b` + new commit |
| Duplicate check via indexes | Candidates fetched via the organisation-number index and the trigram index before similarity is computed | Measured on 3,383 tenders: 13.6 → 4.2 ms (with org. no.), 13.1 → 5.9 ms (without); same result 40/40 | `bb6ed8e` |
| Match rows written only when changed | `ON CONFLICT … WHERE … IS DISTINCT FROM` | Integration test: no rows written when nothing changed | `bb6ed8e` |
| Daily match refresh only where time matters | Only tenders whose deadline falls inside the window that can change a match; closed tenders removed in one query. Also fixed a bug: a match that fell below the threshold kept its old score | Integration test: same result as a full recompute. Measured: see §7 | `bb6ed8e` |
| Worker rests when idle | Heartbeat every minute (was every 5 s); one read of the schedule instead of 11 claim attempts per minute; up to 15 s rest when idle (was 5 s), kept below the database pool's 20 s idle timeout so the connection is reused. A new job in the same process wakes it at once | Measured: §7. Unit test for the rest limit | `39ed46f`, fixed in the new commit |
| Index for the e-mail quota count | `email_outbox (sent_at) where status = 'sent'` | – | `eeadb1b` |
| OCR in the browser | See §3 | Unit, integration and Chromium end-to-end tests | `fa6f7ba` |

## 3. New functionality

- **OCR for scanned PDFs (in the customer's browser).**
  - pdf.js finds the pages without text, and Tesseract.js (Norwegian and English) reads them one at a time, with
    progress and a cancel button, up to 60 pages.
  - The server uses the OCR text only for pages where its own extraction found nothing, and marks the document "N
    pages read with OCR – may contain reading errors".
  - The engine, language data and pdf.js are served from AnbudRadar's own server (about 20 MB in the build, about
    11 MB downloaded per browser on first use, then cached). Nothing is fetched from other sites and no document leaves
    the browser except in the normal upload.
  - Running cost: $0 per page. A cloud OCR API would have charged per page and added a new data processor.
  - The OCR packages are build-time development dependencies only.
- **Admin → AI-bruk:** cost and savings per feature and per organisation, reuse rate, share of input read from the
  provider cache, and for each cheap-first feature the rejection share and whether the guard has paused it.
- **`npx tsx scripts/cost-model.ts`:** the estimate in this report, reproducible. It makes no AI calls and writes
  nothing.

## 4. AI cost per call and per customer – before and after

**Method.** "Before" is the code before this work (`6c9156a`), "after" is now. The prompts are the real system prompt,
response schema and source block. Prices are list prices: Sonnet 5.5 $2 / $10 per million tokens with cache reads at
$0.10, and Haiku 5.5 $0.10 / $0.50 with cache reads at $0.01. Cache writes cost 1.25× the input price.

**Assumptions (change them in the script):**

| Assumption | Value |
| --- | --- |
| Quality model | Claude Sonnet 5.5 |
| Cheap model | Claude Haiku 5.5 |
| Characters per token | 3.4 (120 000 characters ≈ 35 000 tokens) |
| Haiku token count | +30 % for the same text. Its newer tokenizer is documented to count about 30 % more; applying this only to Haiku is conservative |
| With documents | The source block fills the 120 000-character cap |
| Notice only | Median of 300 real notices (1 364 characters) |
| Chat | Questions come in sessions of 3 within 5 minutes; the first writes the cache, the next two read it |
| Typical answer length | Fixed per feature, e.g. full analysis 4 000 tokens, chat 600 |
| Rejection rate of the cheap model | Unknown until AI runs – shown at 10 %, 30 % and 50 % |
| Typical use | 30 % of the plan's quota |
| Customer mix | 30 % Start, 50 % Professional, 20 % Business |

**Per call (USD, typical answer).** The after column shows 10 % / 30 % / 50 % rejected:

| Feature | Before | After |
| --- | --- | --- |
| Short summary (shared) | 0.0006 | 0.0006 |
| Weekly overview | 0.0004 | 0.0004 |
| Ask about the tender (per question) | 0.0390 | 0.0123 / 0.0263 / 0.0347 |
| Bid outline | 0.1053 | 0.0174 / 0.0384 / 0.0595 |
| Full analysis with documents | 0.1340 | 0.1340 (unchanged on purpose) |
| Full analysis, notice only (shared) | 0.0368 | 0.0368 |
| Fit assessment | 0.1167 | 0.1167 |
| Profit analysis | 0.1369 | 0.1369 |
| Bid checklist | 0.1103 | 0.1103 (shared when built from public text only) |
| Bid draft (one section) | 0.1167 | 0.1167 |
| Bid review | 0.0333 | 0.0333 |

Above 50 % rejected, the guard switches the feature back to the quality model, so the price is the same as before.
Without warm-cache routing, chat at 50 % rejected would have cost 0.0508 per question (+30 %); this is the risk that
was fixed.

If `ANTHROPIC_MODEL_FAST` was not set before, the short summary also drops from $0.0093 to $0.0006 and the weekly
overview from $0.0067 to $0.0004. That adds about $0.02 per customer per month. It is not included below.

**Per customer per month, typical use:**

| Plan | Before | After at 30 % rejected (10–50 %) | Change |
| --- | --- | --- | --- |
| Start (299 kr) | $0.002 | $0.002 | 0 % |
| Professional (699 kr) | $1.21 | $1.14 ($1.05–1.19) | −6 % (−13 to −2 %) |
| Business (1 490 kr) | $5.10 | $4.71 ($4.44–4.90) | −8 % (−13 to −4 %) |
| **Average for the mix** | **$1.63** | **$1.51 ($1.42–1.58)** | **−7 % (−13 to −3 %)** |

**Worst case** (whole quota spent on full analyses with documents, answers at the output cap): Professional $15.24,
Business $48.69 per month. This is unchanged, and Business is stopped at the $40 monthly cap per organisation.

## 5. Estimated savings per month

**AI** (estimate; after-figures at 10 / 30 / 50 % rejected):

| Customers | AI before | AI after | Saving per month |
| --- | --- | --- | --- |
| 100 | $163 | $142 / $151 / $157 | **$21 / $12 / $5** (197 / 107 / 49 kr) |
| 1,000 | $1,628 | $1,415 / $1,512 / $1,575 | **$213 / $116 / $53** (1 968 / 1 073 / 491 kr) |
| 10,000 | $16,279 | $14,151 / $15,119 / $15,748 | **$2,128 / $1,160 / $531** (19 679 / 10 730 / 4 913 kr) |

The model scales linearly and does not count reuse across customers. In reality, shared analyses of public tenders
cost once per tender, not once per customer. That existed before, so it lowers both columns and is left out to keep
the figures conservative.

Not included because there is no traffic to measure yet:
- one call for simultaneous identical requests;
- sharing of public checklists and outlines;
- smaller inputs on real documents.

They can only lower the after-column. Admin → AI-bruk will show them once AI is on.

**Infrastructure:** no direct saving in kroner on the current plans (free tiers, fixed prices). What changed is load
and headroom (§7). That postpones the point where a bigger database plan is needed, but I cannot put a reliable number
on when.

## 6. Remaining unavoidable external costs

| Cost | Price (excl. VAT) | When it applies |
| --- | --- | --- |
| Anthropic (AI tokens) | Per token, see §4; capped per organisation by `AI_MONTHLY_COST_LIMIT_USD_PER_ORG` ($40 in `render.yaml`) | When AI is switched on – the largest variable cost |
| Stripe | 2.4 % + 2 kr per Norwegian/EEA card, plus Billing 0.7 % ≈ 3.4 % of revenue (24.85 kr per customer per month on the current mix) | Every payment |
| Supabase | Free today. Pro $25/month (includes $10 compute credit), Small compute +$15, PITR $100 per 7 days *(checked 2.11.2026)* | Pro before the first paying customer (daily backups, no pausing). Larger compute at a few hundred customers and up – larger tiers not price-checked here |
| Render | Free today. About $25/month web (1 CPU/2 GB) and $7 worker *(third-party sources, not checked with Render)* | Before the first paying customer (the free plan sleeps) |
| Resend (e-mail) | Free up to 3,000/month and 100/day. Pro $20 for 50,000 *(checked 2.11.2026)* | Likely needed once there are a few hundred customers and newsletter subscribers (weekly newsletters and alerts). At 10,000 customers, probably more than 50,000/month – a higher tier (price not checked) |
| GitHub | Free (public repository: CI, keep-alive, backups) | – |
| Domain | Yearly fee | – |

Every plan change needs your approval. None was made.

## 7. Performance and quality impact

**Measured (local database):**
- **Duplicate check per imported notice:** 13.6 → 4.2 ms with organisation number, 13.1 → 5.9 ms without, same
  result for 40 of 40. The old cost grew with the number of tenders; the new one follows the index.
- **Daily match refresh (2 profiles, 991 open tenders, 3 runs):** pairs scored 1,982 → 624 (−69 %), time about 200 →
  about 90 ms. The old version also rewrote every stored match each day (1,254 rows here); now unchanged rows are not
  written. That avoids table bloat and write load, which grows with customers × open tenders. The results match a full
  recompute (integration test).
- **Idle worker, 180 s with nothing to do.** Measured exactly: all database traffic went through a small relay that
  counts bytes each way and new connections.

  | Version | Transactions | New connections | Bytes from DB | Bytes to DB |
  | --- | --- | --- | --- | --- |
  | Before (5 s rest) | 219 | 0 | 6,069 | 15,060 |
  | My first version (30 s rest) | ≈ 54 | 5 | 52,446 | 10,933 |
  | **Now (15 s rest)** | **57 (−74 %)** | **0** | **3,250 (−46 %)** | **4,667 (−69 %)** |

  - Per month from the database: about 87 MB before, 755 MB with my first version, and 47 MB now. In production every
    new connection also costs a TLS handshake, so the first version would have been worse there.
  - My earlier measurement with the machine's network counter could not separate this traffic from other local
    traffic, so it is replaced by this one.
- **OCR (Chromium):** a scanned page of Norwegian text was read correctly, including æ/ø, dates and times, except
  "ISO", which became "150" (a common OCR confusion; the page tells the customer to check important numbers). It ran
  in under 5 s locally including model loading, with no requests to other sites.

**Effects that depend on traffic:**
- **Chat speed:** an accepted cheap answer should come faster (smaller model; not measured). A rejected one takes two
  calls and is slower. Warm-cache routing limits that to once per session, and the guard stops it becoming routine.
- **Worker latency:** with the worker inside the web process (today's setup), new jobs start immediately. With a
  separate worker service, a job started from the website (e.g. "Hent nå") can start up to 15 s later.

**Answer quality:**
- The customer only ever sees an answer that passed the same checks as before: valid format, no refusal, and for chat
  and bid outline every quote found verbatim in the sources. Anything else is regenerated by the quality model.
- **NOT VERIFIED:** how often Haiku 5.5 is rejected, and whether its accepted answers are as useful as the quality
  model's. The checks catch invented quotes, not shallow answers. This needs a small paid test on real tenders before
  customers rely on it (§9). Until then you can use one model for everything by setting `ANTHROPIC_MODEL_FAST` equal to
  `ANTHROPIC_MODEL`.

**Security and privacy:**
- No change to row-level security.
- Private answers are never shared, locks and routing memory are per organisation for private requests, and the
  routing memory holds only hashes.
- OCR runs locally, and the page's security rules (CSP) are unchanged.

## 8. Tests and results

| Check | Result (16 November 2026, after all changes) |
| --- | --- |
| Typecheck (TypeScript strict) | No errors |
| Unit tests | 275 passed, 0 failed, 1 skipped (DFØ sample files; runs only when that SDK is present locally) |
| Integration tests (real PostgreSQL 16 with row-level security, real HTTP) | 288 of 288 passed |
| End-to-end in Chromium | 12 of 12 passed, including OCR of a scanned PDF |
| Production build | OK |
| `npm audit` (production dependencies and all) | 0 vulnerabilities |
| GitHub CI | Green for `fa6f7ba`, which includes all earlier cost commits. It runs again on this push |

New or changed tests in this work:
- `tests/integration/ai-cost.test.ts`: simultaneous requests, privacy, escalation (3 kinds), chat with warm-cache
  routing, the guard, and shared checklists.
- `tests/unit/ai-routing.test.ts`.
- `tests/unit/worker-rest.test.ts`.
- `tests/unit/compact-sources.test.ts`.
- `tests/integration/matching-refresh.test.ts`.
- `tests/unit/ocr-payload.test.ts`, `tests/integration/ocr-upload.test.ts` and `tests/e2e/ocr.test.ts`.

Existing tests that already cover the other areas you listed:
- payments and subscriptions (Stripe test mode, simulated);
- permissions and organisation isolation (row-level security);
- TED and Doffin (recorded data);
- AI and fallback (simulated provider);
- PDF, Word, Excel and ZIP uploads;
- quotas and cost cap.

No live TED, Doffin, Stripe or AI calls were made in this round.

## 9. Not done, and what needs your approval

1. **Switch on AI in production, and approve a small test budget** (for example up to $5) to run the cheap model on
   20–30 real tenders before customers rely on it. Until then, every AI saving here is an estimate.
   - When you switch it on, also set `AI_MONTHLY_COST_LIMIT_USD_PER_ORG`. `render.yaml` sets 40, but the code default
     is 0 (no cap), and today's free service was set up by hand without it.
   - Also set a monthly spending limit with Anthropic (already on the launch checklist).
2. **Trim stored raw source payloads** (about 22 % of the local database). It deletes data, so I have not done it. It
   is only worth doing if database size becomes a problem.
3. **Retention for failed AI rows** (diagnostics only). A proposal; not changed.
4. **1-hour provider cache for bid drafts.** It pays off only if customers write sections more than 5 minutes apart.
   Decide after Admin → AI-bruk shows the cache-read share for drafts.
5. **Sharing cached documents across features (analysis → fit → profit …).** Not recommended. The provider restarts
   the cache when the system prompt, effort or response format changes, and every feature uses its own strict response
   format, which is what guarantees valid answers. Dropping those formats would trade reliability for cost.
6. **Batch API (50 % off).** Not recommended now: the only non-interactive AI work (summaries, weekly overview) already
   costs fractions of a cent.
7. **Plan upgrades** (Supabase Pro before paying customers, Render paid instances, Resend Pro as volume grows), when
   you decide.
8. **Deployment:** nothing is deployed. Everything waits for your «rull ut».
