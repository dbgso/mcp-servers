import { Project } from "ts-morph";
import { writeFileSync, readFileSync } from "node:fs";

// Create test file
const testFile = "/tmp/line-shift-test3.ts";
writeFileSync(testFile, `export function foo(a: string, b: number): string {
  return "foo";
}

export function bar(x: string, y: number): string {
  return "bar";
}
`);

const project = new Project();
const sourceFile = project.addSourceFileAtPath(testFile);

console.log("=== Before ===");
console.log(sourceFile.getFullText());
console.log("bar is at line:", sourceFile.getFunction("bar")?.getStartLineNumber());

// First transformation: add multiple lines to foo
const fooFunc = sourceFile.getFunction("foo");
if (fooFunc) {
  const params = fooFunc.getParameters();
  const start = params[0].getStart();
  const end = params[params.length - 1].getEnd();

  // Replace with multi-line format (adds lines!)
  sourceFile.replaceText([start, end], `{
    a,
    b,
  }: {
    a: string;
    b: number;
  }`);
}

console.log("\n=== After first transform (foo expanded to multi-line) ===");
console.log(sourceFile.getFullText());
console.log("bar is now at line:", sourceFile.getFunction("bar")?.getStartLineNumber());

// Now try to transform bar using the ORIGINAL line number (5)
console.log("\n=== Trying to find function at original line 5 ===");
const line5 = sourceFile.getFullText().split("\n")[4]; // 0-indexed
console.log("Content at line 5:", JSON.stringify(line5));

// This is what batch_execute would do - use the original line number
const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(4, 16); // line 5, col 17
const nodeAtPos = sourceFile.getDescendantAtPos(pos);
console.log("Node at original position:", nodeAtPos?.getText()?.slice(0, 50));
