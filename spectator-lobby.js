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
        watchBtn.textContent = '▶ Watch Live';
        watchBtn.addEventListener('click', () => handleWatch(room.room_code));

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(watchBtn);
        liveListEl.appendChild(card);
    });

    statusEl.textContent = `${rooms.length} live ${rooms.length === 1 ? 'room' : 'rooms'}`;
}

// Store active rooms from realtime broadcasts
let activeRooms = new Map();
let lobbyChannel = null;

async function fetchLiveRooms() {
    statusEl.textContent = 'Listening for live rooms...';
    liveListEl.innerHTML = '<div class="empty">Scanning for active rooms...</div>';

    console.log('=== LISTENING FOR ROOM BROADCASTS ===');
    
    // Clear old rooms older than 15 seconds
    const now = Date.now();
    for (const [roomCode, data] of activeRooms.entries()) {
        if (now - data.timestamp > 15000) {
            activeRooms.delete(roomCode);
        }
    }
    
    renderRooms(Array.from(activeRooms.values()));

    // Subscribe to lobby broadcast channel if not already subscribed
    if (!lobbyChannel) {
        lobbyChannel = supabaseClient.channel('lobby-broadcast');
        
        lobbyChannel
            .on('broadcast', { event: 'room-active' }, (payload) => {
                console.log('📡 Room broadcast received:', payload.payload);
                const { room_code, timestamp } = payload.payload;
                
                activeRooms.set(room_code, {
                    room_code: room_code,
                    created_at: new Date(timestamp).toISOString(),
                    timestamp: timestamp
                });
                
                // Update display
                renderRooms(Array.from(activeRooms.values()));
            })
            .subscribe((status) => {
                console.log('Lobby channel status:', status);
                if (status === 'SUBSCRIBED') {
                    statusEl.textContent = 'Listening for live rooms...';
                }
            });
    }
    
    // Auto-refresh to clean old rooms
    setTimeout(() => {
        const now = Date.now();
        let changed = false;
        for (const [roomCode, data] of activeRooms.entries()) {
            if (now - data.timestamp > 15000) {
                activeRooms.delete(roomCode);
                changed = true;
            }
        }
        if (changed) {
            renderRooms(Array.from(activeRooms.values()));
        }
    }, 5000);
}

async function handleWatch(roomCode) {
    try {
        statusEl.textContent = `Connecting to room ${roomCode}...`;
        const token = Math.random().toString(36).substring(2, 12);
        const { error } = await supabaseClient
            .from('spectators')
            .insert([{
                room_code: roomCode,
                token: token
            }]);

        if (error) {
            console.error('Database error:', error);
            throw error;
        }

        // Navigate to viewer immediately for seamless experience
        const target = `${spectatorBase}?roomCode=${roomCode}&token=${token}`;
        console.log('🎬 Opening viewer:', target);
        window.location.href = target;
    } catch (err) {
        console.error('Error joining as spectator', err);
        statusEl.textContent = 'Error joining room';
    }
}

refreshBtn.addEventListener('click', fetchLiveRooms);
document.addEventListener('DOMContentLoaded', fetchLiveRooms);
