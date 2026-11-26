import type { Dispatch, SetStateAction } from "react";
import { MAX_REGISTRATION_DOGS } from "@shared/customer-booking";
import CustomerDogFields, { DogPhotoInput, newCustomerDog } from "./CustomerDogFields";
import { Field } from "./ui";

export type RegistrationDog = { key: string; data: ReturnType<typeof newCustomerDog>; photo: File | null; photoBusy: boolean };
export const newRegistrationDog = (): RegistrationDog => ({ key: crypto.randomUUID(), data: newCustomerDog(), photo: null, photoBusy: false });

export default function RegistrationDogs({ pets, setPets, disabled }: {
  pets: RegistrationDog[]; setPets: Dispatch<SetStateAction<RegistrationDog[]>>; disabled: boolean;
}) {
  const update = (key: string, value: Partial<RegistrationDog>) => setPets(rows => rows.map(row => row.key === key ? { ...row, ...value } : row));
  const resize = (count: number) => {
    if (count < pets.length) {
      const filled = pets.slice(count).some(pet => !!pet.photo || JSON.stringify(pet.data) !== JSON.stringify(newCustomerDog()));
      if (filled && !window.confirm("Le schede che stai togliendo contengono dati o foto. Vuoi rimuoverle dalla registrazione?")) return;
    }
    setPets(rows => count < rows.length ? rows.slice(0, count) : [...rows, ...Array.from({ length: count - rows.length }, newRegistrationDog)]);
  };
  return <section className="space-y-4" aria-label="Animali da registrare">
    <Field label="Quanti cani hai?" hint={`Una scheda per ciascuno, fino a ${MAX_REGISTRATION_DOGS} alla volta. Puoi aggiungerne altri dalla tua area personale. Se hai un gatto, scegli la specie nella sua scheda.`}>
      <select className="input min-h-12" value={pets.length} disabled={disabled || pets.some(pet => pet.photoBusy)} onChange={e => resize(Number(e.target.value))}>
        {Array.from({ length: MAX_REGISTRATION_DOGS }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count === 1 ? "1 animale" : `${count} animali`}</option>)}
      </select>
    </Field>
    {pets.map((pet, index) => <fieldset key={pet.key} disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-sky-200 bg-white p-3 sm:p-4" data-testid={`registration-pet-${index}`}>
      <legend className="max-w-full break-words px-2 font-bold text-brand-navy">Animale {index + 1}{pet.data.name ? ` · ${pet.data.name}` : ""}</legend>
      <CustomerDogFields value={pet.data} onChange={data => update(pet.key, { data })} />
      <DogPhotoInput file={pet.photo} onChange={photo => update(pet.key, { photo })} onProcessingChange={photoBusy => update(pet.key, { photoBusy })} />
    </fieldset>)}
  </section>;
}
