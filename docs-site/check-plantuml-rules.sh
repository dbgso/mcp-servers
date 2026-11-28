#!/usr/bin/env bash
# docs/ の AsciiDoc の PlantUML の書き方の決まりを確かめる。
#
#   docs-site/check-plantuml-rules.sh
#
# - シーケンス図には autonumber を必ず入れる (本文から「3. の呼び出し」のように番号で指せるようにするため)。
#   participant などの宣言があり、ユースケース図・コンポーネント図の要素 (rectangle、usecase、component、
#   node、package、left to right direction) が無いブロックをシーケンス図とみなす。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

failed=0
while IFS= read -r f; do
  # @startuml〜@enduml ごとに、シーケンス図なのに autonumber が無いものの開始行を出す
  while IFS= read -r line; do
    echo "::error file=${f#"$root"/},line=${line}::シーケンス図に autonumber がない" >&2
    failed=$((failed + 1))
  done < <(awk '
    /^@startuml/ { start = NR; seq = 0; other = 0; num = 0; next }
    /^@enduml/   { if (start && seq && !other && !num) print start; start = 0; next }
    start && /^[[:space:]]*(rectangle|usecase|component|node|package|left to right direction)([[:space:]]|$)/ { other = 1 }
    start && /^[[:space:]]*(participant|actor|boundary|control|entity|database|collections|queue)[[:space:]]/ { seq = 1 }
    start && /^[[:space:]]*autonumber/ { num = 1 }
  ' "$f")
done < <(find "$root/docs" -name '*.adoc' -not -path '*/node_modules/*' -not -path '*/build/*')

echo "plantuml rules: failed: $failed" >&2
[ "$failed" -eq 0 ]
