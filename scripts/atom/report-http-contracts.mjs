/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const filePath = path.resolve(fileArg || "compat/legacy-http-contracts.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const contracts = Array.isArray(data.contracts) ? data.contracts : [];
const classes = ["UPSTREAM", "COMPAT", "ATOM", "DROP"];

const countBy = (key, values) =>
  Object.fromEntries(values.map((value) => [value, contracts.filter((item) => item[key] === value).length]));

const classification = countBy("classification", classes);
const unclassified = contracts.filter((item) => !classes.includes(item.classification));
const priorities = countBy("priority", ["high", "medium", "low", "deferred", "none"]);

console.log(`legacy HTTP contracts: ${contracts.length}`);
for (const name of classes) console.log(`${name.padEnd(8)} ${classification[name]}`);
console.log(`UNCLASSIFIED ${unclassified.length}`);
console.log("");
for (const [name, count] of Object.entries(priorities)) console.log(`${name.padEnd(8)} ${count}`);

if (process.argv.includes("--high")) {
  console.log("\nhigh-priority non-upstream contracts:");
  for (const item of contracts.filter(
    (entry) => entry.priority === "high" && entry.classification !== "UPSTREAM",
  )) {
    console.log(`${item.classification.padEnd(8)} ${item.method.padEnd(6)} ${item.path}`);
  }
}

if (contracts.length !== 69 || unclassified.length > 0) process.exitCode = 1;
