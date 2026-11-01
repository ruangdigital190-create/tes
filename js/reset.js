import {getDb,$,safeError} from './shared.js';
let db;
try {db=getDb();$('resetMessage').textContent=db?'Tautan telah dibuka. Masukkan password baru.':'Supabase belum dikonfigurasi.';}catch(e){$('resetMessage').textContent=safeError(e);}
$('resetForm').onsubmit=async(e)=>{e.preventDefault();if(!db)return;const password=$('newPassword').value;
 const {data:{session},error:sessionError}=await db.auth.getSession();if(sessionError||!session){$('resetMessage').textContent='Sesi pemulihan tidak valid atau kedaluwarsa. Ulangi permintaan reset dari halaman login.';return;}
 const {error}=await db.auth.updateUser({password});$('resetMessage').textContent=error?'Gagal mengganti password: '+safeError(error):'Password berhasil diperbarui. Silakan kembali ke toko dan login.';
};
