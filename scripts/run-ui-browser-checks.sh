#!/usr/bin/env bash
# Run from the repository root. A failing suite must not hide other engines' evidence.
set -u
status=0
for browser in chromium firefox webkit; do
  for suite in browser.py browser_regressions.py; do
    echo "::group::${browser}: ${suite}"
    if ! NMNM_UI_BROWSER="$browser" python3 "packages/nmnm-ui/test/$suite"; then
      status=1
    fi
    echo '::endgroup::'
  done
done
exit "$status"
