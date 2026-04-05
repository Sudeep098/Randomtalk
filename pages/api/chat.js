import pusher from "../../lib/pusher";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { targetUserId, message, fromUserId, timestamp } = req.body;

  if (!targetUserId || !message || !fromUserId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  await pusher.trigger(`user-${targetUserId}`, "chat-message", {
    message,
    fromUserId,
    timestamp,
  });

  return res.status(200).json({ ok: true });
}
