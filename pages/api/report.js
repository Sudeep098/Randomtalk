export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { reportedUserId, reporterUserId, reason } = req.body;
  // In production: save to DB, auto-ban after N reports
  console.log(`[REPORT] ${reporterUserId} reported ${reportedUserId}: ${reason}`);
  return res.status(200).json({ ok: true });
}
