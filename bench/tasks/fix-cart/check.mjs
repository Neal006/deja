// Pass when every test passes and the tests themselves were not edited.
import { spawnSync } from "node:child_process";

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
console.log("pass");
