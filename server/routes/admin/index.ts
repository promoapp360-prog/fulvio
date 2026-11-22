import { Router } from "express";
import { isStaff } from "../../auth";
import agenda from "./agenda";
import crm from "./crm";
import catalog from "./catalog";
import staff from "./staff";
import money from "./money";
import shop from "./shop";
import content from "./content";
import marketing from "./marketing";
import stats from "./stats";
import system from "./system";

const r = Router();
r.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Accesso richiesto" });
  if (!isStaff(req.user)) return res.status(403).json({ error: "Area riservata al personale" });
  res.set("Cache-Control", "no-store");
  next();
});
for (const m of [agenda, crm, catalog, staff, money, shop, content, marketing, stats, system]) r.use(m);
export default r;
