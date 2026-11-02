# Group pre-order: end-to-end tests

## Approach

I picked the direction **"backend is deployed, frontend is not integrated yet"**.
The Owner endpoints for the group pre-order (view participants, confirm) exist only in the API,
so the scenarios are tested on **API level**. Positive and negative cases are covered for levels 1 and 2.
On the UI side there is **one minimal test** (sign in and land on the main page), just to prove that the UI layer of the framework works.

Stack: Playwright Test + TypeScript. GitHub Actions for the pipeline.

## What is covered

| Level | File | What is checked |
|---|---|---|
| 1. View participants | `tests/api/level1-view-participants.spec.ts` | empty group, guest with dishes, owner + guests, personal and overall totals, `isSubmitted`, 401 / 403 / 404 |
| 2. Confirm pre-order | `tests/api/level2-confirm-preorder.spec.ts` | merging identical dishes, unsubmitted guests are skipped, group is locked after confirmation, 400 / 401 / 403 / 404 |
| UI | `tests/ui/login.spec.ts` | sign in through the form |

Levels 1 and 2 are automated. Level 3 (delete participant) is not part of this work.

## Behaviour that the spec does not describe (what I decided to check)

- Empty group: `participants: []`, `total: 0`.
- Confirming the same group a second time returns `400` (the group is already submitted).
- A customer who is not the Owner gets `403` on both Owner endpoints. No token gives `401`.
- A guest token cannot be used on the Owner endpoints (`401` or `403`).
- Guests who did not press "submit" are not included in the confirmed order.

If the real backend behaves differently in one of these cases, the test shows it as a failure and it is a candidate for a defect.

## How the data is handled

- Every test gets its own Owner (a new customer is registered through `/register`), its own reservation and its own group.
  Names and emails contain a unique suffix, so tests do not depend on each other and can run in parallel.
- The reservation time is a random future slot, so runs do not collide with each other.
- Dishes and location are taken from the API (`GET /locations`, `GET /locations/{id}/dishes`), nothing is hardcoded.
- After each test the reservation is cancelled (best effort, cleanup never fails a test).

## Setup

```bash
npm ci
npx playwright install chromium
cp .env.example .env     # then fill in the values
```

| Variable | Meaning |
|---|---|
| `API_URL` | base URL of the deployed API (with the stage, e.g. `.../develop`) |
| `UI_URL` | URL of the deployed frontend, used only by the UI test |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | optional, a fixed customer. If empty, a new one is registered for every test |
| `LOCATION_ID` | optional, if empty the first location from the API is used |

`.env` is in `.gitignore`. In CI the same values come from repository secrets.

## Run

```bash
npm test                 # everything
npm run test:api         # API tests only
npm run test:ui          # UI test only
npm run test:smoke       # only @smoke
npx playwright test --grep "Level 2"   # one level
npm run report           # open the HTML report
```

## Pipeline

`.github/workflows/tests.yml` runs on every push to `main`, on pull requests and manually (with an optional `grep` input).
Steps: install, typecheck, run tests, upload the HTML report and traces/screenshots as artifacts, then fail the job if tests failed.
The artifacts are uploaded even when tests fail.

Secrets to add in the repository settings: `API_URL`, `UI_URL` and optionally `OWNER_EMAIL`, `OWNER_PASSWORD`, `LOCATION_ID`.

## Not done

- "Owner adds own dishes": the API gives the Owner only the id of the session (`GET /reservations/{id}/guest-session-id`), not a session token, so this cannot be done through the public API the same way as for guests.
- Waiter scenarios (no waiter account was available for the test run).

- Report Portal and a cloud pipeline outside GitHub Actions (optional task).
- The real group pre-order UI, because the frontend is not integrated with these endpoints yet.

## Differences between the API docs and the deployed backend

- `POST /guest/sessions`: docs say `201 Created`, the backend returns `200 OK`. The tests expect `200`.
- Some responses use PascalCase keys (`SessionId`, `GroupReservationId`), others camelCase. The test client normalises the keys.
- `GET /guest/invites/{token}` refuses the invite when the group is full, so the tests reserve a table for 6 guests (or less, if the location has no such table).
