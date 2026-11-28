# docs の図が全部描けるかを CI (docs-site.yml) で確かめるための Kroki。
# 閲覧のときに図を描くのは、サイトの /api/kroki の後ろにある Kroki の Lambda
# (dbgso/private-static-site の terraform/private-static-site-kroki/Dockerfile)。
# そちらと同じ版で確かめるため、FROM は tag と digest をそちらに揃える。向こうを上げたらこちらも上げる。
#   Kroki 0.36.0 (PlantUML 1.2026.9)
FROM yuzutech/kroki:0.36.0@sha256:de0f2fdc42e926d54706ac962aa5cfb38c5c387035a1b30d07ce297bbc37057b

# 公式の image と同じ非 root ユーザーで動かす (公式の image も USER kroki で終わる。trivy の DS-0002 のため明示する)
USER kroki
