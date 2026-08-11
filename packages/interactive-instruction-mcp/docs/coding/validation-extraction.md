# Validation Extraction

Extract validation logic into independent validator classes. Each validator receives only the arguments it needs.

## Structure

```
src/services/validators.ts
src/__tests__/validators.test.ts
```

## Pattern

```typescript
// Interface
export interface Validator {
  validate(): AddResult;
}

// Runner
export function runValidators(params: { validators: Validator[] }): AddResult {
  for (const validator of params.validators) {
    const result = validator.validate();
    if (!result.success) {
      return result;
    }
  }
  return { success: true };
}

// Validator class - receives only needed args in constructor
export class HasDescriptionValidator implements Validator {
  private readonly description: string;

  constructor(params: { description: string }) {
    this.description = params.description;
  }

  validate(): AddResult {
    if (this.description === "(No description)") {
      return { success: false, error: "Must have description." };
    }
    return { success: true };
  }
}
```

## Usage

```typescript
const description = this.parseDescription(content);
const exists = await this.documentExists(id);

const validation = runValidators({
  validators: [
    new HasDescriptionValidator({ description }),
    new NotExistsValidator({ id, exists }),
  ],
});
if (!validation.success) {
  return validation;
}
```

## Requirements

1. **One validator class = one check**
2. **Constructor receives only needed args** (not shared context)
3. **Separate file** for validators
4. **Test each validator class independently**
