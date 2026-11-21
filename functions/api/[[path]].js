const enc = new TextEncoder();
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8', ...headers}});
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const random = n => { const a=new Uint8Array(n); crypto.getRandomValues(a); return a; };
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
function cookies(req){return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}))}
async function hmac(secret, value){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(await crypto.subtle.sign('HMAC',key,enc.encode(value)));}
async function signedToken(secret, payload){const body=b64u(enc.encode(JSON.stringify(payload)));return body+'.'+await hmac(secret,body)}
async function verifyToken(secret, token){try{const [body,sig]=token.split('.');if(!body||!sig||await hmac(secret,body)!==sig)return null;return JSON.parse(new TextDecoder().decode(unb64u(body)))}catch{return null}}
async function getSession(req,env){const c=cookies(req);const p=await verifyToken(env.AUTH_SECRET||'',c.dl_session||'');return p&&p.steamid&&p.exp>Date.now()?p:null}
async function isAdmin(req,env){const session=await getSession(req,env);if(!session)return false;const ids=String(env.STEAM_ADMIN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);return ids.includes(session.steamid)}
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function steamIdFromClaimed(value){const m=String(value||'').match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/);return m?m[1]:null}
async function currentUser(req,env){const session=await getSession(req,env);if(!session)return null;return await env.DB.prepare('SELECT steamid,discord_id,discord_username,discord_avatar,created,updated FROM users WHERE steamid=?').bind(session.steamid).first()}
async function hasUnlock(req,env,id){const c=cookies(req);const p=await verifyToken(env.AUTH_SECRET||'',c['dl_unlock_'+id]||'');return !!p&&p.id===id&&p.exp>Date.now()}
async function hashPassword(password,saltHex){const salt=saltHex?Uint8Array.from(saltHex.match(/../g).map(x=>parseInt(x,16))):random(16);const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},key,256);return {salt:hex(salt),hash:hex(bits)}}
async function getProject(env,id){return await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first()}
async function getImages(env,id){const {results=[]}=await env.DB.prepare('SELECT id,name,content_type FROM images WHERE project_id=? ORDER BY rowid').bind(id).all();return results.map(x=>({...x,url:'/api/images/'+x.id}))}
function safeProject(p,images=[]){return {id:p.id,title:p.title,description:p.description,notes:p.notes,category:p.category,version:p.version,status:p.status,priority:p.priority,tags:JSON.parse(p.tags||'[]'),visibility:p.visibility,created:p.created,updated:p.updated,images}}
async function canRead(req,env,p){return p.visibility==='public'||await isAdmin(req,env)||await hasUnlock(req,env,p.id)}
async function handler({request,env}){
 if(!env.DB||!env.IMAGES||!env.AUTH_SECRET)return json({error:'Server is not configured. Check D1, R2 and AUTH_SECRET.'},503);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean),method=request.method;
 if(path[0]==='auth'&&path[1]==='steam'&&method==='GET'){
  const state=b64u(random(24)),origin=url.origin,returnTo=origin+'/api/auth/steam/callback?state='+encodeURIComponent(state);
  const target=new URL('https://steamcommunity.com/openid/login');
  for(const [k,v] of Object.entries({'openid.ns':'http://specs.openid.net/auth/2.0','openid.mode':'checkid_setup','openid.return_to':returnTo,'openid.realm':origin+'/','openid.identity':'http://specs.openid.net/auth/2.0/identifier_select','openid.claimed_id':'http://specs.openid.net/auth/2.0/identifier_select'}))target.searchParams.set(k,v);
  const stateToken=await signedToken(env.AUTH_SECRET,{state,exp:Date.now()+10*60*1000});
  return new Response(null,{status:302,headers:{location:target.toString(),'set-cookie':cookie('dl_steam_state',stateToken,600)}});
 }
 if(path[0]==='auth'&&path[1]==='steam'&&path[2]==='callback'&&method==='GET'){
  const stateCookie=await verifyToken(env.AUTH_SECRET,cookies(request).dl_steam_state||''),state=url.searchParams.get('state');
  if(!stateCookie||!state||stateCookie.state!==state||stateCookie.exp<Date.now())return new Response('Steam login state validation failed',{status:401,headers:{'set-cookie':cookie('dl_steam_state','',0)}});
  const claimed=url.searchParams.get('openid.claimed_id'),steamid=steamIdFromClaimed(claimed);
  if(!steamid||url.searchParams.get('openid.mode')!=='id_res')return new Response('Steam authentication failed', {status:401});
  const returnTo=url.origin+'/api/auth/steam/callback?state='+encodeURIComponent(state);if(url.searchParams.get('openid.return_to')!==returnTo||url.searchParams.get('openid.op_endpoint')!=='https://steamcommunity.com/openid/login')return new Response('Invalid Steam return URL',{status:400});
  const nonce=url.searchParams.get('openid.response_nonce')||'',nonceTime=Date.parse(nonce.slice(0,20));if(!nonce||!Number.isFinite(nonceTime)||Math.abs(Date.now()-nonceTime)>5*60*1000)return new Response('Expired Steam login response',{status:401});
  try{await env.DB.prepare('INSERT INTO steam_nonces(nonce,created) VALUES(?,?)').bind(nonce,Date.now()).run()}catch{return new Response('Steam login response already used',{status:401})}
  const verify=new URLSearchParams(url.searchParams);verify.set('openid.mode','check_authentication');
  const checked=await fetch('https://steamcommunity.com/openid/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:verify.toString()});const verifyText=await checked.text();
  if(!checked.ok||!verifyText.includes('is_valid:true'))return new Response('Steam identity could not be verified',{status:401});
  const now=Date.now();await env.DB.prepare('INSERT INTO users(steamid,created,updated) VALUES(?,?,?) ON CONFLICT(steamid) DO UPDATE SET updated=excluded.updated').bind(steamid,now,now).run();
  const token=await signedToken(env.AUTH_SECRET,{steamid,exp:now+30*86400000});return new Response(null,{status:302,headers:{location:url.origin+'/','set-cookie':[cookie('dl_session',token,2592000),cookie('dl_steam_state','',0)]}});
 }
 if(path[0]==='auth'&&path[1]==='discord'&&method==='GET'){
  const session=await getSession(request,env);if(!session)return json({error:'Сначала войди через Steam'},401);
  if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET)return json({error:'Настрой DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET в Cloudflare'},503);
  const state=b64u(random(24)),redirectUri=url.origin+'/api/auth/discord/callback';const target=new URL('https://discord.com/oauth2/authorize');
  for(const [k,v] of Object.entries({client_id:env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:redirectUri,scope:'identify',state}))target.searchParams.set(k,v);
  return new Response(null,{status:302,headers:{location:target.toString(),'set-cookie':cookie('dl_discord_state',await signedToken(env.AUTH_SECRET,{state,steamid:session.steamid,exp:Date.now()+600000}),600)}});
 }
 if(path[0]==='auth'&&path[1]==='discord'&&path[2]==='callback'&&method==='GET'){
  const stateCookie=await verifyToken(env.AUTH_SECRET,cookies(request).dl_discord_state||''),session=await getSession(request,env),code=url.searchParams.get('code');
  if(!session||!stateCookie||stateCookie.steamid!==session.steamid||stateCookie.state!==url.searchParams.get('state')||stateCookie.exp<Date.now()||!code)return new Response('Discord link authorization failed',{status:400});
  const redirectUri=url.origin+'/api/auth/discord/callback';const tokenRes=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:redirectUri})});
  const tokenData=await tokenRes.json();if(!tokenRes.ok||!tokenData.access_token)return new Response('Discord token exchange failed',{status:401});
  const userRes=await fetch('https://discord.com/api/users/@me',{headers:{authorization:`Bearer ${tokenData.access_token}`}});const discord=await userRes.json();if(!userRes.ok||!discord.id)return new Response('Could not read Discord profile',{status:401});
  const avatar=discord.avatar?`https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.png?size=128`:null;
  try{await env.DB.prepare('UPDATE users SET discord_id=?,discord_username=?,discord_avatar=?,updated=? WHERE steamid=?').bind(discord.id,discord.global_name||discord.username,avatar,Date.now(),session.steamid).run()}catch{return new Response('Этот Discord уже привязан к другому Steam-аккаунту',{status:409})};
  return new Response(null,{status:302,headers:{location:url.origin+'/?profile=1&discord=linked','set-cookie':cookie('dl_discord_state','',0)}});
 }
 if(path[0]==='discord'&&path[1]==='unlink'&&method==='POST'){
  const session=await getSession(request,env);if(!session)return json({error:'Требуется вход через Steam'},401);
  await env.DB.prepare('UPDATE users SET discord_id=NULL,discord_username=NULL,discord_avatar=NULL,updated=? WHERE steamid=?').bind(Date.now(),session.steamid).run();return json({ok:true});
 }
 if(path[0]==='logout'&&method==='POST')return json({ok:true},200,{'set-cookie':cookie('dl_session','',0)});
 if(path[0]==='me'&&method==='GET'){
  const user=await currentUser(request,env);return json({authenticated:!!user,admin:await isAdmin(request,env),user});
 }
 if(path[0]==='projects'&&method==='GET'){
  const admin=await isAdmin(request,env);const {results=[]}=await env.DB.prepare(admin?'SELECT * FROM projects ORDER BY updated DESC':'SELECT * FROM projects WHERE visibility=\'public\' ORDER BY updated DESC').all();
  const out=[];for(const p of results)out.push(safeProject(p,await getImages(env,p.id)));return json({projects:out,admin});
 }
 if(path[0]==='projects'&&path.length===2&&method==='GET'){
  const p=await getProject(env,path[1]);if(!p)return json({error:'Проект не найден'},404);
  if(!await canRead(request,env,p))return json({error:'Для просмотра нужен пароль',locked:true},401);
  return json({project:safeProject(p,await getImages(env,p.id))});
 }
 if(path[0]==='projects'&&path.length===3&&path[2]==='unlock'&&method==='POST'){
  const id=path[1],p=await getProject(env,id);if(!p)return json({error:'Проект не найден'},404);if(p.visibility==='public'||await isAdmin(request,env))return json({ok:true});
  const body=await request.json().catch(()=>({}));const test=await hashPassword(String(body.password||''),p.password_salt);
  if(test.hash!==p.password_hash)return json({error:'Неверный пароль'},401);
  const token=await signedToken(env.AUTH_SECRET,{id,exp:Date.now()+12*3600000});
  return json({ok:true},200,{'set-cookie':`dl_unlock_${id}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`});
 }
 if(path[0]==='images'&&path.length===2&&method==='GET'){
  const row=await env.DB.prepare('SELECT project_id,object_key,content_type FROM images WHERE id=?').bind(path[1]).first();if(!row)return new Response('Not found',{status:404});
  const p=await getProject(env,row.project_id);if(!p||!await canRead(request,env,p))return new Response('Forbidden',{status:403});
  const obj=await env.IMAGES.get(row.object_key);if(!obj)return new Response('Not found',{status:404});
  return new Response(obj.body,{headers:{'content-type':row.content_type,'cache-control':'private, max-age=3600','x-content-type-options':'nosniff'}});
 }
 if(path[0]==='projects'&&(method==='POST'||method==='PUT'||method==='DELETE')){
  if(!await isAdmin(request,env))return json({error:'Требуется вход администратора'},403);
  const id=path[1]||crypto.randomUUID();
  if(method==='DELETE'){
   const {results=[]}=await env.DB.prepare('SELECT object_key FROM images WHERE project_id=?').bind(id).all();for(const x of results)await env.IMAGES.delete(x.object_key);
   await env.DB.prepare('DELETE FROM images WHERE project_id=?').bind(id).run();await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();return json({ok:true});
  }
  const body=await request.json();const old=method==='PUT'?await getProject(env,id):null;if(method==='PUT'&&!old)return json({error:'Проект не найден'},404);
  const title=String(body.title||'').trim();if(!title)return json({error:'Укажи название проекта'},400);
  const visibility=body.visibility==='private'?'private':'public';let salt=old?.password_salt||null,pwh=old?.password_hash||null;
  if(visibility==='private'&&body.password){const h=await hashPassword(String(body.password));salt=h.salt;pwh=h.hash;}
  if(visibility==='private'&&!pwh)return json({error:'Для приватного проекта задай пароль'},400);
  if(visibility==='public'){salt=null;pwh=null;}
  const now=Date.now(),created=old?.created||now;
  const values=[title,String(body.description||''),String(body.notes||''),String(body.category||'DAYZ MOD'),String(body.version||''),String(body.status||'idea'),String(body.priority||'medium'),JSON.stringify(Array.isArray(body.tags)?body.tags:[]),visibility,salt,pwh,created,now,id];
  await env.DB.prepare(`INSERT INTO projects(title,description,notes,category,version,status,priority,tags,visibility,password_salt,password_hash,created,updated,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,notes=excluded.notes,category=excluded.category,version=excluded.version,status=excluded.status,priority=excluded.priority,tags=excluded.tags,visibility=excluded.visibility,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated=excluded.updated`).bind(...values).run();
  if(Array.isArray(body.images)){
   const oldRows=await env.DB.prepare('SELECT object_key FROM images WHERE project_id=?').bind(id).all();for(const x of oldRows.results||[])await env.IMAGES.delete(x.object_key);await env.DB.prepare('DELETE FROM images WHERE project_id=?').bind(id).run();
   for(const img of body.images.slice(0,20)){
    if(!img||typeof img.data!=='string'||!img.data.startsWith('data:image/'))continue;const m=img.data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);if(!m)continue;
    const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));if(bytes.length>8*1024*1024)continue;
    const imageId=crypto.randomUUID(),key=`${id}/${imageId}`;await env.IMAGES.put(key,bytes,{httpMetadata:{contentType:m[1]}});
    await env.DB.prepare('INSERT INTO images(id,project_id,object_key,name,content_type) VALUES(?,?,?,?,?)').bind(imageId,id,key,String(img.name||''),m[1]).run();
   }
  }
  const p=await getProject(env,id);return json({project:safeProject(p,await getImages(env,id))});
 }
 return json({error:'Not found'},404);
}
export async function onRequest(context){try{return await handler(context)}catch(e){return json({error:'Внутренняя ошибка сервера',detail:String(e?.message||e)},500)}}
