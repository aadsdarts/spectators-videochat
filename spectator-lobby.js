const liveListEl = document.getElementById('liveList');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');

// Point to the spectator viewer (we preserved the old viewer as viewer.html)
// GitHub Pages serves from /spectators-videochat/ path
const spectatorBase = window.location.origin.includes('github.io') 
    ? `${window.location.origin}/spectators-videochat/viewer.html`
    : `${window.location.origin}/viewer.html`;

function formatAgo(isoString) {
    const created = new Date(isoString);
    const diffMin = Math.max(0, Math.round((Date.now() - created.getTime()) / 60000));
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const hours = Math.floor(diffMin / 60);
    return `${hours}h ago`;
}

function renderRooms(rooms) {
    liveListEl.innerHTML = '';

    if (!rooms || rooms.length === 0) {
        liveListEl.innerHTML = '<div class="empty">No live games right now. Check back soon.</div>';
        statusEl.textContent = 'No live rooms';
        return;
    }

    rooms.forEach((room) => {
        const card = document.createElement('div');
        card.className = 'card';

        const title = document.createElement('h3');
        title.textContent = `Room ${room.room_code}`;

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.innerHTML = `<span>Active</span><span>${formatAgo(room.created_at)}</span>`;

        const watchBtn = document.createElement('button');
        watchBtn.className = 'btn watch-btn';
        watchBtn.textContent = 'Watch';
        watchBtn.addEventListener('click', () => handleWatch(room.room_code));

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(watchBtn);
        liveListEl.appendChild(card);
    });

    statusEl.textContent = `${rooms.length} live ${rooms.length === 1 ? 'room' : 'rooms'}`;
}

async function fetchLiveRooms() {
    statusEl.textContent = 'Loading';
    liveListEl.innerHTML = '';

    const { data, error } = await supabaseClient
        .from('rooms')
        .select('room_code, created_at', { head: false, count: 'exact' })
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading rooms', error);
        statusEl.textContent = 'Error loading rooms';
        liveListEl.innerHTML = '<div class="empty error">Failed to load live games.</div>';
        return;
    }

    // Probe realtime presence for each room and keep only rooms with
    // at least two non-spectator presences (i.e., both participants online)
    const rooms = data || [];
    
    // Filter out stale rooms older than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentRooms = rooms.filter(r => new Date(r.created_at) > tenMinutesAgo);
    
    const probeResults = await Promise.all(recentRooms.map(r => probeRoom(r.room_code)));
    const byRoom = new Map(probeResults.map(x => [x.roomCode, x]));
    // Require at least two participant pongs OR presence count >= 2
    const liveConnected = recentRooms.filter(r => {
        const p = byRoom.get(r.room_code);
        const pongOk = (p?.pongs || 0) >= 2;
        const presenceOk = (p?.presenceCount || 0) >= 2;
        return pongOk || presenceOk;
    });

    renderRooms(liveConnected);
}

// Get presence count (excluding spectators) for a room channel
function probeRoom(roomCode) {
    return new Promise((resolve) => {
        let resolved = false;
        let pongs = 0;
        try {
            const channel = supabaseClient.channel(`room-${roomCode}`, {
                config: {
                    broadcast: { self: false },
                    presence: { key: `lobby-${Math.random().toString(36).slice(2, 9)}` }
                }
            });

            const finalize = () => {
                if (resolved) return;
                const presenceState = channel.presenceState();
                const nonSpectatorCount = Object.values(presenceState)
                    .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.filter(p => p?.type !== 'spectator').length : 0), 0);
                resolved = true;
                // Unsubscribe after computing
                setTimeout(() => channel.unsubscribe().catch(() => {}), 0);
                resolve({ roomCode, presenceCount: nonSpectatorCount, pongs });
            };

            channel.on('broadcast', { event: 'lobby-pong' }, (payload) => {
                const role = payload?.payload?.role;
                if (role === 'participant') pongs += 1;
            });

            channel.on('presence', { event: 'sync' }, finalize);
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Fallback in case 'sync' doesn't fire quickly
                    // Send a ping to solicit pongs from active participants
                    channel.send({ type: 'broadcast', event: 'lobby-ping', payload: { ts: Date.now() } });
                    setTimeout(finalize, 1200);
                }
            });
        } catch (err) {
            console.warn('Presence check failed for room', roomCode, err);
            resolve({ roomCode, presenceCount: 0, pongs: 0 });
        }
    });
}

async function handleWatch(roomCode) {
    try {
        statusEl.textContent = `Joining room ${roomCode}`;
        const token = Math.random().toString(36).substring(2, 12);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const { error } = await supabaseClient
            .from('spectators')
            .insert([{
                room_code: roomCode,
                spectator_token: token,
                created_at: new Date(),
                expires_at: expiresAt
            }]);

        if (error) throw error;

        const target = `${spectatorBase}?roomCode=${roomCode}&token=${token}`;
        window.location.href = target;
    } catch (err) {
        console.error('Error joining as spectator', err);
        statusEl.textContent = 'Error joining room';
    }
}

refreshBtn.addEventListener('click', fetchLiveRooms);
document.addEventListener('DOMContentLoaded', fetchLiveRooms);

