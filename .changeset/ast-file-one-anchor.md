---
"ast-file-mcp": patch
---

`link_check`, `go_to_definition`, `toc_generate`, `topic_index` and `find_backlinks` now agree on a heading's anchor.

There were four slug functions. The one `link_check`, `go_to_definition` and `toc_generate` used dropped every non-ASCII letter, so a Japanese heading's anchor was empty: `toc_generate` wrote `[詳細設計](#)`, and any Japanese anchor matched the first Japanese heading -- a link to a heading that does not exist was reported valid, and `go_to_definition` jumped to the wrong heading. For AsciiDoc it produced `section-one` while asciidoctor (and `topic_index`) id the section `_section_one`, so `<<_section_one>>` was reported broken. All five tools now use the anchor `topic_index` reports. Anchors are compared without regard to case or to `_` versus `-`, so `xref:page.adoc#section-one[]` is still accepted. AsciiDoc tables of contents now link to `<<_section_one,Section One>>`.
