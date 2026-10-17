# claims

claim-chain-mcp 自身の決まり (dogfooding)。要件と仕様は
`docs/chain/requirement/01M54YS4E4W5JC0KSJJ8YKN6YA.md` と
`docs/chain/spec/01M54YS4EBY6NG0NREYDT0M9CQ.md` にあり、そこで決めたことを
1 件 1 ファイルの決まりとして置いている。

- 書き足すときは手で編集せず、claim-chain-mcp の `execute(action: "add")` を使う。
  id はツールが発行し、上流を指せない決まりは書けない。
- `node packages/claim-chain-mcp/dist/index.js check docs/claims` で検査できる。
- `GAP/` は書けなかった決まりの記録で、解決済みのものも経緯として残している。
