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

    console.log('Fetching live rooms from Supabase...');

    const { data, error } = await supabaseClient
        .from('rooms')
        .select('room_code, created_at, updated_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading rooms', error);
        console.log('Error details:', JSON.stringify(error));
        statusEl.textContent = 'Error loading rooms';
        liveListEl.innerHTML = '<div class="empty error">Failed to load live games.</div>';
        return;
    }

    const rooms = data || [];
    console.log('Rooms from database:', rooms);

    // Filter rooms by heartbeat: show only rooms updated in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const liveRooms = rooms.filter(r => {
        const lastUpdate = r.updated_at ? new Date(r.updated_at) : new Date(r.created_at);
        return lastUpdate > tenMinutesAgo;
    });

    console.log('Live rooms (heartbeat < 10 min):', liveRooms);
    renderRooms(liveRooms);
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
