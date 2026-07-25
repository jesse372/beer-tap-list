# 🍺 Beer Tap List

A tap-list display for a TV (Fire Stick), plus a dead-simple editor for the brewer.

- `index.html` — the TV screen. Auto-refreshes every 60s, rotates pages if there are lots of beers.
- `edit.html` — the editor. Big buttons, one green **Publish** button.
- `icons.js` — the 8 beer icons, shared by both pages.
- `taps.json` — the data. The editor writes this straight to GitHub; the TV reads it.

### Logos
- **Per beer:** pick one of 8 icons (pint, mug, bottle, can, hop, barley, keg, growler) or *None*.
  It shows in gold next to the beer name.
- **At the top:** upload any PNG/JPG in the editor's settings section. It's resized on the laptop
  (max 600×200) and stored inside `taps.json`, so there's no separate image file to host.
  Tick *"My logo already has the name in it"* to hide the duplicate text heading.

---

## Part 1 — Put it online (you, once)

```bash
cd ~/Projects/beer-tap-list
gh auth login        # only if you aren't already logged in
./setup.sh
```

That creates a public GitHub repo, pushes the site, and turns on GitHub Pages.
It prints your two URLs when it's done:

- **TV screen:** `https://jesse372.github.io/beer-tap-list`
- **Editor:** `https://jesse372.github.io/beer-tap-list/edit.html`

> Public repo is required — GitHub Pages on a private repo needs a paid plan.
> Nothing sensitive is in here; it's a beer list.

### Make the Publish button work

1. Go to <https://github.com/settings/personal-access-tokens/new>
2. **Repository access** → *Only select repositories* → pick `beer-tap-list`
3. **Permissions** → *Repository permissions* → **Contents** → **Read and write**
4. Generate, copy the token (it's only shown once)
5. On his laptop, open the **editor** URL → open the ⚙️ section → paste his
   GitHub username, `beer-tap-list`, and the token → **Test the connection**

The token is stored only in that laptop's browser. If it ever leaks, delete it on
GitHub and make a new one — worst case someone edits a beer list.

---

## Part 2 — Fire Stick setup (5 minutes, once)

1. On the Fire Stick home screen, **Find → Search**, type **Silk Browser**, install it
   (free, made by Amazon).
2. Open Silk. Go to the address bar, type your **TV screen** URL.
3. Menu (☰) → **Add to bookmarks**, and → **Set as homepage**.
   Now the tap list is the first thing that loads when he opens Silk.
4. Menu → **Request desktop site** if it looks cramped.
5. Stop the screensaver from covering it:
   **Settings → Display & Sounds → Screensaver → Start Time → Never**
   (or 15 minutes, if you'd rather it still sleeps eventually)
6. Keep it from sleeping entirely:
   **Settings → Display & Sounds → Display → Sleep → Never** *(labelled
   "Turn off display" on some Fire TV models)*

**Every day after that:** turn on the TV → open Silk → it's already there.

### Tips
- The Fire Stick remote's **⏸/menu** button hides the browser chrome for full screen.
- If the picture is cut off at the edges, that's TV overscan — the page already leaves
  a safe margin, but you can fix it properly in your TV's picture settings
  (look for *Screen Fit*, *Just Scan*, *1:1 Pixel*, or *Full*).
- The page reloads its data every 60 seconds, so edits show up on the TV within a minute.
  No need to touch the Fire Stick after an edit.

---

## Part 3 — How he updates it

Bookmark the **editor** URL on his laptop. Then:

1. Open the bookmark.
2. Change whatever — drag the keg slider down as a keg empties, hit **Empty** when it kicks,
   **+ Add another beer** for a new brew.
3. Click the green **Publish to the TV**.
4. Done. The TV updates on its own within a minute.

His changes are saved in the browser as he types, so closing the laptop mid-edit
doesn't lose anything — he'll be offered them back next time.

### If the internet is down
The ⚙️ section has a **Download the taps.json file** button. That file can be
uploaded to the repo by hand later (github.com → the repo → `taps.json` → pencil icon).

---

## Editing the data by hand

`taps.json` is plain JSON:

```json
{
  "brewery": "Dad's Garage Brewing",
  "tagline": "Home Brewed · Always Cold",
  "showClock": true,
  "perPage": 6,
  "rotateSeconds": 20,
  "hideKicked": false,
  "taps": [
    {
      "num": 1,
      "name": "Hoppy Days",
      "style": "American IPA",
      "abv": "6.8",
      "ibu": "65",
      "notes": "Grapefruit and pine, dry bitter finish.",
      "color": "#e0a63a",
      "icon": "hop",
      "level": 85,
      "status": "pouring"
    }
  ]
}
```

- `status` — `pouring`, `kicked`, or `coming`
- `level` — 0–100, how full the keg is
- `perPage` — 2, 4, 6 or 8 beers per screen (fewer = bigger text)
- `icon` — `pint`, `mug`, `bottle`, `can`, `hop`, `wheat`, `keg`, `growler`, or `""` for none
- `logo` — `""` or a `data:image/...` URI (the editor fills this in for you)

## Local preview

```bash
cd ~/Projects/beer-tap-list && python3 -m http.server 8777
# TV screen: http://localhost:8777/
# Editor:    http://localhost:8777/edit.html
```
