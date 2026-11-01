import {CONFIG,$,fmt,esc,validUrl,getDb,isConfigured,toast,showModal,closeModal,dateText,startDeviceTracking,markDeviceInactive,safeError} from './shared.js';
let db=null,products=[],profile=null,user=null,activeProduct=null,filter='all',query='',cart=[],posters={mlbb:'./assets/mlbb-price-list.webp',freefire:'./assets/freefire-price-list.webp'},posterFiles={mlbb:'./assets/mlbb-price-list.png',freefire:'./assets/freefire-price-list.jpeg'},poster='mlbb',channel=null;
try {cart=JSON.parse(localStorage.getItem('rd190-cart-v2')||'[]');if(!Array.isArray(cart))cart=[];}catch{cart=[];}
const saveCart=()=>{try{localStorage.setItem('rd190-cart-v2',JSON.stringify(cart));}catch{} $('cartCount').textContent=cart.reduce((s,x)=>s+x.qty,0);};
const iconOf=p=>p.id==='mlbb'?'💎':p.id==='freefire'?'🔥':({netflix:'🎬',spotify:'🎧',youtube:'▶️',capcut:'🎞️',canva:'🎨',chatgpt:'✨',gemini:'✦',grammarly:'📝',quillbot:'✍️'}[p.id]||'📦');
const stockName=s=>({available:'Tersedia',limited:'Terbatas',out_of_stock:'Habis',confirm:'Konfirmasi admin'}[s]||'Konfirmasi admin');

function renderCatalog(){
 const filtered=products.filter(p=>(filter==='all'||p.group_name===filter) && [p.title,p.brand,p.category,p.tag].some(v=>String(v||'').toLowerCase().includes(query)));
 $('productGrid').innerHTML=filtered.length?filtered.map(p=>{
  const vars=p.variants||[];const prices=vars.filter(v=>v.is_active!==false&&v.price!==null).map(v=>Number(v.price));
  return `<article class="product"><div class="pic">${validUrl(p.image_url)?`<img loading="lazy" src="${esc(validUrl(p.image_url))}" alt="${esc(p.title)}">`:iconOf(p)}</div><h3>${esc(p.title)}</h3><p>${esc(p.short_description||p.description||p.category)}</p><div class="meta"><span>${esc(p.tag||p.category)}</span><span>${prices.length?'Mulai '+fmt(Math.min(...prices)):'Cek harga'}</span></div><button class="btn" data-product="${esc(p.id)}" type="button">Lihat Paket →</button></article>`;
 }).join(''):'<div class="info-box" style="grid-column:1/-1">Produk tidak ditemukan. Coba kata kunci lain.</div>';
}
async function loadCatalog(){
 try {
  if(db){
   const {data,error}=await db.from('products').select('id,brand,title,group_name,category,tag,short_description,description,info,image_url,sort_order,is_active,product_variants(id,name,price,original_price,stock_status,stock_quantity,discount_enabled,note,sort_order,is_active)').eq('is_active',true).order('sort_order',{ascending:true});
   if(error)throw error;
   products=(data||[]).map(p=>({...p,variants:(p.product_variants||[]).filter(v=>v.is_active).sort((a,b)=>a.sort_order-b.sort_order)}));
   $('catalogStatus').textContent='Katalog online • '+products.length+' produk';
  } else {
   const resp=await fetch('./data/catalog-fallback.json',{cache:'no-store'});if(!resp.ok)throw new Error('File katalog cadangan tidak ditemukan');products=await resp.json();
   $('catalogStatus').textContent='Mode katalog contoh';
  }
 }catch(err){console.error('catalog:',err);$('catalogStatus').textContent='Tidak tersambung • katalog cadangan';if(!products.length){try{products=await(await fetch('./data/catalog-fallback.json')).json();}catch{}}}
 renderCatalog();
}
async function loadPosters(){if(!db)return;const{data,error}=await db.from('store_assets').select('slug,image_url');if(error)return;(data||[]).forEach(a=>{if(a.slug in posters && validUrl(a.image_url)){posters[a.slug]=a.image_url;posterFiles[a.slug]=a.image_url;}});renderPoster();}
function renderPoster(){const visible=!$('posterPanel').classList.contains('hidden');$('posterImage').src=posters[poster];$('posterImage').alt='Price List '+(poster==='mlbb'?'Mobile Legends':'Free Fire');$('posterDownload').href=posterFiles[poster];$('posterDownload').download=poster==='mlbb'?'Price-List-MLBB.png':'Price-List-Free-Fire.jpg';$('posterDownload').classList.toggle('hidden',!visible);document.querySelectorAll('[data-poster]').forEach(b=>{b.classList.toggle('active',b.dataset.poster===poster);b.classList.toggle('secondary',b.dataset.poster!==poster);});}
function showVariants(p){activeProduct=p;$('productModalTitle').textContent=p.title;$('productModalDescription').textContent=p.description||p.short_description||'';$('productModalInfo').textContent=p.info||'';const options=(p.variants||[]).filter(v=>v.is_active!==false);
 $('variantSelect').innerHTML=options.map((v,i)=>`<option value="${i}">${esc(v.name)} — ${esc(fmt(v.price))}</option>`).join('');$('addCart').disabled=!options.length; $('variantQuantity').value=1;updateVariantDetails();showModal('productModal');}
