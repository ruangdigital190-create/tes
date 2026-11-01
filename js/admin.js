import {CONFIG,$,fmt,esc,validUrl,getDb,isConfigured,toast,showModal,closeModal,dateText,startDeviceTracking,markDeviceInactive,safeError} from './shared.js';
let db=null,me=null,profile=null,products=[],variants=[],orders=[],users=[],devices=[],assets=[],tickets=[],audit=[],activeTab='overview';
const fail=id=>msg=>{const el=$(id);if(el){el.textContent=msg;el.classList.remove('hidden');}};
const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="muted">Belum ada data.</td></tr>`}</tbody></table>`;
const check=({data,error})=>{if(error)throw error;return data||[];};
const yes=v=>v?'Aktif':'Nonaktif';
const boolean=v=>v==='true';
const optionalNumber=v=>String(v??'').trim()===''?null:Number(v);
const option=(value,label,selected)=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`;
function statusOptions(items,current){return items.map(x=>option(x,x,current)).join('');}
function selectTab(tab){activeTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.admin-section').forEach(s=>s.classList.toggle('hidden',s.id!=='tab-'+tab));}
async function ensureAdmin(){
 const {data:{user},error}=await db.auth.getUser();if(error || !user){me=null;profile=null;return false;}
 const {data:p,error:pError}=await db.from('profiles').select('id,username,display_name,role').eq('id',user.id).maybeSingle();
 if(pError)throw pError;
 if(p?.role!=='admin'){await db.auth.signOut();me=null;profile=null;fail('adminLoginMessage')('Akun ini bukan administrator. Daftar sebagai pelanggan dulu, lalu jalankan SQL 03-activate-admin.sql di project Supabase Anda.');return false;}
 me=user;profile=p;await startDeviceTracking(db,user.id);return true;
}
function showAuth(){ $('adminLoginView').classList.remove('hidden');$('adminDashboard').classList.add('hidden');$('adminLogout').classList.add('hidden');$('adminIdentity').textContent='Belum login';}
async function showDashboard(){if(!(await ensureAdmin())){showAuth();return;} $('adminLoginView').classList.add('hidden');$('adminDashboard').classList.remove('hidden');$('adminLogout').classList.remove('hidden');$('adminIdentity').textContent='@'+profile.username;selectTab(activeTab);await refreshAll();}
async function login(e){e.preventDefault();const btn=$('adminLoginButton');btn.disabled=true;btn.textContent='Memeriksa akun…';$('adminLoginMessage').classList.add('hidden');
 try{
  if(!db)throw Error('Supabase belum dikonfigurasi di js/config.js.');
  const username=$('adminUsername').value.trim().toLowerCase(),password=$('adminPassword').value;
  if(!/^[a-z0-9_]{3,24}$/.test(username))throw Error('Username tidak valid.');
  const {data:email,error:lookupError}=await db.rpc('resolve_admin_login',{p_username:username});if(lookupError)throw new Error('Database belum siap. Jalankan sql/01-schema.sql terlebih dahulu.');
  if(!email)throw new Error('Username atau password tidak sesuai, atau akun belum diberi role admin.');
  const {error:authError}=await db.auth.signInWithPassword({email,password});if(authError)throw new Error('Username atau password tidak sesuai, atau email belum terverifikasi.');
  if(!(await ensureAdmin()))throw new Error('Akses hanya untuk administrator.');
  $('adminPassword').value='';await showDashboard();toast('Berhasil masuk sebagai administrator.');
 }catch(err){console.error('admin auth:',err);fail('adminLoginMessage')(safeError(err));}
 finally{btn.disabled=false;btn.textContent='Masuk ke Dashboard →';}
}
async function logout(){await markDeviceInactive(db);await db.auth.signOut();me=null;profile=null;showAuth();toast('Anda telah keluar dari dashboard.');}
async function refreshAll(){
 if(!db || !me)return;
 try{
  const [p,v,o,u,d,a,t,l]=await Promise.all([
   db.from('products').select('*').order('sort_order'),
   db.from('product_variants').select('*').order('sort_order'),
   db.from('orders').select('*,order_items(product_name,variant_name,quantity,price)').order('created_at',{ascending:false}).limit(200),
   db.from('profiles').select('id,username,display_name,email,phone,role,created_at').order('created_at',{ascending:false}).limit(1000),
   db.from('device_sessions').select('*').order('last_seen',{ascending:false}).limit(500),
   db.from('store_assets').select('*'),
   db.from('support_tickets').select('*').order('created_at',{ascending:false}).limit(200),
   db.from('audit_logs').select('*').order('changed_at',{ascending:false}).limit(150)
  ]);
  products=check(p);variants=check(v);orders=check(o);users=check(u);devices=check(d);assets=check(a);tickets=check(t);audit=check(l);
  renderAll();
 }catch(e){console.error(e);toast('Gagal memuat dashboard: '+safeError(e));}
}
function renderOverview(){ $('sProducts').textContent=products.filter(p=>p.is_active).length;$('sVariants').textContent=variants.length;$('sUsers').textContent=users.length;$('sOrders').textContent=orders.length;
 $('overviewLatest').innerHTML=orders.slice(0,4).map(o=>`<div class="order-row"><b>${esc(o.order_number)}</b> · ${esc(o.customer_name)} · ${fmt(o.amount)} · ${esc(o.status)}</div>`).join('')||'<p class="muted">Belum ada pesanan.</p>';}
function renderProducts(){const q=$('adminProductSearch').value.trim().toLowerCase();const matches=products.filter(p=>[p.title,p.brand,p.category].some(x=>String(x||'').toLowerCase().includes(q)));
 $('productTable').innerHTML=table(['Gambar','Nama','Kategori','Status','Varian','Tindakan'],matches.map(p=>`<tr><td>${validUrl(p.image_url)?`<img class="tablethumb" src="${esc(validUrl(p.image_url))}" alt="">`:'📦'}</td><td><b>${esc(p.title)}</b><br><small>${esc(p.id)}</small></td><td>${esc(p.category)}</td><td><span class="tag ${p.is_active?'ok':''}">${yes(p.is_active)}</span></td><td>${variants.filter(v=>v.product_id===p.id).length}</td><td><div class="tools"><button class="btn secondary" data-edit-product="${esc(p.id)}">Edit</button><button class="btn red" data-delete-product="${esc(p.id)}">Hapus</button></div></td></tr>`).join(''));}
function renderVariants(){const id=$('variantProductFilter').value;
 const select=$('variantProductFilter');select.innerHTML='<option value="all">Semua produk</option>'+products.map(p=>option(p.id,p.title,id)).join('');select.value=(id==='all'||products.some(p=>p.id===id))?id:'all';
 const matches=variants.filter(v=>select.value==='all'||v.product_id===select.value);$('variantTable').innerHTML=table(['Produk','Paket','Harga','Stok','Status','Tindakan'],matches.map(v=>`<tr><td>${esc(products.find(p=>p.id===v.product_id)?.title||v.product_id)}</td><td><b>${esc(v.name)}</b><br><small>${esc(v.note||'')}</small></td><td>${fmt(v.price)}</td><td>${esc(({available:'Tersedia',limited:'Terbatas',out_of_stock:'Habis',confirm:'Konfirmasi'}[v.stock_status]||v.stock_status))}</td><td>${yes(v.is_active)}</td><td><div class="tools"><button class="btn secondary" data-edit-variant="${esc(v.id)}">Edit</button><button class="btn red" data-delete-variant="${esc(v.id)}">Hapus</button></div></td></tr>`).join(''));}
function renderPosters(){const names={mlbb:'Mobile Legends (MLBB)',freefire:'Free Fire'};
 $('posterAdmin').innerHTML=Object.keys(names).map(slug=>{const a=assets.find(x=>x.slug===slug),url=a?.image_url||'./assets/'+(slug==='mlbb'?'mlbb-price-list.webp':'freefire-price-list.webp');return `<div class="info-box" style="margin-bottom:13px"><h3>${esc(names[slug])}</h3><img loading="lazy" src="${esc(validUrl(url))}" style="width:min(220px,100%);height:auto;border-radius:10px;display:block;margin:12px 0" alt="Poster ${esc(slug)}"><label class="field">Pilih file gambar baru<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-poster-file="${slug}"></label><button class="btn" data-upload-poster="${slug}" type="button">Upload & Simpan Poster</button></div>`;}).join('');}
function renderOrders(){$('orderTable').innerHTML=table(['Invoice','Pemesan','Items','Total','Status pesanan','Pembayaran','Admin'],orders.map(o=>`<tr><td><b>${esc(o.order_number)}</b><br>${dateText(o.created_at)}</td><td>${esc(o.customer_name)}<br><small>${esc(o.phone)}</small><br><small>ID: ${esc(o.player_id||'-')} / ${esc(o.zone_id||'-')}</small></td><td>${(o.order_items||[]).map(i=>`${esc(i.product_name)} · ${esc(i.variant_name)} ×${i.quantity}`).join('<br>')}</td><td>${fmt(o.amount)}${o.quote_required?' (perlu penawaran)':''}</td><td><select class="order-field" data-order-status="${o.id}">${statusOptions(['new','processing','completed','cancelled'],o.status)}</select></td><td><select class="order-field" data-payment-status="${o.id}">${statusOptions(['unpaid','pending','paid','refunded'],o.payment_status)}</select></td><td><input class="order-field" data-order-note="${o.id}" value="${esc(o.admin_note||'')}" placeholder="Catatan"><button class="btn small" data-save-order="${o.id}" type="button">Simpan</button></td></tr>`).join(''));}
function renderUsers(){$('usersTable').innerHTML=table(['Username','Nama','Email','WhatsApp','Role','Terdaftar'],users.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone||'-')}</td><td>${esc(u.role)}</td><td>${dateText(u.created_at)}</td></tr>`).join(''));}
function renderDevices(){const now=Date.now(),on=d=>d.is_active&&(now-new Date(d.last_seen).getTime())<180000;$('sOnline').textContent=devices.filter(on).length;$('sSessions').textContent=devices.length;
 $('devicesTable').innerHTML=table(['Username','Jenis Perangkat','Status','Mulai','Terakhir'],devices.map(d=>`<tr><td>${esc(users.find(u=>u.id===d.user_id)?.username||'akun')}</td><td>${esc(d.device_label)}</td><td><span class="tag ${on(d)?'ok':''}">${on(d)?'Online':'Offline'}</span></td><td>${dateText(d.started_at)}</td><td>${dateText(d.last_seen)}</td></tr>`).join(''));}
