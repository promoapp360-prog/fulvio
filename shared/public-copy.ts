export const PUBLIC_COPY = {
  heroTitle: "Benvenuti da Dog's Planet!",
  heroText: "La toelettatura professionale di riferimento di Cernusco sul Naviglio: competenza, cura, esperienza e tanto amore per il tuo Amico",
  fidelity: "La ricevi gratis registrandoti: accumula punti con servizi ed acquisti, scopri i vantaggi riservati a te.",
  grooming: "Lavaggio, taglio a forbice o con tosatrice, trattamenti di stripping o rimozione di sottopelo e muta, taglio unghie e tanto altro. Ci prendiamo cura di ogni nostro Ospite rispettando le sue esigenze e necessità, con prodotti di altissima qualità ed operatori esperti e premurosi.",
  steps: ["Accedi o registrati", "Scegli il giorno e l'orario preferiti", "Attendi la conferma del salone"],
  selfService: "Lava il tuo amico in autonomia, quando vuoi, nelle nostre postazioni professionali in acciaio inox, attrezzate con vasche apribili, acqua calda, aspiratore e soffiatore professionali. Ogni box ha un cancelletto di sicurezza, perché intimità e sicurezza siano sempre garantite. Se il tuo amico è grande e pesante, non fare sforzi: usa l'apposita slitta per farlo entrare in vasca.",
  selfServiceHow: "Tessera ricaricabile e shampoo si trovano nello stesso distributore automatico in negozio, che accetta banconote e monete.\n\nSegui le istruzioni presenti sul posto per utilizzare il lavaggio. Per qualsiasi dubbio contattaci.",
  fidelityPage: "Registrandoti ricevi gratuitamente la tua Fidelity Card digitale.\n\nAccumula punti con la tua fedeltà: con i nostri servizi, acquistando in negozio e sullo store, oppure presentandoci i tuoi amici. Puoi controllare punti, premi e sconti in ogni momento accedendo alla tua area personale.",
  shop: "La Poppy sta preparando qualcosa di speciale: la vendita online non è ancora pronta. Work in progress…",
};

/** Solo testi editoriali: non applicare a dati personali, identificatori o URL. */
export function publicText(value: string) {
  return value
    .replace(/dogsplanetcernusco@gmail\.com/gi, "info@dogsplanet.it")
    .replace(/\bon\s+line\b/gi, "online")
    .replace(/(?<!#)\bLaPappadiPoppy\b/g, "#LaPappadiPoppy")
    .replace(/\be (?=[aeiouàèéìòù])/gi, match => match === "E " ? "Ed " : "ed ");
}
