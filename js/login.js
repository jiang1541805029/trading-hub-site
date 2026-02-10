const SUPABASE_URL = 'https://wqqpyozrvstrzarzjsru.supabase.co';
const SUPABASE_KEY = 'sb_publishable__5kVr0Gmnw3tVVv4e0Noyg_RRBexQ6c';
const EMAIL_KEY = 'tradingJournal_email';
const PANEL_URL = 'panel.html';

const supabaseClient = (typeof supabase !== 'undefined')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

function setStatus(msg) {
  const el = document.getElementById('loginStatus');
  if (el) el.innerText = msg || '';
}

async function sendMagicLink() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }
  const emailInput = document.getElementById('loginEmail');
  const email = (emailInput ? emailInput.value : '').trim();
  if (!email) {
    setStatus('Please enter an email.');
    return;
  }
  localStorage.setItem(EMAIL_KEY, email);
  setStatus('Sending magic link...');

  const redirectTo = (location.protocol === 'file:')
    ? null
    : new URL(PANEL_URL, window.location.href).href;

  if (location.protocol === 'file:') {
    setStatus('Magic link requires http(s). Open this page via a local server.');
  }

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: redirectTo ? { emailRedirectTo: redirectTo } : {}
  });

  if (error) {
    setStatus('Error: ' + error.message);
    return;
  }

  setStatus('Magic link sent. Check your email.');
}

async function initLogin() {
  if (!supabaseClient) {
    setStatus('Supabase client not available.');
    return;
  }

  const savedEmail = localStorage.getItem(EMAIL_KEY);
  if (savedEmail) {
    const input = document.getElementById('loginEmail');
    if (input) input.value = savedEmail;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    window.location.href = PANEL_URL;
    return;
  }

  const btn = document.getElementById('loginSendBtn');
  if (btn) btn.addEventListener('click', sendMagicLink);
}

document.addEventListener('DOMContentLoaded', initLogin);
