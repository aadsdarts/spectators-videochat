// State Management
let state = {
    roomCode: null,
    spectatorToken: null,
    peerConnection: null,
    channel: null,
    remoteStream: null,
    remoteParticipants: [],
    pendingRemoteIce: [],
    remoteDescriptionSet: false
};

// DOM Elements
const joinModal = document.getElementById('joinModal');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const tokenInput = document.getElementById('tokenInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const status = document.getElementById('status');
const notification = document.getElementById('notification');
const videoContainer = document.getElementById('videoContainer');
const participantsInfo = document.getElementById('participants');

// Check for URL parameters
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('roomCode');
    const token = params.get('token');

    if (roomCode && token) {
        roomCodeInput.value = roomCode;
        tokenInput.value = token;
        handleJoinRoom();
    } else {
        // No params: redirect to lobby instead of prompting
        window.location.href = `${window.location.origin}/`;
        return;
    }

    joinBtn.addEventListener('click', handleJoinRoom);
    leaveBtn.addEventListener('click', handleLeaveRoom);
});

// Sanitize room code to 4 digits
function sanitizeRoomCode(code) {
    return (code || '')
        .replace(/[^0-9]/g, '')
        .slice(0, 4);
}

// Handle join room
async function handleJoinRoom() {
    const rawRoomCode = (roomCodeInput.value || '').trim();
    const roomCode = sanitizeRoomCode(rawRoomCode);
    const token = tokenInput.value.trim();

    if (!token) {
        showNotification('Spectator token is required', 'error');
        return;
    }

    if (!roomCode) {
        showNotification('Please enter a room code', 'error');
        return;
    }

    // Validate format: 4 digits
    if (roomCode.length !== 4) {
        showNotification('Please enter a valid 4-digit room code', 'error');
        return;
    }

    try {
        // Verify spectator token if provided
        if (token) {
            const { data, error } = await supabaseClient
                .from('spectators')
                .select('*')
                .eq('spectator_token', token)
                .eq('room_code', roomCode)
                .single();

            if (error || !data) {
                showNotification('Invalid or expired spectator token', 'error');
                return;
            }

            // Check expiry
            const expiryDate = new Date(data.expires_at);
            if (expiryDate < new Date()) {
                showNotification('Spectator link has expired', 'error');
                return;
            }

            state.spectatorToken = token;
        }

        // Verify room exists
        const { data: room, error: roomError } = await supabaseClient
            .from('rooms')
            .select('*')
            .eq('room_code', roomCode)
            .eq('is_active', true)
            .single();

        if (roomError || !room) {
            showNotification('Room not found or is inactive', 'error');
            return;
        }

        state.roomCode = roomCode;
        joinModal.style.display = 'none';
        leaveBtn.removeAttribute('hidden');
        status.textContent = `Viewing Room: ${roomCode}`;

        // Setup Realtime channel
function setupRealtimeChannel() {
    state.channel = supabaseClient.channel(
oom-, {
        config: {
            broadcast: { self: true },
            presence: { key: spectator- }
        }
    });

    // Listen for presence changes (participant updates)
    state.channel.on('presence', { event: 'sync' }, () => {
        const presenceState = state.channel.presenceState();
        updateParticipantsList(presenceState);
    });

    // Listen for SDP offers targeted to this spectator
    state.channel.on('broadcast', { event: 'spectator-offer' }, async (payload) => {
        const token = payload.payload?.token;
        const offer = payload.payload?.offer;
        if (!token || token !== state.spectatorToken || !offer) return;

        if (!state.peerConnection) {
            await createPeerConnection();
        }

        if (!state.peerConnection.getTransceivers().length) {
            state.peerConnection.addTransceiver('video', { direction: 'recvonly' });
            state.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        }

        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        state.remoteDescriptionSet = true;
        await flushPendingIce();
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);

        state.channel.send({
            type: 'broadcast',
            event: 'spectator-answer',
            payload: { token: state.spectatorToken, answer: state.peerConnection.localDescription }
        });
    });

    // Listen for ICE candidates for this spectator
    state.channel.on('broadcast', { event: 'spectator-ice' }, async (payload) => {
        const token = payload.payload?.token;
        const candidate = payload.payload?.candidate;
        if (!token || token !== state.spectatorToken || !candidate) return;
        if (!state.peerConnection) return;

        if (!state.remoteDescriptionSet) {
            state.pendingRemoteIce.push(candidate);
            return;
        }

        try {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Error adding spectator ICE candidate:', error);
        }
    });

    state.channel.subscribe(async (status_val) => {
        if (status_val === 'SUBSCRIBED') {
            console.log('Subscribed to room as spectator');
            await state.channel.track({ type: 'spectator', token: state.spectatorToken });
            state.channel.send({
                type: 'broadcast',
                event: 'spectator-offer-request',
                payload: { token: state.spectatorToken }
            });
        }
    });
}

// Create peer connection

async function createPeerConnection() {
    state.peerConnection = new RTCPeerConnection({ iceServers: RTCConfig.iceServers });

    // Handle remote tracks
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind, event.streams);
        if (event.streams && event.streams[0]) {
            displayRemoteVideo(event.streams[0]);
        }
    };

    // Connection state logging
    state.peerConnection.onconnectionstatechange = () => {
        // console.log('Connection state:', state.peerConnection.connectionState);
    };
    state.peerConnection.oniceconnectionstatechange = () => {
        // console.log('ICE connection state:', state.peerConnection.iceConnectionState);
    };
    state.peerConnection.onsignalingstatechange = () => {
        // console.log('Signaling state:', state.peerConnection.signalingState);
    };

    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            state.channel.send({
                type: 'broadcast',
                event: 'spectator-ice',
                payload: { token: state.spectatorToken, candidate: event.candidate }
            });
        }
    };

    // Monitor connection state
    state.peerConnection.onconnectionstatechange = () => {
        // console.log('Connection state:', state.peerConnection.connectionState);
        updateStatus();
    };

    state.peerConnection.oniceconnectionstatechange = () => {
        // console.log('ICE connection state:', state.peerConnection.iceConnectionState);
        updateStatus();
    };
}

