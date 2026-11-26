# Crossover ✖️

A Jackbox-style party game for the family, played entirely from phones in a web browser.

Every round, everyone gets the same two random franchises from the chosen category — say
**Phineas and Ferb ✖ Steven Universe** — and writes a line of dialogue that would appear in
their crossover. Then everyone ranks all the answers (anonymously, and never their own).
Answers earn points from the rankings, and after **5 rounds** the player with the most points wins.

## How a game works

1. **The host** opens the site, enters their name, picks a category, and taps **Create game**.
2. The host's phone shows a **QR code, a link, and a 4-letter code**. Everyone else scans it
   (or goes to the site and types the code) and enters the name they want to use.
   The **📲 Invite** button shows the QR again at any time so latecomers can join.
3. The host taps **Start**. Each round:
   - **Write** — everyone writes a line for the crossover.
   - **Rank** — everyone taps the other answers in order, from favourite to least favourite.
   - **Results** — answers are revealed with their authors and points, plus the scoreboard.
4. After round 5 the winner is crowned 🏆, and the host can **play again** with a new category.

### Scoring

If you rank *N* answers, your #1 pick gets *N* points, your #2 gets *N−1*, … and your last pick
gets 1 point. Each player's round score is the total their answer collected. ⭐ marks how many
people ranked an answer first.

### Categories

Cartoons, Movies, TV Shows, Sci-Fi, Fantasy, Video Games, Superheroes, and Everything (all mixed).
Add or edit franchises in [`src/categories.js`](src/categories.js) — it's just lists of names.

### Handy details

- **Phones falling asleep are fine.** Reopening the page reconnects you to your game with your score.
- **Someone wandered off?** The host gets a "Stop waiting" button to move on without them,
  and can remove players from the lobby with ✕.
- **Host left?** If the host is gone for 30 seconds, hosting passes to another player.

## Running it

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
```

```bash
npm start
```

It prints two addresses:

```
Crossover is running!
  On this computer:  http://localhost:3000
  On your Wi-Fi:     http://192.168.1.23:3000
```

For a game at home, run it on any computer on your Wi-Fi and have the host open the **Wi-Fi**
address. The QR code automatically uses the Wi-Fi address even if the host opens `localhost`.
Everyone's phone must be on the same Wi-Fi network.

### Playing over the internet

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pcbills/crossover)

The easiest option is Render's free plan: click the button above and approve the defaults
(configured in [`render.yaml`](render.yaml)). Free services sleep after 15 minutes without
visitors, so the host should open the site a minute before playing to wake it up.
Each push to `main` redeploys automatically.

Otherwise, deploy it to any Node host that supports
WebSockets (Render, Railway, Fly.io, a VPS…). Use `npm start` as the start command. The server
reads:

| Variable     | Purpose                                                               |
| ------------ | --------------------------------------------------------------------- |
| `PORT`       | Port to listen on (default `3000`; most hosts set this automatically). |
| `PUBLIC_URL` | Optional. Force the URL shown in the QR code, e.g. `https://crossover.example.com`. |

Games live in memory, so restarting the server ends any games in progress. A single server
comfortably handles many simultaneous family games.

## Development

```bash
npm run dev
```

```bash
npm test
```

- `server.js` — Express + Socket.IO server, room codes, QR codes, reconnection.
- `src/game.js` — the game rules as a plain class (phases, scoring, admin actions). Unit tested.
- `src/categories.js` — the franchise lists.
- `public/` — the phone UI (plain HTML/CSS/JS, no build step).

The server sends each phone its own view of the game, so nobody's browser ever receives who
wrote which answer until the results are revealed.
