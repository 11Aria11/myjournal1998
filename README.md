# My Journal 1998 -- prototype (frontend + backend)

## Run it
```
cd myjournal1998-backend
npm install
node server.js
```
Server starts on http://localhost:3000

Then open the sibling `index.html` (in the outputs folder, one level up) directly in
your browser -- no build step needed. It talks to the backend at localhost:3000, so
the server needs to be running first.

## What's real vs. simulated
- Accounts, entries, friendships, settings: real, persisted to data.json, and the
  frontend now reads/writes them live -- sign up, write an entry, toggle a setting,
  and it survives a page refresh (because it's on the server, not in browser state).
- Tier separation (teen/adult): enforced server-side in /api/feed and /api/friends.
  A teen account cannot see adult entries or send an adult a friend request, and the
  frontend has no way to bypass this since the check happens on the backend.
- The composer's crisis interstitial now triggers off a REAL round trip: typing
  matching language and posting sends the text to the backend, the backend classifies
  it, and only if the backend says crisisTier >= 3 does the frontend show the crisis
  screen. Use the "Fill in demo crisis language" button in the composer to see it.
- Identity verification (/api/verify): SIMULATED. Reads a birth year, flips a flag.
  Swap for a real KYC/age-estimation vendor webhook before real users touch this.
- Crisis detection (classifyEntry in server.js): a placeholder keyword list. Swap for
  a real classifier/vendor before real users touch this.
- A seeded demo adult account ("Riley N.", id demo-riley) exists so you can test
  sending a friend request from the Friends screen without creating a second account
  by hand. It can't accept back (no session for it), so "Friends" will stay empty --
  that's a demo limitation, not a bug.
- Auth: toy password hashing, no sessions, no rate limiting. Not production-safe.
- Dev nav bar at the top of index.html (screen name buttons) is a review tool only --
  strip it before this is user-facing. It auto-creates a throwaway demo account so
  you can jump to any screen without going through signup each time.

## Endpoints
POST   /api/signup                        {displayName, email, password}
POST   /api/verify                        {userId, birthYear}
GET    /api/users/:userId
PATCH  /api/users/:userId/settings        {commentsDefault?, anonymousDefault?}
POST   /api/entries                       {userId, text, anonymous?, commentsAllowed?}
GET    /api/feed?userId=...               tier-filtered automatically
GET    /api/entries/mine?userId=...
POST   /api/friends/request               {userId, recipientId}   (adults only)
POST   /api/friends/:friendshipId/accept
GET    /api/friends?userId=...
GET    /api/health
