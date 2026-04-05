// Simple in-memory store for waiting users
// For production, replace with Redis/Upstash
const store = {
  waiting: [], // [{ userId, timestamp }]
  pairs: {},   // { userId: partnerId }
};

export default store;
