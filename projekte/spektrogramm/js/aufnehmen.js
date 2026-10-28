import { zeigeMeldung } from "./seite.js";
import { aufnahmeZiel } from "./audio.js";
import { zeitstempel } from "/lib/export.js";

const aufnehmenKnopf = hole("aufnehmenKnopf");

let rekorder = null;
let teile = [];
let startZeit = 0;
let uhrId = null;
const zuhoerer = [];

export function beiAufnahme(funktion) {
  zuhoerer.push(funktion);
  // funktionen für die fertige Aufname
}

function waehleFormat() {
  const FORMATE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  return FORMATE.find((typ) => MediaRecorder.isTypeSupported(typ)) ?? "";
}

function starteAufnahme() {
  if (!aufnahmeZiel) {
    zeigeMeldung("Erst Start drücken, dann aufnehmen.");
    return; // ohne Start gibt es keinen Ton zum Aufnehmen, sonst Fehler bei aufnahmeZiel.stream
  }
  const format = waehleFormat();
  rekorder = new MediaRecorder(aufnahmeZiel.stream, {
    mimeType: format,
    audioBitsPerSecond: 256000,
  });
  teile = [];
  rekorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) teile.push(event.data);
  });
  rekorder.addEventListener("stop", fertig);
  rekorder.start(1000);

  startZeit = performance.now();
  uhrId = setInterval(zeigeUhr, 250);
  zeigeUhr();
}

function zeigeUhr() {
  const sekunden = Math.floor((performance.now() - startZeit) / 1000);
  const m = Math.floor(sekunden / 60);
  const s = String(sekunden % 60).padStart(2, "0");
  aufnehmenKnopf.textContent = `Stopp ${m}:${s}`;
}

export function stoppeAufnahme() {
  if (!rekorder || rekorder.state === "inactive") return;
  rekorder.stop(); 
}

function fertig() {
  clearInterval(uhrId);
  aufnehmenKnopf.textContent = "Aufnehmen";
  const typ = rekorder.mimeType;
  rekorder = null;

  const endung = typ.includes("mp4") ? "m4a" : typ.includes("ogg") ? "ogg" : "webm";
  const datei = new File(teile, `aufnahme-${zeitstempel()}.${endung}`, { type: typ });
  teile = [];
  for (const funktion of zuhoerer) funktion(datei);
}

aufnehmenKnopf.addEventListener("click", () => {
  zeigeMeldung("");
  if (rekorder) stoppeAufnahme();
  else starteAufnahme();
});
