import assert from "node:assert/strict";
import { test } from "node:test";
import { registrationSchema, registrationPhotoIndex, MAX_REGISTRATION_DOGS } from "../shared/customer-booking";
import { breedOptions, DOG_BREEDS } from "../shared/dog-breeds";

const dog = { name: "Poppy test", species: "cane", breed: "Meticcio", size: "media", weightKg: "12.5", birthDate: "2021-03-15", coatType: "mosso", coatLength: "medio" };
const owner = { firstName: "Prova", lastName: "Verifica", email: "test@example.invalid", phone: "3330000000", password: "TestRegistrazione123!",
  city: "Cernusco", province: "MI", cap: "20063", birthDate: "1990-01-01", consentPrivacy: true, consentMarketing: false };
test("registrazione: la vecchia scheda singola resta compatibile, benessere e foto facoltativi", () => {
  const data = registrationSchema.parse({ ...owner, dog });
  assert.equal(data.dogs.length, 1); assert.deepEqual(data.dog, data.dogs[0]);
  assert.equal(data.dog.jointIssues, ""); assert.equal(data.consentMarketing, false);
});
test("registrazione multipla: dati distinti, ordine stabile e identità del proprietario solo lato server", () => {
  const data = registrationSchema.parse({ ...owner, dogs: [dog, { ...dog, name: "Luna", breed: "Golden Retriever", ownerId: 99, id: 9 }] });
  assert.deepEqual(data.dogs.map(d => [d.name, d.breed]), [["Poppy test", "Meticcio"], ["Luna", "Golden Retriever"]]);
  assert.equal("ownerId" in data.dogs[1], false); assert.equal("id" in data.dogs[1], false);
});
test("registrazione multipla: scheda incompleta, liste ambigue e quantità fuori limite rifiutate", () => {
  for (const input of [{}, { dog, dogs: [dog] }, { dogs: [] }, { dogs: Array.from({ length: MAX_REGISTRATION_DOGS + 1 }, () => dog) },
    { dogs: [dog, { ...dog, name: "" }] }, { dogs: [dog], consentPrivacy: false }]) {
    assert.equal(registrationSchema.safeParse({ ...owner, ...input }).success, false);
  }
  assert.ok(registrationSchema.safeParse({ ...owner, dogs: Array.from({ length: MAX_REGISTRATION_DOGS }, () => dog) }).success);
});
test("foto: ogni campo corrisponde al proprio animale, niente indici fuori lista o legacy ambiguo", () => {
  assert.equal(registrationPhotoIndex("photo", 1), 0);
  assert.equal(registrationPhotoIndex("photo_0", 2), 0);
  assert.equal(registrationPhotoIndex("photo_1", 2), 1);
  for (const field of ["photo", "photo_2", "photo_-1", "photo_01", "photo_0x", "__proto__"]) assert.throws(() => registrationPhotoIndex(field, 2));
});
test("razze: elenco completo senza ricerca, ricerca mantenuta e scelte libere sempre disponibili", () => {
  const options = breedOptions();
  assert.equal(options.length, new Set(DOG_BREEDS).size);
  assert.ok(options.length > 300 && options.includes("Yorkshire Terrier"));
  assert.deepEqual(new Set(breedOptions("golden")), new Set(["Golden Retriever", "Meticcio", "Altra razza"]));
  assert.ok(breedOptions("brie").some(name => name.includes("Brie")));
  assert.deepEqual(breedOptions("nessuna corrispondenza test"), ["Meticcio", "Altra razza"]);
});
