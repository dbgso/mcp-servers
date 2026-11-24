#!/usr/bin/env bash
# docs/ja を Antora でサイトにする (仕組みは dbgso/private-static-site の docs/site、dbgso/cloud-foundation の
# docs/site と同じ)。出力は docs-site/build/site。
#
#   cd docs-site && npm ci && ./build.sh
#
# 道具 (この directory) を docs/ の外に置いているのは、docs/ が interactive-instruction-mcp の文書の置き場で、
# 中を再帰的に読んで .md を全部文書として扱うから。docs/ の下に node_modules や README.md を置くと、
# それが文書の一覧に混ざる。.adoc は読まれないので、ページ (docs/ja/*.adoc) は docs/ に置ける。
#
# docs/ja の .adoc は GitHub 上でもそのまま読めるよう平らに置いてあるので、Antora の構成
# (<component>/antora.yml + modules/ROOT/{pages,nav.adoc}) に並べ替えた写しを build/content に作って
# から Antora に渡す。Antora は git の repo しか読めないので写しを commit する。
#
# PlantUML の図は閲覧のときに、サイトの CloudFront の /api/kroki (認証の後ろの Kroki) が SVG にする
# (antora-playbook.yml)。build のときにはどこにも送らない。
#   KROKI_SERVER_URL … 図の URL の向き先を変える (手元で Kroki を立てて見るとき。例 http://localhost:8000)
# 図が全部描けるかは check-diagrams.sh で確かめる (CI は Kroki の Lambda と同じ版の image で確かめる)。
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
docs="$(dirname "$here")/docs"
content="$here/build/content"
# GitHub 上のファイルへのリンク (link:../../...) の置き換え先
repo_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-dbgso/mcp-servers}"
repo_ref="${GITHUB_SHA:-main}"

rm -rf "$here/build"

for lang in ja; do
  root="$content/$lang/modules/ROOT"
  mkdir -p "$root/pages"
  cp "$docs/$lang"/*.adoc "$root/pages/"
  mv "$root/pages/nav.adoc" "$root/nav.adoc"
  # GitHub 上の相対リンク (docs/ja から見た ../../packages/... など) を repo の URL にする
  sed -i \
    -e "s#link:\.\./\.\./#link:${repo_url}/blob/${repo_ref}/#g" \
    "$root/pages"/*.adoc
  cat > "$content/$lang/antora.yml" <<YAML
name: $lang
title: 'mcp-servers'
version: ~
nav: [modules/ROOT/nav.adoc]
YAML
done

git -C "$content" init -q
git -C "$content" add -A
git -C "$content" -c user.name=build -c user.email=build@localhost commit -qm build

set --
if [ -n "${KROKI_SERVER_URL:-}" ]; then
  set -- --attribute "kroki-server-url=$KROKI_SERVER_URL"
fi

cd "$here"
npx antora "$@" antora-playbook.yml

# 図の URL を同じ origin の /api/kroki にする (antora-playbook.yml の kroki-server-url のコメント)。img の src だけ書き換える
if [ -z "${KROKI_SERVER_URL:-}" ]; then
  grep -rlZ --include='*.html' 'src="https://kroki.invalid/api/kroki/' build/site \
    | xargs -0 -r sed -i 's#src="https://kroki\.invalid/api/kroki/#src="/api/kroki/#g'
  if grep -rq --include='*.html' 'src="https://kroki\.invalid' build/site; then
    echo "src が kroki.invalid のままの画像がある" >&2
    exit 1
  fi
fi
echo "built: $here/build/site" >&2
