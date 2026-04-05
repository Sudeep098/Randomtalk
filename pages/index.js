import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";

// Safe UUID that works on both server and client
function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── ICE servers (STUN + free TURN from open-relay.metered.ca) ──────────────
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const INTERESTS_OPTIONS = [
  "Music", "Gaming", "Art", "Tech", "Movies", "Sports",
  "Anime", "Travel", "Food", "Books", "Coding", "Fashion",
];

// ── Status enum ───────────────────────────────────────────────────────────
const STATUS = {
  IDLE: "idle",
  REQUESTING_MEDIA: "requesting_media",
  WAITING: "waiting",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
};

export default function Home() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [userId] = useState(() => generateId());
  const [partnerId, setPartnerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [interests, setInterests] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [connectionTime, setConnectionTime] = useState(0);
  const [strangerTyping, setStrangerTyping] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [chatCount, setChatCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(Math.floor(Math.random() * 800) + 200);
  const [waitTime, setWaitTime] = useState(0);
  const [networkQuality, setNetworkQuality] = useState(null); // "good"|"poor"
  const [showInterests, setShowInterests] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const pusherRef = useRef(null);
  const channelRef = useRef(null);
  const partnerIdRef = useRef(null);
  const timerRef = useRef(null);
  const waitTimerRef = useRef(null);
  const typingTimerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const pendingCandidates = useRef([]);

  // Keep partnerIdRef in sync
  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);

  // ── Simulate online count fluctuation ──────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      setOnlineCount(c => c + Math.floor(Math.random() * 11) - 5);
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  // ── Scroll chat to bottom ─────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Connection timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (status === STATUS.CONNECTED) {
      timerRef.current = setInterval(() => setConnectionTime(t => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setConnectionTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  // ── Wait timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === STATUS.WAITING) {
      waitTimerRef.current = setInterval(() => setWaitTime(t => t + 1), 1000);
    } else {
      clearInterval(waitTimerRef.current);
      setWaitTime(0);
    }
    return () => clearInterval(waitTimerRef.current);
  }, [status]);

  // ── Setup Pusher (client-side only) ──────────────────────────────────
  useEffect(() => {
    // Dynamically import Pusher to avoid SSR issues
    import("pusher-js").then(({ default: Pusher }) => {
      const p = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
      });
      pusherRef.current = p;

    const ch = p.subscribe(`user-${userId}`);
    channelRef.current = ch;

    ch.bind("matched", ({ partnerId: pid, initiator }) => {
      setPartnerId(pid);
      partnerIdRef.current = pid;
      setStatus(STATUS.CONNECTING);
      addSystemMessage(`🟢 Connected to a stranger! Say hello!`);
      if (initiator) {
        startWebRTC(pid, true);
      }
    });

    ch.bind("signal", async ({ type, data, fromUserId }) => {
      if (type === "offer") {
        await handleOffer(data, fromUserId);
      } else if (type === "answer") {
        await handleAnswer(data);
      } else if (type === "ice-candidate") {
        await handleIceCandidate(data);
      }
    });

    ch.bind("chat-message", ({ message, fromUserId, timestamp }) => {
      addMessage({ text: message, from: "stranger", timestamp });
    });

    ch.bind("partner-left", () => {
      addSystemMessage("👋 Stranger has disconnected.");
      cleanupPeer();
      setStatus(STATUS.DISCONNECTED);
      setPartnerId(null);
    });

    ch.bind("stranger-typing", () => {
      setStrangerTyping(true);
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setStrangerTyping(false), 2000);
    });

    }); // end import("pusher-js")

    return () => {
      if (pusherRef.current) {
        pusherRef.current.unsubscribe(`user-${userId}`);
        pusherRef.current.disconnect();
      }
    };
  }, [userId]);

  // ── WebRTC helpers ────────────────────────────────────────────────────
  const createPeerConnection = useCallback((pid) => {
    cleanupPeer();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Remote stream
    pc.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
        setStatus(STATUS.CONNECTED);
        setChatCount(c => c + 1);
        setNetworkQuality("good");
      }
    };

    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        fetch("/api/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: pid,
            fromUserId: userId,
            type: "ice-candidate",
            data: e.candidate,
          }),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setNetworkQuality("poor");
      } else if (pc.connectionState === "connected") {
        setNetworkQuality("good");
      }
    };

    return pc;
  }, [userId]);

  const startWebRTC = useCallback(async (pid, initiator) => {
    const pc = createPeerConnection(pid);
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: pid,
          fromUserId: userId,
          type: "offer",
          data: offer,
        }),
      });
    }
  }, [createPeerConnection, userId]);

  const handleOffer = useCallback(async (offer, pid) => {
    const pc = createPeerConnection(pid);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    // Flush pending candidates
    for (const c of pendingCandidates.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
    pendingCandidates.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: pid,
        fromUserId: userId,
        type: "answer",
        data: answer,
      }),
    });
  }, [createPeerConnection, userId]);

  const handleAnswer = useCallback(async (answer) => {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  const handleIceCandidate = useCallback(async (candidate) => {
    if (pcRef.current && pcRef.current.remoteDescription) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidates.current.push(candidate);
    }
  }, []);

  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    pendingCandidates.current = [];
    setStrangerTyping(false);
  }, []);

  // ── Main actions ──────────────────────────────────────────────────────
  const getMedia = async () => {
    setStatus(STATUS.REQUESTING_MEDIA);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setShowInterests(false);
      startSearch();
    } catch (err) {
      alert("Camera/mic access required. Please allow permissions and try again.");
      setStatus(STATUS.IDLE);
    }
  };

  const startSearch = async () => {
    setMessages([]);
    setStatus(STATUS.WAITING);
    setPartnerId(null);
    addSystemMessage("🔍 Looking for a stranger...");

    const poll = async () => {
      if (status === STATUS.CONNECTED) return;
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, interests }),
      });
      const data = await res.json();
      if (data.matched) {
        setPartnerId(data.partnerId);
        partnerIdRef.current = data.partnerId;
        setStatus(STATUS.CONNECTING);
        addSystemMessage("🟡 Connecting...");
        if (!data.initiator) {
          // We receive offer — do nothing, wait for signal
        }
      } else {
        // Poll again after 2s
        setTimeout(poll, 2000);
      }
    };
    poll();
  };

  const handleStart = () => {
    if (!localStreamRef.current) {
      getMedia();
    } else {
      setMessages([]);
      cleanupPeer();
      // Notify old partner
      if (partnerIdRef.current) {
        fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action: "leave" }),
        });
      }
      startSearch();
    }
  };

  const handleNext = () => {
    // Tell server we're leaving
    if (partnerIdRef.current) {
      fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "leave" }),
      });
    }
    cleanupPeer();
    addSystemMessage("⏭ Looking for next stranger...");
    startSearch();
  };

  const handleStop = () => {
    if (partnerIdRef.current) {
      fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: "leave" }),
      });
    }
    cleanupPeer();
    setPartnerId(null);
    setStatus(STATUS.IDLE);
    setMessages([]);
    // Stop local stream
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setShowInterests(true);
  };

  // ── Chat ──────────────────────────────────────────────────────────────
  const addMessage = (msg) => {
    setMessages(prev => [...prev, { ...msg, id: generateId() }]);
  };

  const addSystemMessage = (text) => {
    setMessages(prev => [...prev, { text, from: "system", id: generateId() }]);
  };

  const sendMessage = (e) => {
    e?.preventDefault();
    if (!chatInput.trim() || !partnerIdRef.current) return;
    const msg = { text: chatInput.trim(), from: "me", timestamp: Date.now(), id: generateId() };
    addMessage(msg);
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: partnerIdRef.current,
        fromUserId: userId,
        message: msg.text,
        timestamp: msg.timestamp,
      }),
    });
    setChatInput("");
  };

  const handleTyping = (e) => {
    setChatInput(e.target.value);
    if (partnerIdRef.current) {
      fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: partnerIdRef.current,
          fromUserId: userId,
          type: "typing",
          data: null,
        }),
      });
    }
  };

  // ── Media controls ────────────────────────────────────────────────────
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(t => (t.enabled = !t.enabled));
      setIsMuted(m => !m);
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(t => (t.enabled = !t.enabled));
      setIsCamOff(c => !c);
    }
  };

  const toggleInterest = (interest) => {
    setInterests(prev =>
      prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]
    );
  };

  const handleReport = () => {
    if (!reportReason || !partnerIdRef.current) return;
    fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportedUserId: partnerIdRef.current,
        reporterUserId: userId,
        reason: reportReason,
      }),
    });
    setShowReport(false);
    setReportReason("");
    addSystemMessage("⚠️ Report submitted. Moving to next stranger...");
    handleNext();
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const isActive = status === STATUS.CONNECTED || status === STATUS.CONNECTING || status === STATUS.WAITING;

  return (
    <>
      <Head>
        <title>RandomTalk — Meet Strangers Live</title>
        <meta name="description" content="Random video chat with strangers" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>" />
      </Head>

      <div style={styles.root}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>◈</span>
            <span style={styles.logoText}>RandomTalk</span>
          </div>
          <div style={styles.headerStats}>
            <div style={styles.stat}>
              <span style={{ ...styles.dot, background: "#00f5a0" }} />
              <span style={styles.statNum}>{onlineCount.toLocaleString()}</span>
              <span style={styles.statLabel}>online</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.dot, background: "#00d4ff" }} />
              <span style={styles.statNum}>{chatCount}</span>
              <span style={styles.statLabel}>chats today</span>
            </div>
          </div>
        </header>

        {/* Main layout */}
        <main style={styles.main}>
          {/* Video section */}
          <div style={styles.videoSection}>
            {/* Remote video */}
            <div style={styles.videoBox}>
              <div style={styles.videoLabel}>STRANGER</div>
              {status === STATUS.CONNECTED || status === STATUS.CONNECTING ? (
                <video ref={remoteVideoRef} autoPlay playsInline style={styles.video} />
              ) : (
                <div style={styles.videoPlaceholder}>
                  {status === STATUS.WAITING ? (
                    <div style={styles.waitingAnim}>
                      <div style={styles.spinner} />
                      <p style={styles.waitText}>Searching... {waitTime > 0 ? formatTime(waitTime) : ""}</p>
                      <p style={styles.waitSub}>Looking for someone with similar interests</p>
                    </div>
                  ) : (
                    <div style={styles.emptyState}>
                      <div style={styles.emptyIcon}>◈</div>
                      <p style={styles.emptyText}>No one connected</p>
                      <p style={styles.emptySub}>Press Start to find a stranger</p>
                    </div>
                  )}
                </div>
              )}
              {/* Network quality indicator */}
              {networkQuality && status === STATUS.CONNECTED && (
                <div style={{
                  ...styles.networkBadge,
                  background: networkQuality === "good" ? "rgba(0,245,160,0.15)" : "rgba(255,71,87,0.15)",
                  borderColor: networkQuality === "good" ? "#00f5a0" : "#ff4757",
                  color: networkQuality === "good" ? "#00f5a0" : "#ff4757",
                }}>
                  {networkQuality === "good" ? "◉ Good" : "◎ Poor"}
                </div>
              )}
              {/* Timer */}
              {status === STATUS.CONNECTED && (
                <div style={styles.timerBadge}>{formatTime(connectionTime)}</div>
              )}
            </div>

            {/* Local video */}
            <div style={styles.localVideoBox}>
              <div style={styles.videoLabel}>YOU</div>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{ ...styles.video, transform: "scaleX(-1)", opacity: isCamOff ? 0.3 : 1 }}
              />
              {isCamOff && (
                <div style={styles.camOffOverlay}>
                  <span style={{ fontSize: 32 }}>📷</span>
                  <span>Camera Off</span>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div style={styles.controls}>
            {!isActive ? (
              <button style={styles.startBtn} onClick={handleStart}>
                {status === STATUS.REQUESTING_MEDIA ? "Requesting Camera..." : "▶ Start"}
              </button>
            ) : (
              <>
                <button style={styles.nextBtn} onClick={handleNext} disabled={status === STATUS.WAITING}>
                  ⏭ Next
                </button>
                <button style={styles.stopBtn} onClick={handleStop}>
                  ◼ Stop
                </button>
                {localStreamRef.current && (
                  <>
                    <button style={{ ...styles.mediaBtn, opacity: isMuted ? 0.5 : 1 }} onClick={toggleMute}>
                      {isMuted ? "🔇" : "🎙️"}
                    </button>
                    <button style={{ ...styles.mediaBtn, opacity: isCamOff ? 0.5 : 1 }} onClick={toggleCam}>
                      {isCamOff ? "📷" : "📸"}
                    </button>
                  </>
                )}
                {status === STATUS.CONNECTED && (
                  <button style={styles.reportBtn} onClick={() => setShowReport(true)} title="Report">
                    ⚑
                  </button>
                )}
              </>
            )}
          </div>

          {/* Interests */}
          {showInterests && (
            <div style={styles.interestsPanel}>
              <p style={styles.interestsTitle}>Your interests (optional)</p>
              <div style={styles.interestTags}>
                {INTERESTS_OPTIONS.map(i => (
                  <button
                    key={i}
                    style={{
                      ...styles.tag,
                      background: interests.includes(i) ? "rgba(0,245,160,0.15)" : "transparent",
                      borderColor: interests.includes(i) ? "#00f5a0" : "#21262d",
                      color: interests.includes(i) ? "#00f5a0" : "#7d8590",
                    }}
                    onClick={() => toggleInterest(i)}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat section */}
          <div style={styles.chatSection}>
            <div style={styles.chatHeader}>
              <span style={styles.chatTitle}>Chat</span>
              {strangerTyping && <span style={styles.typingIndicator}>Stranger is typing...</span>}
            </div>
            <div style={styles.chatMessages}>
              {messages.map(msg => (
                <div key={msg.id} style={{
                  ...styles.message,
                  ...(msg.from === "me" ? styles.myMsg : {}),
                  ...(msg.from === "system" ? styles.sysMsg : {}),
                  ...(msg.from === "stranger" ? styles.strangerMsg : {}),
                }}>
                  {msg.from !== "system" && (
                    <span style={styles.msgFrom}>
                      {msg.from === "me" ? "You" : "Stranger"}:
                    </span>
                  )}
                  {msg.text}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form style={styles.chatForm} onSubmit={sendMessage}>
              <input
                style={styles.chatInput}
                value={chatInput}
                onChange={handleTyping}
                placeholder={status === STATUS.CONNECTED ? "Say something..." : "Connect to chat"}
                disabled={status !== STATUS.CONNECTED}
                maxLength={500}
              />
              <button
                style={{
                  ...styles.sendBtn,
                  opacity: status === STATUS.CONNECTED && chatInput.trim() ? 1 : 0.4,
                }}
                type="submit"
                disabled={status !== STATUS.CONNECTED || !chatInput.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </main>

        {/* Report modal */}
        {showReport && (
          <div style={styles.modalOverlay} onClick={() => setShowReport(false)}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
              <h3 style={styles.modalTitle}>Report Stranger</h3>
              <p style={styles.modalSub}>Help us keep RandomTalk safe</p>
              {["Inappropriate content", "Harassment", "Spam", "Nudity/Sexual content", "Hate speech", "Other"].map(r => (
                <button
                  key={r}
                  style={{
                    ...styles.reportOption,
                    borderColor: reportReason === r ? "#ff4757" : "#21262d",
                    color: reportReason === r ? "#ff4757" : "#7d8590",
                    background: reportReason === r ? "rgba(255,71,87,0.1)" : "transparent",
                  }}
                  onClick={() => setReportReason(r)}
                >
                  {r}
                </button>
              ))}
              <div style={styles.modalActions}>
                <button style={styles.cancelBtn} onClick={() => setShowReport(false)}>Cancel</button>
                <button
                  style={{ ...styles.confirmReportBtn, opacity: reportReason ? 1 : 0.4 }}
                  onClick={handleReport}
                  disabled={!reportReason}
                >
                  Submit Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer style={styles.footer}>
          <p>By using RandomTalk you agree to be 18+ and follow community guidelines. Be respectful. 🌍</p>
        </footer>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    maxWidth: 1100,
    margin: "0 auto",
    padding: "0 16px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 0 16px",
    borderBottom: "1px solid #21262d",
    marginBottom: 24,
  },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: {
    fontSize: 28,
    color: "#00f5a0",
    textShadow: "0 0 20px rgba(0,245,160,0.6)",
    lineHeight: 1,
  },
  logoText: {
    fontSize: 22,
    fontWeight: 800,
    background: "linear-gradient(90deg, #00f5a0, #00d4ff)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    letterSpacing: "-0.5px",
  },
  headerStats: { display: "flex", gap: 20 },
  stat: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  statNum: { fontSize: 16, fontWeight: 700, color: "#e6edf3" },
  statLabel: { fontSize: 12, color: "#7d8590", fontFamily: "'Space Mono', monospace" },

  main: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "1fr 340px",
    gridTemplateRows: "auto auto auto",
    gap: 16,
    alignItems: "start",
  },

  videoSection: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    gridColumn: "1",
    gridRow: "1",
  },
  videoBox: {
    position: "relative",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: "16/9",
  },
  localVideoBox: {
    position: "relative",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 12,
    overflow: "hidden",
    aspectRatio: "16/9",
  },
  videoLabel: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 10,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'Space Mono', monospace",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.5)",
    background: "rgba(0,0,0,0.4)",
    padding: "3px 8px",
    borderRadius: 4,
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  videoPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  waitingAnim: { textAlign: "center" },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #21262d",
    borderTop: "3px solid #00f5a0",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "0 auto 16px",
  },
  waitText: { color: "#00f5a0", fontWeight: 700, fontSize: 14, marginBottom: 4 },
  waitSub: { color: "#7d8590", fontSize: 11, fontFamily: "'Space Mono', monospace" },
  emptyState: { textAlign: "center" },
  emptyIcon: { fontSize: 40, color: "#21262d", marginBottom: 12 },
  emptyText: { color: "#7d8590", fontWeight: 600, fontSize: 13, marginBottom: 4 },
  emptySub: { color: "#21262d", fontSize: 11, fontFamily: "'Space Mono', monospace" },
  networkBadge: {
    position: "absolute",
    bottom: 10,
    right: 10,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'Space Mono', monospace",
    border: "1px solid",
    padding: "3px 8px",
    borderRadius: 4,
  },
  timerBadge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    fontSize: 11,
    fontFamily: "'Space Mono', monospace",
    color: "rgba(255,255,255,0.6)",
    background: "rgba(0,0,0,0.4)",
    padding: "3px 8px",
    borderRadius: 4,
  },
  camOffOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: "#7d8590",
    fontSize: 12,
    pointerEvents: "none",
  },

  controls: {
    gridColumn: "1",
    gridRow: "2",
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  startBtn: {
    background: "linear-gradient(135deg, #00f5a0, #00d4ff)",
    color: "#080b10",
    fontWeight: 800,
    fontSize: 15,
    padding: "12px 32px",
    borderRadius: 10,
    border: "none",
    letterSpacing: 0.5,
    boxShadow: "0 0 20px rgba(0,245,160,0.3)",
    transition: "all 0.2s",
  },
  nextBtn: {
    background: "rgba(0,212,255,0.1)",
    color: "#00d4ff",
    fontWeight: 700,
    fontSize: 15,
    padding: "12px 24px",
    borderRadius: 10,
    border: "1px solid rgba(0,212,255,0.3)",
    transition: "all 0.2s",
  },
  stopBtn: {
    background: "rgba(255,71,87,0.1)",
    color: "#ff4757",
    fontWeight: 700,
    fontSize: 15,
    padding: "12px 24px",
    borderRadius: 10,
    border: "1px solid rgba(255,71,87,0.3)",
    transition: "all 0.2s",
  },
  mediaBtn: {
    background: "rgba(255,255,255,0.05)",
    color: "#e6edf3",
    fontSize: 20,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #21262d",
    transition: "all 0.2s",
  },
  reportBtn: {
    background: "rgba(255,71,87,0.08)",
    color: "#ff4757",
    fontSize: 16,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,71,87,0.2)",
    marginLeft: "auto",
    transition: "all 0.2s",
  },

  interestsPanel: {
    gridColumn: "1",
    gridRow: "3",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 12,
    padding: 16,
  },
  interestsTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    color: "#7d8590",
    fontFamily: "'Space Mono', monospace",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  interestTags: { display: "flex", flexWrap: "wrap", gap: 8 },
  tag: {
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 20,
    border: "1px solid",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "'Syne', sans-serif",
  },

  chatSection: {
    gridColumn: "2",
    gridRow: "1 / 4",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 160px)",
    minHeight: 400,
  },
  chatHeader: {
    padding: "14px 16px",
    borderBottom: "1px solid #21262d",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chatTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    color: "#7d8590",
    fontFamily: "'Space Mono', monospace",
    textTransform: "uppercase",
  },
  typingIndicator: {
    fontSize: 10,
    color: "#00f5a0",
    fontFamily: "'Space Mono', monospace",
    animation: "blink 1.2s infinite",
  },
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  message: {
    fontSize: 13,
    lineHeight: 1.5,
    animation: "slide-in-right 0.2s ease",
    wordBreak: "break-word",
  },
  myMsg: {
    color: "#00d4ff",
    textAlign: "right",
  },
  strangerMsg: {
    color: "#e6edf3",
  },
  sysMsg: {
    color: "#7d8590",
    fontSize: 11,
    fontFamily: "'Space Mono', monospace",
    textAlign: "center",
    padding: "4px 0",
  },
  msgFrom: {
    fontWeight: 700,
    marginRight: 6,
    fontSize: 11,
    opacity: 0.7,
  },
  chatForm: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid #21262d" },
  chatInput: {
    flex: 1,
    background: "#161b22",
    border: "1px solid #21262d",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#e6edf3",
    fontSize: 13,
    outline: "none",
    transition: "border-color 0.2s",
  },
  sendBtn: {
    background: "linear-gradient(135deg, #00f5a0, #00d4ff)",
    color: "#080b10",
    fontWeight: 800,
    fontSize: 13,
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(4px)",
  },
  modal: {
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 16,
    padding: 28,
    width: 380,
    animation: "bounce-in 0.25s ease",
  },
  modalTitle: { fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#ff4757" },
  modalSub: { fontSize: 12, color: "#7d8590", fontFamily: "'Space Mono', monospace", marginBottom: 20 },
  reportOption: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "1px solid",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 8,
    transition: "all 0.15s",
    fontFamily: "'Syne', sans-serif",
  },
  modalActions: { display: "flex", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    background: "transparent",
    border: "1px solid #21262d",
    borderRadius: 8,
    padding: "10px",
    color: "#7d8590",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "'Syne', sans-serif",
  },
  confirmReportBtn: {
    flex: 1,
    background: "#ff4757",
    border: "none",
    borderRadius: 8,
    padding: "10px",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "'Syne', sans-serif",
  },

  footer: {
    textAlign: "center",
    padding: "20px 0",
    color: "#7d8590",
    fontSize: 11,
    fontFamily: "'Space Mono', monospace",
    borderTop: "1px solid #21262d",
    marginTop: 24,
  },
};
