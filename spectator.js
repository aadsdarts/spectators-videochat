// Spectator Viewer - Receives video streams from participants
let state = {
    roomCode: null,
    spectatorToken: null,
    peerConnection: null,
    channel: null
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

        setupPeerConnection();
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

function setupPeerConnection() {
    state.peerConnection = new RTCPeerConnection(RTCConfig);

    state.peerConnection.ontrack = (event) => {
        console.log('📹 Received video track:', event.track.kind, 'from stream:', event.streams[0].id);
        
        // Hide loading spinner
        const spinner = document.querySelector('.loading-spinner');
        if (spinner) spinner.style.display = 'none';
        
        if (!remoteVideo1.srcObject) {
            remoteVideo1.srcObject = event.streams[0];
            console.log('✅ Set video stream 1');
            remoteVideo1.play().catch(e => {
                console.log('Autoplay blocked, showing play button');
                document.getElementById('playPrompt').style.display = 'block';
            });
            showNotification('Connected! Receiving video...', 'success');
        } else if (!remoteVideo2.srcObject && event.streams[0] !== remoteVideo1.srcObject) {
            remoteVideo2.srcObject = event.streams[0];
            console.log('✅ Set video stream 2');
            remoteVideo2.play().catch(e => console.log('Autoplay blocked for video 2'));
            showNotification('Second participant joined!', 'success');
        }

        document.querySelector('.loading-spinner').style.display = 'none';
    };

    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate && state.channel) {
            state.channel.send({
                type: 'broadcast',
                event: 'spectator-ice',
                payload: { 
                    token: state.spectatorToken,
                    candidate: event.candidate 
                }
            });
        }
    };

    state.peerConnection.onconnectionstatechange = () => {
        const connState = state.peerConnection.connectionState;
        console.log('Connection state:', connState);
        
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
        } else {
            status.textContent = `Room ${state.roomCode} - ${connState}`;
        }
    };
}

function setupRealtimeChannel() {
    state.channel = supabaseClient.channel(`room-${state.roomCode}`);

    state.channel.on('broadcast', { event: 'offer' }, async (payload) => {
        console.log('📡 Received offer from participant');
        const offer = payload.payload.offer;

        if (!state.peerConnection) {
            console.error('No peer connection available');
            return;
        }

        // Check if we can accept this offer
        const signalingState = state.peerConnection.signalingState;
        if (signalingState !== 'stable' && signalingState !== 'have-local-offer') {
            console.warn('Ignoring offer - peer connection in wrong state:', signalingState);
            return;
        }

        try {
            // If we have a local offer pending, rollback first
            if (signalingState === 'have-local-offer') {
                console.log('Rolling back local offer to accept remote offer');
                await state.peerConnection.setLocalDescription({ type: 'rollback' });
            }

            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await state.peerConnection.createAnswer();
            await state.peerConnection.setLocalDescription(answer);

            state.channel.send({
                type: 'broadcast',
                event: 'spectator-answer',
                payload: { 
                    token: state.spectatorToken,
                    answer: state.peerConnection.localDescription 
                }
            });
            
            console.log('✅ Sent answer to participant');
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    });

    state.channel.on('broadcast', { event: 'participant-ice' }, async (payload) => {
        const candidate = payload.payload.candidate;
        if (candidate && state.peerConnection) {
            try {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ Added ICE candidate from participant');
            } catch (error) {
                console.error('ICE error:', error);
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
    if (state.peerConnection) {
        state.peerConnection.close();
    }
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
