import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { h } from "../util";
import { requestMembership } from "../services/loyalty-membership";
import { audit } from "../services/audit";
const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, keyGenerator: req => String(req.user!.id), standardHeaders: true, legacyHeaders: false });
r.post("/loyalty/claim", limiter, h(async (req, res) => {
  const { code } = z.object({ code: z.string().trim().toUpperCase().regex(/^DP\d{8}$/, "Inserisci il numero tessera DP seguito da 8 cifre") }).parse(req.body);
  const out = await requestMembership(code, req.user!.id);
  await audit(req, "fidelity_claim_request", "user", req.user!.id, { linked: out.linked });
  res.json(out);
}));
export default r;
