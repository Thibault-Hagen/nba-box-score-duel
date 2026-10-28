# Box Score Duel

Compare any two NBA players after every game. Free to run: GitHub Pages hosts the site and
GitHub Actions pulls finished box scores from ESPN's public JSON feed every 30 minutes on game nights.

## What's on the site
- **Game night**: every finished game for a date, plus a leaderboard ranked by Hollinger Game Score.
- **Head to head**: pick players A and B (buttons on the leaderboard or search). Compare one night,
  the last 5 games, or the season so far. The better number in each row is highlighted.
- **Game by game**: both players' trend for Game Score, points, rebounds, assists, TS%, minutes or +/-.
- **Logs**: each player's last 10 games. Links are shareable (`?a=…&b=…&d=…&s=season`).

## How it updates
`.github/workflows/update.yml` runs `scripts/update.mjs` (Node 20, no dependencies):
1. Reads `site/data/season.json`.
2. Checks ESPN's scoreboard for each date since `SEASON_START` (finished dates are skipped
   except the last 3 days, which are rechecked for stat corrections).
3. Pulls the box score of each newly finished game and appends every player's line.
4. Commits the file only when something changed, then redeploys GitHub Pages.

Schedule (UTC): every 30 min 23:00–08:59, plus 14:17 and 19:17. Run it by hand from the Actions tab
with **Run workflow**.

## One-time setup (already done if Claude set this up)
1. Create a **public** repo and push this folder to `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions tab → *Update box scores and deploy* → **Run workflow**. The first run backfills the season.

Site URL: `https://<your-username>.github.io/<repo-name>/`

## Notes
- ESPN's feed is free and public but unofficial; if ESPN changes it, the parser reads stats by
  column label to keep working, and the workflow fails loudly (you get an email) instead of writing bad data.
- GitHub can pause scheduled workflows after 60 days without repo activity (mostly an off-season
  concern). If that happens, open the Actions tab and re-enable it.
