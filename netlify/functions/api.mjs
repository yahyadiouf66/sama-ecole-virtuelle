import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

const store = getStore({ name: "sama-ecole-virtuelle", consistency: "strong" });

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...extra }
  });
}

function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return Object.fromEntries(raw.split(";").map(x => {
    const i = x.indexOf("=");
    if (i < 0) return [x.trim(), ""];
    return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1).trim())];
  }).filter(([k]) => k));
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function makeSession() {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const payload = `${exp}`;
  return `${payload}.${sign(payload)}`;
}

function validSession(request) {
  const token = parseCookies(request).sama_admin;
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function readJSON() {
  const data = await store.get("state.json", { type: "json", consistency: "strong" });
  return data && typeof data === "object" ? data : {
    version: 1,
    openings: [],
    candidates: [],
    notifications: []
  };
}

async function writeJSON(data) {
  await store.setJSON("state.json", data);
}

function cleanText(v, max=2000) {
  return String(v ?? "").trim().slice(0, max);
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

function unauthorized() {
  return json({ error: "Non autorisé." }, 401);
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "public";

    // Toutes les opérations de modification passent par le même site.
    if (!sameOrigin(request)) return json({ error: "Origine refusée." }, 403);

    if (request.method === "GET" && action === "public") {
      const state = await readJSON();
      return json({
        openings: (state.openings || []).filter(o => o.active !== false).sort((a,b) => String(a.subject).localeCompare(String(b.subject), "fr"))
      });
    }

    if (request.method === "POST" && action === "login") {
      const body = await request.json();
      const supplied = String(body?.password ?? "");
      const a = crypto.createHash("sha256").update(supplied).digest();
      const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
      if (!crypto.timingSafeEqual(a,b)) return json({ error: "Identifiants incorrects." }, 401);
      return json({ ok: true }, 200, {
        "Set-Cookie": `sama_admin=${encodeURIComponent(makeSession())}; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax`
      });
    }

    if (request.method === "POST" && action === "logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": "sama_admin=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
      });
    }

    if (request.method === "POST" && action === "candidate") {
      const body = await request.json();
      const candidate = {
        id: cleanText(body?.id, 80) || makeId("CAND"),
        name: cleanText(body?.name, 120),
        whatsapp: cleanText(body?.whatsapp, 40),
        subject: cleanText(body?.subject, 120),
        grade: cleanText(body?.grade, 120),
        computer: body?.computer === true,
        wifi: body?.wifi === true,
        bio: cleanText(body?.bio, 1800),
        date: cleanText(body?.date, 60) || new Date().toISOString(),
        status: "En attente"
      };

      if (!candidate.name || !candidate.whatsapp || !candidate.subject || !candidate.grade || !candidate.bio || !candidate.computer || !candidate.wifi) {
        return json({ error: "Tous les champs obligatoires doivent être renseignés." }, 400);
      }

      const state = await readJSON();
      const openingExists = (state.openings || []).some(o =>
        o.active !== false &&
        String(o.subject).trim() === candidate.subject &&
        String(o.grade).trim() === candidate.grade
      );
      if (!openingExists) return json({ error: "Ce recrutement n'est plus ouvert." }, 409);

      const already = (state.candidates || []).some(c =>
        String(c.whatsapp).replace(/\D/g,"") === String(candidate.whatsapp).replace(/\D/g,"") &&
        String(c.subject).trim() === candidate.subject &&
        String(c.grade).trim() === candidate.grade &&
        String(c.status || "En attente") !== "Refusé"
      );
      if (already) return json({ error: "Une candidature avec ce numéro WhatsApp existe déjà pour cette matière et cette classe." }, 409);

      state.candidates = [candidate, ...(state.candidates || [])];
      state.notifications = [{
        id: makeId("NOTIF"),
        type: "candidate",
        candidateId: candidate.id,
        message: `Nouvelle candidature : ${candidate.name} — ${candidate.subject} — ${candidate.grade}`,
        date: new Date().toISOString(),
        read: false
      }, ...(state.notifications || [])].slice(0, 200);
      await writeJSON(state);
      return json({ ok: true, candidateId: candidate.id }, 201);
    }

    // Admin-only from here.
    if (!validSession(request)) return unauthorized();

    if (request.method === "GET" && action === "admin-data") {
      const state = await readJSON();
      return json({
        openings: state.openings || [],
        candidates: state.candidates || [],
        notifications: state.notifications || []
      });
    }

    if (request.method === "POST" && action === "opening") {
      const body = await request.json();
      const opening = {
        id: cleanText(body?.id, 80) || makeId("OPEN"),
        subject: cleanText(body?.subject, 120),
        grade: cleanText(body?.grade, 120),
        requirement: cleanText(body?.requirement, 700),
        date: new Date().toISOString(),
        active: true
      };
      if (!opening.subject || !opening.grade) return json({ error: "Matière et classe obligatoires." }, 400);

      const state = await readJSON();
      const duplicate = (state.openings || []).some(o =>
        o.active !== false && String(o.subject).trim() === opening.subject && String(o.grade).trim() === opening.grade
      );
      if (duplicate) return json({ error: "Ce recrutement existe déjà." }, 409);

      state.openings = [...(state.openings || []), opening];
      await writeJSON(state);
      return json({ ok: true, opening }, 201);
    }

    if (request.method === "PATCH" && action === "opening") {
      const body = await request.json();
      const oid = cleanText(body?.id, 80);
      const state = await readJSON();
      const idx = (state.openings || []).findIndex(o => String(o.id) === oid);
      if (idx < 0) return json({ error: "Recrutement introuvable." }, 404);

      state.openings[idx] = {
        ...state.openings[idx],
        subject: cleanText(body?.subject, 120),
        grade: cleanText(body?.grade, 120),
        requirement: cleanText(body?.requirement, 700),
        active: body?.active !== false
      };
      await writeJSON(state);
      return json({ ok: true, opening: state.openings[idx] });
    }

    if (request.method === "DELETE" && action === "opening") {
      const body = await request.json();
      const oid = cleanText(body?.id, 80);
      const state = await readJSON();
      const before = (state.openings || []).length;
      state.openings = (state.openings || []).filter(o => String(o.id) !== oid);
      if (state.openings.length === before) return json({ error: "Recrutement introuvable." }, 404);
      await writeJSON(state);
      return json({ ok: true });
    }

    if (request.method === "PATCH" && action === "candidate") {
      const body = await request.json();
      const cid = cleanText(body?.id, 80);
      const status = cleanText(body?.status, 40);
      if (!["En attente","Accepté","Refusé"].includes(status)) return json({ error: "Statut invalide." }, 400);
      const state = await readJSON();
      const idx = (state.candidates || []).findIndex(c => String(c.id) === cid);
      if (idx < 0) return json({ error: "Candidature introuvable." }, 404);
      state.candidates[idx] = { ...state.candidates[idx], status, updatedAt: new Date().toISOString() };
      state.notifications = [{
        id: makeId("NOTIF"),
        type: "decision",
        candidateId: cid,
        message: `${state.candidates[idx].name} : candidature ${status.toLowerCase()}.`,
        date: new Date().toISOString(),
        read: false
      }, ...(state.notifications || [])].slice(0, 200);
      await writeJSON(state);
      return json({ ok: true, candidate: state.candidates[idx] });
    }

    if (request.method === "DELETE" && action === "candidate") {
      const body = await request.json();
      const cid = cleanText(body?.id, 80);
      const state = await readJSON();
      const before = (state.candidates || []).length;
      state.candidates = (state.candidates || []).filter(c => String(c.id) !== cid);
      if (state.candidates.length === before) return json({ error: "Candidature introuvable." }, 404);
      state.notifications = (state.notifications || []).filter(n => String(n.candidateId) !== cid);
      await writeJSON(state);
      return json({ ok: true });
    }

    if (request.method === "POST" && action === "notifications-read") {
      const state = await readJSON();
      state.notifications = (state.notifications || []).map(n => ({...n, read:true}));
      await writeJSON(state);
      return json({ ok: true });
    }

    return json({ error: "Action inconnue." }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Erreur interne du serveur." }, 500);
  }
};
