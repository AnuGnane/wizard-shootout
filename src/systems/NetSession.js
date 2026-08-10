// Tiny singleton holding the ACTIVE online connection + role, so the rest of
// the app (stage 2: host-authoritative match integration) can reach the live
// NetConnection without threading it through scene data. Dependency-light on
// purpose — it never imports NetConnection; it only holds a reference and
// duck-types close()/send()/isOpen() on it.
//
// It also owns the two ways a session ENDS from this side: clearSession() (the
// session is over, drop it) and leaveSession() (I am leaving on purpose — say
// so first). See the `bye` protocol note below.

export const NetSession = {
    connection: null,   // the active NetConnection instance (or null)
    role: null,         // 'host' | 'guest' | null
    connected: false,   // true once a data channel is open and handed over here
};

// Adopt a live connection. If a different connection is already held, the old
// one is closed first so we never leak a stray RTCPeerConnection when replacing.
export function setSession(conn, role) {
    if (NetSession.connection && NetSession.connection !== conn &&
        typeof NetSession.connection.close === 'function') {
        NetSession.connection.close();
    }
    NetSession.connection = conn;
    NetSession.role = role;
    NetSession.connected = true;
}

// Detach a connection's callbacks. Once we've decided the session is over,
// nothing that arrives on the wire may reach the scene that owned it — that is
// exactly how a quit used to resurrect a dead GameScene (C3). Written to be
// safe on any duck-typed connection: it only ever assigns no-ops.
function muteConnection(conn) {
    if (!conn) return;
    const noop = () => {};
    try {
        conn.onMessage = noop;
        conn.onClose = noop;
        conn.onError = noop;
        conn.onOpen = noop;
    } catch (err) { /* frozen/exotic stub — nothing to mute */ }
}

// Drop and close the held connection (idempotent).
export function clearSession() {
    const conn = NetSession.connection;
    NetSession.connection = null;
    NetSession.role = null;
    NetSession.connected = false;
    muteConnection(conn);
    if (conn && typeof conn.close === 'function') conn.close();
}

// ---- deliberate exit ("bye") ----------------------------------------------
//
// The 8th protocol message, and the only one that is role-independent:
//
//     { t: 'bye' }        "I am leaving this match on purpose"
//
// No payload — the receiver needs nothing from it beyond the fact that it
// arrived, which keeps it forward/backward tolerant (an older build simply
// ignores an unknown `t` and still ends up in the same place a beat later via
// channel-close detection). Sent by whoever leaves, consumed by
// NetGameSync.onNetMessage, which routes it into the SAME "OPPONENT LEFT" path
// a hard disconnect already takes.
//
// A closed RTCPeerConnection tears the SCTP association down without draining
// what is still queued, so the close is deferred by a few frames to let the
// bye actually leave the machine. Everything the app can observe — the held
// connection, the role, `connected`, and the callbacks — is cleared
// synchronously, so nothing can use the connection during that window; the
// peer's own close/timeout detection remains the backstop if the bye is lost.
const BYE_FLUSH_MS = 250;

// Leave a live net session on purpose: tell the peer, then tear down.
// Idempotent, never throws, and returns whether a bye actually went out
// (false when the channel was already gone — the close path covers that).
export function leaveSession() {
    const conn = NetSession.connection;
    NetSession.connection = null;
    NetSession.role = null;
    NetSession.connected = false;
    if (!conn) return false;

    let sent = false;
    try {
        if (typeof conn.isOpen === 'function' && conn.isOpen() && typeof conn.send === 'function') {
            conn.send({ t: 'bye' });
            sent = true;
        }
    } catch (err) { /* channel died first — the peer's close detection covers it */ }

    muteConnection(conn);

    const close = () => {
        if (typeof conn.close === 'function') {
            try { conn.close(); } catch (err) { /* already gone */ }
        }
    };
    if (sent && typeof setTimeout === 'function') setTimeout(close, BYE_FLUSH_MS);
    else close();
    return sent;
}
