import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getErrorMessage } from "mcp-shared";
import type { HeadingSummary, LinkCheckItem, LinkCheckResult, LinkSummary } from "../types/index.js";
import { anchorMatchesHeading, type DocumentType } from "./anchor.js";

/**
 * What a link points at, and how to check it -- shared by both handlers.
 *
 * Each handler had its own checkSingleLink, crawl and checkExternalUrl. The
 * external-URL check was byte-identical in both, the file-and-anchor tail of
 * checkSingleLink differed only in a word of its message, and "is this URL
 * external / an anchor / a file" was asked again in crawl, go_to_definition
 * and find_backlinks.
 */

export type LinkStatus = "valid" | "broken" | "skipped";

export interface LinkOutcome {
  status: LinkStatus;
  reason?: string;
}

/** What a link check needs from the handler and the document the link sits in. */
export interface LinkCheckContext {
  filePath: string;
  headings: HeadingSummary[];
  checkExternal: boolean;
  timeout: number;
  document: LinkedDocument;
}

/** The handler-specific half of a link check. */
export interface LinkedDocument {
  readonly fileType: DocumentType;
  /** How a missing anchor is named in a reason: "heading" or "anchor". */
  readonly anchorNoun: string;
  /** Headings of another document of this type, for an anchor into it. */
  headingsOf(content: string): HeadingSummary[];
  /** Whether `anchor` names a place in the document being checked. */
  checkSameFileAnchor(params: { anchor: string; context: LinkCheckContext }): LinkOutcome;
}

/**
 * One method per kind of link target. An operation over links -- checking
 * them, following them to a definition -- implements this, so adding a kind
 * is a compile error everywhere it is not handled yet.
 */
export interface LinkTargetVisitor<R> {
  external(target: ExternalTarget): R;
  sameFileAnchor(target: SameFileAnchorTarget): R;
  file(target: FileTarget): R;
}

export interface LinkTarget {
  accept<R>(visitor: LinkTargetVisitor<R>): R;
}

const EXTERNAL_PREFIXES = ["http://", "https://"];

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** `path#anchor` split at the first `#`; either part may be empty. */
export function splitUrl(url: string): { pathPart: string; anchor: string | undefined } {
  const [pathPart, anchor] = url.split("#");
  return { pathPart, anchor };
}

export class ExternalTarget implements LinkTarget {
  constructor(readonly url: string) {}

  accept<R>(visitor: LinkTargetVisitor<R>): R {
    return visitor.external(this);
  }
}

/** A place in the document the link sits in. */
export class SameFileAnchorTarget implements LinkTarget {
  constructor(readonly anchor: string) {}

  accept<R>(visitor: LinkTargetVisitor<R>): R {
    return visitor.sameFileAnchor(this);
  }
}

/** Another file, relative to the one the link sits in, and maybe a heading in it. */
export class FileTarget implements LinkTarget {
  constructor(
    readonly pathPart: string,
    readonly anchor: string | undefined,
  ) {}

  accept<R>(visitor: LinkTargetVisitor<R>): R {
    return visitor.file(this);
  }

  /** The file this target names, from the file that links to it. */
  resolveFrom(filePath: string): string {
    return this.pathPart ? resolve(dirname(filePath), this.pathPart) : filePath;
  }
}

/** link_check: whether each kind of target is there. */
export class LinkChecker implements LinkTargetVisitor<Promise<LinkOutcome>> {
  constructor(private readonly context: LinkCheckContext) {}

  external(target: ExternalTarget): Promise<LinkOutcome> {
    if (!this.context.checkExternal) {
      return Promise.resolve({ status: "skipped", reason: "external link (check_external=false)" });
    }
    return checkExternalUrl({ url: target.url, timeout: this.context.timeout });
  }

  sameFileAnchor(target: SameFileAnchorTarget): Promise<LinkOutcome> {
    return Promise.resolve(this.context.document.checkSameFileAnchor({ anchor: target.anchor, context: this.context }));
  }

  async file(target: FileTarget): Promise<LinkOutcome> {
    const targetPath = target.resolveFrom(this.context.filePath);
    if (!existsSync(targetPath)) {
      return { status: "broken", reason: "file not found" };
    }
    if (!target.anchor) {
      return { status: "valid" };
    }
    return this.checkAnchorIn({ targetPath, pathPart: target.pathPart, anchor: target.anchor });
  }

  private async checkAnchorIn(params: { targetPath: string; pathPart: string; anchor: string }): Promise<LinkOutcome> {
    const { targetPath, pathPart, anchor } = params;
    const { document } = this.context;
    try {
      const headings = document.headingsOf(await readFile(targetPath, "utf-8"));
      if (headingsHaveAnchor({ headings, anchor, fileType: document.fileType })) {
        return { status: "valid" };
      }
      return { status: "broken", reason: `${document.anchorNoun} "${anchor}" not found in ${pathPart}` };
    } catch {
      return { status: "broken", reason: `failed to read ${pathPart}` };
    }
  }
}

/** The Markdown reading of a URL: `#anchor`, an external URL, or a file. */
export function parseLinkTarget(url: string): LinkTarget {
  if (url.startsWith("#")) return new SameFileAnchorTarget(url.slice(1));
  if (isExternalUrl(url)) return new ExternalTarget(url);
  const { pathPart, anchor } = splitUrl(url);
  return new FileTarget(pathPart, anchor);
}

export function headingsHaveAnchor(params: {
  headings: HeadingSummary[];
  anchor: string;
  fileType: DocumentType;
}): boolean {
  const { headings, anchor, fileType } = params;
  return headings.some((h) => anchorMatchesHeading({ anchor, headingText: h.text, fileType }));
}

/** Links sorted into the three result lists by their outcome. */
export function toLinkCheckResult(params: {
  filePath: string;
  checked: Array<{ link: LinkSummary; outcome: LinkOutcome }>;
}): LinkCheckResult {
  const buckets: Record<LinkStatus, LinkCheckItem[]> = { valid: [], broken: [], skipped: [] };
  for (const { link, outcome } of params.checked) {
    const { status, ...reason } = outcome;
    buckets[status].push({ url: link.url, text: link.text, line: link.line, ...reason });
  }
  return { filePath: params.filePath, ...buckets };
}

/**
 * Check an external URL with a HEAD request, falling back to GET for servers
 * that refuse HEAD.
 */
export async function checkExternalUrl(params: { url: string; timeout: number }): Promise<LinkOutcome> {
  const { url, timeout } = params;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return { status: "valid" };
      }

      // Some servers don't support HEAD, try GET
      if (response.status === 405) {
        const getResponse = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
        });
        if (getResponse.ok) {
          return { status: "valid" };
        }
        return { status: "broken", reason: `HTTP ${getResponse.status}` };
      }

      return { status: "broken", reason: `HTTP ${response.status}` };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "broken", reason: "timeout" };
    }
    return { status: "broken", reason: getErrorMessage(error) };
  }
}
