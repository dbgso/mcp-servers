# Link Test Document

This document tests various link types for link_check.

## Valid Links

- [Local file](./docs/README.md)
- [Same directory](./sample.md)
- [Section anchor](#valid-links)
- [File with anchor](./docs/README.md#getting-started)

## Broken Links

- [Missing file](./missing-file.md)
- [Missing anchor](#nonexistent-section)
- [File with bad anchor](./docs/README.md#bad-anchor)

## External Links

- [GitHub](https://github.com)
- [Example](https://example.com)
