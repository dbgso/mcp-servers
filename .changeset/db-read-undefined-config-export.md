---
"db-read-mcp": patch
---

A `.ts` / `.js` config whose `tableMetadata` or `selectableFields` export is undefined is now refused at startup with a clear message.

A named export that existed but was undefined used to be accepted, and the server crashed on the first table lookup instead. The same export wrapped in a default export (`export default { tableMetadata: undefined }`) silently loaded as an empty map, so the server started with no tables. Both now fail with "does not export 'tableMetadata'", the same as a missing export. JSON config files are not affected.
