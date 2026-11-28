#!/usr/bin/env node
import { runCli } from "../cli.js";

const code = await runCli({
  argv: process.argv.slice(2),
  io: { out: text => console.log(text), err: text => console.error(text) },
});
process.exit(code);
