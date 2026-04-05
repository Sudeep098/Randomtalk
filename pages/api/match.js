import pusher from "../../lib/pusher";
import { MongoClient } from "mongodb";

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("randomtalk");
const waitingCollection = db.collection("waiting");
const activeCollection = db.collection("active");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { userId, interests = [], action } = req.body;

  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    await client.connect();

    // LEAVE: remove from pool + notify partner
    if (action === "leave") {
      await waitingCollection.deleteOne({ userId });
      const activeDoc = await activeCollection.findOne({ $or: [{ userId }, { partnerId: userId }] });
      if (activeDoc) {
        await activeCollection.deleteOne({ _id: activeDoc._id });
        const partnerId = activeDoc.userId === userId ? activeDoc.partnerId : activeDoc.userId;
        // Notify partner that this user left
        await pusher.trigger(`user-${partnerId}`, "partner-left", { userId });
      }
      return res.status(200).json({ ok: true });
    }

    // FIND: match with someone
    await waitingCollection.deleteOne({ userId }); // remove stale entry

    // Try interest-based match first
    let matchedDoc = null;

    if (interests.length > 0) {
      matchedDoc = await waitingCollection.findOne({
        userId: { $ne: userId },
        interests: { $in: interests }
      });
    }

    // Fall back to random match
    if (!matchedDoc) {
      matchedDoc = await waitingCollection.findOne({ userId: { $ne: userId } });
    }

    if (matchedDoc) {
      // Found a match!
      await waitingCollection.deleteOne({ _id: matchedDoc._id });
      await activeCollection.insertOne({ userId, partnerId: matchedDoc.userId });
      await activeCollection.insertOne({ userId: matchedDoc.userId, partnerId: userId });

      // Decide who initiates (the one who was waiting longer = matchedDoc is initiator)
      // The person who was waiting becomes the "offer" sender
      await pusher.trigger(`user-${matchedDoc.userId}`, "matched", {
        partnerId: userId,
        initiator: true, // matched person sends offer
      });

      return res.status(200).json({
        matched: true,
        partnerId: matchedDoc.userId,
        initiator: false, // new arrival receives offer
      });
    } else {
      // No match, join waiting pool
      await waitingCollection.insertOne({
        userId,
        interests,
        timestamp: new Date(),
      });

      return res.status(200).json({ matched: false, waiting: true });
    }
  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Database error" });
  } finally {
    await client.close();
  }
}
