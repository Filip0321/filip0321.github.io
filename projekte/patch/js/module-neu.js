// Alle Module ab Runde 17, nach Gruppen in eigenen Dateien. module.js legt sie zu TYPEN dazu.
// Reihenfolge in der Auswahl: erst nach Gruppe (wie in module.js), darin in dieser Reihenfolge.
import { KLANG } from "./module-klang.js";
import { STEUERUNG } from "./module-steuerung.js";
import { EFFEKTE } from "./module-effekte.js";
import { NOTEN_MODULE } from "./module-noten.js"; // Runde 21
import { WERKZEUG_MODULE } from "./module-werkzeug.js"; // Runde 21: Rechnen und Zufall wie in Max
import { NATUR_MODULE } from "./module-natur.js"; // Runde 21: Geräusche aus der Natur, nachgebaut
import { SAMPLER_MODULE } from "./module-sampler.js"; // Runde 22: Schleife, Sampler, Kohle
import { STIMME_MODULE } from "./module-stimme.js"; // Runde 22: die Stimme aus /projekte/stimme
import { BAUKASTEN_MODULE } from "./module-baukasten.js"; // Runde 22b: Salve, Kurve, Shaper, Pling
import { SPUREN_MODULE } from "./module-spuren.js"; // Runde 23b: Kanal und Clips
import { PHYSIK_MODULE } from "./module-physik.js"; // Runde 24: Blasrohr und Bogen (Wellenleiter)
import { ABC_MODULE } from "./module-abc.js"; // Runde 25: Noten als Text (ABC-Notation)

export const NEUE_MODULE = { ...KLANG, ...STEUERUNG, ...EFFEKTE, ...NOTEN_MODULE, ...WERKZEUG_MODULE, ...NATUR_MODULE, ...SAMPLER_MODULE, ...STIMME_MODULE, ...BAUKASTEN_MODULE, ...SPUREN_MODULE, ...PHYSIK_MODULE, ...ABC_MODULE };