async function flushPendingIce() {
    if (!state.remoteDescriptionSet || !state.peerConnection) return;

    while (state.pendingRemoteIce.length) {
        const candidate = state.pendingRemoteIce.shift();
        try {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Error flushing spectator ICE:', error);
        }
    }
}

// Display remote video
function displayRemoteVideo(stream) {
    const video = document.getElementById('remoteVideo');
    const spinner = document.querySelector('.loading-spinner');
    if (spinner) spinner.style.display = 'none';
    video.srcObject = stream;
    video.style.display = 'block';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    video.play().catch(e => {
        console.log('Autoplay blocked:', e);
        const btn = document.getElementById('playPrompt');
        if (btn) btn.style.display = 'block';
    });
}

// Update participants list
function updateParticipantsList(presenceState) {
    const participants = Object.values(presenceState)
        .filter(p => p.some(presence => presence.user))
        .map(p => p[0].user)
        .filter(Boolean);

    if (participants.length > 0) {
        participantsInfo.innerHTML = `<strong>Participants:</strong><br>${participants.join('<br>')}`;
    }
}

// Update status
function updateStatus() {
    const connectionState = state.peerConnection?.connectionState;
    const iceState = state.peerConnection?.iceConnectionState;

    if (connectionState === 'connected' || iceState === 'connected') {
        status.textContent = `Viewing Room: ${state.roomCode} - Connected`;
    } else if (connectionState === 'connecting' || iceState === 'checking') {
        status.textContent = `Viewing Room: ${state.roomCode} - Connecting...`;
    } else if (connectionState === 'failed' || iceState === 'failed') {
        status.textContent = `Viewing Room: ${state.roomCode} - Connection Failed`;
    } else {
        status.textContent = `Viewing Room: ${state.roomCode} - Waiting for video...`;
    }
}

// Handle leave room
async function handleLeaveRoom() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }

    if (state.channel) {
        await state.channel.unsubscribe();
    }

    state.pendingRemoteIce = [];
    state.remoteDescriptionSet = false;
    state.spectatorToken = null;
    state.roomCode = null;

    joinModal.style.display = 'flex';
    leaveBtn.setAttribute('hidden', '');
    status.textContent = 'Loading...';
    tokenInput.value = '';
    roomCodeInput.value = '';
    videoContainer.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p>Waiting for video feed...</p>
        </div>
    `;
    participantsInfo.innerHTML = '';

    showNotification('Left room', 'success');
}

// Show notification
function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification show ${type}`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}
