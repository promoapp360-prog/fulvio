import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CustomerDogFields, { DogPhotoInput } from "../client/src/components/CustomerDogFields";
import { customerDogSchema, registrationSchema } from "../shared/customer-booking";

const essentials = { name: "Prova", species: "cane", breed: "Meticcio", size: "media",
  weightKg: "12", birthDate: "2021-01-01", coatType: "liscio", coatLength: "corto" };

test("registrazione valida senza alcun dato benessere o alimentazione", () => {
  const parsed = registrationSchema.parse({ firstName: "Prova", lastName: "Test", email: "test@example.invalid",
    password: "SoloPerIlTest123!", phone: "3330000000", city: "Cernusco", province: "MI",
    cap: "20063", birthDate: "1990-01-01", consentPrivacy: true, dog: essentials });
  assert.equal(parsed.dog.food.notes, "");
  assert.equal(parsed.dog.jointIssues, "");
  assert.equal(parsed.consentMarketing, false);
});

test("campi facoltativi vuoti o nulli non impongono risposte mediche inventate", () => {
  for (const field of ["jointIssues", "dermatitis", "intolerances", "sensitivities", "otherNeeds", "otherPets", "aggressiveNotes"]) {
    for (const value of ["", null, undefined])
      assert.equal(customerDogSchema.safeParse({ ...essentials, [field]: value }).success, true, field);
  }
  for (const food of [null, undefined, {}, { notes: "" }, { notes: null }])
    assert.equal(customerDogSchema.safeParse({ ...essentials, food }).success, true);
  assert.equal(customerDogSchema.safeParse({ ...essentials, aggressive: true, aggressiveNotes: "" }).success, true);
  assert.equal(customerDogSchema.safeParse({ ...essentials, sensitivities: "x".repeat(1001) }).success, false);
});

test("dati già presenti e limiti di validazione restano rispettati", () => {
  const dog = customerDogSchema.parse({ ...essentials, jointIssues: "Da maneggiare con cura",
    food: { dry: true, notes: "Alimento abituale" }, aggressive: true, aggressiveNotes: "Informazione fornita" });
  assert.equal(dog.jointIssues, "Da maneggiare con cura");
  assert.equal(dog.food.dry, true);
  assert.equal(dog.aggressiveNotes, "Informazione fornita");
  assert.equal(customerDogSchema.safeParse({ ...essentials, name: "" }).success, false);
});

test("il markup reale della sezione benessere non contiene campi required o asterischi", () => {
  const client = new QueryClient();
  client.setQueryData(["customer-dog-fields"], []);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(CustomerDogFields, { value: { ...essentials, aggressive: true }, onChange: () => {} })));
  const title = "Parlaci del Benessere del tuo Animale";
  const begin = html.indexOf(title);
  assert.ok(begin > -1);
  const section = html.slice(begin, html.indexOf("</fieldset>", begin));
  assert.ok(section.includes("facoltative"));
  assert.ok(!section.includes("required"));
  assert.ok(!section.includes("*"));
  client.clear();
});

test("la foto è indicata come facoltativa, con galleria e fotocamera ancora disponibili", () => {
  const html = renderToStaticMarkup(createElement(DogPhotoInput, { file: null, onChange: () => {} }));
  assert.ok(html.includes("Foto del tuo animale (facoltativa)"));
  assert.ok(html.includes("Scegli dalla galleria"));
  assert.ok(html.includes("Scatta una foto"));
  assert.ok(!html.includes("required"));
});
