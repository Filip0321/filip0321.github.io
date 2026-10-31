// Eigener Audio-Player, für jedes .player auf der Seite einer (Track, Feldaufnahme in der Fotoserie …)
// Ohne JavaScript bleibt der normale Player des Browsers (controls) stehen,
// mit JavaScript wird er versteckt und die eigene Leiste gezeigt.
//
// HTML dazu:
//   <div class="player">
//     <audio src="track.m4a" preload="metadata" controls></audio>
//     <div class="player-leiste" hidden>
//       <button class="play" type="button" aria-label="Abspielen">▶</button>
//       <input class="zeitleiste" type="range" min="0" max="100" step="0.1" value="0" aria-label="Position">
//       <span class="zeit"><span class="aktuell">0:00</span> / <span class="dauer">–:––</span></span>
//     </div>
//   </div>

const alleAudios = [];

function formatiere(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = Math.floor(sekunden % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// alles mit player.querySelector statt document.querySelector:
// so findet jeder Player nur seine eigenen Teile, auch wenn es mehrere auf der Seite gibt
function richtePlayerEin(player) {
  const audio = player.querySelector("audio");
  const knopf = player.querySelector(".play");
  const aktuell = player.querySelector(".aktuell");
  const dauer = player.querySelector(".dauer");
  const leiste = player.querySelector(".zeitleiste");
  let ziehtGerade = false;

  audio.controls = false; // den Player des Browsers verstecken
  player.querySelector(".player-leiste").hidden = false; // und die eigene Leiste zeigen
  alleAudios.push(audio);

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
    // immer nur einer auf einmal: startet dieser, halten die anderen an
    for (const anderes of alleAudios) {
      if (anderes !== audio) anderes.pause();
    }
    knopf.textContent = "❚❚";
    knopf.setAttribute("aria-label", "Pausieren");
  });

  audio.addEventListener("pause", () => {
    knopf.textContent = "▶︎";
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
}

document.querySelectorAll(".player").forEach(richtePlayerEin);