function renderTickets(){$('ticketsTable').innerHTML=table(['Tipe','Pengguna','Pesanan','Pertanyaan','Status','Balasan'],tickets.map(t=>`<tr><td>${esc(t.ticket_type)}</td><td>${esc(users.find(x=>x.id===t.user_id)?.username||t.user_id)}</td><td>${esc(t.order_number||'-')}</td><td>${esc(t.message)}</td><td><select data-ticket-status="${t.id}">${statusOptions(['new','processing','closed'],t.status)}</select></td><td><textarea data-ticket-reply="${t.id}" rows="2">${esc(t.admin_reply||'')}</textarea><button type="button" class="btn small" data-save-ticket="${t.id}">Simpan</button></td></tr>`).join(''));}
function renderAudit(){$('auditTable').innerHTML=table(['Waktu','Tabel','Aksi','ID'],audit.map(a=>`<tr><td>${dateText(a.changed_at)}</td><td>${esc(a.table_name)}</td><td>${esc(a.action)}</td><td>${esc(a.row_id||'-')}</td></tr>`).join(''));}
function renderAll(){renderOverview();renderProducts();renderVariants();renderPosters();renderOrders();renderUsers();renderDevices();renderTickets();renderAudit();}
function clearForm(form){form.reset();}
function productEditor(id=null){const p=products.find(p=>p.id===id);const form=$('adminProductForm');clearForm(form);$('editProductMessage').classList.add('hidden');$('editProductId').value=p?.id||'';$('editProductSlug').disabled=!!p;$('editProductSlug').value=p?.id||'';
 if(p)for(const [k,v] of Object.entries(p)){const control=form.elements.namedItem(k);if(control&&k!=='editingId'&&k!=='imageFile')control.value=String(v??'');}
 else {form.elements.namedItem('sort_order').value=products.length+1;form.elements.namedItem('is_active').value='true';}
 $('productEditorTitle').textContent=p?'Edit '+p.title:'Tambah Produk Baru';if(validUrl(p?.image_url)){$('productPreview').src=p.image_url;$('productPreview').classList.remove('hidden');}else $('productPreview').classList.add('hidden');showModal('adminProductModal');}
