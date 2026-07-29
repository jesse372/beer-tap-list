#!/usr/bin/env bash
# Publish the current board + editor to the STAGING site at /next/.
#
# Staging is a full copy of the pages, but it reads the LIVE beer list at the site
# root — new code against real beers. The live board at the root is untouched, so a
# feature can be looked at on a real screen before anyone else sees it.
#
#   ./stage.sh      -> https://<site>/next/          (and /next/edit.html)
#   ./promote.sh    -> copies staging over the live board
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p next

# Assets are copied rather than referenced with ../, so the staging pages need no
# rewriting beyond the data path. They change rarely and cost ~150KB once.
for a in icons.js favicon.svg apple-touch-icon.png keepawake.mp4 keepawake.webm; do
  [ -e "$a" ] && cp "$a" "next/$a"
done
rm -rf next/fonts && cp -R fonts next/fonts

python3 - <<'PY'
import re, datetime

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

for name in ("index.html", "edit.html"):
    s = open(name).read()

    # The one line that makes this copy read the live data at the site root.
    s2, n = re.subn(r'var DATA_BASE = "";', 'var DATA_BASE = "../";', s, count=1)
    assert n == 1, f"{name}: DATA_BASE not found — did the constant get renamed?"
    s = s2

    # Both pages carry the flag: the board uses it for the badge, the editor uses it
    # to guard the two buttons that reach the real board.
    s2, n = re.subn(r'var STAGING   = false;', 'var STAGING   = true;', s, count=1)
    assert n == 1, f"{name}: STAGING flag not found"
    s = s2

    if name == "index.html":
        # Its own stamp, so staging self-updates against staging and never against live.
        s2, n = re.subn(r'var BUILD = "[^"]*";', 'var BUILD = "%s";' % stamp, s, count=1)
        assert n == 1, "index.html: BUILD not found"
        s = s2

    open("next/" + name, "w").write(s)

open("next/build.txt", "w").write(stamp + "\n")
print("staged", stamp)
PY

echo "staging ready:  next/index.html  next/edit.html"