function updateVariantDetails(){const opts=(activeProduct?.variants||[]).filter(v=>v.is_active!==false);const v=opts[Number($('variantSelect').value)];if(!v){$('variantDetails').textContent='Belum tersedia varian.';return;}$('variantDetails').textContent=`${fmt(v.price)} • Stok: ${stockName(v.stock_status)}${v.note?' • '+v.note:''}`;$('addCart').disabled=v.stock_status==='out_of_stock';}
function addCart(){const opts=(activeProduct?.variants||[]).filter(v=>v.is_active!==false);const v=opts[Number($('variantSelect').value)];if(!v || v.stock_status==='out_of_stock')return;const qty=Math.max(1,Math.min(50,Number($('variantQuantity').value)||1));const key=activeProduct.id+'::'+(v.id||v.name);const existing=cart.find(x=>x.key===key);if(existing)existing.qty=Math.min(50,existing.qty+qty);else cart.push({key,product_id:activeProduct.id,variant_id:v.id||null,product_name:activeProduct.title,variant_name:v.name,price:v.price,qty});saveCart();closeModal('productModal');toast('Paket ditambahkan ke keranjang.');}
function renderCart(){let sum=0,quote=false;$('cartItems').innerHTML=cart.length?cart.map((x,i)=>{sum+=Number(x.price||0)*x.qty;if(x.price===null)quote=true;return `<div class="cart-item"><div><strong>${esc(x.product_name)}</strong><small>${esc(x.variant_name)} · ${fmt(x.price)}</small></div><div class="cart-qty"><button type="button" data-minus="${i}" aria-label="Kurangi">−</button><b>${x.qty}</b><button type="button" data-plus="${i}" aria-label="Tambah">+</button><button type="button" data-remove="${i}" aria-label="Hapus">×</button></div></div>`;}).join(''):'<p>Keranjang Anda masih kosong.</p>';
 $('cartTotal').textContent='Total: '+fmt(sum)+(quote?' + paket konfirmasi harga':'');$('checkoutButton').disabled=cart.length===0;
 $('checkoutNotice').textContent=user?'Login aktif. Pesanan akan dicatat di database sebelum konfirmasi WhatsApp.':'Belum login. Pesanan akan disiapkan melalui WhatsApp tanpa nomor order online.';}
