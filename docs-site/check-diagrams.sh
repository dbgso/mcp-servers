#!/usr/bin/env bash
# build.sh で作ったサイトの図 (/api/kroki/... の img) を、全部 Kroki に描かせて確かめる。
#
#   ./check-diagrams.sh http://localhost:8000
#
# 図は閲覧のときに描くので、書き間違いは build では分からず、見たときに壊れた画像になる。
# CI (docs-site.yml) は Kroki の Lambda と同じ image (docs-site/kroki/Dockerfile。dbgso/private-static-site の terraform/private-static-site-kroki/Dockerfile と同じ版) を
# docker で立てて、これを流す。
set -euo pipefail

kroki="${1:?Kroki の URL (例 http://localhost:8000)}"
site="$(cd "$(dirname "$0")" && pwd)/build/site"

mapfile -t paths < <(grep -rhoE --include='*.html' 'src="/api/kroki/[^"]+"' "$site" \
  | sed -E 's#^src="/api/kroki##; s#"$##' | sort -u)
if [ "${#paths[@]}" -eq 0 ]; then
  echo "図が 1 つも無い (build.sh を先に流す)" >&2
  exit 1
fi

failed=0
for p in "${paths[@]}"; do
  out="$(mktemp)"
  code="$(curl -sS -o "$out" -w '%{http_code}' "$kroki$p" || echo 000)"
  if [ "$code" != 200 ] || ! grep -q '<svg' "$out"; then
    failed=$((failed + 1))
    # どのページの図かを出す
    pages="$(grep -rlF --include='*.html' "src=\"/api/kroki$p\"" "$site" | sed "s#^$site/##" | tr '\n' ' ')"
    echo "::error::$code ${pages}" >&2
    head -c 500 "$out" >&2
    echo >&2
  fi
  rm -f "$out"
done

echo "diagrams: ${#paths[@]}, failed: $failed" >&2
[ "$failed" -eq 0 ]
