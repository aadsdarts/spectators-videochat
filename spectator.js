// Spectator Viewer - Receives video streams from participants
let state = {
    roomCode: null,
    spectatorToken: null,
    peerConnections: [], // Support multiple participants
    channel: null,
    videoSlots: [null, null] // Track which video element has which stream
};

const status = document.getElementById('status');
const notification = document.getElementById('notification');
const remoteVideo1 = document.getElementById('remoteVideo1');
const remoteVideo2 = document.getElementById('remoteVideo2');
const leaveBtn = document.getElementById('leaveBtn');

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('roomCode');
    const token = params.get('token');

    if (roomCode && token) {
        state.roomCode = roomCode;
        state.spectatorToken = token;
        joinAsSpectator();
    } else {
        status.textContent = 'Invalid link';
        showNotification('No room specified', 'error');
    }

    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            window.location.href = '/spectators-videochat/';
        });
    }
});

async function joinAsSpectator() {
    try {
        status.textContent = `Connecting to room ${state.roomCode}...`;
        console.log('✅ Spectator joining room:', state.roomCode);
        
        showNotification('Connecting to live video...', 'info');

        setupRealtimeChannel();

        leaveBtn.removeAttribute('hidden');
        
        // Auto-hide loading spinner after 30 seconds if no video
        setTimeout(() => {
            const spinner = document.querySelector('.loading-spinner');
            if (spinner && spinner.style.display !== 'none') {
                spinner.style.display = 'none';
                showNotification('Waiting for participants to start streaming...', 'info');
            }
        }, 30000);
        
    } catch (error) {
        console.error('❌ Error joining:', error);
        status.textContent = 'Connection failed';
        showNotification('Failed to connect to room', 'error');
    }
}

function createPeerConnectionForParticipant(participantId) {
    console.log('📡 Creating peer connection for participant:', participantId);
    
    const pc = new RTCPeerConnection(RTCConfig);
    
    pc.ontrack = (event) => {
        console.log('📹 Received video track:', event.track.kind, 'from participant:', participantId);
        
        // Hide loading spinner
        const spinner = document.querySelector('.loading-spinner');
        if (spinner) spinner.style.display = 'none';
        
        // Assign to first available video slot
        if (!state.videoSlots[0]) {
            remoteVideo1.srcObject = event.streams[0];
            state.videoSlots[0] = event.streams[0];
            console.log('✅ Set video stream to slot 1');
            remoteVideo1.play().catch(e => {
                console.log('Autoplay blocked, showing play button');
                document.getElementById('playPrompt')?.style.setProperty('display', 'block');
            });
            showNotification('Connected! Receiving video...', 'success');
        } else if (!state.videoSlots[1] && event.streams[0] !== state.videoSlots[0]) {
            remoteVideo2.srcObject = event.streams[0];
            state.videoSlots[1] = event.streams[0];
            console.log('✅ Set video stream to slot 2');
            remoteVideo2.play().catch(e => console.log('Autoplay blocked for video 2'));
            showNotification('Second participant joined!', 'success');
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate && state.channel) {
            state.channel.send({
                type: 'broadcast',
                event: 'spectator-ice',
                payload: { 
                    token: state.spectatorToken,
                    participantId: participantId,
                    candidate: event.candidate 
                }
            });
        }
    };

    pc.onconnectionstatechange = () => {
        const connState = pc.connectionState;
        console.log(`Connection state for ${participantId}:`, connState);
        
        if (connState === 'connected') {
            console.log('✅ Successfully connected to participant');
            status.textContent = `Watching Room ${state.roomCode}`;
            showNotification('Live! Watching video call', 'success');
        } else if (connState === 'connecting') {
            status.textContent = `Connecting to Room ${state.roomCode}...`;
        } else if (connState === 'failed') {
            console.error('❌ Connection to participant failed');
            status.textContent = `Connection Failed - Room ${state.roomCode}`;
            showNotification('Connection failed. Room may be inactive.', 'error');
            
            // Hide spinner on failure
            const spinner = document.querySelector('.loading-spinner');
            if (spinner) spinner.style.display = 'none';
        } else if (connState === 'disconnected') {
            status.textContent = `Disconnected from Room ${state.roomCode}`;
            showNotification('Disconnected from video call', 'error');
        }
    };
    
    state.peerConnections.push({ id: participantId, pc: pc });
    return pc;
}

function setupRealtimeChannel() {
    state.channel = supabaseClient.channel(`room-${state.roomCode}`);

    state.channel.on('broadcast', { event: 'offer' }, async (payload) => {
        console.log('📡 Received offer from participant', payload.payload);
        const offer = payload.payload.offer;
        const participantId = payload.payload.participantId || `participant-${Date.now()}`;

        try {
            // Check if we already have a connection for this participant
            let existingConn = state.peerConnections.find(c => c.id === participantId);
            let pc;
            
            if (existingConn) {
                pc = existingConn.pc;
                console.log('Using existing connection for:', participantId);
                
                // Check if we can accept this offer
                const signalingState = pc.signalingState;
                if (signalingState !== 'stable' && signalingState !== 'have-local-offer') {
                    console.warn('Ignoring offer - peer connection in wrong state:', signalingState);
                    return;
                }
                
                // If we have a local offer pending, rollback first
                if (signalingState === 'have-local-offer') {
                    console.log('Rolling back local offer to accept remote offer');
                    await pc.setLocalDescription({ type: 'rollback' });
                }
            } else {
                // Create new peer connection for this participant
                pc = createPeerConnectionForParticipant(participantId);
                console.log('Created new connection for:', participantId);
            }

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            state.channel.send({
                type: 'broadcast',
                event: 'spectator-answer',
                payload: { 
                    token: state.spectatorToken,
                    participantId: participantId,
                    answer: pc.localDescription 
                }
            });
            
            console.log('✅ Sent answer to participant:', participantId);
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    });

    state.channel.on('broadcast', { event: 'participant-ice' }, async (payload) => {
        const candidate = payload.payload.candidate;
        const participantId = payload.payload.participantId;
        
        if (candidate) {
            // Find the correct peer connection for this participant
            const conn = participantId 
                ? state.peerConnections.find(c => c.id === participantId)
                : state.peerConnections[state.peerConnections.length - 1]; // fallback to latest
            
            if (conn && conn.pc) {
                try {
                    await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log('✅ Added ICE candidate from participant:', participantId);
                } catch (error) {
                    console.error('ICE error:', error);
                }
            } else {
                console.warn('No peer connection found for participant:', participantId);
            }
        }
    });

    state.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            console.log('✅ Subscribed as spectator');
            await state.channel.track({ spectator: true });
            
            state.channel.send({
                type: 'broadcast',
                event: 'spectator-ready',
                payload: { token: state.spectatorToken }
            });
        }
    });
}

function handleLeaveRoom() {
    // Close all peer connections
    state.peerConnections.forEach(conn => {
        if (conn.pc) {
            conn.pc.close();
        }
    });
    state.peerConnections = [];
    
    if (state.channel) {
        state.channel.unsubscribe();
    }
    window.location.href = '/spectators-videochat/';
}

function showNotification(message, type = 'info') {
    notification.textContent = message;
    notification.className = `notification show ${type}`;
    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}
