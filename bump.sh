#!/usr/bin/env bash
# Stamp a new build number into the page and publish it, so every screen
# can tell whether it is running the current version.
set -euo pipefail
cd "$(dirname "$0")"
B=$(date +%Y%m%d-%H%M%S)
python3 - "$B" <<PY
import sys, re
b = sys.argv[1]
s = open("index.html").read()
s2 = re.sub(r'var BUILD = "[^"]*";', 'var BUILD = "%s";' % b, s, count=1)
assert s2 != s, "BUILD constant not found in index.html"
open("index.html","w").write(s2)
open("build.txt","w").write(b + "\n")
PY
echo "build $B"
