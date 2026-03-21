import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ulid } from "ulid";
import type { Rule, RuleAction, RulesFile } from "./types.js";
import { RulesFileSchema } from "./types.js";

/**
 * Manages rule persistence to JSON file
 */
export class RuleStore {
  private rules: Rule[] = [];
  private defaultAction: RuleAction = "deny";

  constructor(private readonly filePath: string) {}

  /**
   * Load rules from file
   */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      // Create empty rules file
      this.rules = [];
      this.defaultAction = "deny";
      await this.save();
      return;
    }

    const content = readFileSync(this.filePath, "utf-8");
    const data = RulesFileSchema.parse(JSON.parse(content));
    this.rules = data.rules;
    this.defaultAction = data.defaultAction;
  }

  /**
   * Save rules to file
   */
  async save(): Promise<void> {
    const data: RulesFile = {
      rules: this.rules,
      defaultAction: this.defaultAction,
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Get all rules sorted by priority (descending)
   */
  getRules(): Rule[] {
    return [...this.rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get default action
   */
  getDefaultAction(): RuleAction {
    return this.defaultAction;
  }

  /**
   * Set default action
   */
  async setDefaultAction(action: RuleAction): Promise<void> {
    this.defaultAction = action;
    await this.save();
  }

  /**
   * Add a new rule
   */
  async addRule(
    rule: Omit<Rule, "id"> & { id?: string }
  ): Promise<Rule> {
    const newRule: Rule = {
      ...rule,
      id: rule.id ?? ulid(),
    };
    this.rules.push(newRule);
    await this.save();
    return newRule;
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): Rule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  /**
   * Update an existing rule
   */
  async updateRule(
    id: string,
    updates: Partial<Omit<Rule, "id">>
  ): Promise<Rule | undefined> {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return undefined;

    this.rules[index] = {
      ...this.rules[index],
      ...updates,
    };
    await this.save();
    return this.rules[index];
  }

  /**
   * Remove a rule by ID
   */
  async removeRule(id: string): Promise<boolean> {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) return false;

    this.rules.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Get rules count
   */
  count(): number {
    return this.rules.length;
  }

  /**
   * Get file path
   */
  getFilePath(): string {
    return this.filePath;
  }
}
