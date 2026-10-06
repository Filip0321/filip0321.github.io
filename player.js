const audio = document.querySelector("audio");
const knopf = document.querySelector(".play");
const aktuell = document.querySelector(".aktuell");
const dauer = document.querySelector(".dauer");
const leiste = document.querySelector(".zeitleiste");
let ziehtGerade = false;

function formatiere(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = Math.floor(sekunden % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function zeigeDauer() {
  dauer.textContent = formatiere(audio.duration);
  leiste.max = audio.duration;
}

knopf.addEventListener("click", () => {
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
});

audio.addEventListener("play", () => {
  knopf.textContent = "❚❚";
  knopf.setAttribute("aria-label", "Pausieren");
});

audio.addEventListener("pause", () => {
  knopf.textContent = "\u25B6\uFE0E";
  knopf.setAttribute("aria-label", "Abspielen");
});

audio.addEventListener("timeupdate", () => {
  if (!ziehtGerade) {
    leiste.value = audio.currentTime;
    aktuell.textContent = formatiere(audio.currentTime);
  }
});

audio.addEventListener("loadedmetadata", zeigeDauer);

if (audio.readyState >= 1) {
  zeigeDauer();
}

leiste.addEventListener("input", () => {
  ziehtGerade = true;
  aktuell.textContent = formatiere(Number(leiste.value));
});

leiste.addEventListener("change", () => {
  audio.currentTime = Number(leiste.value);
  ziehtGerade = false;
});