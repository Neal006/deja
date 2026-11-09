// Pass when the tests pass, the tests were not edited, and no snake_case
// function names are left in src/.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tests = spawnSync(process.execPath, ["--test"], { stdio: "ignore" });
if (tests.status !== 0) {
  console.log("fail: tests do not pass");
  process.exit(1);
}
const untouched = spawnSync("git", ["diff", "--quiet", "HEAD", "--", "test"], { stdio: "ignore" });
if (untouched.status !== 0) {
  console.log("fail: test/ was edited");
  process.exit(1);
}
for (const file of readdirSync("src")) {
  const text = readFileSync(join("src", file), "utf8");
  const left = text.match(/\bfunction\s+[a-z0-9]+_[a-z0-9_]*/g);
  if (left) {
    console.log(`fail: ${file} still has ${left.join(", ")}`);
    process.exit(1);
  }
}
console.log("pass");
