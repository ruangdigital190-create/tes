import { CONFIG } from './config.js';
export { CONFIG };
export const $ = (id) => document.getElementById(id);
export const fmt = (v) => v === null || v === undefined ? 'Konfirmasi admin' : 'Rp' + Number(v).toLocaleString('id-ID');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const validUrl = (value) => {
  if (!value) return '';
  try { const u = new URL(value, location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
  catch { return ''; }
};
export const isConfigured = Boolean(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CONFIG.supabaseUrl) && CONFIG.supabaseAnonKey && !CONFIG.supabaseAnonKey.startsWith('PASTE_'));
let instance = null;
export function getDb() {
  if (!isConfigured) return null;
  if (!instance) {
    if (!window.supabase?.createClient) throw new Error('Supabase SDK gagal dimuat. Periksa koneksi internet / CDN.');
    instance = window.supabase.createClient(CONFIG.supabaseUrl.replace(/\/$/,''), CONFIG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  }
  return instance;
}
export function toast(message) {
  const el = $('toast'); if(!el) return;
  el.textContent = message; el.classList.remove('hidden');
  clearTimeout(el._hideTimeout); el._hideTimeout = setTimeout(() => el.classList.add('hidden'), 4600);
}
export function showModal(id) {const el=$(id);if(!el)return;el.classList.remove('hidden');el.setAttribute('aria-hidden','false');document.body.classList.add('lock');}
export function closeModal(id) {const el=$(id);if(!el)return;el.classList.add('hidden');el.setAttribute('aria-hidden','true');if(!document.querySelector('.modal:not(.hidden)'))document.body.classList.remove('lock');}
export function dateText(value) {return value ? new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}) : '—';}
export function safeError(error) {return (error && typeof error.message === 'string') ? error.message : 'Terjadi kesalahan. Periksa koneksi dan pengaturan Supabase.';}
export function currentDevice() {
 const ua=navigator.userAgent || '';
 const os=/Android/i.test(ua)?'Android':/iPhone|iPad/i.test(ua)?'iPhone/iPad':/Windows/i.test(ua)?'Windows':/Macintosh/i.test(ua)?'Mac':'Perangkat lain';
 const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Browser';
 return os+' • '+browser;
}
let heartbeat = null, deviceId = null, trackedUser = null;
export async function startDeviceTracking(db,userId) {
 if(!db||!userId)return;
 if(trackedUser === userId && heartbeat)return;
 stopDeviceTracking(); trackedUser=userId; deviceId=crypto.randomUUID();
 const push=async()=>{
  try{await db.from('device_sessions').upsert({id:deviceId,user_id:userId,device_label:currentDevice(),last_seen:new Date().toISOString(),is_active:true},{onConflict:'id'});}catch(e){console.warn('device heartbeat:',safeError(e));}
 };
 await push(); heartbeat=setInterval(push,60000);
}
export function stopDeviceTracking() {
 if(heartbeat) clearInterval(heartbeat);
 heartbeat=null;trackedUser=null;
}
export async function markDeviceInactive(db) {
 if(db && deviceId)try {await db.from('device_sessions').update({is_active:false,last_seen:new Date().toISOString()}).eq('id',deviceId);}catch{}
 stopDeviceTracking();deviceId=null;
}
