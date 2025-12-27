// State Management
let state = {
    roomCode: null,
    spectatorToken: null,
    peerConnection: null,
    channel: null,
    remoteStream: null,
    remoteParticipants: []
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
        joinModal.style.display = 'flex';
    }

    joinBtn.addEventListener('click', handleJoinRoom);
    leaveBtn.addEventListener('click', handleLeaveRoom);
});

// Sanitize room code to 6 uppercase alphanumerics
function sanitizeRoomCode(code) {
    return (code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
}

// Handle join room
async function handleJoinRoom() {
    const rawRoomCode = (roomCodeInput.value || '').trim();
    const roomCode = sanitizeRoomCode(rawRoomCode);
    const token = tokenInput.value.trim();

    if (!roomCode) {
        showNotification('Please enter a room code', 'error');
        return;
    }

    // Validate format: 6 uppercase alphanumerics
    if (roomCode.length !== 6) {
        showNotification('Please enter a valid 6-character room code', 'error');
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
        setupRealtimeChannel();

        showNotification('Connected as spectator', 'success');
    } catch (error) {
        console.error('Error joining room:', error);
        showNotification('Error joining room: ' + error.message, 'error');
    }
}

// Setup Realtime channel
function setupRealtimeChannel() {
    state.channel = supabaseClient.channel(`room-${state.roomCode}`, {
        config: {
            broadcast: { self: true },
            presence: { key: `spectator-${Math.random()}` }
        }
    });

    // Listen for presence changes (participant updates)
    state.channel.on('presence', { event: 'sync' }, () => {
        const presenceState = state.channel.presenceState();
        updateParticipantsList(presenceState);
    });

    // Listen for SDP offers (to establish peer connection)
    state.channel.on('broadcast', { event: 'offer' }, async (payload) => {
        console.log('Received offer from participant');
        const offer = payload.payload.offer;

        if (!state.peerConnection) {
            await createPeerConnection();
        }

        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);

        // Send answer
        state.channel.send({
            type: 'broadcast',
            event: 'spectator-answer',
            payload: { answer: state.peerConnection.localDescription }
        });
    });

    // Listen for ICE candidates
    state.channel.on('broadcast', { event: 'ice-candidate' }, async (payload) => {
        const candidate = payload.payload.candidate;

        if (state.peerConnection && candidate) {
            try {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    });

    state.channel.subscribe(async (status_val) => {
        if (status_val === 'SUBSCRIBED') {
            console.log('Subscribed to room as spectator');
            await state.channel.track({ type: 'spectator' });
        }
    });
}

// Create peer connection
async function createPeerConnection() {
    state.peerConnection = new RTCPeerConnection({ iceServers: RTCConfig.iceServers });

    // Handle remote tracks
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (!state.remoteStream) {
            state.remoteStream = new MediaStream();
            displayRemoteVideo(state.remoteStream);
        }
        state.remoteStream.addTrack(event.track);
    };

    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            state.channel.send({
                type: 'broadcast',
                event: 'ice-candidate',
                payload: { candidate: event.candidate }
            });
        }
    };

    // Monitor connection state
    state.peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', state.peerConnection.connectionState);
        updateStatus();
    };

    state.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', state.peerConnection.iceConnectionState);
        updateStatus();
    };
}

// Display remote video
function displayRemoteVideo(stream) {
    // Remove loading spinner
    const spinner = videoContainer.querySelector('.loading-spinner');
    if (spinner) {
        spinner.remove();
    }

    // Create or update video element
    let video = videoContainer.querySelector('video');
    if (!video) {
        video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        videoContainer.insertBefore(video, videoContainer.firstChild);
    }

    video.srcObject = stream;
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
