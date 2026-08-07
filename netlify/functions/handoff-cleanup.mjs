import { defaultHandoffStore } from "./_shared/handoff.mjs";

export default async function cleanupHandoffs() {
  const store = await defaultHandoffStore();
  const removed = await store.purgeExpired(Date.now());
  console.log("Purged expired Hara identity handoffs", { removed });
}

export const config = { schedule: "@hourly" };