function openCart(){renderCart();showModal('cartModal');}
function whatsappText(form,invoice=''){const vals=Object.fromEntries(new FormData(form));const lines=['Halo Admin RUANGDIGITAL190, saya ingin memesan:',invoice?'Nomor pesanan: '+invoice:'','',...cart.map(x=>`• ${x.product_name} / ${x.variant_name} x${x.qty} — ${fmt(x.price)}`),'','Nama: '+vals.customer,'WhatsApp: '+vals.phone,'Player ID: '+(vals.player||'-'),'Zone ID: '+(vals.zone||'-'),'Catatan: '+(vals.note||'-'),'Mohon konfirmasi stok, harga final, dan cara pembayarannya.'];return lines.filter((x,i)=>x||i<3).join('\n');}
async function checkout(event){event.preventDefault();if(!cart.length)return;const fields=new FormData(event.currentTarget);
 if(cart.some(x=>['mlbb','freefire'].includes(x.product_id)) && String(fields.get('player')||'').trim().length<3){toast('Masukkan Player ID untuk pemesanan top up game.');return;}
 if(cart.some(x=>x.product_id==='mlbb') && String(fields.get('zone')||'').trim().length<2){toast('Masukkan Zone ID MLBB terlebih dahulu.');return;}
 const button=$('checkoutButton');button.disabled=true;button.textContent='Menyimpan pesanan…';let invoice='';
 try{
  if(db&&user&&cart.every(x=>x.variant_id)){
   const f=Object.fromEntries(new FormData(event.currentTarget));const items=cart.map(x=>({product_id:x.product_id,variant_id:x.variant_id,quantity:x.qty}));
   const {data,error}=await db.rpc('place_order',{p_name:f.customer,p_phone:f.phone,p_player:f.player||'',p_zone:f.zone||'',p_note:f.note||'',p_items:items});if(error)throw error;invoice=data.order_number;
  }
  const url='https://wa.me/'+CONFIG.whatsappNumber+'?text='+encodeURIComponent(whatsappText(event.currentTarget,invoice));
  cart=[];saveCart();renderCart();$('checkoutNotice').innerHTML=`${invoice?`Pesanan <b>${esc(invoice)}</b> tercatat online. `:''}<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="btn" style="margin-top:10px">Buka WhatsApp untuk konfirmasi →</a>`;toast(invoice?'Pesanan berhasil disimpan. Lanjutkan konfirmasi WhatsApp.':'Pesanan siap dikirim melalui WhatsApp.');
 }catch(e){console.error(e);toast('Gagal menyimpan pesanan: '+safeError(e)+' — data tetap di keranjang.');}
 finally{button.disabled=cart.length===0;button.textContent='Kirim Pesanan';}
}
function accountMessage(message,isError=false){const el=$('accountNotice');el.textContent=message;el.classList.remove('hidden');el.classList.toggle('error',isError);}
async function refreshAccount(){if(!db)return;const {data:{user:u}}=await db.auth.getUser();user=u||null;profile=null;
 if(user){const {data}=await db.from('profiles').select('id,username,display_name,email,role').eq('id',user.id).maybeSingle();profile=data||null;await startDeviceTracking(db,user.id);}
 $('accountButton').textContent=profile?(profile.username||'Akun'):'Akun';$('loggedOut').classList.toggle('hidden',!!user);$('loggedIn').classList.toggle('hidden',!user);
 if(user)$('accountName').textContent=`${profile?.display_name||user.email} · @${profile?.username||''}`;
}
async function userLogin(e){e.preventDefault();if(!db)return accountMessage('Hubungkan Supabase terlebih dahulu melalui js/config.js.',true);const f=new FormData(e.currentTarget);const{error}=await db.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});if(error)return accountMessage('Login gagal. Periksa email, password, dan verifikasi email.',true);await refreshAccount();accountMessage('Berhasil masuk.');}
async function userRegister(e){e.preventDefault();if(!db)return accountMessage('Akun hanya dapat dibuat setelah Supabase terhubung.',true);const f=new FormData(e.currentTarget),username=String(f.get('username')).trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))return accountMessage('Username hanya huruf kecil, angka, dan underscore (3-24 karakter).',true);
 const {data,error}=await db.auth.signUp({email:String(f.get('email')).trim(),password:String(f.get('password')),options:{data:{username,display_name:String(f.get('name')).trim()}}});
 if(error)return accountMessage('Pendaftaran gagal: '+safeError(error),true);
 if(data.session)await refreshAccount();accountMessage('Pendaftaran diterima. Jika diminta, buka email Anda untuk verifikasi sebelum login.');}