function variantEditor(id=null){const v=variants.find(v=>v.id===id);const form=$('adminVariantForm');clearForm(form);$('editVariantMessage').classList.add('hidden');$('editVariantId').value=v?.id||'';
 $('editVariantProduct').innerHTML=products.map(p=>option(p.id,p.title,v?.product_id||'')).join('');
 if(v)for(const [k,value] of Object.entries(v)){const c=form.elements.namedItem(k);if(c&&k!=='editingId')c.value=String(value??'');}
 else{form.elements.namedItem('sort_order').value=variants.length+1;form.elements.namedItem('stock_status').value='confirm';}
 $('variantEditorTitle').textContent=v?'Edit Paket':'Tambah Varian';showModal('adminVariantModal');}
async function uploadImage(file,directory){if(!file)return null;if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type))throw Error('Format gambar tidak didukung.');if(file.size>5*1024*1024)throw Error('Ukuran gambar maksimal 5 MB.');const ext=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'})[file.type];const name=directory+'/'+crypto.randomUUID()+'.'+ext;
 const {error}=await db.storage.from('rd190-images').upload(name,file,{contentType:file.type,upsert:false});if(error)throw error;
 return db.storage.from('rd190-images').getPublicUrl(name).data.publicUrl;
}
async function saveProduct(e){e.preventDefault();const form=e.currentTarget,btn=form.querySelector('[type=submit]');btn.disabled=true;const f=new FormData(form),existingId=String(f.get('editingId')||'').trim(),id=existingId||String(f.get('id')||'').trim().toLowerCase();
 try{
  if(!/^[a-z0-9][a-z0-9_-]{2,59}$/.test(id))throw Error('ID produk harus 3–60 karakter huruf kecil, angka, dash, underscore.');
  const file=f.get('imageFile');let image=String(f.get('image_url')||'').trim()||null;
  if(file instanceof File&&file.size)image=await uploadImage(file,'products');
  if(image&&!validUrl(image))throw Error('URL gambar tidak valid.');
  const payload={id,title:String(f.get('title')).trim(),brand:String(f.get('brand')).trim(),group_name:f.get('group_name'),category:String(f.get('category')).trim(),tag:String(f.get('tag')||''),short_description:String(f.get('short_description')||''),description:String(f.get('description')||''),info:String(f.get('info')||''),image_url:image,sort_order:Number(f.get('sort_order')||0),is_active:boolean(f.get('is_active'))};
  const res=existingId?await db.from('products').update(payload).eq('id',existingId):await db.from('products').insert(payload);if(res.error)throw res.error;
  closeModal('adminProductModal');toast('Produk berhasil disimpan.');await refreshAll();
 }catch(err){fail('editProductMessage')(safeError(err));}finally{btn.disabled=false;}
}
async function saveVariant(e){e.preventDefault();const f=new FormData(e.currentTarget),id=String(f.get('editingId')||''),btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
 try{
  const payload={product_id:String(f.get('product_id')),name:String(f.get('name')).trim(),price:optionalNumber(f.get('price')),original_price:optionalNumber(f.get('original_price')),stock_status:String(f.get('stock_status')),stock_quantity:optionalNumber(f.get('stock_quantity')),discount_enabled:boolean(f.get('discount_enabled')),is_active:boolean(f.get('is_active')),note:String(f.get('note')||''),sort_order:Number(f.get('sort_order')||0)};
  if(!payload.name)throw Error('Nama varian wajib diisi.');
  const result=id?await db.from('product_variants').update(payload).eq('id',id):await db.from('product_variants').insert(payload);if(result.error)throw result.error;closeModal('adminVariantModal');toast('Varian tersimpan.');await refreshAll();
 }catch(err){fail('editVariantMessage')(safeError(err));}finally{btn.disabled=false;}
}
async function deleteEntity(table,id,what){if(!confirm(`Yakin ingin menghapus ${what}? Pesanan lama tetap menyimpan nama dan harga saat transaksi.`))return;const{error}=await db.from(table).delete().eq('id',id);if(error)toast('Gagal menghapus: '+safeError(error));else{toast('Data dihapus.');await refreshAll();}}
async function uploadPoster(slug){const input=document.querySelector(`[data-poster-file="${slug}"]`),file=input?.files?.[0];if(!file)return toast('Pilih file poster terlebih dahulu.');try{const url=await uploadImage(file,'posters');const title=slug==='mlbb'?'Price List Mobile Legends':'Price List Free Fire';const{error}=await db.from('store_assets').upsert({slug,title,image_url:url,updated_at:new Date().toISOString()},{onConflict:'slug'});if(error)throw error;toast('Price list tersimpan dan akan tampil di toko.');await refreshAll();}catch(e){toast('Gagal unggah poster: '+safeError(e));}}
async function saveOrder(id){const status=document.querySelector(`[data-order-status="${id}"]`)?.value,payment_status=document.querySelector(`[data-payment-status="${id}"]`)?.value,admin_note=document.querySelector(`[data-order-note="${id}"]`)?.value||'';
 if(payment_status==='paid'&&!confirm('Pastikan pembayaran telah benar-benar diterima. Tandai pesanan sebagai paid?'))return;
 const{error}=await db.from('orders').update({status,payment_status,admin_note}).eq('id',id);if(error)toast(safeError(error));else{toast('Pesanan tersimpan.');await refreshAll();}}
