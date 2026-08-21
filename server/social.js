const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const router = express.Router();
const dataDir = process.env.LUNARCORD_DATA_DIR || path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'lunarcord.json');
const jwtSecret = process.env.LUNARCORD_JWT_SECRET || 'troque-esta-chave-antes-de-publicar';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

async function readDb() {
  if (pool) {
    await pool.query('CREATE TABLE IF NOT EXISTS lunarcord_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL)');
    const result = await pool.query('SELECT data FROM lunarcord_state WHERE id = 1');
    return result.rows[0]?.data || { users: [], servers: [] };
  }
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) return { users: [], servers: [] };
  try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { return { users: [], servers: [] }; }
}
async function writeDb(db) {
  if (pool) { await pool.query('INSERT INTO lunarcord_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [JSON.stringify(db)]); return; }
  fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}
function id() { return crypto.randomUUID(); }
function publicUser(user) { return { id: user.id, username: user.username, email: user.email, verified: user.verified }; }
function tokenFor(user) { return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' }); }
function auth(req, res, next) {
  try { req.userId = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), jwtSecret).sub; next(); }
  catch { res.status(401).json({ error: 'Faça login novamente.' }); }
}
async function sendCode(email, code) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) { console.log(`[Lunarcord] Código de ${email}: ${code}`); return false; }
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await transport.sendMail({ from: SMTP_FROM || SMTP_USER, to: email, subject: 'Código de verificação do Lunarcord', text: `Seu código de verificação é ${code}. Ele expira em 15 minutos.` });
  return true;
}

router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().slice(0, 24);
  const password = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || username.length < 2 || password.length < 8) return res.status(400).json({ error: 'Use e-mail válido, nome com 2 caracteres e senha com 8 ou mais.' });
  const db = await readDb(); if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.users.push({ id: id(), email, username, passwordHash: await bcrypt.hash(password, 12), verified: false, verificationCode: code, codeExpires: Date.now() + 15 * 60_000, friends: [], requests: [] }); await writeDb(db);
  const sent = await sendCode(email, code).catch(() => false);
  res.json({ ok: true, emailSent: sent, developmentCode: sent ? undefined : code });
});

router.post('/verify', async (req, res) => {
  const email=String(req.body.email||'').toLowerCase(), code=String(req.body.code||''); const db=await readDb(); const user=db.users.find(u=>u.email===email);
  if (!user || user.verificationCode !== code || user.codeExpires < Date.now()) return res.status(400).json({ error: 'Código inválido ou expirado.' });
  user.verified=true; delete user.verificationCode; delete user.codeExpires; await writeDb(db); res.json({ token: tokenFor(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const db=await readDb(), user=db.users.find(u=>u.email===String(req.body.email||'').toLowerCase());
  if (!user || !await bcrypt.compare(String(req.body.password||''), user.passwordHash)) return res.status(401).json({ error:'E-mail ou senha incorretos.' });
  if (!user.verified) return res.status(403).json({ error:'Confirme seu e-mail primeiro.', needsVerification:true });
  res.json({ token:tokenFor(user), user:publicUser(user) });
});

router.get('/me', auth, async (req,res)=>{ const db=await readDb(), user=db.users.find(u=>u.id===req.userId); res.json({ user:publicUser(user), friends:user.friends.map(fid=>publicUser(db.users.find(u=>u.id===fid))).filter(Boolean), requests:user.requests.map(fid=>publicUser(db.users.find(u=>u.id===fid))).filter(Boolean), servers:db.servers.filter(s=>s.members.some(m=>m.userId===req.userId)) }); });
router.post('/friends/request', auth, async (req,res)=>{ const db=await readDb(), target=db.users.find(u=>u.email===String(req.body.email||'').toLowerCase()), me=db.users.find(u=>u.id===req.userId); if(!target||target.id===me.id)return res.status(404).json({error:'Usuário não encontrado.'}); if(!target.requests.includes(me.id)&&!target.friends.includes(me.id))target.requests.push(me.id); await writeDb(db); res.json({ok:true}); });
router.post('/friends/accept', auth, async (req,res)=>{ const db=await readDb(), me=db.users.find(u=>u.id===req.userId), from=db.users.find(u=>u.id===req.body.userId); if(!from||!me.requests.includes(from.id))return res.status(404).json({error:'Pedido não encontrado.'}); me.requests=me.requests.filter(x=>x!==from.id); if(!me.friends.includes(from.id))me.friends.push(from.id); if(!from.friends.includes(me.id))from.friends.push(me.id); await writeDb(db); res.json({ok:true}); });

router.post('/servers', auth, async (req,res)=>{ const name=String(req.body.name||'').trim().slice(0,40); if(name.length<2)return res.status(400).json({error:'Digite um nome para o servidor.'}); const db=await readDb(), server={id:id(),name,ownerId:req.userId,inviteCode:crypto.randomBytes(3).toString('hex').toUpperCase(),roles:[{id:'owner',name:'Dono',permissions:['ADMINISTRATOR']},{id:'member',name:'Membro',permissions:['VIEW_CHANNEL','SEND_MESSAGES','CONNECT','SPEAK','VIDEO','SHARE_SCREEN']}],members:[{userId:req.userId,roleId:'owner'}]}; db.servers.push(server);await writeDb(db);res.json(server); });
router.post('/servers/join', auth, async (req,res)=>{ const db=await readDb(), server=db.servers.find(s=>s.inviteCode===String(req.body.inviteCode||'').toUpperCase());if(!server)return res.status(404).json({error:'Convite inválido.'});if(!server.members.some(m=>m.userId===req.userId))server.members.push({userId:req.userId,roleId:'member'});await writeDb(db);res.json(server); });
router.get('/servers/:serverId', auth, async (req,res)=>{const db=await readDb(),server=db.servers.find(s=>s.id===req.params.serverId&&s.members.some(m=>m.userId===req.userId));if(!server)return res.status(404).json({error:'Servidor não encontrado.'});res.json({...server,members:server.members.map(m=>({...m,user:publicUser(db.users.find(u=>u.id===m.userId))}))});});
router.post('/servers/:serverId/roles', auth, async (req,res)=>{ const db=await readDb(), server=db.servers.find(s=>s.id===req.params.serverId);if(!server||server.ownerId!==req.userId)return res.status(403).json({error:'Somente o dono pode criar cargos.'});const role={id:id(),name:String(req.body.name||'Cargo').slice(0,30),permissions:Array.isArray(req.body.permissions)?req.body.permissions.filter(p=>['VIEW_CHANNEL','SEND_MESSAGES','CONNECT','SPEAK','VIDEO','SHARE_SCREEN','MANAGE_ROLES','KICK_MEMBERS'].includes(p)):[]};server.roles.push(role);await writeDb(db);res.json(role); });
router.put('/servers/:serverId/members/:userId/role', auth, async (req,res)=>{ const db=await readDb(), server=db.servers.find(s=>s.id===req.params.serverId);if(!server||server.ownerId!==req.userId)return res.status(403).json({error:'Sem permissão.'});const member=server.members.find(m=>m.userId===req.params.userId);if(!member||!server.roles.some(r=>r.id===req.body.roleId))return res.status(404).json({error:'Membro ou cargo não encontrado.'});member.roleId=req.body.roleId;await writeDb(db);res.json({ok:true}); });

module.exports = router;
