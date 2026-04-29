#!/usr/bin/env bash
set -e

OUT="zotero-autotagger.xpi"
rm -f "$OUT"
zip -r "$OUT" manifest.json bootstrap.js content/ prefs/
echo "Built $OUT"
