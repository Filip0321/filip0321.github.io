// Variablen und was ich brauch

export const zustand = {
  format: "original",
  hintergrund: "#000000",
  transparent: false,

  pixelgroesse: 1, // welche Zahl hat der Slider bekommen
  ditherAn: false, // ist eine Checkbox, also Boolean
  stufen: 2,
  grau: true,

  vhsAn: false,
  crtAn: false,
  rahmenAn: false,
  rahmenTitel: "Unbekannt",

  teilung: 0,

  werte: { crt: {}, vhs: {}, rahmen: {} }, // bringen beide einige eigene Einstellungen mit
  // und können später auch erweitert werden
};
