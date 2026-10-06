export const DASHBOARD_NOTIFICATION_EVENT = "armani:dashboard-notification";
export const DASHBOARD_NOTIFICATION_SOUND_EVENT = "armani:dashboard-notification-sound";
export const DASHBOARD_NOTIFICATION_SOUND_KEY = "armani.orders.sound";

export function playDashboardNotificationSound() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(988, context.currentTime + 0.11);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.07, context.currentTime + 0.025);
    gain.gain.setValueAtTime(0.07, context.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.32);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is optional; browsers may block it until the user enables it.
  }
}

export function dashboardNotificationSoundEnabled() {
  try {
    return localStorage.getItem(DASHBOARD_NOTIFICATION_SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function setDashboardNotificationSound(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(DASHBOARD_NOTIFICATION_SOUND_KEY, "on");
    else localStorage.removeItem(DASHBOARD_NOTIFICATION_SOUND_KEY);
  } catch {
    // Keep the preference for this page even when browser storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent(DASHBOARD_NOTIFICATION_SOUND_EVENT, { detail: { enabled } }),
  );
}
