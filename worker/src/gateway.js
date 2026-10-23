// Envelope encryption: RSA-OAEP(SHA-256) wraps AES-256-GCM request/response.
// Payload and personalized data never enter public GitHub plaintext.
const enc = new TextEncoder();
const dec = new TextDecoder();
const from64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const to64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const pem = value => from64(value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, ""));
const rsaOptions = {name: "RSA-OAEP", hash: "SHA-256"};
const maxEnvelopeLength = 22000;

async function openEnvelope(encoded, privatePem) {
  if (!encoded.startsWith("enc-v1:") || encoded.length > maxEnvelopeLength) throw Error("invalid_envelope");
  const envelope = JSON.parse(dec.decode(from64(encoded.slice(7))));
  if (envelope.v !== 1 || !envelope.ek || !envelope.iv || !envelope.ct) throw Error("invalid_envelope");
  const key = await crypto.subtle.importKey("pkcs8", pem(privatePem), rsaOptions, false, ["decrypt"]);
  const symmetric = await crypto.subtle.decrypt({name:"RSA-OAEP"}, key, from64(envelope.ek));
  const aes = await crypto.subtle.importKey("raw", symmetric, "AES-GCM", false, ["decrypt"]);
  const raw = await crypto.subtle.decrypt({name:"AES-GCM", iv:from64(envelope.iv)}, aes, from64(envelope.ct));
  const obj = JSON.parse(dec.decode(raw));
  if (!obj || typeof obj !== "object") throw Error("invalid_payload");
  return obj;
}

async function sealEnvelope(data, publicPem) {
  if (typeof publicPem !== "string" || publicPem.length > 1700) throw Error("invalid_reply_key");
  const key = await crypto.subtle.importKey("spki", pem(publicPem), rsaOptions, false, ["encrypt"]);
  const symmetric = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({name:"RSA-OAEP"}, key, symmetric);
  const aes = await crypto.subtle.importKey("raw", symmetric, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM",iv}, aes, enc.encode(JSON.stringify(data)));
  return "enc-v1:"+to64(enc.encode(JSON.stringify({v:1,ek:to64(wrapped),iv:to64(iv),ct:to64(ciphertext)})));
}

export async function handleGateway(env, request) {
  if (!env.GATEWAY_PRIVATE_KEY) return {status:503, body:{error:"gateway_unconfigured"}};
  if (request.caller !== "Johnny-Kao" || !Number.isSafeInteger(request.request_id) || request.request_id <= 0)
    return {status:403,body:{error:"not_authorized"}};
  try {
    const query = await openEnvelope(request.envelope,env.GATEWAY_PRIVATE_KEY);
    const op = query.op;
    let result;
    if(op === "status"){
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM candidates").first();
      const recent = await env.DB.prepare("SELECT kind,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 10").all();
      result = {op, candidate_count:count?.n||0, recent_jobs:recent.results};
    } else if(op === "shortlist") {
      const limit = Math.max(1,Math.min(Number(query.limit)||12,25));
      const rows = await env.DB.prepare("SELECT id,pub,title,url,published FROM candidates ORDER BY published DESC LIMIT ?").bind(limit).all();
      result = {op,candidates:rows.results};
    } else if(op === "policy"){
      result = {op, mode:"read_only", writing:"disabled", approval_policy:"explicit user approval for exact target and body"};
    } else return {status:400,body:{error:"unsupported_operation"}};
    const reply=await sealEnvelope({request_id:request.request_id,ok:true,data:result},query.reply_pub);
    return {status:200,body:{ok:true,reply}};
  } catch(e) {return {status:400,body:{error:"invalid_encrypted_request"}};}
}