async function myOrders(){if(!db||!user)return;const {data,error}=await db.from('orders').select('order_number,amount,status,payment_status,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(15);$('myOrders').innerHTML=error?'Gagal memuat riwayat.':(data?.length?data.map(o=>`<div class="order-row"><b>${esc(o.order_number)}</b> · ${fmt(o.amount)}<br>${esc(o.status)} / ${esc(o.payment_status)}<br><small>${dateText(o.created_at)}</small></div>`).join(''):'Belum ada pesanan online.');}
async function logout(){await markDeviceInactive(db);if(db)await db.auth.signOut();await refreshAccount();accountMessage('Berhasil keluar.');}
async function requestPasswordReset(){
 if(!db)return accountMessage('Konfigurasi Supabase belum tersedia.',true);
 const email=$('loginForm').elements.namedItem('email').value.trim();
 if(!email)return accountMessage('Masukkan alamat email akun Anda terlebih dahulu.',true);
 const redirectTo=new URL('./reset.html',location.href).href;
 const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo});
 accountMessage(error?'Tidak dapat mengirim email reset: '+safeError(error):'Jika email terdaftar, tautan reset akan dikirim. Periksa inbox dan spam.',!!error);
}
async function sendSupport(e){e.preventDefault();if(!db||!user)return toast('Anda harus login untuk mengirim tiket.');const f=new FormData(e.currentTarget);const payload={user_id:user.id,ticket_type:String(f.get('ticket_type')),order_number:String(f.get('order_number')||''),message:String(f.get('message')||'').trim()};
 const {error}=await db.from('support_tickets').insert(payload);
 if(error)return toast('Gagal mengirim: '+safeError(error));e.currentTarget.reset();toast('Tiket bantuan berhasil dikirim kepada admin.');
}
function setupEvents(){
 $('enterStore').onclick=()=>{$('intro').classList.add('hidden');document.body.classList.remove('lock');};
 document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
 document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);}));
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal:not(.hidden)').forEach(m=>closeModal(m.id));});
 $('accountButton').onclick=()=>showModal('accountModal');$('cartButton').onclick=openCart;
 $('productGrid').addEventListener('click',e=>{const b=e.target.closest('[data-product]');if(b){const p=products.find(x=>x.id===b.dataset.product);if(p)showVariants(p);}});
 $('variantSelect').onchange=updateVariantDetails;$('addCart').onclick=addCart;
 $('cartItems').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;let i=Number(b.dataset.minus??b.dataset.plus??b.dataset.remove);if(!Number.isInteger(i)||!cart[i])return;if('remove' in b.dataset)cart.splice(i,1);else if('plus' in b.dataset)cart[i].qty=Math.min(50,cart[i].qty+1);else if('minus' in b.dataset){cart[i].qty--;if(cart[i].qty<1)cart.splice(i,1);}saveCart();renderCart();});
 $('checkoutForm').onsubmit=checkout;$('loginForm').onsubmit=userLogin;$('registerForm').onsubmit=userRegister;
 $('showRegister').onclick=()=>{ $('loginForm').classList.add('hidden');$('registerForm').classList.remove('hidden');$('showRegister').classList.add('active');$('showLogin').classList.remove('active');};
 $('showLogin').onclick=()=>{ $('registerForm').classList.add('hidden');$('loginForm').classList.remove('hidden');$('showLogin').classList.add('active');$('showRegister').classList.remove('active');};
 $('logoutButton').onclick=logout;$('viewMyOrders').onclick=myOrders;$('resetPasswordRequest').onclick=requestPasswordReset;$('supportForm').onsubmit=sendSupport;
 $('productSearch').oninput=e=>{query=e.target.value.toLowerCase().trim();renderCatalog();};
 document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{filter=b.dataset.group;document.querySelectorAll('[data-group]').forEach(x=>x.classList.toggle('active',x===b));renderCatalog();});
 document.querySelectorAll('[data-poster]').forEach(b=>b.onclick=()=>{poster=b.dataset.poster;$('posterPanel').classList.remove('hidden');renderPoster();});
 $('closePoster').onclick=()=>{$('posterPanel').classList.toggle('hidden');$('posterDownload').classList.toggle('hidden',$('posterPanel').classList.contains('hidden'));};
 $('posterDownload').addEventListener('click',async e=>{const url=validUrl(e.currentTarget.href);if(!url)return;const u=new URL(url);if(u.origin===location.origin)return;e.preventDefault();try{const response=await fetch(url);if(!response.ok)throw Error('Unduhan gagal');const blob=await response.blob();const a=document.createElement('a'),src=URL.createObjectURL(blob);a.href=src;a.download=e.currentTarget.download;a.click();setTimeout(()=>URL.revokeObjectURL(src),3000);}catch{window.open(url,'_blank','noopener,noreferrer');toast('Jika unduhan tidak dimulai, simpan gambar dari tab yang terbuka.');}});
}
function subscribe(){if(!db)return;try{channel=db.channel('rd190-store-v2').on('postgres_changes',{event:'*',schema:'public',table:'products'},()=>loadCatalog()).on('postgres_changes',{event:'*',schema:'public',table:'product_variants'},()=>loadCatalog()).on('postgres_changes',{event:'*',schema:'public',table:'store_assets'},()=>loadPosters()).subscribe();}catch(e){console.warn('Realtime unavailable',e);}setInterval(()=>{if(document.visibilityState==='visible'){loadCatalog();loadPosters();}},60000);}
async function init(){setupEvents();saveCart();renderPoster();if(!sessionStorage.getItem('rd190-intro-seen')){$('intro').classList.remove('hidden');document.body.classList.add('lock');sessionStorage.setItem('rd190-intro-seen','1');}
 try{db=getDb();}catch(e){toast(safeError(e));}
 await loadCatalog();if(db){await loadPosters();await refreshAccount();db.auth.onAuthStateChange(()=>setTimeout(()=>refreshAccount().catch(console.warn),0));subscribe();}
 else{$('catalogStatus').title='Untuk mode online, isi js/config.js menggunakan URL dan public key Supabase yang baru.';}
}
init().catch(e=>{console.error(e);toast('Kesalahan awal: '+safeError(e));});
