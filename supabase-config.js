// Supabase Configuration
const SUPABASE_URL = 'https://ciuuivaqtpqfiaefspxh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdXVpdmFxdHBxZmlhZWZzcHhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDU0MjEsImV4cCI6MjA4MjM4MTQyMX0.0pK-vYOAvDjsUV_YKKXcYcBhZ3shvG4JDLT0xQfJHU8';

// Initialize Supabase
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            Accept: 'application/json'
        }
    }
});

// WebRTC Configuration
const RTCConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
    ]
};