async function saveTicket(id){const status=document.querySelector(`[data-ticket-status="${id}"]`)?.value,admin_reply=document.querySelector(`[data-ticket-reply="${id}"]`)?.value||'';const{error}=await db.from('support_tickets').update({status,admin_reply}).eq('id',id);if(error)toast(safeError(error));else{toast('Balasan tersimpan.');await refreshAll();}}
function exportCSV(){const cols=['username','display_name','email','phone','role','created_at'];const csv=[cols.join(','),...users.map(u=>cols.map(k=>'"'+String(u[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='RUANGDIGITAL190-pengguna.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function bindEvents(){
 $('adminLoginForm').onsubmit=login;$('adminLogout').onclick=logout;$('refreshAdmin').onclick=refreshAll;
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
 document.querySelectorAll('.modal').forEach(m=>m.onclick=e=>{if(e.target===m)closeModal(m.id);});
 $('newProduct').onclick=()=>productEditor();$('newVariant').onclick=()=>variantEditor();$('adminProductForm').onsubmit=saveProduct;$('adminVariantForm').onsubmit=saveVariant;
 $('adminProductSearch').oninput=renderProducts;$('variantProductFilter').onchange=renderVariants;$('exportUsers').onclick=exportCSV;
 $('productTable').onclick=e=>{const edit=e.target.closest('[data-edit-product]'),del=e.target.closest('[data-delete-product]');if(edit)productEditor(edit.dataset.editProduct);if(del)deleteEntity('products',del.dataset.deleteProduct,'produk ini');};
 $('variantTable').onclick=e=>{const edit=e.target.closest('[data-edit-variant]'),del=e.target.closest('[data-delete-variant]');if(edit)variantEditor(edit.dataset.editVariant);if(del)deleteEntity('product_variants',del.dataset.deleteVariant,'varian ini');};
 $('posterAdmin').onclick=e=>{const b=e.target.closest('[data-upload-poster]');if(b)uploadPoster(b.dataset.uploadPoster);};
 $('orderTable').onclick=e=>{const b=e.target.closest('[data-save-order]');if(b)saveOrder(b.dataset.saveOrder);};
 $('ticketsTable').onclick=e=>{const b=e.target.closest('[data-save-ticket]');if(b)saveTicket(b.dataset.saveTicket);};
 $('adminProductForm').elements.namedItem('imageFile').onchange=e=>{const f=e.target.files?.[0];if(f){$('productPreview').src=URL.createObjectURL(f);$('productPreview').classList.remove('hidden');}};
}
async function init(){bindEvents();try{db=getDb();}catch(e){fail('adminLoginMessage')(safeError(e));}
 if(!db){$('adminBackendStatus').textContent='Belum terhubung. Isi URL dan public key Supabase baru di js/config.js, upload ke GitHub, lalu refresh.';$('adminBackendStatus').classList.add('error');return;}
 $('adminBackendStatus').textContent='Koneksi Supabase terkonfigurasi. Silakan login dengan akun administrator.';
 try{await showDashboard();}catch(e){console.error(e);showAuth();fail('adminLoginMessage')('Gagal memuat akun admin: '+safeError(e));}
 db.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){me=null;profile=null;showAuth();}});
 setInterval(()=>{if(me&&document.visibilityState==='visible')refreshAll();},60000);
}
init();
