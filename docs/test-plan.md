# Manual test plan

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 1 | Capture offline | Go offline → save a finding | Saved instantly; badge "pending"; header "Offline · 1 waiting" |
| 2 | Auto-sync on reconnect | After #1, go online | Syncs within ~1 s without a click; badge "synced" |
| 3 | App closed while offline | Offline → save → close the tab → go online → reopen | Record still there (IndexedDB) and syncs on open |
| 4 | Connection drops mid-sync | Stop the API (`Ctrl+C`) → save → click "Sync now" → restart the API | Banner "Sync failed, will retry"; syncs automatically after the retry; **no duplicates** |
| 5 | Retry after lost reply | Push the same body twice in Swagger | 2nd response is `duplicate`; one row in the database |
| 6 | Conflict between devices | Use Swagger with the same id: push v1, push an edit from `device-B` with `baseServerVersion` = v1, push another edit from `device-A` with the same base | 3rd is `conflict`; `GET /api/conflicts` (as analyst1) lists it |
| 7 | Resolve conflict | `POST /api/conflicts/{id}/resolve?keep=client` as analyst1 | 204; pull shows the device's values with a new version |
| 8 | Invalid data | Push latitude `123` or material `Gold` | `rejected` with reasons; shown in red on the device |
| 9 | Out-of-area warning | Save lat `25.0`, lon `80.0` in Block A | Accepted with ⚠ "outside the expedition's survey block" |
| 10 | Possible duplicate | Save two findings ~2 m apart | Second one flagged ⚠ "possible duplicate" |
| 11 | Unauthorized | Call `/api/sync/pull` without a token | 401 |
| 12 | Wrong role | `GET /api/conflicts` as engineer1; `POST /api/sync/push` as analyst1 | 403 for both |
| 13 | Brute-force protection | Call login 11 times in a minute | 11th returns 429 |
| 14 | GPS denied | Block location permission → tap GPS | Clear error message; manual entry still works |
| 15 | Large backlog | Create 120 findings offline → go online | Sent in batches of 50; all synced |
| 16 | Reload offline (PWA) | Production build → offline → reload | App shell loads; local data visible |
| 17 | Admin edits data | Sign in as admin1 → Manage findings → add, edit, delete a finding | Each change syncs; engineer devices show the edit and drop the deleted finding |
| 18 | Analyst is read-only | Sign in as analyst1 → dashboard | "All findings" list with no Add / Edit / Delete buttons |
