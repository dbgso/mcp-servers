// This file is an entry point - its exports should be considered "used"
export function entryFunction(): void {
  console.log("entry");
}

export class EntryClass {
  public run(): void {
    console.log("running");
  }
}

export const ENTRY_CONFIG = { debug: true };
