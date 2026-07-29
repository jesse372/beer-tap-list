#!/usr/bin/env bash
# Promote the STAGING site to live.
#
# Copies next/index.html and next/edit.html over the live pages, undoing the two
# staging-only changes (the data path and the staging flag) and stamping a fresh
# build so every screen reloads itself.
#
# Staging is left in place afterwards, so the two match until the next ./stage.sh.
set -euo pipefail
cd "$(dirname "$0")"

[ -f next/index.html ] || { echo "nothing staged — run ./stage.sh first" >&2; exit 1; }

python3 - <<'PY'
import re

import os
PAGES = [p for p in ("index.html", "edit.html", "menu.html", "hall.html") if os.path.exists("next/" + p)]

for name in PAGES:
    s = open("next/" + name).read()

    s2, n = re.subn(r'var DATA_BASE = "\.\./";', 'var DATA_BASE = "";', s, count=1)
    assert n == 1, f"{name}: staging DATA_BASE not found — was next/ built by stage.sh?"
    s = s2

    s2, n = re.subn(r'var STAGING   = true;', 'var STAGING   = false;', s, count=1)
    assert n == 1, f"{name}: staging flag not found"
    s = s2

    open(name, "w").write(s)

print("promoted staging -> live")
PY

# Fresh stamp for the live pages, so the TVs pick the change up on their own.
./bump.sh
echo "done — commit and push to publish"
