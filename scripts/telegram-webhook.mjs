import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const command = process.argv[2] ?? "info";

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env");
  process.exit(1);
}

const baseUrl = `https://api.telegram.org/bot${token}`;

async function run() {
  if (command === "set") {
    if (!webhookUrl) {
      console.error("TELEGRAM_WEBHOOK_URL is not set in .env");
      process.exit(1);
    }
    const response = await fetch(`${baseUrl}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  if (command === "delete") {
    const response = await fetch(`${baseUrl}/deleteWebhook`, { method: "POST" });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  const response = await fetch(`${baseUrl}/getWebhookInfo`);
  const json = await response.json();
  console.log(JSON.stringify(json, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
