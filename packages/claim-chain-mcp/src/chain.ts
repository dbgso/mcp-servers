/**
 * The operations, over a store and the kinds it uses.
 *
 * Every operation reads the root afresh, so what it answers is what is on disk
 * now, whoever wrote it.
 */

import { versionOf, type Claim, type Draft, type Gap } from "./claim.js";
import { checkAll, checkShape, citersOf, shapeOf, staleRefs, type Finding } from "./checks.js";
import { GAP_KIND, kindIndex, loadKinds, type KindRule } from "./kinds.js";
import { ClaimStore, type Snapshot } from "./store.js";

/** The id a claim is checked under before it has been issued one. */
const NEW_ID = "(new)";

export interface AddInput {
  kind: string;
  fields: Record<string, string>;
  refs: string[];
  /** What upstream has not decided. Turns a shortfall into a recorded gap. */
  want?: string;
  /** A gap this claim answers, closed when the claim is written. */
  resolves?: string;
}

export type AddResult =
  | { outcome: "added"; claim: Claim; unblocked: Gap[]; resolved?: string }
  | { outcome: "gap"; gaps: Gap[]; findings: Finding[] }
  | { outcome: "rejected"; findings: Finding[]; needsWant: boolean };

export interface UpdateInput {
  id: string;
  fields?: Record<string, string>;
  /** Replaces the citations, each pinned to the cited claim's current version. */
  refs?: string[];
}

export type UpdateResult =
  | { outcome: "updated"; claim: Claim; versionChanged: boolean; nowStale: Claim[] }
  | { outcome: "rejected"; findings: Finding[] };

export interface TraceNode {
  id: string;
  kind: string;
  children: TraceNode[];
}

interface Loaded {
  snapshot: Snapshot;
  kinds: Map<string, KindRule>;
}

export class ClaimChain {
  readonly store: ClaimStore;

  constructor(readonly root: string) {
    this.store = new ClaimStore(root);
  }

  async add(input: AddInput): Promise<AddResult> {
    const { snapshot, kinds } = await this.load();
    const shape = { id: NEW_ID, kind: input.kind, fields: input.fields, refs: input.refs };
    const findings = checkShape({ shape, kinds, claims: snapshot.claims });
    findings.push(...this.checkResolves({ resolves: input.resolves, snapshot }));

    if (findings.length > 0) return this.refuse({ input, findings });

    const refs = input.refs.map((id) => pin({ id, snapshot }));
    const claim = await this.store.create<Claim>({
      kind: input.kind,
      build: (id) => ({ id, kind: input.kind, fields: input.fields, refs }),
    });

    const resolved = await this.resolve({ resolves: input.resolves, snapshot, by: claim.id });
    const unblocked = unblockedBy({ claim, snapshot }).filter((gap) => gap.id !== resolved);
    return { outcome: "added", claim, unblocked, resolved };
  }

  async update(input: UpdateInput): Promise<UpdateResult> {
    const { snapshot, kinds } = await this.load();
    const current = this.existing({ id: input.id, snapshot });
    const claim = changed({ current, input, snapshot });

    const findings = checkShape({ shape: shapeOf(claim), kinds, claims: snapshot.claims });
    if (findings.length > 0) return { outcome: "rejected", findings };

    await this.store.writeClaim(claim);
    const versionChanged = versionOf(claim) !== versionOf(current);
    const nowStale = versionChanged ? citersOf({ id: claim.id, claims: snapshot.claims }) : [];
    return { outcome: "updated", claim, versionChanged, nowStale };
  }

  async read(id: string): Promise<{ claim?: Claim; gap?: Gap; citers: Claim[]; stale: string[] }> {
    const { snapshot } = await this.load();
    const claim = snapshot.claims.get(id);
    const gap = snapshot.gaps.get(id);
    if (claim === undefined && gap === undefined) throw new Error(`${id} does not exist`);

    const citers = citersOf({ id, claims: snapshot.claims });
    const stale = claim === undefined ? [] : staleRefs({ claim, claims: snapshot.claims }).map((ref) => ref.id);
    return { claim, gap, citers, stale };
  }

