// Tiny singleton holding the ACTIVE online connection + role, so the rest of
// the app (stage 2: host-authoritative match integration) can reach the live
// NetConnection without threading it through scene data. Dependency-light on
// purpose — it never imports NetConnection; it only holds a reference and
// duck-types close() on it.

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

// Drop and close the held connection (idempotent).
export function clearSession() {
    if (NetSession.connection && typeof NetSession.connection.close === 'function') {
        NetSession.connection.close();
    }
    NetSession.connection = null;
    NetSession.role = null;
    NetSession.connected = false;
}
