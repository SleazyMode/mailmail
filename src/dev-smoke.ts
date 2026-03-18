import "dotenv/config";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const tenantId = process.env.SMOKE_TENANT_ID ?? "tenant-smoke";
const recipient = process.env.SMOKE_RECIPIENT ?? "demo@example.com";

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
};

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
};

type SendResponse = {
  accepted: boolean;
  internalMessageId: string;
  providerMessageId?: string;
};

const run = async (): Promise<void> => {
  const sent = await postJson<SendResponse>("/dev/send", {
    tenantId,
    recipientAddresses: [recipient],
    subject: "Mail Anchor Smoke Test",
    textBody: "This is a smoke-test proof message.",
    htmlBody: "<p>This is a smoke-test proof message.</p>"
  });

  await postJson(`/dev/simulate-events/${sent.internalMessageId}`, {
    events: ["processed", "delivered"]
  });

  const receipt = await getJson(`/verify/${sent.internalMessageId}`);
  const preview = await postJson(`/anchor/${tenantId}?preview=true`, {});

  console.log(JSON.stringify({
    baseUrl,
    internalMessageId: sent.internalMessageId,
    verifyUrl: `${baseUrl}/verify/${sent.internalMessageId}/view`,
    receipt,
    preview
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
