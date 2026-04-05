import pusher from "../../lib/pusher";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { targetUserId, type, data, fromUserId } = req.body;

  if (!targetUserId || !type || !fromUserId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Relay signaling data to the target user
  await pusher.trigger(`user-${targetUserId}`, "signal", {
    type,   // "offer" | "answer" | "ice-candidate"
    data,
    fromUserId,
  });

  return res.status(200).json({ ok: true });
}
