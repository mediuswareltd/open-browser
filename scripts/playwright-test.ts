import { runPlaywrightTask } from "../electron/playwright/playwright-runner";

async function main() {
  const prompt =
    process.argv.slice(2).join(" ").trim() || "search OpenAI latest updates";
  const output = await runPlaywrightTask({ prompt });
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.success ? 0 : 1);
}

void main();
