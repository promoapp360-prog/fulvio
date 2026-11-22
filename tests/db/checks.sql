-- Controlli di integrità del database (ogni blocco fallisce con un'eccezione se il vincolo non funziona)
\set QUIET on
BEGIN;
INSERT INTO users (id, email, password_hash, role, first_name, last_name) VALUES (1, 'cliente@test.it', 'x', 'customer', 'Mario', 'Rossi');
INSERT INTO users (id, email, password_hash, role, first_name, last_name, username) VALUES (2, 'admin@test.it', 'x', 'admin', 'Fulvio', 'DP', 'Admin');
INSERT INTO dogs (id, owner_id, name, size) VALUES (1, 1, 'Fido', 'media');
INSERT INTO services (id, name, slug, duration_min) VALUES (1, 'Lavaggio', 'lavaggio', 60);
INSERT INTO operators (id, name) VALUES (1, 'Martina');
INSERT INTO appointments (id, customer_id, dog_id, service_id, operator_id, start_at, end_at, duration_min, status, final_price_cents)
  VALUES (1, 1, 1, 1, 1, '2026-12-01 09:00+01', '2026-12-01 10:00+01', 60, 'completata', 4000);

-- 1. username unico senza distinzione maiuscole
DO $$ BEGIN
  BEGIN INSERT INTO users (email, password_hash, role, first_name, last_name, username) VALUES ('x@test.it','x','manager','A','B','admin');
    RAISE EXCEPTION 'FALLITO: username duplicato accettato';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK username unico'; END;
END $$;

-- 2. ruolo non valido rifiutato
DO $$ BEGIN
  BEGIN INSERT INTO users (email, password_hash, role, first_name, last_name) VALUES ('y@test.it','x','staff','A','B');
    RAISE EXCEPTION 'FALLITO: ruolo staff accettato';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK ruoli'; END;
END $$;

-- 3. appuntamento con fine precedente all'inizio rifiutato
DO $$ BEGIN
  BEGIN INSERT INTO appointments (customer_id, dog_id, service_id, start_at, end_at, duration_min) VALUES (1,1,1,'2026-12-01 10:00+01','2026-12-01 09:00+01',60);
    RAISE EXCEPTION 'FALLITO: orari invertiti accettati';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK orari appuntamento'; END;
END $$;

-- 4. lo stesso pagamento del provider non può essere registrato due volte
INSERT INTO payments (appointment_id, customer_id, kind, method, amount_cents, provider, provider_ref) VALUES (1, 1, 'saldo', 'online', 4000, 'stripe', 'cs_test_1');
DO $$ BEGIN
  BEGIN INSERT INTO payments (appointment_id, customer_id, kind, method, amount_cents, provider, provider_ref) VALUES (1, 1, 'saldo', 'online', 4000, 'stripe', 'cs_test_1');
    RAISE EXCEPTION 'FALLITO: pagamento duplicato accettato';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK pagamenti non duplicati'; END;
END $$;

-- 5. un solo accredito punti per appuntamento; storno e utilizzi ammessi
INSERT INTO loyalty_cards (id, customer_id, code, points) VALUES (1, 1, 'DP00000001', 0);
INSERT INTO loyalty_transactions (card_id, points, remaining, kind, reason, appointment_id) VALUES (1, 40, 40, 'accumulo', 'Servizio', 1);
INSERT INTO loyalty_transactions (card_id, points, kind, reason, appointment_id) VALUES (1, -20, 'storno', 'Rimborso', 1);
DO $$ BEGIN
  BEGIN INSERT INTO loyalty_transactions (card_id, points, remaining, kind, reason, appointment_id) VALUES (1, 40, 40, 'accumulo', 'Doppio', 1);
    RAISE EXCEPTION 'FALLITO: doppio accredito accettato';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK accredito punti unico'; END;
END $$;

-- 6. liquidazione: una sola per operatore e settimana
INSERT INTO staff_settlements (operator_id, week_start, week_end, minutes, gross_cents, total_cents) VALUES (1, '2026-11-15', '2026-11-21', 465, 7750, 7750);
DO $$ BEGIN
  BEGIN INSERT INTO staff_settlements (operator_id, week_start, week_end, minutes, gross_cents, total_cents) VALUES (1, '2026-11-15', '2026-11-21', 1, 1, 1);
    RAISE EXCEPTION 'FALLITO: liquidazione doppia accettata';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK liquidazione unica'; END;
END $$;

-- 7. contatti importati: stato marketing predefinito "non_richiesto", mai "concesso" in automatico
INSERT INTO privacy_contacts (email, consent_marketing) VALUES ('import@test.it', false);
DO $$ BEGIN
  IF (SELECT marketing_status FROM privacy_contacts WHERE email = 'import@test.it') <> 'non_richiesto' THEN RAISE EXCEPTION 'FALLITO: stato marketing predefinito'; END IF;
  RAISE NOTICE 'OK stato marketing predefinito';
END $$;

-- 8. storico consensi: deve riferirsi a un cliente o a un contatto
DO $$ BEGIN
  BEGIN INSERT INTO customer_consents (kind, granted, source) VALUES ('marketing', true, 'test');
    RAISE EXCEPTION 'FALLITO: consenso senza soggetto accettato';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK soggetto consenso'; END;
END $$;

-- 9. email: deduplica per chiave (es. promemoria dello stesso appuntamento)
INSERT INTO email_queue (to_email, subject, html, dedupe_key) VALUES ('a@test.it','s','h','reminder:1');
DO $$ BEGIN
  BEGIN INSERT INTO email_queue (to_email, subject, html, dedupe_key) VALUES ('a@test.it','s','h','reminder:1');
    RAISE EXCEPTION 'FALLITO: email duplicata accettata';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK deduplica email'; END;
END $$;

-- 10. query dei report (stessa struttura usata da /api/admin/stats)
SELECT coalesce(sum(case when p.kind = 'rimborso' then -p.amount_cents else p.amount_cents end) filter (where p.appointment_id is not null), 0)::int AS grooming
  FROM payments p WHERE p.status = 'pagato';
SELECT o.name, count(a.*) filter (where a.status in ('confermata','completata'))::int AS n FROM operators o LEFT JOIN appointments a ON a.operator_id = o.id GROUP BY o.id;
SELECT count(*) FROM (SELECT customer_id FROM appointments WHERE status = 'completata' GROUP BY customer_id HAVING count(*) >= 4) x;
SELECT d.id FROM dogs d JOIN LATERAL (SELECT a.start_at FROM appointments a WHERE a.dog_id = d.id AND a.status = 'completata' ORDER BY a.start_at DESC LIMIT 1) last ON true
  WHERE coalesce(d.recall_days, 30) IS NOT NULL AND last.start_at + make_interval(days => coalesce(d.recall_days, 30)) <= now();
SELECT regexp_replace(coalesce('+39 389 908 2610', ''), '\D', '', 'g') = '393899082610' AS phone_ok;
ROLLBACK;