  async list(kind?: string): Promise<Claim[]> {
    const { snapshot } = await this.load();
    return [...snapshot.claims.values()]
      .filter((claim) => kind === undefined || claim.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async check(): Promise<Finding[]> {
    const { snapshot, kinds } = await this.load();
    return checkAll({ snapshot, kinds });
  }

  async gaps(): Promise<Gap[]> {
    const { snapshot } = await this.load();
    return [...snapshot.gaps.values()]
      .filter((gap) => gap.status === "open")
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async unblocked(id: string): Promise<Gap[]> {
    const { snapshot } = await this.load();
    const claim = this.existing({ id, snapshot });
    return unblockedBy({ claim, snapshot });
  }

  async trace(params: { id: string; direction: "up" | "down" }): Promise<TraceNode> {
    const { snapshot } = await this.load();
    const start = this.existing({ id: params.id, snapshot });
    const next = params.direction === "up" ? upstreamOf : downstreamOf;
    return walk({ claim: start, snapshot, next, seen: new Set() });
  }

  private async load(): Promise<Loaded> {
    const [snapshot, config] = await Promise.all([this.store.snapshot(), loadKinds(this.root)]);
    return { snapshot, kinds: kindIndex(config) };
  }

  private existing(params: { id: string; snapshot: Snapshot }): Claim {
    const claim = params.snapshot.claims.get(params.id);
    if (claim === undefined) throw new Error(`${params.id} is not a claim`);
    return claim;
  }

  private checkResolves(params: { resolves?: string; snapshot: Snapshot }): Finding[] {
    const { resolves, snapshot } = params;
    if (resolves === undefined) return [];

    const gap = snapshot.gaps.get(resolves);
    if (gap?.status === "open") return [];
    return [
      {
        rule: "resolves",
        severity: "error",
        id: NEW_ID,
        message: `${resolves} is not an open gap`,
      },
    ];
  }

  /**
   * A claim that could not be written: as a gap when all that is wrong is
   * something missing upstream and the caller said what, rejected otherwise.
   *
   * A citation that does not exist, or of the wrong kind, is never a gap -- it is
   * indistinguishable from a typo, and recording it would fill the gaps with
   * noise.
   */
  private async refuse(params: { input: AddInput; findings: Finding[] }): Promise<AddResult> {
    const { input, findings } = params;
    const shortfalls = findings.filter((finding) => finding.needs !== undefined);
    const onlyShortfalls = shortfalls.length === findings.length;

    if (!onlyShortfalls || input.want === undefined) {
      return { outcome: "rejected", findings, needsWant: onlyShortfalls };
    }

    const draft: Draft = { kind: input.kind, fields: input.fields, refs: input.refs };
    const gaps: Gap[] = [];
    for (const shortfall of shortfalls) {
      const fields = { needs: String(shortfall.needs), under: input.refs, want: input.want, draft };
      gaps.push(
        await this.store.create<Gap>({
          kind: GAP_KIND,
          build: (id) => ({ id, kind: GAP_KIND, ...fields, status: "open" }),
        })
      );
    }
    return { outcome: "gap", gaps, findings };
  }

  private async resolve(params: { resolves?: string; snapshot: Snapshot; by: string }): Promise<string | undefined> {
    const { resolves, snapshot, by } = params;
    if (resolves === undefined) return undefined;

    const gap = snapshot.gaps.get(resolves) as Gap;
    await this.store.writeGap({ ...gap, status: "resolved", resolvedBy: by });
    return resolves;
  }
}

/**
 * A claim with an update applied. A citation that does not resolve is kept with
 * an empty version, so the shape check reports it rather than this throwing.
 */
function changed(params: { current: Claim; input: UpdateInput; snapshot: Snapshot }): Claim {
  const { current, input, snapshot } = params;
  const fields = input.fields ?? current.fields;
  const refs = input.refs?.map((id) => pinIfPresent({ id, snapshot })) ?? current.refs;
  return { ...current, fields, refs };
}

function pinIfPresent(params: { id: string; snapshot: Snapshot }): { id: string; version: string } {
  const target = params.snapshot.claims.get(params.id);
  return { id: params.id, version: target === undefined ? "" : versionOf(target) };
}

/** A citation of `id` as it is now. */
function pin(params: { id: string; snapshot: Snapshot }): { id: string; version: string } {
  const target = params.snapshot.claims.get(params.id) as Claim;
  return { id: params.id, version: versionOf(target) };
}

/**
 * The open gaps a new claim can answer: gaps for its kind whose draft cited
 * nothing, cited this claim, or cited something this claim cites.
 */
export function unblockedBy(params: { claim: Claim; snapshot: Snapshot }): Gap[] {
  const { claim, snapshot } = params;
  const cited = new Set([claim.id, ...claim.refs.map((ref) => ref.id)]);

  return [...snapshot.gaps.values()].filter(
    (gap) =>
      gap.status === "open" &&
      gap.needs === claim.kind &&
      (gap.under.length === 0 || gap.under.some((id) => cited.has(id)))
  );
}

function upstreamOf(params: { claim: Claim; snapshot: Snapshot }): Claim[] {
  return params.claim.refs
    .map((ref) => params.snapshot.claims.get(ref.id))
    .filter((claim): claim is Claim => claim !== undefined);
}

function downstreamOf(params: { claim: Claim; snapshot: Snapshot }): Claim[] {
  return citersOf({ id: params.claim.id, claims: params.snapshot.claims });
}

function walk(params: {
  claim: Claim;
  snapshot: Snapshot;
  next: (params: { claim: Claim; snapshot: Snapshot }) => Claim[];
  seen: Set<string>;
}): TraceNode {
  const { claim, snapshot, next, seen } = params;
  seen.add(claim.id);
  const children = next({ claim, snapshot })
    .filter((child) => !seen.has(child.id))
    .map((child) => walk({ claim: child, snapshot, next, seen }));
  return { id: claim.id, kind: claim.kind, children };
}
