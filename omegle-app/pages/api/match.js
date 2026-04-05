import pusher from "../../lib/pusher";

// Shared waiting pool (persists across hot reloads in dev, resets on cold start)
const waitingPool = new Map(); // userId -> { userId, interests, timestamp }
const activePairs = new Map(); // userId -> partnerId

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId, interests = [], action } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  // LEAVE: remove from pool + notify partner
  if (action === "leave") {
    waitingPool.delete(userId);
    const partnerId = activePairs.get(userId);
    if (partnerId) {
      activePairs.delete(userId);
      activePairs.delete(partnerId);
      // Notify partner that this user left
      await pusher.trigger(`user-${partnerId}`, "partner-left", { userId });
    }
    return res.status(200).json({ ok: true });
  }

  // FIND: match with someone
  waitingPool.delete(userId); // remove stale entry

  // Try interest-based match first
  let matchedEntry = null;
  let matchedKey = null;

  if (interests.length > 0) {
    for (const [uid, entry] of waitingPool) {
      if (uid === userId) continue;
      const commonInterests = entry.interests.filter((i) =>
        interests.includes(i)
      );
      if (commonInterests.length > 0) {
        matchedEntry = entry;
        matchedKey = uid;
        break;
      }
    }
  }

  // Fall back to random match
  if (!matchedEntry) {
    for (const [uid, entry] of waitingPool) {
      if (uid === userId) continue;
      matchedEntry = entry;
      matchedKey = uid;
      break;
    }
  }

  if (matchedEntry && matchedKey) {
    // Found a match!
    waitingPool.delete(matchedKey);
    activePairs.set(userId, matchedKey);
    activePairs.set(matchedKey, userId);

    // Decide who initiates (the one who was waiting longer = matchedKey is initiator)
    // The person who was waiting becomes the "offer" sender
    await pusher.trigger(`user-${matchedKey}`, "matched", {
      partnerId: userId,
      initiator: true, // matched person sends offer
    });

    return res.status(200).json({
      matched: true,
      partnerId: matchedKey,
      initiator: false, // new arrival receives offer
    });
  } else {
    // No match, join waiting pool
    waitingPool.set(userId, {
      userId,
      interests,
      timestamp: Date.now(),
    });

    return res.status(200).json({ matched: false, waiting: true });
  }
}
