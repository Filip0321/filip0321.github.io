// Alle Module aus Runde 17, nach Gruppen in eigenen Dateien. module.js legt sie zu TYPEN dazu.
// Reihenfolge in der Auswahl: erst nach Gruppe (wie in module.js), darin in dieser Reihenfolge.
import { KLANG } from "./module-klang.js";
import { STEUERUNG } from "./module-steuerung.js";
import { EFFEKTE } from "./module-effekte.js";

export const NEUE_MODULE = { ...KLANG, ...STEUERUNG, ...EFFEKTE };
